#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: guard-ai-access-schema-rollback.sh <public-releases> <backend-releases> <release-name-or-empty> <live-database-file>" >&2
  exit 64
fi

public_releases="$1"
backend_releases="$2"
release_name="$3"
access_database="$4"

if [ -n "${release_name}" ]; then
  if ! printf '%s\n' "${release_name}" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$' ||
    printf '%s\n' "${release_name}" | grep -q '\.\.'; then
    echo "Invalid rollback release name." >&2
    exit 64
  fi
fi

select_release() {
  release_root="$1"
  selected_name="${release_name}"
  if [ -z "${selected_name}" ] && [ -d "${release_root}" ]; then
    selected_name="$(
      find "${release_root}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
        grep -E '^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$' |
        grep -v '\.\.' | LC_ALL=C sort | tail -n 2 | head -n 1
    )"
  fi
  candidate="${release_root}/${selected_name}"
  if [ -n "${selected_name}" ] && [ -d "${candidate}" ] && [ ! -L "${candidate}" ]; then
    printf '%s\n' "${candidate}"
  fi
}

target_public="$(select_release "${public_releases}")"
target_backend="$(select_release "${backend_releases}")"

if { [ -n "${target_public}" ] || [ -n "${target_backend}" ]; } && [ -f "${access_database}" ]; then
  command -v sqlite3 >/dev/null 2>&1 || {
    echo "Rollback refused before changing release symlinks: sqlite3 is required to verify the live AI database schema." >&2
    exit 69
  }

  if [ -n "${target_backend}" ]; then
    [ -f "${target_backend}/ai-access-service.js" ] || {
      echo "Rollback refused before changing release symlinks: the target backend does not declare AI_ACCESS_SCHEMA_VERSION." >&2
      echo "Restore a verified database backup matching the target backend, then retry the rollback." >&2
      exit 78
    }
    target_ai_access_schema_version="$(
      sed -nE 's/^[[:space:]]*const[[:space:]]+SCHEMA_VERSION[[:space:]]*=[[:space:]]*([0-9]+);[[:space:]]*$/\1/p' \
        "${target_backend}/ai-access-service.js" | head -n 1
    )"
    case "${target_ai_access_schema_version}" in
      ''|*[!0-9]*)
        echo "Rollback refused before changing release symlinks: could not read the target AI_ACCESS_SCHEMA_VERSION." >&2
        exit 78
        ;;
    esac
  fi

  live_ai_access_schema_version="$(
    sqlite3 -cmd ".timeout 10000" "${access_database}" "PRAGMA user_version;"
  )" || {
    echo "Rollback refused before changing release symlinks: could not read the live AI database schema." >&2
    exit 74
  }
  case "${live_ai_access_schema_version}" in
    ''|*[!0-9]*)
      echo "Rollback refused before changing release symlinks: the live AI database returned an invalid schema version." >&2
      exit 74
      ;;
  esac

  if [ -n "${target_backend}" ]; then
    if [ "${live_ai_access_schema_version}" -gt "${target_ai_access_schema_version}" ]; then
      echo "Rollback refused before changing release symlinks: live AI database schema ${live_ai_access_schema_version} is newer than target AI_ACCESS_SCHEMA_VERSION ${target_ai_access_schema_version}." >&2
      echo "Stop uartdebug-ai.service and restore the matching verified pre-migration ai-access.sqlite backup under /var/backups/uartdebug-ai, then retry this rollback." >&2
      exit 78
    fi
    echo "Rollback schema guard passed: live schema ${live_ai_access_schema_version}, target supports ${target_ai_access_schema_version}." >&2
  fi

  # Workspace rows exist from database schema 2 onward. Chat formats evolve
  # within those rows without changing PRAGMA user_version.
  if [ "${live_ai_access_schema_version}" -ge 2 ]; then
    live_conversation_schema_version="$(
      sqlite3 -readonly -cmd ".timeout 10000" "${access_database}" "
        SELECT COALESCE(MAX(version), 0) FROM (
          SELECT json_extract(payload_json, '$.draftConversation.schemaVersion') AS version
            FROM account_workspace_snapshots WHERE data_type = 'files'
          UNION ALL
          SELECT json_extract(project.value, '$.conversation.schemaVersion')
            FROM account_workspace_snapshots, json_each(payload_json, '$.miniProjects') AS project
            WHERE data_type = 'files'
        );"
    )" || {
      echo "Rollback refused before changing release symlinks: could not read the live project chat format." >&2
      exit 78
    }
    if ! [[ "${live_conversation_schema_version}" =~ ^(0|[1-9][0-9]{0,5})$ ]]; then
      echo "Rollback refused before changing release symlinks: the live project chat format is invalid." >&2
      exit 78
    fi
    if [ "${live_conversation_schema_version}" -ge 5 ]; then
      read_conversation_capability() {
        if [ -n "$1" ] && [ -f "$1/$2" ]; then
          sed -nE 's/^[[:space:]]*const[[:space:]]+CONVERSATION_SCHEMA_VERSION[[:space:]]*=[[:space:]]*([0-9]+);[[:space:]]*$/\1/p' "$1/$2" | head -n 1
        fi
      }
      target_frontend_conversation_version="$(read_conversation_capability "${target_public}" "avr-project-chat.js")"
      target_backend_conversation_version="$(read_conversation_capability "${target_backend}" "avr-conversation-contract.js")"
      target_frontend_conversation_version="${target_frontend_conversation_version:-0}"
      target_backend_conversation_version="${target_backend_conversation_version:-0}"
      if ! [[ "${target_frontend_conversation_version}" =~ ^(0|[1-9][0-9]{0,5})$ &&
              "${target_backend_conversation_version}" =~ ^(0|[1-9][0-9]{0,5})$ ]] ||
          [ "${target_frontend_conversation_version}" -lt "${live_conversation_schema_version}" ] ||
          [ "${target_backend_conversation_version}" -lt "${live_conversation_schema_version}" ]; then
        echo "Rollback refused before changing release symlinks: live project chat format ${live_conversation_schema_version} requires compatible frontend and backend readers (target ${target_frontend_conversation_version}/${target_backend_conversation_version})." >&2
        echo "Choose a compatible release or restore its matching verified database backup before retrying." >&2
        exit 78
      fi
      echo "Rollback chat guard passed: live format ${live_conversation_schema_version}, target readers ${target_frontend_conversation_version}/${target_backend_conversation_version}." >&2
    fi
  fi
fi

printf '%s\n%s\n' "${target_public}" "${target_backend}"

#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "usage: guard-ai-access-schema-rollback.sh <public-releases> <backend-releases> <python-releases> <release-name-or-empty> <live-database-file>" >&2
  exit 64
fi

public_releases="$1"
backend_releases="$2"
python_releases="$3"
release_name="$4"
access_database="$5"

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
target_python="$(select_release "${python_releases}")"

if [ -n "${target_backend}" ] && [ -f "${access_database}" ]; then
  [ -f "${target_backend}/ai-access-service.js" ] || {
    echo "Rollback refused before changing release symlinks: the target backend does not declare AI_ACCESS_SCHEMA_VERSION." >&2
    echo "Restore a verified database backup matching the target backend, then retry the rollback." >&2
    exit 78
  }
  command -v sqlite3 >/dev/null 2>&1 || {
    echo "Rollback refused before changing release symlinks: sqlite3 is required to verify the live AI database schema." >&2
    exit 69
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

  if [ "${live_ai_access_schema_version}" -gt "${target_ai_access_schema_version}" ]; then
    echo "Rollback refused before changing release symlinks: live AI database schema ${live_ai_access_schema_version} is newer than target AI_ACCESS_SCHEMA_VERSION ${target_ai_access_schema_version}." >&2
    echo "Stop uartdebug-ai.service and restore the matching verified pre-migration ai-access.sqlite backup under /var/backups/uartdebug-ai, then retry this rollback." >&2
    exit 78
  fi
  echo "Rollback schema guard passed: live schema ${live_ai_access_schema_version}, target supports ${target_ai_access_schema_version}." >&2
fi

printf '%s\n%s\n%s\n' "${target_public}" "${target_backend}" "${target_python}"

#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: backup-ai-access-database.sh <database-file> <backup-directory>" >&2
  exit 64
fi

database_file="$1"
backup_root="$2"
retention_root="/var/backups/uartdebug-ai"
retention_keep=10
retention_name_pattern='^[0-9]{8}T[0-9]{6}Z-pre-migration-[0-9a-f]{7}$'

prune_verified_pre_migration_backups() {
  requested_backup_root="$1"
  requested_parent="$(dirname -- "${requested_backup_root}")"
  requested_name="$(basename -- "${requested_backup_root}")"

  # Manual installer and unrelated operational backups deliberately stay out of
  # this retention set. Only workflow-created pre-migration directories match.
  if [ "${requested_parent}" != "${retention_root}" ] ||
    ! printf '%s\n' "${requested_name}" | grep -Eq "${retention_name_pattern}"; then
    return 0
  fi

  [ -d "${retention_root}" ] && [ ! -L "${retention_root}" ] || {
    echo "Refusing backup retention: ${retention_root} is not a real directory." >&2
    return 74
  }
  resolved_retention_root="$(readlink -f -- "${retention_root}")"
  [ "${resolved_retention_root}" = "${retention_root}" ] || {
    echo "Refusing backup retention outside ${retention_root}." >&2
    return 74
  }
  [ "$(stat -c '%u' -- "${retention_root}")" = "0" ] &&
    [ "$(stat -c '%a' -- "${retention_root}")" = "700" ] || {
      echo "Refusing backup retention: ${retention_root} must be root-owned mode 0700." >&2
      return 74
    }

  mapfile -t retained_names < <(
    find "${retention_root}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
      grep -E "${retention_name_pattern}" |
      LC_ALL=C sort -r
  )
  if [ "${#retained_names[@]}" -le "${retention_keep}" ]; then
    return 0
  fi

  for candidate_name in "${retained_names[@]:${retention_keep}}"; do
    candidate="${retention_root}/${candidate_name}"
    [ -d "${candidate}" ] && [ ! -L "${candidate}" ] || {
      echo "Refusing to prune an unverified backup path: ${candidate}" >&2
      return 74
    }
    resolved_candidate="$(readlink -f -- "${candidate}")"
    [ "$(dirname -- "${resolved_candidate}")" = "${retention_root}" ] &&
      [ "$(basename -- "${resolved_candidate}")" = "${candidate_name}" ] || {
        echo "Refusing to prune a backup outside ${retention_root}: ${candidate}" >&2
        return 74
      }
    [ "$(stat -c '%u' -- "${candidate}")" = "0" ] &&
      [ "$(stat -c '%a' -- "${candidate}")" = "700" ] || {
        echo "Refusing to prune a backup with unsafe ownership or mode: ${candidate}" >&2
        return 74
      }

    candidate_database="${candidate}/ai-access.sqlite"
    candidate_metadata="${candidate}/metadata.txt"
    candidate_contents="$(
      find "${candidate}" -mindepth 1 -maxdepth 1 -printf '%f\n' |
        LC_ALL=C sort
    )"
    [ "${candidate_contents}" = $'ai-access.sqlite\nmetadata.txt' ] &&
      [ -f "${candidate_database}" ] && [ ! -L "${candidate_database}" ] &&
      [ -f "${candidate_metadata}" ] && [ ! -L "${candidate_metadata}" ] &&
      [ "$(stat -c '%u:%a' -- "${candidate_database}")" = "0:600" ] &&
      [ "$(stat -c '%u:%a' -- "${candidate_metadata}")" = "0:600" ] || {
        echo "Refusing to prune an incomplete or unsafe backup: ${candidate}" >&2
        return 74
      }

    [ "$(grep -Ec '^schema_version=[0-9]+$' "${candidate_metadata}")" = "1" ] || {
      echo "Refusing to prune a backup with invalid metadata: ${candidate}" >&2
      return 74
    }
    metadata_version="$(sed -nE 's/^schema_version=([0-9]+)$/\1/p' "${candidate_metadata}")"
    candidate_integrity="$(
      sqlite3 -cmd ".timeout 10000" "${candidate_database}" "PRAGMA quick_check;"
    )"
    candidate_version="$(
      sqlite3 -cmd ".timeout 10000" "${candidate_database}" "PRAGMA user_version;"
    )"
    [ "${candidate_integrity}" = "ok" ] &&
      [ "${candidate_version}" = "${metadata_version}" ] || {
        echo "Refusing to prune a corrupt or mismatched backup: ${candidate}" >&2
        return 74
      }

    rm -rf -- "${resolved_candidate}"
    echo "Pruned verified pre-migration backup: ${resolved_candidate}"
  done
}

if [ ! -f "${database_file}" ]; then
  echo "AI access database does not exist yet; no pre-migration backup is needed."
  exit 0
fi
if [[ "${database_file}" == *"'"* || "${backup_root}" == *"'"* ]]; then
  echo "Database and backup paths must not contain single quotes." >&2
  exit 64
fi
command -v sqlite3 >/dev/null 2>&1 || {
  echo "sqlite3 is required for a consistent online database backup." >&2
  exit 69
}

backup_parent="$(dirname -- "${backup_root}")"
backup_name="$(basename -- "${backup_root}")"
if [ "${backup_parent}" = "${retention_root}" ] &&
  printf '%s\n' "${backup_name}" | grep -Eq "${retention_name_pattern}"; then
  if [ -e "${retention_root}" ] || [ -L "${retention_root}" ]; then
    [ -d "${retention_root}" ] && [ ! -L "${retention_root}" ] &&
      [ "$(readlink -f -- "${retention_root}")" = "${retention_root}" ] || {
        echo "Refusing to use an unsafe retention directory: ${retention_root}" >&2
        exit 74
      }
  fi
  install -d -o root -g root -m 0700 "${retention_root}"
fi

install -d -o root -g root -m 0700 "${backup_root}"
backup_file="${backup_root}/ai-access.sqlite"
[ ! -e "${backup_file}" ] || {
  echo "Refusing to overwrite an existing database backup: ${backup_file}" >&2
  exit 73
}

sqlite3 -cmd ".timeout 10000" "${database_file}" \
  ".backup '${backup_file}'"
chmod 0600 "${backup_file}"
chown root:root "${backup_file}"

integrity_check="$(sqlite3 -cmd ".timeout 10000" "${backup_file}" "PRAGMA integrity_check;")"
[ "${integrity_check}" = "ok" ] || {
  echo "The pre-migration database backup failed its integrity check." >&2
  exit 74
}

source_version="$(sqlite3 -cmd ".timeout 10000" "${database_file}" "PRAGMA user_version;")"
backup_version="$(sqlite3 -cmd ".timeout 10000" "${backup_file}" "PRAGMA user_version;")"
[ "${source_version}" = "${backup_version}" ] || {
  echo "The pre-migration database backup has a mismatched schema version." >&2
  exit 74
}

(
  umask 0077
  printf 'created_at_utc=%s\nsource=%s\nschema_version=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "${database_file}" \
    "${backup_version}" > "${backup_root}/metadata.txt"
)
chown root:root "${backup_root}/metadata.txt"
chmod 0600 "${backup_root}/metadata.txt"

echo "Consistent AI access database backup: ${backup_file} (schema ${backup_version})"
prune_verified_pre_migration_backups "${backup_root}"

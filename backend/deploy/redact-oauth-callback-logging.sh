#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: redact-oauth-callback-logging.sh <nginx-site-file> <callback-snippet> [backup-directory]" >&2
  exit 64
fi

site_file="$(readlink -f "$1")"
snippet_file="$(readlink -f "$2")"
backup_directory="${3:-}"
begin_marker="# BEGIN uartdebug-ai-oauth-callback"
end_marker="# END uartdebug-ai-oauth-callback"

for required_file in "${site_file}" "${snippet_file}"; do
  [ -f "${required_file}" ] || {
    echo "Missing nginx configuration file: ${required_file}" >&2
    exit 66
  }
done

grep -Fq "${begin_marker}" "${snippet_file}" &&
  grep -Fq "${end_marker}" "${snippet_file}" &&
  grep -Fq "access_log off;" "${snippet_file}" || {
    echo "The OAuth callback snippet is missing its managed markers or access-log protection" >&2
    exit 66
  }

if grep -Fq "location = /api/avr/ai/auth/google/callback" "${site_file}" &&
  ! grep -Fq "${begin_marker}" "${site_file}"; then
  echo "An unmanaged exact OAuth callback location already exists; refusing to create a duplicate" >&2
  exit 65
fi

site_tmp="$(mktemp)"
cleanup() {
  rm -f "${site_tmp}"
}
trap cleanup EXIT

awk \
  -v snippet="${snippet_file}" \
  -v begin_marker="${begin_marker}" \
  -v end_marker="${end_marker}" '
  BEGIN {
    while ((getline line < snippet) > 0) {
      block = block "    " line "\n"
    }
    close(snippet)
  }
  index($0, begin_marker) {
    printf "%s", block
    replacing = 1
    replaced = 1
    inserted = 1
    next
  }
  replacing {
    if (index($0, end_marker)) replacing = 0
    next
  }
  !inserted && /^    location \^~ \/api\/avr\/ai\/ \{/ {
    printf "%s\n", block
    inserted = 1
  }
  { print }
  END {
    if (replacing || (!replaced && !inserted)) exit 42
  }
' "${site_file}" > "${site_tmp}" || {
  echo "Could not locate the managed callback block or the broader AVR AI location" >&2
  exit 65
}

if cmp -s "${site_file}" "${site_tmp}"; then
  exit 0
fi

if [ -n "${backup_directory}" ]; then
  install -d -m 0700 "${backup_directory}"
  install -m 0600 \
    "${site_file}" \
    "${backup_directory}/$(basename "${site_file}").before-oauth-log-redaction"
fi

install -m 0644 "${site_tmp}" "${site_file}"

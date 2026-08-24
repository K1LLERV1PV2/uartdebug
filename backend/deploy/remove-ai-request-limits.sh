#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: remove-ai-request-limits.sh <nginx-limits-file> <nginx-site-file> [backup-directory]" >&2
  exit 64
fi

limits_file="$1"
site_file="$2"
backup_directory="${3:-}"

for required_file in "${limits_file}" "${site_file}"; do
  [ -f "${required_file}" ] || {
    echo "Missing nginx configuration file: ${required_file}" >&2
    exit 66
  }
done

if [ -n "${backup_directory}" ]; then
  install -d -o root -g root -m 0700 "${backup_directory}"
  cp -a "${limits_file}" "${backup_directory}/$(basename "${limits_file}")"
  cp -a "${site_file}" "${backup_directory}/$(basename "${site_file}")"
fi

limits_tmp="$(mktemp)"
site_tmp="$(mktemp)"
cleanup() {
  rm -f "${limits_tmp}" "${site_tmp}"
}
trap cleanup EXIT

awk '
  /^[[:space:]]*limit_req_zone[[:space:]].*zone=uartdebug_ai_per_ip:[^;]+;([[:space:]]*#.*)?[[:space:]]*$/ {
    next
  }
  { print }
' "${limits_file}" > "${limits_tmp}"
if ! cmp -s "${limits_tmp}" "${limits_file}"; then
  install -o root -g root -m 0644 "${limits_tmp}" "${limits_file}"
fi

awk '
  function brace_delta(line, copy, opens, closes) {
    copy = line
    sub(/[[:space:]]*#.*/, "", copy)
    opens = gsub(/\{/, "{", copy)
    closes = gsub(/\}/, "}", copy)
    return opens - closes
  }
  /^[[:space:]]*location[[:space:]]+\^~[[:space:]]+\/api\/avr\/ai\/[[:space:]]*\{/ {
    in_ai_location = 1
    location_depth = 0
  }
  in_ai_location && /^[[:space:]]*limit_req[[:space:]]+zone=uartdebug_ai_per_ip([[:space:]]+[^;]*)?;([[:space:]]*#.*)?[[:space:]]*$/ {
    location_depth += brace_delta($0)
    if (location_depth <= 0) in_ai_location = 0
    next
  }
  {
    print
    if (in_ai_location) {
      location_depth += brace_delta($0)
      if (location_depth <= 0) in_ai_location = 0
    }
  }
' "${site_file}" > "${site_tmp}"
if ! cmp -s "${site_tmp}" "${site_file}"; then
  install -o root -g root -m 0644 "${site_tmp}" "${site_file}"
fi

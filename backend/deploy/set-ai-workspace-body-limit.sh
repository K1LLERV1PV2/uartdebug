#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: set-ai-workspace-body-limit.sh <nginx-site-file> <backup-directory>" >&2
  exit 64
fi

site_file="$1"
backup_root="$2"
[ -f "${site_file}" ] || {
  echo "nginx site file is missing: ${site_file}" >&2
  exit 66
}
command -v nginx >/dev/null 2>&1 || {
  echo "nginx is required to validate the updated site configuration." >&2
  exit 69
}

backup_file="${backup_root}/$(basename "${site_file}")"
site_tmp="$(mktemp)"
cleanup() {
  rm -f "${site_tmp}"
}
trap cleanup EXIT

existing_buffering="$({
  awk '
    BEGIN { inside = 0; count = 0 }
    /^[[:space:]]*location[[:space:]]+\^~[[:space:]]+\/api\/avr\/ai\/[[:space:]]*\{/ { inside = 1 }
    inside && /^[[:space:]]*proxy_buffering[[:space:]]+/ { count += 1 }
    inside && /^[[:space:]]*\}[[:space:]]*$/ { inside = 0 }
    END { print count }
  ' "${site_file}"
})"
[ "${existing_buffering}" = "0" ] || [ "${existing_buffering}" = "1" ] || {
  echo "Could not safely normalize AVR AI nginx proxy buffering." >&2
  exit 65
}

if ! awk -v insert_buffering="$([ "${existing_buffering}" = "0" ] && echo 1 || echo 0)" '
  BEGIN { targets = 0; body_directives = 0; timeout_directives = 0; buffering_directives = 0; inside = 0 }
  /^[[:space:]]*location[[:space:]]+\^~[[:space:]]+\/api\/avr\/ai\/[[:space:]]*\{/ {
    targets += 1
    inside = 1
  }
  inside && /^[[:space:]]*client_max_body_size[[:space:]]+/ {
    match($0, /^[[:space:]]*/)
    printf "%sclient_max_body_size 5m;\n", substr($0, 1, RLENGTH)
    body_directives += 1
    next
  }
  inside && /^[[:space:]]*proxy_read_timeout[[:space:]]+/ {
    match($0, /^[[:space:]]*/)
    printf "%sproxy_read_timeout 1200s;\n", substr($0, 1, RLENGTH)
    timeout_directives += 1
    next
  }
  inside && /^[[:space:]]*proxy_buffering[[:space:]]+/ {
    match($0, /^[[:space:]]*/)
    printf "%sproxy_buffering off;\n", substr($0, 1, RLENGTH)
    buffering_directives += 1
    next
  }
  inside && insert_buffering && /^[[:space:]]*proxy_http_version[[:space:]]+/ {
    print
    match($0, /^[[:space:]]*/)
    printf "%sproxy_buffering off;\n", substr($0, 1, RLENGTH)
    buffering_directives += 1
    next
  }
  { print }
  inside && /^[[:space:]]*\}[[:space:]]*$/ { inside = 0 }
  END {
    if (targets != 1 || body_directives != 1 || timeout_directives != 1 || buffering_directives != 1 || inside) exit 42
  }
' "${site_file}" > "${site_tmp}"; then
  echo "Could not identify exactly one AVR AI nginx location, body-size directive, read timeout, and buffering directive." >&2
  exit 65
fi

if cmp -s "${site_file}" "${site_tmp}"; then
  echo "AVR AI nginx body limit and response timeout are already configured."
  exit 0
fi

install -d -o root -g root -m 0700 "${backup_root}"
[ ! -e "${backup_file}" ] || {
  echo "Refusing to overwrite an existing nginx backup: ${backup_file}" >&2
  exit 73
}
cp -a "${site_file}" "${backup_file}"

install -o root -g root -m 0644 "${site_tmp}" "${site_file}"
if ! nginx -t; then
  echo "Updated nginx configuration is invalid; restoring the previous file." >&2
  install -o root -g root -m 0644 "${backup_file}" "${site_file}"
  nginx -t
  exit 78
fi

echo "Updated AVR AI nginx body limit to 5m and response timeout to 1200s. Backup: ${backup_file}"

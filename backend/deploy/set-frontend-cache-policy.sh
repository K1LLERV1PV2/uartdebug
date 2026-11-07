#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: set-frontend-cache-policy.sh <nginx-site-file> <backup-directory>" >&2
  exit 64
fi

site_file="$1"
backup_root="$2"
[ -f "${site_file}" ] || { echo "Missing nginx site file: ${site_file}" >&2; exit 66; }
command -v nginx >/dev/null 2>&1 || { echo "nginx is required to validate the cache policy." >&2; exit 69; }
site_tmp="$(mktemp)"
trap 'rm -f "${site_tmp}"' EXIT

# Both extensionless entry routes and direct HTML/static requests must revalidate.
# Keep the existing security-header includes and API locations untouched.
if ! awk '
  BEGIN { inside = 0; targets = 0; invalid = 0 }
  /^[[:space:]]*location[[:space:]]/ {
    target = ($0 ~ /^[[:space:]]*location[[:space:]]+=[[:space:]]+\/(avr|uart)[[:space:]]*\{/ ||
              $0 ~ /^[[:space:]]*location[[:space:]]+\/[[:space:]]*\{/ ||
              (index($0, "location ~*") && (index($0, "(css|js|png|") || index($0, "(html)"))))
    if (target) {
      inside = 1
      security_headers = 0
      targets += 1
      print
      print "        expires off;"
      print "        add_header Cache-Control \"no-cache, max-age=0, must-revalidate\" always;"
      next
    }
  }
  inside && /^[[:space:]]*include[[:space:]]+\/etc\/nginx\/snippets\/uartdebug-security-headers\.conf;/ { security_headers += 1 }
  inside && /^[[:space:]]*(expires[[:space:]]|add_header[[:space:]]+Cache-Control[[:space:]])/ { next }
  { print }
  inside && /^[[:space:]]*\}[[:space:]]*$/ {
    if (security_headers != 1) invalid = 1
    inside = 0
  }
  END { if (targets != 5 || inside || invalid) exit 42 }
' "${site_file}" > "${site_tmp}"; then
  echo "Could not identify the five expected frontend nginx locations; configuration unchanged." >&2
  exit 65
fi

if cmp -s "${site_file}" "${site_tmp}"; then
  echo "Frontend cache revalidation is already configured."
  exit 0
fi

install -d -o root -g root -m 0700 "${backup_root}"
backup_file="${backup_root}/$(basename "${site_file}")"
[ ! -e "${backup_file}" ] || { echo "Refusing to overwrite nginx backup: ${backup_file}" >&2; exit 73; }
cp -a "${site_file}" "${backup_file}"
install -o root -g root -m 0644 "${site_tmp}" "${site_file}"
if ! nginx -t; then
  echo "Invalid nginx cache policy; restoring the previous configuration." >&2
  install -o root -g root -m 0644 "${backup_file}" "${site_file}"
  nginx -t
  exit 78
fi
echo "Enabled frontend cache revalidation. Backup: ${backup_file}"

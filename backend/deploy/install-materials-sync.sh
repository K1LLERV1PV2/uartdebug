#!/usr/bin/env bash
set -euo pipefail

# Install only the deployment receiver, never execute files from UartDebug2.
[ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 77; }
backend_dir="${1:-/var/www/uartdebug/backend}"
site_file="${2:-/etc/nginx/sites-available/uartdebug.com}"
materials_root="/var/lib/uartdebug-ai/materials"
unit_file="/etc/systemd/system/uartdebug-materials-sync.service"
for source in materials-sync-server.js materials-sync-auth.js deploy/install-materials.py \
  deploy/verify-materials.js deploy/uartdebug-materials-sync.service deploy/nginx-materials-sync-location.conf; do
  [ -f "${backend_dir}/${source}" ] || { echo "Missing receiver file: ${source}" >&2; exit 66; }
done
[ -f "${site_file}" ] || { echo "Missing nginx site" >&2; exit 66; }
getent group uartai >/dev/null || { echo "Install the AI service first" >&2; exit 66; }
backup="$(mktemp -d /var/backups/uartdebug-materials-sync.XXXXXXXX)"
cp -a "${site_file}" "${backup}/site"
had_unit=0
if [ -f "${unit_file}" ]; then
  had_unit=1
  cp -a "${unit_file}" "${backup}/unit"
fi
was_enabled=0
was_running=0
systemctl is-enabled --quiet uartdebug-materials-sync.service && was_enabled=1
systemctl is-active --quiet uartdebug-materials-sync.service && was_running=1
restore_on_failure() {
  result=$?
  if [ "${result}" -ne 0 ]; then
    install -o root -g root -m 0644 "${backup}/site" "${site_file}"
    if [ "${had_unit}" -eq 1 ]; then
      install -o root -g root -m 0644 "${backup}/unit" "${unit_file}"
    else
      rm -f "${unit_file}"
    fi
    systemctl daemon-reload || true
    if [ "${was_enabled}" -eq 1 ]; then
      systemctl enable uartdebug-materials-sync.service || true
    else
      systemctl disable uartdebug-materials-sync.service || true
    fi
    if [ "${was_running}" -eq 1 ]; then
      systemctl restart uartdebug-materials-sync.service || true
    else
      systemctl stop uartdebug-materials-sync.service || true
    fi
    nginx -t && systemctl reload nginx || true
    echo "Materials receiver installation failed; restored configuration from ${backup}" >&2
  fi
}
trap restore_on_failure EXIT
if ! getent passwd uartmaterials >/dev/null; then
  useradd --system --gid uartai --home-dir "${materials_root}" --shell /usr/sbin/nologin uartmaterials
fi
install -d -o uartmaterials -g uartai -m 0750 "${materials_root}" \
  "${materials_root}/releases" "${materials_root}/uploads"
install -o root -g root -m 0644 "${backend_dir}/deploy/uartdebug-materials-sync.service" \
  "${unit_file}"
if ! grep -q 'location = /api/internal/materials/sync' "${site_file}"; then
  temporary="$(mktemp)"
  awk -v snippet="${backend_dir}/deploy/nginx-materials-sync-location.conf" '
    BEGIN { while ((getline line < snippet) > 0) block = block "    " line "\n"; close(snippet) }
    /^    location \^~ \/api\/avr\/ai\/ \{/ && !inserted { printf "%s\n", block; inserted = 1 }
    { print }
    END { if (!inserted) exit 42 }
  ' "${site_file}" > "${temporary}"
  install -o root -g root -m 0644 "${temporary}" "${site_file}"
  rm -f "${temporary}"
fi
nginx -t
systemd-analyze verify "${unit_file}"
systemctl daemon-reload
systemctl enable uartdebug-materials-sync.service
systemctl restart uartdebug-materials-sync.service
systemctl reload nginx
curl --fail --silent --show-error --retry 5 --retry-connrefused --retry-delay 1 \
  http://127.0.0.1:8084/health

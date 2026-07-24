#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: install-ai-service.sh <staged-backend-directory>" >&2
  exit 64
fi

stage="$(readlink -f "$1")"
backend_link="/var/www/uartdebug/backend"
backend_dir="$(readlink -f "${backend_link}")"
drafts_root="/var/lib/uartdebug-ai/drafts"
credential_file="/etc/uartdebug/secrets/openai-api-key"
access_credential_file="/etc/uartdebug/secrets/ai-access-token"
unit_file="/etc/systemd/system/uartdebug-ai.service"
site_file="/etc/nginx/sites-available/uartdebug.com"
limits_file="/etc/nginx/conf.d/uartdebug-limits.conf"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="/var/backups/uartdebug-ai/${timestamp}"

required=(
  "${stage}/ai-server.js"
  "${stage}/avr-ai-service.js"
  "${stage}/avr-documentation-markers.js"
  "${stage}/ai/rule-packs/active.json"
  "${stage}/deploy/uartdebug-ai.service"
  "${stage}/deploy/nginx-avr-ai-location.conf"
  "${stage}/deploy/install-ai-rule-pack.sh"
)
for required_file in "${required[@]}"; do
  [ -f "${required_file}" ] || {
    echo "Missing staged file: ${required_file}" >&2
    exit 66
  }
done

[ -d "${backend_dir}" ] || {
  echo "Backend target is missing: ${backend_dir}" >&2
  exit 66
}

install -d -o root -g root -m 0700 "${backup_root}"
cp -a "${site_file}" "${backup_root}/uartdebug.com"
cp -a "${limits_file}" "${backup_root}/uartdebug-limits.conf"
if [ -f "${unit_file}" ]; then
  cp -a "${unit_file}" "${backup_root}/uartdebug-ai.service"
fi

if ! getent passwd uartai >/dev/null; then
  useradd \
    --system \
    --user-group \
    --home-dir /var/lib/uartdebug-ai \
    --shell /usr/sbin/nologin \
    uartai
fi

install -d -o root -g root -m 0755 /etc/uartdebug
install -d -o root -g root -m 0700 /etc/uartdebug/secrets
if [ ! -e "${credential_file}" ]; then
  install -o root -g root -m 0400 /dev/null "${credential_file}"
else
  chown root:root "${credential_file}"
  chmod 0400 "${credential_file}"
fi
if [ ! -e "${access_credential_file}" ]; then
  command -v openssl >/dev/null || {
    echo "openssl is required to create the owner access credential" >&2
    exit 69
  }
  umask 0077
  openssl rand -hex 32 > "${access_credential_file}"
fi
chown root:root "${access_credential_file}"
chmod 0400 "${access_credential_file}"

install -d -o root -g root -m 0755 /var/lib/uartdebug-ai
install -d -o uartai -g uartai -m 0700 "${drafts_root}"

/bin/bash "${stage}/deploy/install-ai-rule-pack.sh" "${stage}"

install -o deploy -g deploy -m 0644 \
  "${stage}/ai-server.js" \
  "${backend_dir}/ai-server.js"
install -o deploy -g deploy -m 0644 \
  "${stage}/avr-ai-service.js" \
  "${backend_dir}/avr-ai-service.js"
install -o deploy -g deploy -m 0644 \
  "${stage}/avr-documentation-markers.js" \
  "${backend_dir}/avr-documentation-markers.js"
install -o root -g root -m 0644 \
  "${stage}/deploy/uartdebug-ai.service" \
  "${unit_file}"

if ! grep -q "zone=uartdebug_ai_per_ip:" "${limits_file}"; then
  limits_tmp="$(mktemp)"
  cp "${limits_file}" "${limits_tmp}"
  printf '%s\n' \
    'limit_req_zone $binary_remote_addr zone=uartdebug_ai_per_ip:10m rate=10r/m;' \
    >> "${limits_tmp}"
  install -o root -g root -m 0644 "${limits_tmp}" "${limits_file}"
  rm -f "${limits_tmp}"
fi

if ! grep -q 'location \^~ /api/avr/ai/' "${site_file}"; then
  site_tmp="$(mktemp)"
  awk -v snippet="${stage}/deploy/nginx-avr-ai-location.conf" '
    BEGIN {
      while ((getline line < snippet) > 0) {
        block = block "    " line "\n"
      }
      close(snippet)
    }
    /^    location \^~ \/api\/avr\/ \{/ && !inserted {
      printf "%s\n", block
      inserted = 1
    }
    { print }
    END {
      if (!inserted) exit 42
    }
  ' "${site_file}" > "${site_tmp}"
  install -o root -g root -m 0644 "${site_tmp}" "${site_file}"
  rm -f "${site_tmp}"
fi

nginx -t
systemd-analyze verify "${unit_file}"
systemctl daemon-reload
systemctl enable uartdebug-ai.service
systemctl restart uartdebug-ai.service
systemctl reload nginx

for attempt in $(seq 1 20); do
  if curl --fail --silent --show-error --max-time 10 \
    http://127.0.0.1:8083/health; then
    break
  fi
  if [ "${attempt}" -eq 20 ]; then
    systemctl status uartdebug-ai.service --no-pager -l || true
    exit 1
  fi
  sleep 1
done
curl --fail --silent --show-error --max-time 10 \
  http://127.0.0.1:8083/api/avr/ai/status
echo
echo "AI service installed. Backups: ${backup_root}"

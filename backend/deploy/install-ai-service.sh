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
data_root="/var/lib/uartdebug-ai/data"
access_db_file="${data_root}/ai-access.sqlite"
skills_catalog="${stage}/ai/skills/catalog.json"
credential_file="/etc/uartdebug/secrets/openai-api-key"
access_credential_file="/etc/uartdebug/secrets/ai-access-token"
google_client_id_file="/etc/uartdebug/secrets/google-oauth-client-id"
google_client_secret_file="/etc/uartdebug/secrets/google-oauth-client-secret"
identity_secret_file="/etc/uartdebug/secrets/ai-identity-secret"
session_secret_file="/etc/uartdebug/secrets/ai-session-secret"
unit_file="/etc/systemd/system/uartdebug-ai.service"
site_file="/etc/nginx/sites-available/uartdebug.com"
limits_file="/etc/nginx/conf.d/uartdebug-limits.conf"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="/var/backups/uartdebug-ai/${timestamp}"

required=(
  "${stage}/ai-server.js"
  "${stage}/ai-access-service.js"
  "${stage}/avr-ai-service.js"
  "${stage}/avr-documentation-markers.js"
  "${stage}/package.json"
  "${stage}/package-lock.json"
  "${stage}/ai/rule-packs/active.json"
  "${skills_catalog}"
  "${stage}/deploy/uartdebug-ai.service"
  "${stage}/deploy/nginx-avr-ai-location.conf"
  "${stage}/deploy/nginx-avr-ai-oauth-callback-location.conf"
  "${stage}/deploy/install-ai-rule-pack.sh"
  "${stage}/deploy/redact-oauth-callback-logging.sh"
  "${stage}/deploy/remove-ai-request-limits.sh"
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

command -v node >/dev/null || {
  echo "Node.js is required to install the AI service" >&2
  exit 69
}
command -v npm >/dev/null || {
  echo "npm is required to install the AI service" >&2
  exit 69
}
node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) process.exit(1);
' || {
  echo "Node.js 22.13 or newer is required by the AI access service" >&2
  exit 69
}
node -e '
  const service = require(process.argv[1]);
  service.loadAiSkillCatalog(process.argv[2]).catch((error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  });
' "${stage}/avr-ai-service.js" "${skills_catalog}" || {
  echo "The staged AI skill catalog is invalid" >&2
  exit 66
}
if [ -f "${access_db_file}" ] && ! command -v sqlite3 >/dev/null; then
  echo "sqlite3 is required to make a consistent online access-database backup" >&2
  exit 69
fi

install -d -o root -g root -m 0700 "${backup_root}"
cp -a "${site_file}" "${backup_root}/uartdebug.com"
cp -a "${limits_file}" "${backup_root}/uartdebug-limits.conf"
if [ -f "${unit_file}" ]; then
  cp -a "${unit_file}" "${backup_root}/uartdebug-ai.service"
fi
if [ -f "${access_db_file}" ]; then
  sqlite3 -cmd ".timeout 10000" "${access_db_file}" \
    ".backup '${backup_root}/ai-access.sqlite'"
  if [ -f "${backup_root}/ai-access.sqlite" ]; then
    chmod 0600 "${backup_root}/ai-access.sqlite"
  fi
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

ensure_empty_credential() {
  credential_path="$1"
  if [ ! -e "${credential_path}" ]; then
    install -o root -g root -m 0400 /dev/null "${credential_path}"
  fi
  chown root:root "${credential_path}"
  chmod 0400 "${credential_path}"
}

ensure_random_credential() {
  credential_path="$1"
  credential_label="$2"
  if [ ! -s "${credential_path}" ]; then
    command -v openssl >/dev/null || {
      echo "openssl is required to create ${credential_label}" >&2
      exit 69
    }
    (
      umask 0077
      openssl rand -hex 32 > "${credential_path}"
    )
  fi
  chown root:root "${credential_path}"
  chmod 0400 "${credential_path}"
}

ensure_empty_credential "${credential_file}"
ensure_empty_credential "${google_client_id_file}"
ensure_empty_credential "${google_client_secret_file}"
ensure_random_credential "${identity_secret_file}" "the installation-identity secret"
ensure_random_credential "${session_secret_file}" "the session-signing secret"
ensure_random_credential "${access_credential_file}" "the optional AI access credential"

# Keep this dormant credential ready for a future AI_REQUIRE_ACCESS_TOKEN=1
# deployment. Public mode never sends it to the browser.

install -d -o root -g root -m 0755 /var/lib/uartdebug-ai
install -d -o uartai -g uartai -m 0700 "${drafts_root}"
install -d -o uartai -g uartai -m 0700 "${data_root}"
if [ -f "${access_db_file}" ]; then
  chown uartai:uartai "${access_db_file}"
  chmod 0600 "${access_db_file}"
fi

/bin/bash "${stage}/deploy/install-ai-rule-pack.sh" "${stage}"

if [ "${stage}" != "${backend_dir}" ]; then
  shopt -s nullglob
  skill_markdown=("${stage}"/ai/skills/*.md)
  install -d -o deploy -g deploy -m 0755 \
    "${backend_dir}/ai" \
    "${backend_dir}/ai/skills"
  install -o deploy -g deploy -m 0644 \
    "${skills_catalog}" \
    "${backend_dir}/ai/skills/catalog.json"
  # The catalog is authoritative. Remove obsolete prototype blocks before
  # installing the currently allowlisted Markdown files from the staged release.
  rm -f -- "${backend_dir}/ai/skills/"*.md
  if [ "${#skill_markdown[@]}" -gt 0 ]; then
    install -o deploy -g deploy -m 0644 \
      "${skill_markdown[@]}" \
      "${backend_dir}/ai/skills/"
  fi
  shopt -u nullglob
  install -o deploy -g deploy -m 0644 \
    "${stage}/ai-server.js" \
    "${backend_dir}/ai-server.js"
  install -o deploy -g deploy -m 0644 \
    "${stage}/ai-access-service.js" \
    "${backend_dir}/ai-access-service.js"
  install -o deploy -g deploy -m 0644 \
    "${stage}/avr-ai-service.js" \
    "${backend_dir}/avr-ai-service.js"
  install -o deploy -g deploy -m 0644 \
    "${stage}/avr-documentation-markers.js" \
    "${backend_dir}/avr-documentation-markers.js"
  install -o deploy -g deploy -m 0644 \
    "${stage}/package.json" \
    "${stage}/package-lock.json" \
    "${backend_dir}/"
fi
npm ci --prefix "${backend_dir}" --omit=dev --ignore-scripts
install -o root -g root -m 0644 \
  "${stage}/deploy/uartdebug-ai.service" \
  "${unit_file}"

/bin/bash "${stage}/deploy/remove-ai-request-limits.sh" \
  "${limits_file}" \
  "${site_file}"

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

/bin/bash "${stage}/deploy/redact-oauth-callback-logging.sh" \
  "${site_file}" \
  "${stage}/deploy/nginx-avr-ai-oauth-callback-location.conf" \
  "${backup_root}/oauth-log-redaction"

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
skills_body="$(mktemp)"
curl --fail --silent --show-error --max-time 10 \
  --output "${skills_body}" \
  http://127.0.0.1:8083/api/avr/ai/skills
node -e '
  const fs = require("fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (value.ok !== true || value.schemaVersion !== 1) process.exit(1);
  if (!Array.isArray(value.skills) || value.skills.length !== value.count) process.exit(1);
  if (!/^[a-f0-9]{64}$/.test(String(value.digest || ""))) process.exit(1);
' "${skills_body}"
rm -f "${skills_body}"
echo "AI service installed. Backups: ${backup_root}"

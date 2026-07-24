#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-https://uartdebug.com}"
status_file="$(mktemp)"
unauthorized_file="$(mktemp)"
authorized_file="$(mktemp)"
cleanup() {
  rm -f "${status_file}" "${unauthorized_file}" "${authorized_file}"
}
trap cleanup EXIT

status_code="$(
  curl --silent --show-error \
    --output "${status_file}" \
    --write-out '%{http_code}' \
    --max-time 15 \
    "${base_url}/api/avr/ai/status"
)"
[ "${status_code}" = "200" ]
grep -q '"ok":true' "${status_file}"
grep -q '"accessConfigured":true' "${status_file}"
grep -q '"rules":{"packageId":' "${status_file}"

unauthorized_code="$(
  curl --silent --show-error \
    --output "${unauthorized_file}" \
    --write-out '%{http_code}' \
    --max-time 15 \
    --request POST \
    --header "Origin: ${base_url}" \
    --header 'Content-Type: application/json' \
    --data-binary '{"prompt":"Service smoke test"}' \
    "${base_url}/api/avr/ai/generate"
)"
[ "${unauthorized_code}" = "401" ]
grep -q '"code":"owner_access_required"' "${unauthorized_file}"

if ! grep -q '"configured":false' "${status_file}"; then
  echo "OpenAI is configured; the paid generation smoke test was intentionally skipped." >&2
  exit 78
fi

access_token="$(sudo cat /etc/uartdebug/secrets/ai-access-token)"
authorized_code="$(
  curl --silent --show-error \
    --output "${authorized_file}" \
    --write-out '%{http_code}' \
    --max-time 15 \
    --request POST \
    --header "Origin: ${base_url}" \
    --header 'Content-Type: application/json' \
    --header "X-UartDebug-AI-Token: ${access_token}" \
    --data-binary '{"prompt":"Service smoke test"}' \
    "${base_url}/api/avr/ai/generate"
)"
unset access_token

[ "${authorized_code}" = "503" ]
grep -q '"code":"api_key_not_configured"' "${authorized_file}"

printf 'status=%s unauthorized=%s authorized-without-key=%s\n' \
  "${status_code}" \
  "${unauthorized_code}" \
  "${authorized_code}"

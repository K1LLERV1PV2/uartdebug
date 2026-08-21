#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-https://uartdebug.com}"
status_file="$(mktemp)"
public_file="$(mktemp)"
cleanup() {
  rm -f "${status_file}" "${public_file}"
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
grep -q '"accessRequired":false' "${status_file}"
grep -q '"rules":{"packageId":' "${status_file}"

if ! grep -q '"configured":false' "${status_file}"; then
  echo "OpenAI is configured; the paid assistant smoke test was intentionally skipped." >&2
  exit 78
fi

public_code="$(
  curl --silent --show-error \
    --output "${public_file}" \
    --write-out '%{http_code}' \
    --max-time 15 \
    --request POST \
    --header "Origin: ${base_url}" \
    --header 'Content-Type: application/json' \
    --data-binary '{"prompt":"Service smoke test"}' \
    "${base_url}/api/avr/ai/respond"
)"
[ "${public_code}" = "503" ]
grep -q '"code":"api_key_not_configured"' "${public_file}"

printf 'status=%s public-without-key=%s\n' \
  "${status_code}" \
  "${public_code}"

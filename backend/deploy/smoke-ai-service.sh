#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-https://uartdebug.com}"
status_file="$(mktemp)"
auth_file="$(mktemp)"
retired_file="$(mktemp)"
public_file="$(mktemp)"
cleanup() {
  rm -f "${status_file}" "${auth_file}" "${retired_file}" "${public_file}"
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
node -e '
  const fs = require("fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (value.contract !== "uartdebug-canvas/v1" || !value.knowledge) process.exit(1);
  if (!Array.isArray(value.knowledge.devices) || !value.knowledge.devices.length) process.exit(1);
' "${status_file}"

for retired_route in respond generate skills; do
  retired_method="POST"
  [ "${retired_route}" != "skills" ] || retired_method="GET"
  retired_code="$(curl --silent --show-error --max-time 15 \
    --output "${retired_file}" --write-out '%{http_code}' \
    --request "${retired_method}" --header "Origin: ${base_url}" \
    "${base_url}/api/avr/ai/${retired_route}")"
  [ "${retired_code}" = "404" ]
done

auth_code="$(
  curl --silent --show-error \
    --output "${auth_file}" \
    --write-out '%{http_code}' \
    --max-time 15 \
    "${base_url}/api/avr/ai/auth/session"
)"
[ "${auth_code}" = "200" ]
node -e '
  const fs = require("fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (value.ok !== true) process.exit(1);
  if (value.mode !== "public" && value.mode !== "google") process.exit(1);
  if (value.mode === "google" && value.configured !== true) process.exit(1);
' "${auth_file}"

if ! grep -q '"configured":false' "${status_file}"; then
  echo "OpenAI is configured; the paid assistant smoke test was intentionally skipped." >&2
  public_code="skipped"
else
  public_code="$(
    curl --silent --show-error \
      --output "${public_file}" \
      --write-out '%{http_code}' \
      --max-time 15 \
      --request POST \
      --header "Origin: ${base_url}" \
      --header 'Content-Type: application/json' \
      --data-binary '{"canvas":{"schemaVersion":2,"revision":0,"markdown":"Service smoke test","locale":"en","annotations":[],"target":{"mcu":"attiny1624","packageName":"SOIC-14"}},"mcu":"attiny1624","packageName":"SOIC-14"}' \
      "${base_url}/api/avr/ai/canvas"
  )"
  [ "${public_code}" = "503" ]
  grep -q '"code":"api_key_not_configured"' "${public_file}"
fi

printf 'status=%s retired-routes=%s auth=%s canvas-without-key=%s\n' \
  "${status_code}" \
  "${retired_code}" \
  "${auth_code}" \
  "${public_code}"

#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-https://uartdebug.com}"
status_file="$(mktemp)"
auth_file="$(mktemp)"
skills_file="$(mktemp)"
public_file="$(mktemp)"
cleanup() {
  rm -f "${status_file}" "${auth_file}" "${skills_file}" "${public_file}"
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

skills_code="$(
  curl --silent --show-error \
    --output "${skills_file}" \
    --write-out '%{http_code}' \
    --max-time 15 \
    "${base_url}/api/avr/ai/skills"
)"
[ "${skills_code}" = "200" ]
node -e '
  const fs = require("fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (value.ok !== true || value.schemaVersion !== 1) process.exit(1);
  if (!Array.isArray(value.skills) || value.skills.length !== value.count) process.exit(1);
  if (!value.skills.length) process.exit(1);
  const allowed = ["id", "markdown", "summary", "title", "version"];
  for (const skill of value.skills) {
    if (Object.keys(skill).some((key) => !allowed.includes(key))) process.exit(1);
  }
' "${skills_file}"

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

printf 'status=%s skills=%s auth=%s public-without-key=%s\n' \
  "${status_code}" \
  "${skills_code}" \
  "${auth_code}" \
  "${public_code}"

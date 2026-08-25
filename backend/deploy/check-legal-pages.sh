#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: check-legal-pages.sh <site-origin> [curl-resolve]" >&2
  exit 64
fi

site_origin="${1%/}"
curl_resolve="${2:-}"
legal_body=""

cleanup() {
  if [ -n "${legal_body}" ]; then
    rm -f "${legal_body}"
  fi
}
trap cleanup EXIT

for legal_route in privacy terms; do
  legal_body="$(mktemp)"
  legal_url="${site_origin}/${legal_route}"
  curl_arguments=(
    --silent
    --show-error
    --output "${legal_body}"
    --write-out '%{http_code}'
    --max-time 10
  )
  if [ -n "${curl_resolve}" ]; then
    curl_arguments+=(--resolve "${curl_resolve}")
  fi
  legal_code="$(curl "${curl_arguments[@]}" "${legal_url}" || true)"
  expected_title="$(printf '%s' "${legal_route}" | sed 's/^./\U&/')"

  [ "${legal_code}" = "200" ] &&
    grep -Fq "<title>${expected_title}" "${legal_body}" &&
    grep -Fq \
      "rel=\"canonical\" href=\"https://uartdebug.com/${legal_route}\"" \
      "${legal_body}" || {
        echo "Legal page ${legal_url} failed semantic readiness with HTTP ${legal_code}" >&2
        cat "${legal_body}" >&2 || true
        exit 1
      }

  rm -f "${legal_body}"
  legal_body=""
done

echo "Legal pages passed semantic readiness checks."

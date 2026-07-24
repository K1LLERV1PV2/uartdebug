#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: install-ai-rule-pack.sh <staged-backend-directory>" >&2
  exit 64
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "install-ai-rule-pack.sh must run as root" >&2
  exit 77
fi

stage="$(readlink -f "$1")"
source_root="${stage}/ai/rule-packs"
rules_root="/var/lib/uartdebug-ai/rule-packs"
packages_root="${rules_root}/packages"
active_source="${source_root}/active.json"
service_module="${stage}/avr-ai-service.js"

[ -f "${active_source}" ] || {
  echo "Missing active rules pointer: ${active_source}" >&2
  exit 66
}
[ -f "${service_module}" ] || {
  echo "Missing AI service module: ${service_module}" >&2
  exit 66
}

package_id="$(
  /usr/bin/node -e '
    const fs = require("fs");
    const active = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (
      active.schemaVersion !== 1 ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(active.packageId || "")
    ) process.exit(65);
    process.stdout.write(active.packageId);
  ' "${active_source}"
)"
package_source="${source_root}/packages/${package_id}"
[ -f "${package_source}/manifest.json" ] || {
  echo "Active rule package is missing: ${package_source}" >&2
  exit 66
}

/usr/bin/node -e '
  const path = require("path");
  const service = require(path.resolve(process.argv[1]));
  service.loadActiveRulePack(path.resolve(process.argv[2])).catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    process.exit(65);
  });
' "${service_module}" "${source_root}"

install -d -o root -g root -m 0755 /var/lib/uartdebug-ai
install -d -o root -g root -m 0755 "${rules_root}"
install -d -o root -g root -m 0755 "${packages_root}"

package_target="${packages_root}/${package_id}"
package_tmp=""
active_tmp=""
cleanup() {
  if [ -n "${package_tmp}" ] && [ -d "${package_tmp}" ]; then
    rm -rf -- "${package_tmp}"
  fi
  if [ -n "${active_tmp}" ] && [ -f "${active_tmp}" ]; then
    rm -f -- "${active_tmp}"
  fi
}
trap cleanup EXIT

if [ -e "${package_target}" ]; then
  [ -d "${package_target}" ] && [ ! -L "${package_target}" ] || {
    echo "Invalid installed rule package target: ${package_target}" >&2
    exit 73
  }
  diff -qr "${package_source}" "${package_target}" >/dev/null || {
    echo "Immutable rule package already exists with different content: ${package_id}" >&2
    exit 73
  }
else
  package_tmp="$(mktemp -d "${packages_root}/.${package_id}.XXXXXX")"
  cp -a "${package_source}/." "${package_tmp}/"
  chown -R root:root "${package_tmp}"
  find "${package_tmp}" -type d -exec chmod 0755 {} +
  find "${package_tmp}" -type f -exec chmod 0644 {} +
  mv -- "${package_tmp}" "${package_target}"
  package_tmp=""
fi

active_tmp="$(mktemp "${rules_root}/.active.json.XXXXXX")"
install -o root -g root -m 0644 "${active_source}" "${active_tmp}"
mv -f -- "${active_tmp}" "${rules_root}/active.json"
active_tmp=""

/usr/bin/node -e '
  const path = require("path");
  const service = require(path.resolve(process.argv[1]));
  service.loadActiveRulePack(path.resolve(process.argv[2])).then((pack) => {
    if (pack.packageId !== process.argv[3]) process.exit(65);
  }).catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    process.exit(65);
  });
' "${service_module}" "${rules_root}" "${package_id}"

echo "AI rule pack active: ${package_id}"

#!/usr/bin/env bash
set -euo pipefail

[ "$#" -eq 1 ] || { echo "usage: install-compiler-service.sh <staged-backend-directory>" >&2; exit 64; }
[ "$(id -u)" -eq 0 ] || { echo "Run the compiler unit installation as root." >&2; exit 77; }
stage="$(readlink -f -- "$1")"
for required in compile-server.js compile-sandbox.js deploy/uartdebug-backend.service; do
  [ -f "${stage}/${required}" ] || { echo "Missing staged compiler file: ${required}" >&2; exit 66; }
done
for executable in /usr/bin/bwrap /usr/bin/prlimit; do
  [ -x "${executable}" ] || { echo "Missing compiler isolation dependency: ${executable}" >&2; exit 69; }
done
id uartcompile >/dev/null
systemd-analyze verify "${stage}/deploy/uartdebug-backend.service"
backup="$(mktemp -d /var/backups/uartdebug-compiler.XXXXXXXX)"
if [ -f /etc/systemd/system/uartdebug-backend.service ]; then
  cp -p /etc/systemd/system/uartdebug-backend.service "${backup}/uartdebug-backend.service"
fi
install -o root -g root -m 0644 "${stage}/deploy/uartdebug-backend.service" /etc/systemd/system/uartdebug-backend.service
systemctl daemon-reload

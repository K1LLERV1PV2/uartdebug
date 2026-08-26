#!/usr/bin/env bash

# Sourced by the GitHub Actions remote deployment script. Keep deployment
# mechanics versioned and testable instead of embedding a large shell program
# in the action input.

run_sudo() {
  command -v sudo >/dev/null 2>&1 || return 127
  sudo -n "$@"
}

print_backend_port_owner() {
  [ -n "${BACKEND_PORT:-}" ] || return 0
  echo "Backend port ${BACKEND_PORT} listeners:"

  if command -v ss >/dev/null 2>&1; then
    run_sudo ss -ltnp "sport = :${BACKEND_PORT}" 2>/dev/null ||
      ss -ltnp "sport = :${BACKEND_PORT}" 2>/dev/null || true
  fi

  if command -v lsof >/dev/null 2>&1; then
    run_sudo lsof -nP -iTCP:"${BACKEND_PORT}" -sTCP:LISTEN 2>/dev/null ||
      lsof -nP -iTCP:"${BACKEND_PORT}" -sTCP:LISTEN 2>/dev/null || true
  fi

  if command -v fuser >/dev/null 2>&1; then
    run_sudo fuser -v "${BACKEND_PORT}/tcp" 2>/dev/null ||
      fuser -v "${BACKEND_PORT}/tcp" 2>/dev/null || true
  fi
}

backend_port_busy() {
  [ -n "${BACKEND_PORT:-}" ] || return 1

  if command -v fuser >/dev/null 2>&1; then
    run_sudo fuser "${BACKEND_PORT}/tcp" >/dev/null 2>&1 ||
      fuser "${BACKEND_PORT}/tcp" >/dev/null 2>&1
    return $?
  fi

  if command -v lsof >/dev/null 2>&1; then
    [ -n "$(run_sudo lsof -ti TCP:"${BACKEND_PORT}" -sTCP:LISTEN 2>/dev/null ||
      lsof -ti TCP:"${BACKEND_PORT}" -sTCP:LISTEN 2>/dev/null || true)" ]
    return $?
  fi

  return 1
}

stop_backend_port_owner() {
  [ -n "${BACKEND_PORT:-}" ] || return 0
  print_backend_port_owner

  if command -v fuser >/dev/null 2>&1; then
    echo "Stopping any process currently listening on backend port ${BACKEND_PORT}"
    run_sudo fuser -k "${BACKEND_PORT}/tcp" >/dev/null 2>&1 ||
      fuser -k "${BACKEND_PORT}/tcp" >/dev/null 2>&1 || true
    sleep 2
  elif command -v lsof >/dev/null 2>&1; then
    pids="$(run_sudo lsof -ti TCP:"${BACKEND_PORT}" -sTCP:LISTEN 2>/dev/null ||
      lsof -ti TCP:"${BACKEND_PORT}" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "${pids}" ]; then
      echo "Stopping process currently listening on backend port ${BACKEND_PORT}: ${pids}"
      kill ${pids} || true
      sleep 2
    fi
  else
    echo "Neither fuser nor lsof found; relying on PM2 process-name cleanup"
  fi

  print_backend_port_owner
  if backend_port_busy; then
    echo "Backend port ${BACKEND_PORT} is still busy after stop attempt"
    exit 1
  fi
}

find_backend_tool() {
  tool_name="$1"
  configured="$2"
  shift 2

  if [ -n "${configured:-}" ]; then
    if [ -x "${configured}" ]; then
      printf '%s\n' "${configured}"
      return 0
    fi

    resolved="$(command -v "${configured}" 2>/dev/null || true)"
    if [ -n "${resolved}" ]; then
      printf '%s\n' "${resolved}"
      return 0
    fi

    echo "Configured ${tool_name} path is not executable: ${configured}" >&2
    return 1
  fi

  resolved="$(command -v "${tool_name}" 2>/dev/null || true)"
  if [ -n "${resolved}" ]; then
    printf '%s\n' "${resolved}"
    return 0
  fi

  for candidate in "$@"; do
    [ -x "${candidate}" ] || continue
    printf '%s\n' "${candidate}"
    return 0
  done

  if [ -d "/opt/microchip" ]; then
    resolved="$(find /opt/microchip -type f -name "${tool_name}" -perm -111 2>/dev/null |
      sort -V | tail -n 1 || true)"
    if [ -n "${resolved}" ]; then
      printf '%s\n' "${resolved}"
      return 0
    fi
  fi

  return 1
}

resolve_expected_compile_server_version() {
  EXPECTED_COMPILE_SERVER_VERSION="$(
    sed -nE 's/.*COMPILE_SERVER_VERSION[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' \
      "${BE_DIR}/compile-server.js" | head -n 1
  )"

  [ -n "${EXPECTED_COMPILE_SERVER_VERSION:-}" ] || {
    echo "Could not resolve COMPILE_SERVER_VERSION from ${BE_DIR}/compile-server.js"
    grep -n "COMPILE_SERVER_VERSION\\|/health" "${BE_DIR}/compile-server.js" || true
    exit 1
  }

  echo "Expected compile-server version: ${EXPECTED_COMPILE_SERVER_VERSION}"
}

resolve_backend_tools() {
  if ! XC8_CC="$(find_backend_tool "xc8-cc" "${XC8_CC:-}" \
    "/opt/microchip/xc8/v3.00/bin/xc8-cc" \
    "/opt/microchip/xc8/v2.50/bin/xc8-cc" \
    "/opt/microchip/xc8/bin/xc8-cc")"; then
    echo "Microchip XC8 compiler xc8-cc was not found on the server."
    echo "Install XC8 or set GitHub secret XC8_CC to the full xc8-cc path."
    exit 1
  fi

  xc8_root="$(dirname "$(dirname "${XC8_CC}")")"
  if ! AVR_OBJCOPY="$(find_backend_tool "avr-objcopy" "${AVR_OBJCOPY:-}" \
    "$(dirname "${XC8_CC}")/avr-objcopy" \
    "${xc8_root}/avr/bin/avr-objcopy" \
    "/usr/bin/avr-objcopy" \
    "/usr/local/bin/avr-objcopy")"; then
    echo "avr-objcopy was not found on the server."
    echo "Install AVR binutils or set GitHub secret AVR_OBJCOPY to the full avr-objcopy path."
    exit 1
  fi

  if [ ! -d "${XC8_DFP}" ]; then
    echo "XC8 DFP path was not found: ${XC8_DFP}"
    echo "Install the ATtiny DFP or set GitHub secret XC8_DFP to the correct directory."
    exit 1
  fi

  export XC8_CC AVR_OBJCOPY XC8_DFP
  export PATH="$(dirname "${XC8_CC}"):$(dirname "${AVR_OBJCOPY}"):${PATH}"
  echo "XC8_CC=${XC8_CC}"
  echo "AVR_OBJCOPY=${AVR_OBJCOPY}"
  echo "XC8_DFP=${XC8_DFP}"
}

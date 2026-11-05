#!/usr/bin/env bash

# Sourced by the GitHub Actions remote deployment script. Keep deployment
# mechanics versioned and testable instead of embedding a large shell program
# in the action input.

run_sudo() {
  command -v sudo >/dev/null 2>&1 || return 127
  sudo -n "$@"
}

verify_compiler_release() {
  local compiler_backend="$1"
  for required in compile-server.js compile-sandbox.js deploy/uartdebug-backend.service deploy/install-compiler-service.sh; do
    [ -f "${compiler_backend}/${required}" ] || {
      echo "Compiler release is missing ${required}; refusing to change release symlinks." >&2
      return 78
    }
  done
  [ -x /usr/bin/bwrap ] && [ -x /usr/bin/prlimit ] || {
    echo "Compiler isolation dependencies are unavailable; refusing to change release symlinks." >&2
    return 69
  }
  id uartcompile >/dev/null || return
  run_sudo systemd-analyze verify "${compiler_backend}/deploy/uartdebug-backend.service"
}

verify_ai_release_knowledge() {
  local materials_backend="$1"
  for required in ai-server.js compile-server.js compile-sandbox.js avr-ai-service.js avr-materials.js deploy/verify-materials.js deploy/uartdebug-ai.service deploy/uartdebug-backend.service; do
    [ -f "${materials_backend}/${required}" ] || {
      echo "Unsupported backend release: missing ${required}; refusing to change release symlinks." >&2
      return 78
    }
  done
  run_sudo -u uartmaterials -g uartai /usr/bin/node "${materials_backend}/deploy/verify-materials.js" \
    /var/lib/uartdebug-ai/materials/current/repository --prepare-catalog || return
  run_sudo -u uartai /usr/bin/node "${materials_backend}/deploy/verify-materials.js" \
    /var/lib/uartdebug-ai/materials/current/repository
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

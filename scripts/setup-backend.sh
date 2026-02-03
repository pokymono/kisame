#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf "\n==> %s\n" "$1"
}

err() {
  printf "\n[error] %s\n" "$1" >&2
}

need_sudo() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "sudo"
  else
    echo ""
  fi
}

SUDO="$(need_sudo)"

install_bun() {
  if command -v bun >/dev/null 2>&1; then
    log "Bun already installed"
    return
  fi

log "Installing Bun"
  curl -fsSL https://bun.sh/install | bash
  # shellcheck disable=SC1091
  if [[ -n "${BUN_INSTALL:-}" && -f "${BUN_INSTALL}/bin/bun" ]]; then
    export PATH="${BUN_INSTALL}/bin:${PATH}"
  elif [[ -f "${HOME}/.bun/bin/bun" ]]; then
    export PATH="${HOME}/.bun/bin:${PATH}"
  fi

  if ! command -v bun >/dev/null 2>&1; then
    err "Bun install completed but bun is not on PATH. Add ~/.bun/bin to PATH."
    exit 1
  fi
}

install_tshark() {
  if command -v tshark >/dev/null 2>&1; then
    log "tshark already installed"
    return
  fi

log "Installing tshark/wireshark-cli"
  if command -v apt-get >/dev/null 2>&1; then
    ${SUDO} apt-get update -y
    ${SUDO} DEBIAN_FRONTEND=noninteractive apt-get install -y tshark
  elif command -v dnf >/dev/null 2>&1; then
    ${SUDO} dnf install -y wireshark-cli || ${SUDO} dnf install -y wireshark
  elif command -v yum >/dev/null 2>&1; then
    ${SUDO} yum install -y wireshark-cli || ${SUDO} yum install -y wireshark
  elif command -v pacman >/dev/null 2>&1; then
    ${SUDO} pacman -Sy --noconfirm wireshark-cli
  else
    err "Unsupported package manager. Install tshark manually."
    exit 1
  fi

  if ! command -v tshark >/dev/null 2>&1; then
    err "tshark install failed. Please install tshark manually."
    exit 1
  fi
}

configure_capture_permissions() {
  if ! command -v dumpcap >/dev/null 2>&1; then
    return
  fi

  if command -v setcap >/dev/null 2>&1; then
    log "Setting capture capabilities for dumpcap"
    ${SUDO} setcap cap_net_raw,cap_net_admin=eip "$(command -v dumpcap)" || true
  fi
}

install_backend_deps() {
  log "Installing explanation-service dependencies"
  pushd "${REPO_ROOT}/services/explanation-service" >/dev/null
  bun install
  popd >/dev/null
}

main() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    err "This script targets Linux VMs. For macOS, install Wireshark/tshark via the official installer or Homebrew."
    exit 1
  fi

  install_bun
  install_tshark
  configure_capture_permissions
  install_backend_deps

  log "Done. Configure environment variables:"
  cat <<EOF
  - OPENAI_API_KEY=<your key>
  - OPENAI_MODEL=gpt-5.2
  - PORT=8787 (or your preferred port)
  - CORS_ORIGIN=*

Run the backend:
  cd services/explanation-service
  bun run start
EOF
}

main "$@"

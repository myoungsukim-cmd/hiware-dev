#!/usr/bin/env bash
# Docker Engine + Compose plugin 최신 안정판 설치
#
# 사용법:
#   ./scripts/install-docker.sh
#   ./scripts/install-docker.sh --skip-start   # 설치만, 서비스 기동 생략
#
# 지원: Amazon Linux 2/2023, RHEL/CentOS/Rocky/Alma (dnf/yum), Debian/Ubuntu (apt)
set -euo pipefail

SKIP_START=false

for arg in "$@"; do
  case "${arg}" in
    --skip-start) SKIP_START=true ;;
    -h|--help)
      sed -n '2,7p' "$0"
      exit 0
      ;;
    *)
      echo "[ERROR] 알 수 없는 옵션: ${arg}" >&2
      exit 1
      ;;
  esac
done

log_info() { echo "[INFO] $*"; }
log_ok()   { echo "[OK]   $*"; }
log_warn() { echo "[WARN] $*"; }
log_err()  { echo "[ERROR] $*" >&2; }

run_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    log_err "root 권한이 필요합니다: $*"
    exit 1
  fi
}

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_VERSION_ID="${VERSION_ID:-}"
    OS_NAME="${NAME:-${OS_ID}}"
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    OS_ID="darwin"
    OS_NAME="macOS"
  else
    OS_ID="unknown"
    OS_NAME="unknown"
  fi
}

docker_ready() {
  command -v docker >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1 \
    && docker info >/dev/null 2>&1
}

install_compose_plugin_fallback() {
  # Amazon Linux 등에서 compose plugin 패키지가 없을 때
  if docker compose version >/dev/null 2>&1; then
    return 0
  fi
  log_info "docker compose plugin 수동 설치"
  local arch
  arch="$(uname -m)"
  case "${arch}" in
    x86_64|amd64) arch="x86_64" ;;
    aarch64|arm64) arch="aarch64" ;;
  esac
  local url="https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${arch}"
  run_root mkdir -p /usr/local/lib/docker/cli-plugins
  run_root curl -fsSL "${url}" -o /usr/local/lib/docker/cli-plugins/docker-compose
  run_root chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  # 구형 호환 심볼릭
  if [[ ! -x /usr/local/bin/docker-compose ]]; then
    run_root ln -sf /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose
  fi
}

install_docker_amazon() {
  local mgr="${1}"
  log_info "Amazon Linux — 공식 Amazon docker 패키지 설치 (${mgr})"

  # 이전에 잘못 추가된 CentOS docker-ce.repo 제거 (404 원인)
  if [[ -f /etc/yum.repos.d/docker-ce.repo ]]; then
    log_warn "잘못된 docker-ce.repo 제거 (CentOS 레포는 Amazon Linux 비호환)"
    run_root rm -f /etc/yum.repos.d/docker-ce.repo
    run_root "${mgr}" clean all 2>/dev/null || true
  fi

  # AL2: amazon-linux-extras / AL2023: dnf docker
  if command -v amazon-linux-extras >/dev/null 2>&1; then
    run_root amazon-linux-extras install -y docker || true
  fi

  run_root "${mgr}" -y install docker

  # compose plugin 패키지가 있으면 설치, 없으면 GitHub release
  if run_root "${mgr}" -y install docker-compose-plugin 2>/dev/null; then
    log_ok "docker-compose-plugin 설치됨"
  elif run_root "${mgr}" -y install docker-compose 2>/dev/null; then
    log_ok "docker-compose 설치됨"
  else
    install_compose_plugin_fallback
  fi
}

install_docker_rhel() {
  local mgr="${1}"
  log_info "Docker CE 설치 (${mgr})"

  run_root "${mgr}" -y install dnf-plugins-core 2>/dev/null \
    || run_root "${mgr}" -y install yum-utils 2>/dev/null \
    || true

  if [[ ! -f /etc/yum.repos.d/docker-ce.repo ]]; then
    run_root "${mgr}" config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  fi

  run_root "${mgr}" -y install \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
}

install_docker_apt() {
  log_info "Docker CE 설치 (apt)"
  run_root apt-get update -qq
  run_root apt-get install -y ca-certificates curl gnupg

  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    run_root install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | run_root gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    run_root chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  local distro="${OS_ID}"
  if [[ "${distro}" == "debian" ]]; then
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${OS_VERSION_ID} stable" \
      | run_root tee /etc/apt/sources.list.d/docker.list >/dev/null
  else
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${OS_VERSION_ID} stable" \
      | run_root tee /etc/apt/sources.list.d/docker.list >/dev/null
  fi

  run_root apt-get update -qq
  run_root apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin
}

start_docker_service() {
  if [[ "${SKIP_START}" == "true" ]]; then
    log_warn "Docker 서비스 기동 생략 (--skip-start)"
    return
  fi

  run_root systemctl enable docker
  run_root systemctl start docker
  log_ok "docker 서비스 시작됨"
}

add_user_to_docker_group() {
  if [[ "${EUID}" -eq 0 ]]; then
    return
  fi
  if id -nG "${USER}" 2>/dev/null | grep -qw docker; then
    return
  fi
  run_root usermod -aG docker "${USER}" 2>/dev/null || true
  log_warn "현재 사용자(${USER})를 docker 그룹에 추가했습니다."
  log_warn "적용: 로그아웃 후 재로그인, 또는 newgrp docker"
}

print_versions() {
  log_ok "Docker $(docker --version)"
  log_ok "Compose $(docker compose version)"
}

main() {
  echo "=== Docker 설치 ==="

  if docker_ready; then
    print_versions
    log_ok "Docker가 이미 설치·실행 중입니다."
    exit 0
  fi

  detect_os
  log_info "OS: ${OS_NAME}"

  if [[ "${OS_ID}" == "darwin" ]]; then
    log_err "macOS는 Docker Desktop을 설치하세요: https://docs.docker.com/desktop/setup/install/mac-install/"
    exit 1
  fi

  local mgr=""
  if command -v dnf >/dev/null 2>&1; then mgr="dnf"
  elif command -v yum >/dev/null 2>&1; then mgr="yum"
  elif command -v apt-get >/dev/null 2>&1; then mgr="apt"
  else
    log_err "지원하지 않는 OS입니다. Docker CE를 수동 설치하세요."
    exit 1
  fi

  case "${OS_ID}" in
    amzn|amazon)
      install_docker_amazon "${mgr}"
      ;;
    *)
      case "${mgr}" in
        dnf|yum) install_docker_rhel "${mgr}" ;;
        apt) install_docker_apt ;;
      esac
      ;;
  esac

  start_docker_service
  add_user_to_docker_group

  if docker_ready; then
    print_versions
  else
    log_warn "설치됐으나 docker info 실패 — docker 그룹 적용 후 재시도하거나 sudo docker 로 실행하세요."
    docker --version
    docker compose version
  fi

  echo ""
  echo "MySQL 컨테이너 시작:"
  echo "  cp docker/mysql/.env.example docker/mysql/.env && vi docker/mysql/.env"
  echo "  npm run db:mysql:up"
  echo "  npm run db:init"
}

main "$@"

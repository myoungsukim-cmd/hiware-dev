#!/usr/bin/env bash
# slack-hiware-approval 최초 실행 부트스트랩
# - OS 패키지(Node.js 등) 확인·설치 (yum/dnf 우선)
# - npm 의존성 설치
# - .env 생성
# - DB init + 상태 확인
#
# 사용법:
#   ./setup.sh              # 전체 (OS 설치 포함)
#   ./setup.sh --skip-os    # OS 패키지 설치 생략 (이미 Node 있을 때)
#   ./setup.sh --skip-db    # DB init 생략
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT}"

SKIP_OS=false
SKIP_DB=false
NPM_CI=false

for arg in "$@"; do
  case "${arg}" in
    --skip-os) SKIP_OS=true ;;
    --skip-db) SKIP_DB=true ;;
    --prod) NPM_CI=true ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "[ERROR] 알 수 없는 옵션: ${arg} (./setup.sh --help)" >&2
      exit 1
      ;;
  esac
done

NODE_MIN_MAJOR=18

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

detect_pkg_mgr() {
  if command -v dnf >/dev/null 2>&1; then
    PKG_MGR="dnf"
  elif command -v yum >/dev/null 2>&1; then
    PKG_MGR="yum"
  elif command -v apt-get >/dev/null 2>&1; then
    PKG_MGR="apt"
  elif command -v brew >/dev/null 2>&1; then
    PKG_MGR="brew"
  else
    PKG_MGR=""
  fi
}

node_major_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi
  node -v | sed 's/^v//' | cut -d. -f1
}

install_node_rhel() {
  local mgr="${1}"
  log_info "Node.js ${NODE_MIN_MAJOR}+ 설치 (${mgr})"

  run_root "${mgr}" -y install curl ca-certificates gcc-c++ make

  if ! rpm -qa 2>/dev/null | grep -q nodesource-release; then
    log_info "NodeSource 18.x repo 등록"
    curl -fsSL https://rpm.nodesource.com/setup_18.x | run_root bash -
  fi

  run_root "${mgr}" -y install nodejs
}

install_node_apt() {
  log_info "Node.js 설치 (apt)"
  run_root apt-get update -qq
  run_root apt-get install -y curl ca-certificates build-essential
  if ! command -v node >/dev/null 2>&1 || [[ "$(node_major_version)" -lt "${NODE_MIN_MAJOR}" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | run_root bash -
    run_root apt-get install -y nodejs
  fi
}

install_node_brew() {
  log_info "Node.js 설치 (brew)"
  brew install node@18
  brew link --overwrite node@18 2>/dev/null || true
}

ensure_node() {
  local major
  major="$(node_major_version)"

  if [[ "${major}" -ge "${NODE_MIN_MAJOR}" ]]; then
    log_ok "Node.js $(node -v) (npm $(npm -v))"
    return
  fi

  if [[ "${SKIP_OS}" == "true" ]]; then
    log_err "Node.js ${NODE_MIN_MAJOR}+ 필요합니다. 현재: $(command -v node >/dev/null && node -v || echo '없음')"
    exit 1
  fi

  detect_os
  detect_pkg_mgr
  log_info "OS: ${OS_NAME} / 패키지 관리자: ${PKG_MGR:-없음}"

  case "${PKG_MGR}" in
    dnf) install_node_rhel dnf ;;
    yum) install_node_rhel yum ;;
    apt) install_node_apt ;;
    brew) install_node_brew ;;
    *)
      log_err "지원하지 않는 OS입니다. Node.js ${NODE_MIN_MAJOR}+ 를 수동 설치 후 --skip-os 로 재실행하세요."
      exit 1
      ;;
  esac

  major="$(node_major_version)"
  if [[ "${major}" -lt "${NODE_MIN_MAJOR}" ]]; then
    log_err "Node.js 설치 후에도 버전이 부족합니다: $(node -v 2>/dev/null || echo 없음)"
    exit 1
  fi
  log_ok "Node.js $(node -v) 설치 완료"
}

ensure_npm_packages() {
  local marker="${ROOT}/node_modules/express/package.json"

  if [[ -f "${marker}" ]] && [[ -f "${ROOT}/node_modules/mysql2/package.json" ]]; then
    log_ok "npm 패키지 이미 설치됨"
    return
  fi

  log_info "npm 의존성 설치 중..."
  if [[ "${NPM_CI}" == "true" ]] && [[ -f "${ROOT}/package-lock.json" ]]; then
    npm ci --omit=dev
  elif [[ -f "${ROOT}/package-lock.json" ]]; then
    npm ci
  else
    npm install
  fi
  log_ok "npm install 완료"
}

ensure_env_file() {
  local env_file="${ROOT}/.env"
  local example="${ROOT}/.env.example"

  if [[ -f "${env_file}" ]]; then
    log_ok ".env 존재"
    return
  fi

  if [[ ! -f "${example}" ]]; then
    log_err ".env.example 없음"
    exit 1
  fi

  cp "${example}" "${env_file}"
  chmod 600 "${env_file}" 2>/dev/null || true
  log_warn ".env 생성됨 — 배포 전 반드시 값을 수정하세요:"
  echo "         DB_PASSWORD, HIWARE_USER_ID/PWD (또는 HIWARE_API_TOKEN), SLACK_*"
}

validate_env_for_db() {
  # shellcheck disable=SC1091
  set +u
  source "${ROOT}/.env" 2>/dev/null || true
  set -u

  local missing=()
  local db_user="${DB_USERNAME:-${MYSQL_USER:-}}"
  local db_pass="${DB_PASSWORD:-${MYSQL_PASSWORD:-}}"
  local db_catalog="${DB_CATALOG:-${MYSQL_DATABASE:-}}"
  [[ -z "${db_user}" ]] && missing+=("DB_USERNAME")
  [[ -z "${db_pass}" || "${db_pass}" == "change-me" ]] && missing+=("DB_PASSWORD")
  [[ -z "${db_catalog}" ]] && missing+=("DB_CATALOG")
  local has_login=0
  local has_token=0
  if [[ -n "${HIWARE_USER_ID:-}" && "${HIWARE_USER_ID}" != "your-hiware-user" \
     && -n "${HIWARE_USER_PWD:-}" && "${HIWARE_USER_PWD}" != "your-hiware-password" ]]; then
    has_login=1
  fi
  if [[ -n "${HIWARE_API_TOKEN:-}" && "${HIWARE_API_TOKEN}" != "your-api-token" ]]; then
    has_token=1
  fi
  if [[ "${has_login}" -eq 0 && "${has_token}" -eq 0 ]]; then
    missing+=("HIWARE_USER_ID+HIWARE_USER_PWD (또는 HIWARE_API_TOKEN)")
  fi
  [[ -z "${SLACK_BOT_TOKEN:-}" || "${SLACK_BOT_TOKEN}" == "xoxb-your-bot-token" ]] && missing+=("SLACK_BOT_TOKEN")
  [[ -z "${SLACK_SIGNING_SECRET:-}" || "${SLACK_SIGNING_SECRET}" == "your-signing-secret" ]] && missing+=("SLACK_SIGNING_SECRET")

  if [[ ${#missing[@]} -gt 0 ]]; then
    log_err ".env 에 다음 값을 설정한 뒤 다시 실행하세요: ${missing[*]}"
    exit 1
  fi
}

run_db_init() {
  log_info "DB 초기화 (npm run db:init)"
  npm run db:init
  log_ok "DB init 완료"
}

run_db_status() {
  log_info "DB 상태 확인 (npm run db:status)"
  npm run db:status
}

main() {
  echo "=== slack-hiware-approval setup ==="
  echo "root=${ROOT}"
  echo ""

  ensure_node
  ensure_npm_packages
  ensure_env_file

  if [[ "${SKIP_DB}" == "true" ]]; then
    log_warn "DB init 생략 (--skip-db)"
    echo ""
  echo "다음 단계:"
  echo "  1) .env 값 확인/수정"
  echo "  2) npm run db:mysql:up   # Docker MySQL 사용 시"
  echo "  3) npm run db:init"
  echo "  4) npm start  &  npm run worker"
  echo "  ★ 전체 가이드: docs/DEPLOY_GUIDE.md"
    exit 0
  fi

  validate_env_for_db
  run_db_init
  run_db_status

  echo ""
  log_ok "setup 완료"
  echo ""
  echo "서비스 시작:"
  echo "  npm start          # API"
  echo "  npm run worker     # Job Worker"
  echo "  pm2 start ecosystem.config.cjs   # PM2 권장"
  echo "  ★ 전체 가이드: docs/DEPLOY_GUIDE.md"
}

main "$@"

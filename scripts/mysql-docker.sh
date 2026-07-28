#!/usr/bin/env bash
# MySQL Docker 컨테이너 관리
#
# 사용법:
#   ./scripts/mysql-docker.sh up       # 기동 (+ healthcheck 대기)
#   ./scripts/mysql-docker.sh down     # 중지
#   ./scripts/mysql-docker.sh restart
#   ./scripts/mysql-docker.sh status
#   ./scripts/mysql-docker.sh logs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MYSQL_DIR="${ROOT}/docker/mysql"
COMPOSE_FILE="${MYSQL_DIR}/docker-compose.yml"
ENV_FILE="${MYSQL_DIR}/.env"
ENV_EXAMPLE="${MYSQL_DIR}/.env.example"

log_info() { echo "[INFO] $*"; }
log_ok()   { echo "[OK]   $*"; }
log_warn() { echo "[WARN] $*"; }
log_err()  { echo "[ERROR] $*" >&2; }

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    log_err "docker 없음 — ./scripts/install-docker.sh 실행"
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    log_err "docker compose plugin 없음 — ./scripts/install-docker.sh 실행"
    exit 1
  fi
}

ensure_env_file() {
  if [[ -f "${ENV_FILE}" ]]; then
    return
  fi
  if [[ ! -f "${ENV_EXAMPLE}" ]]; then
    log_err "docker/mysql/.env.example 없음"
    exit 1
  fi
  cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}" 2>/dev/null || true
  log_warn "docker/mysql/.env 생성됨 — 비밀번호 수정 후 다시 실행하세요."
  exit 1
}

compose() {
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
}

wait_healthy() {
  local i=0
  local max=60
  log_info "MySQL healthcheck 대기 중..."
  while [[ "${i}" -lt "${max}" ]]; do
    local status
    status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}unknown{{end}}' slack-hiware-mysql 2>/dev/null || echo unknown)"
    if [[ "${status}" == "healthy" ]]; then
      log_ok "MySQL healthy"
      return 0
    fi
    sleep 2
    i=$((i + 1))
  done
  log_warn "healthcheck 타임아웃 — docker logs slack-hiware-mysql 확인"
  compose ps
}

cmd_up() {
  ensure_env_file
  compose up -d
  wait_healthy
  echo ""
  echo "다음: npm run db:init"
}

cmd_down() {
  ensure_env_file
  compose down
  log_ok "MySQL 컨테이너 중지"
}

cmd_restart() {
  cmd_down
  cmd_up
}

cmd_status() {
  ensure_env_file
  compose ps
}

cmd_logs() {
  ensure_env_file
  compose logs -f --tail=100 mysql
}

usage() {
  sed -n '2,10p' "$0"
}

main() {
  ensure_docker
  local action="${1:-}"
  case "${action}" in
    up) cmd_up ;;
    down) cmd_down ;;
    restart) cmd_restart ;;
    status) cmd_status ;;
    logs) cmd_logs ;;
    -h|--help|"") usage ;;
    *)
      log_err "알 수 없는 명령: ${action}"
      usage
      exit 1
      ;;
  esac
}

main "$@"

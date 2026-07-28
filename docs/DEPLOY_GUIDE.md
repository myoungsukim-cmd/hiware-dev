# HIWARE × Slack 결재 연동 — 전체 설치·운영 가이드

> **대상:** 운영 서버 `172.25.2.101` 최초 배포  
> **전제:** 코드는 `slack-hiware-approval/` 에 준비됨. DB init은 아직 안 한 상태 기준.

---

## 1. 한눈에 보는 아키텍처

```text
[Slack] ──HTTPS POST──► [도메인/ALB :443]
                              │
                              ▼
                    [Node.js API :3000]  ← /slack/actions, /health
                              │
                    [Node.js Worker]     ← HIWARE applyApv, intray 폴링
                              │
                    [MySQL Docker :3306] ← Docker 컨테이너
                              │
                    [HIWARE API :11200]  ← 172.25.2.101 (내부망)
```

| 프로세스 | 역할 |
|----------|------|
| `slack-hiware-api` | Slack Interactivity 수신 (3초 내 응답) |
| `slack-hiware-worker` | HIWARE API 호출, DM 발송, 스케줄러 |
| `slack-hiware-mysql` | MySQL 8 Docker 컨테이너 |

---

## 2. 사전 준비 체크리스트

배포 전에 아래를 확보하세요.

| 항목 | 상태 | 비고 |
|------|------|------|
| 서버 SSH 접속 (`172.25.2.101`) | ☐ | RHEL/CentOS 계열 가정 |
| HIWARE 서비스 계정 ID/PW (또는 API Token) | ☐ | `/users`, intray, applyApv 권한 |
| Slack App 생성 | ☐ | manifest import (도메인은 나중에 URL 수정 가능) |
| Slack Bot Token (`xoxb-...`) | ☐ | OAuth & Permissions |
| Slack Signing Secret | ☐ | Basic Information |
| 공인 HTTPS 도메인 | ☐ | 인프라팀 발급 대기 중 → `YOUR-DOMAIN` |
| 방화벽 443 인바운드 | ☐ | Slack → 백엔드 |
| 아웃바운드 `api.slack.com:443` | ☐ | DM/Modal API |
| 아웃바운드 `172.25.2.101:11200` | ☐ | HIWARE API |

---

## 3. 내일 할 작업 — 전체 순서

### Step 0. 서버에 코드 올리기

```bash
# 예: scp / git clone 후
cd slack-hiware-approval
```

---

### Step 1. Docker 설치

Docker CE 최신 안정판 + Compose plugin 설치.

```bash
chmod +x scripts/install-docker.sh
./scripts/install-docker.sh
```

| 옵션 | 설명 |
|------|------|
| (없음) | 설치 + `systemctl start docker` |
| `--skip-start` | 패키지만 설치, 서비스 기동 생략 |

설치 후 **로그아웃 → 재로그인** (docker 그룹 적용).  
확인:

```bash
docker --version
docker compose version
```

---

### Step 2. MySQL Docker 환경변수

```bash
cp docker/mysql/.env.example docker/mysql/.env
vi docker/mysql/.env
```

`docker/mysql/.env` 에서 수정할 값:

| 변수 | 설명 | 예시 |
|------|------|------|
| `DB_PORT` | 호스트에 노출할 포트 | `3306` |
| `DB_ROOT_PASSWORD` | root 비밀번호 | 강한 비밀번호 |
| `DB_CATALOG` | DB 이름 | `slack_hiware_approval` |
| `DB_USERNAME` | 앱 접속 계정 | `slack_hiware` |
| `DB_PASSWORD` | 앱 접속 비밀번호 | 강한 비밀번호 |

---

### Step 3. 앱 환경변수 (`.env`)

```bash
cp .env.example .env
vi .env
```

**`docker/mysql/.env` 와 반드시 동일하게 맞출 것:**

| 변수 | 값 |
|------|-----|
| `DB_HOST` | `127.0.0.1` (같은 서버 Docker) |
| `DB_PORT` | `3306` (docker/mysql/.env 와 동일) |
| `DB_USERNAME` | docker/mysql/.env 와 동일 |
| `DB_PASSWORD` | docker/mysql/.env 와 동일 |
| `DB_CATALOG` | docker/mysql/.env 와 동일 |
| `DB_MAX_CONNECTION_SIZE` | `10` (커넥션 풀 크기) |

**HIWARE / Slack:**

| 변수 | 설명 |
|------|------|
| `HIWARE_BASE_URL` | `https://172.25.2.101:11200/hiware/v1/ext` |
| `HIWARE_USER_ID` / `HIWARE_USER_PWD` | **권장** — Login Interface로 authKey 자동 발급·만료 시 재발급 |
| `HIWARE_API_TOKEN` | 레거시 고정 토큰 (ID/PW 없을 때만). ID/PW가 있으면 로그인 모드 우선 |
| `HIWARE_INSECURE` | `true` (HIWARE 자체서명 인증서) |
| `SLACK_BOT_TOKEN` | `xoxb-...` |
| `SLACK_SIGNING_SECRET` | Slack App Signing Secret |
| `TRUST_PROXY` | `true` (ALB/nginx 뒤에서 운영 시) |

무중단 전환: ① 코드 배포(기존 TOKEN만으로도 기동) → ② `.env`에 ID/PW 추가 후 api·worker 재시작 → ③ 로그 `HIWARE login ok` 확인 후 TOKEN 제거 가능.

---

### Step 4. MySQL 컨테이너 기동

```bash
npm run db:mysql:up
```

내부 동작: `docker compose` 로 `slack-hiware-mysql` 컨테이너 시작 → healthcheck 대기.

확인:

```bash
npm run db:mysql:status
docker ps | grep slack-hiware-mysql
```

---

### Step 5. DB 초기화 (schema + migration)

**처음 1회** — `schema.sql` 전체 + `db/migrations/` 미적용분 자동 실행.

```bash
npm run db:init
```

포함 내용:

| 단계 | 파일 | 내용 |
|------|------|------|
| 1 | `db/schema.sql` | 테이블 11개 + `schema_migrations` |
| 2 | `db/migrations/*.sql` | 아직 적용 안 된 migration만 (멱등) |

현재 migration 목록:

- `002_slack_event_logs` — Slack 이벤트 감사 로그

> 신규 설치: schema.sql 에 이미 포함된 migration 은 `[SKIP]` 으로 건너뜀.

확인:

```bash
npm run db:status
```

기대 결과: 테이블 11개, `schema_migrations` 에 `001_initial`, `002_slack_event_logs`.

**이미 schema 만 있고 migration 만 추가할 때:**

```bash
npm run db:migrate
```

---

### Step 6. Node.js + npm 패키지 (setup.sh)

Docker/MySQL 은 위에서 했으므로 DB 부분만 setup 에 맡기거나 전체 실행:

```bash
# Node 없으면 (OS 패키지 포함 전체)
./setup.sh --skip-db

# 또는 Node 이미 있으면
npm ci
```

`--skip-db`: MySQL Docker + `db:init` 을 이미 했으므로 setup 에서 DB 단계 생략.

---

### Step 7. Slack App 등록

1. https://api.slack.com/apps → **Create New App** → **From a manifest**
2. `slack/app-manifest.yaml` 내용 붙여넣기 (YAML 탭)
3. `request_url` 은 도메인 발급 전이면 placeholder 그대로 OK
4. **Install to Workspace**
5. Bot Token + Signing Secret → `.env` 반영

도메인 발급 후 Slack App 설정에서:

```text
Interactivity Request URL:
https://{발급도메인}/slack/actions
```

---

### Step 8. API + Worker 기동 (PM2)

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

| PM2 이름 | 스크립트 | 역할 |
|----------|----------|------|
| `slack-hiware-api` | `src/server.js` | HTTP API (:3000) |
| `slack-hiware-worker` | `src/worker.js` | Job 처리 + 스케줄러 |

헬스체크 (서버 로컬):

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/health/ready
```

`health/ready` 가 200 이면 MySQL 연결 OK.

---

### Step 9. 도메인/SSL 발급 후 (인프라팀)

도메인 확정되면:

1. ALB/nginx: `443` → EC2 `:3000`
2. Health Check: `GET /health` (**Target Group** — Route53이 아님)
3. Slack App `request_url` 업데이트
4. 외부에서 확인:

```bash
curl https://{도메인}/health
```

상세(ALB / SG / Route53 / 검증): [AWS_ALB_ROUTE53.md](./AWS_ALB_ROUTE53.md)

---

### Step 10. 연동 테스트

**10-1. DM 테스트 (도메인 없이 가능)**

`.env` 에 추가:

```env
SLACK_TEST_USER_ID=U01234567
TEST_APV_APLT_NO=4
```

```bash
npm run slack:test-dm
```

Slack DM 수신 → `[상세/처리하기]` 클릭.

**10-2. Modal + 승인/반려 E2E (도메인 + HTTPS 필요)**

1. Modal 열림 확인
2. 코멘트(5자+) + HIWARE 결재 비밀번호 입력
3. [승인] 또는 [반려]
4. Modal "처리 중" → "처리 완료"
5. HIWARE 에서 결재 상태 변경 확인

**10-3. DB 로그 확인**

```bash
npm run db:status

# Slack 이벤트 로그 (MySQL)
# SELECT * FROM slack_event_logs ORDER BY id DESC LIMIT 20;
```

---

### Step 11. 자동 DM 발송 확인 (실사용)

Worker 스케줄러가 자동 실행:

| Job | 주기 (기본) | 역할 |
|-----|-------------|------|
| userSync + mapping | 24h | HIWARE 사용자 목록 + **상세 API 이메일** → Slack 이메일 매핑 |
| approvalSync + notifier | 30s | intray 폴링 → 결재 DM |
| reminder | 15m | 미처리 리마인더 |
| reconcile | 1h | HIWARE 상태 동기화 |

> **참고:** `GET /users` 목록 API는 `emailAddr`가 `********`로 마스킹됩니다.  
> Slack 매핑을 위해 동기화 시 `GET /users/{userNo}` 상세 API로 실제 이메일을 가져옵니다.

HIWARE 에 테스트 결재 1건 올린 뒤 30초~1분 내 결재자 DM 수신 확인.

---

## 4. 명령어 치트시트

### Docker

| 명령어 | 설명 |
|--------|------|
| `./scripts/install-docker.sh` | Docker CE + Compose 설치 |
| `npm run db:mysql:up` | MySQL 컨테이너 시작 + healthcheck 대기 |
| `npm run db:mysql:down` | MySQL 컨테이너 중지 |
| `npm run db:mysql:status` | 컨테이너 상태 |
| `npm run db:mysql:logs` | MySQL 로그 tail |

### DB

| 명령어 | 설명 |
|--------|------|
| `npm run db:init` | **최초 1회** — schema.sql + pending migrations |
| `npm run db:migrate` | migration 만 추가 적용 (기존 DB 업그레이드) |
| `npm run db:status` | 테이블 row 수 + Slack 실패 로그 요약 |

### 앱

| 명령어 | 설명 |
|--------|------|
| `./setup.sh` | Node 설치 + npm + .env + db:init (올인원) |
| `./setup.sh --skip-os` | Node OS 설치 생략 |
| `./setup.sh --skip-db` | DB init 생략 |
| `npm start` | API 서버 단독 실행 |
| `npm run worker` | Worker 단독 실행 |
| `pm2 start ecosystem.config.cjs` | API + Worker 운영 기동 (권장) |
| `pm2 restart all` | .env 변경 후 재시작 |
| `pm2 logs` | 로그 확인 |
| `npm run slack:test-dm` | Slack DM 수동 테스트 |

---

## 5. 환경변수 파일 정리

| 파일 | 용도 | git |
|------|------|-----|
| `.env.example` | 앱 env 템플릿 | ✅ 커밋 |
| `.env` | 실제 앱 설정 (HIWARE, Slack, MySQL 접속) | ❌ gitignore |
| `docker/mysql/.env.example` | MySQL 컨테이너 템플릿 | ✅ 커밋 |
| `docker/mysql/.env` | 실제 MySQL root/앱 비밀번호 | ❌ gitignore |

**규칙:** `DB_CATALOG`, `DB_USERNAME`, `DB_PASSWORD`, `DB_PORT` 는 `.env` 와 `docker/mysql/.env` 가 **동일**해야 함.

> 레거시 `MYSQL_*` 변수도 동작하지만, Querypie 스타일 `DB_*` 사용을 권장합니다.

---

## 6. DB 테이블 (11개)

| 테이블 | 용도 |
|--------|------|
| `hiware_users` | HIWARE 사용자 동기화 |
| `slack_user_mappings` | HIWARE ↔ Slack 이메일 매핑 |
| `approval_items` | 결재 문서 |
| `approval_approvers` | 결재자 step/상태 |
| `slack_messages` | 결재자 DM 이력 |
| `approval_action_logs` | 승인/반려 HIWARE 처리 로그 |
| `slack_requester_notifications` | 기안자 최종 결과 DM |
| `slack_action_jobs` | 비동기 job 큐 |
| `slack_event_logs` | Slack API 이벤트 감사 로그 |
| `worker_locks` | Worker 분산 락 |
| `schema_migrations` | schema/migration 버전 |

---

## 7. 트러블슈팅

| 증상 | 확인 |
|------|------|
| `ECONNREFUSED` MySQL | `npm run db:mysql:status`, `.env` DB_HOST/DB_PORT |
| `Access denied` MySQL | `.env` 와 `docker/mysql/.env` DB_PASSWORD 일치 여부 |
| `Invalid Slack signature` | `SLACK_SIGNING_SECRET`, HTTPS URL, `TRUST_PROXY=true` |
| DM 안 옴 | `SLACK_BOT_TOKEN`, 워크스페이스 앱 설치, 이메일 매핑 |
| Modal 안 열림 | Interactivity URL, 도메인 HTTPS |
| HIWARE SSL 오류 | `HIWARE_INSECURE=true` |
| migration 중복 오류 | `npm run db:status` 로 `schema_migrations` 확인 |

---

## 8. 내일 작업용 최短 명령어 순서 (복붙용)

```bash
cd slack-hiware-approval

# Docker
./scripts/install-docker.sh
# 로그아웃 후 재로그인

# env
cp docker/mysql/.env.example docker/mysql/.env && vi docker/mysql/.env
cp .env.example .env && vi .env

# MySQL + DB
npm run db:mysql:up
npm run db:init
npm run db:status

# 단계별 연동 검증 (RESULT: OK 확인) — docs/VERIFY.md
npm run verify

# Node (이미 있으면 npm ci 만)
./setup.sh --skip-db

# PM2
pm2 start ecosystem.config.cjs
pm2 save
curl http://127.0.0.1:3000/health/ready
npm run verify -- 07 08

# Slack 토큰 .env 반영 후
pm2 restart all
npm run slack:test-dm
```

도메인 발급 후: Slack `request_url` 수정 → `curl https://{도메인}/health` → Modal E2E.

---

## 9. 관련 문서

| 파일 | 내용 |
|------|------|
| `docs/SETUP.md` | Slack App·Block Kit 상세 |
| `docs/PRESENTATION.md` | 발표용 요약 |
| `docs/VERIFY.md` | 단계별 연동 검증 |
| `docs/SCENARIO_POC.md` | 결재선 A/B (팀장→병렬 / 팀장→CISO→병렬) intray PoC |
| `slack/app-manifest.yaml` | Slack App manifest |
| `Slack_Hiware_결재시스템_연동계획서.md` | 전체 기획서 |

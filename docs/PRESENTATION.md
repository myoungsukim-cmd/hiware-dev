# HIWARE × Slack 결재 연동 — 발표 정리

> **한 줄 요약**  
> HIWARE 결재를 Slack DM/Modal로 처리하는 Node.js 백엔드.  
> Slack App은 **봇만 만들고 토큰·URL만 등록**하면 되고, UI·결재 로직은 **백엔드가 전부 담당**한다.

---

# 1. 프로젝트 목표

- HIWARE에 결재 문서 발생 → **현재 결재자에게 Slack DM** 발송
- 결재자가 Slack Modal에서 상세 확인 후 **승인/반려**
- 백엔드가 HIWARE `batchApplyApv` API 호출
- MySQL로 사용자 매핑·발송 이력·중복 방지·처리 로그 관리

**운영 환경**

| 항목 | 값 |
|------|-----|
| HIWARE API | `https://172.25.2.101:11200/hiware/v1/ext` |
| 백엔드 | Node.js 18+ / Express / MySQL 8 |
| 배포 서버 | `172.25.2.101` (운영 테스트 예정) |
| 프로세스 | API 서버 + Worker (2프로세스, PM2) |

---

# 2. 전체 아키텍처

```
┌─────────────┐     intray/users API      ┌──────────────────────┐
│   HIWARE    │ ◄──────────────────────── │  Backend (Node.js)   │
│  (결재 원장) │                           │                      │
└─────────────┘                           │  ┌─ API Server        │
      ▲                                   │  │  /slack/actions   │
      │ batchApplyApv                     │  │  /health          │
      │                                   │  └─ Worker           │
      │                                   │     (job poll)       │
      │                                   └──────────┬───────────┘
      │                                              │
      │                                   ┌──────────▼───────────┐
      │                                   │       MySQL          │
      │                                   │  사용자/결재/이력/큐  │
      │                                   └──────────┬───────────┘
      │                                              │
┌─────┴───────┐   DM + Modal (Block Kit)    ┌────────▼───────────┐
│   Slack     │ ◄────────────────────────── │  Block Kit 생성    │
│  (봇 App)   │   Interactivity callback    │  (백엔드 코드)     │
└─────────────┘                             └────────────────────┘
```

**Slack 3초 타임아웃 대응**

| 단계 | 처리 위치 | 시간 |
|------|-----------|------|
| Modal [승인]/[반려] 클릭 | API: 검증 + DB job INSERT | < 1초 |
| HTTP 응답 | Modal "처리 중" 표시 | 3초 이내 |
| HIWARE API 호출 | Worker (별도 프로세스) | 제한 없음 |
| 결과 반영 | Worker → Modal/DM update | 비동기 |

---

# 3. 사용자 플로우 (데모 시나리오)

```
[1] 결재 발생 (HIWARE)
        ↓
[2] 백엔드 intray 폴링 → 결재자 Slack DM 발송
    ┌─────────────────────────────┐
    │ [결재 요청]                  │
    │ 제목 / 기안자 / 요청일시      │
    │ [상세/처리하기]  ← 버튼      │
    └─────────────────────────────┘
        ↓ 클릭
[3] Modal 오픈 (HIWARE 상세 API 조회)
    ┌─────────────────────────────┐
    │ 제목, 기안자, 요청일시        │
    │ 내용 / 상세(htmlCnts 정제)   │
    │ 코멘트 (5자 이상)            │
    │ HIWARE 결재 비밀번호         │
    │ [승인]  [반려]              │
    └─────────────────────────────┘
        ↓ 클릭
[4] API: job enqueue → Modal "처리 중"
        ↓
[5] Worker: HIWARE batchApplyApv
        ↓
[6] Modal "처리 완료" + DB 이력 저장
```

> **발표 포인트:** Slack 쪽에서 Modal을 디자인할 필요 없음. 백엔드 `blockKit.js`가 DM/Modal JSON을 생성한다.

---

# 4. 프로젝트 파일 구조

```
slack-hiware-approval/
│
├── setup.sh                    # ★ 최초 설치 (Node yum/dnf + npm + DB init)
├── ecosystem.config.cjs        # PM2 (api + worker 2프로세스)
├── package.json
├── .env.example                # 환경변수 템플릿
│
├── docs/
│   ├── SETUP.md                # 설치·배포·Slack App 가이드
│   └── PRESENTATION.md         # ★ 이 문서 (발표용)
│
├── slack/
│   └── app-manifest.yaml       # Slack App manifest (import용)
│
├── db/
│   └── schema.sql              # MySQL 테이블 10개
│
├── scripts/
│   ├── db-init.js              # DB + 스키마 생성
│   ├── db-status.js            # 테이블 row 수 확인
│   ├── send-test-dm.js         # Slack DM 테스트 발송
│   └── worker.js               # (deprecated → src/worker.js)
│
└── src/
    ├── server.js               # ★ API 서버 진입점
    ├── worker.js               # ★ Job Worker 진입점
    │
    ├── app/
    │   └── createApp.js        # Express 앱 조립
    │
    ├── config/
    │   └── index.js            # 환경변수 통합 + 시작 시 검증
    │
    ├── routes/
    │   ├── health.routes.js    # GET /health, /health/ready
    │   └── slack.routes.js     # POST /slack/actions
    │
    ├── controllers/
    │   └── SlackController.js  # Slack Interactivity 처리
    │
    ├── middleware/
    │   ├── slack.js            # raw body + 서명 검증
    │   └── errorHandler.js
    │
    ├── clients/
    │   ├── HiwareClient.js     # HIWARE API (users/intray/detail/applyApv)
    │   └── SlackClient.js      # Slack Web API (DM/Modal)
    │
    ├── slack/                  # ★ Slack UI (Block Kit)
    │   ├── blockKit.js         # DM / Modal JSON 생성
    │   └── htmlToText.js       # htmlCnts → 평문 변환
    │
    ├── services/
    │   ├── ApprovalActionService.js   # 승인/반려 enqueue + Worker 처리
    │   ├── ApprovalNotifyService.js   # 결재 DM 발송
    │   └── AlertService.js            # 가벼운 비동기 알림
    │
    ├── jobs/
    │   ├── SlackActionJobRepository.js  # durable job 큐 (DB)
    │   └── SlackActionJobWorker.js      # job 폴링 + 실행
    │
    ├── repositories/
    │   └── ApprovalActionLogRepository.js  # 처리 이력 (비밀번호 마스킹)
    │
    ├── lib/
    │   ├── AsyncExecutor.js    # Spring @Async 대응 (메모리 큐)
    │   ├── errors.js
    │   └── logger.js           # JSON structured log
    │
    ├── db/
    │   └── pool.js             # MySQL connection pool
    │
    └── utils/
        └── commentValidator.js # 코멘트 5자 이상 검증
```

---

# 5. 파일별 역할 (핵심만)

| 파일 | 역할 |
|------|------|
| `setup.sh` | 운영 서버 최초 실행. yum/dnf로 Node 설치 → npm → DB init |
| `src/server.js` | Express API. Slack Interactivity 수신 |
| `src/worker.js` | HIWARE applyApv 등 무거운 작업 (Slack 3초 회피) |
| `src/slack/blockKit.js` | DM·Modal Block Kit JSON 생성 (기획안 §10) |
| `src/clients/HiwareClient.js` | HIWARE External API 래퍼 |
| `src/controllers/SlackController.js` | 버튼 클릭 → Modal 오픈 → 승인/반려 enqueue |
| `src/jobs/*` | `slack_action_jobs` 테이블 기반 비동기 큐 |
| `db/schema.sql` | 10개 테이블 (사용자, 결재, DM이력, job, 로그 등) |
| `slack/app-manifest.yaml` | Slack App 한 번에 생성 (scope + Interactivity URL) |
| `scripts/send-test-dm.js` | App 등록 후 DM UI 수동 테스트 |

---

# 6. API 엔드포인트

| Method | Path | 설명 | 상태 |
|--------|------|------|------|
| GET | `/health` | 서버 상태 + async 큐 통계 | ✅ |
| GET | `/health/ready` | MySQL 연결 확인 | ✅ |
| POST | `/slack/actions` | Slack Interactivity (서명 검증) | ✅ |

---

# 7. MySQL 테이블 (10개)

| 테이블 | 용도 |
|--------|------|
| `hiware_users` | HIWARE `/users` 동기화 |
| `slack_user_mappings` | HIWARE userNo ↔ Slack user_id (email 매핑) |
| `approval_items` | 결재 문서 마스터 |
| `approval_approvers` | 결재자별 step/상태 |
| `slack_messages` | 결재자 DM 발송 이력 (중복 방지) |
| `approval_action_logs` | 승인/반려 처리 로그 (비밀번호 마스킹) |
| `slack_requester_notifications` | 기안자 최종 결과 DM |
| `slack_action_jobs` | 비동기 job 큐 (Slack 3초 대응) |
| `worker_locks` | Worker 분산 락 |
| `schema_migrations` | 스키마 버전 |

---

# 8. 진행 현황

## ✅ 완료 (PoC + 백엔드 뼈대)

**HIWARE API PoC** (`hiware-api-scripts/`)

- [x] Token 인증 — `/users` 29명 200 OK
- [x] intray API — userNo별 미결재 조회
- [x] 결재 상세 API — `htmlCnts` 포함 200 OK
- [x] §24.1 #3 — Token으로 타 userNo intray 조회 가능 확인
- [x] 신규 기안 #5 — HIWADMIN 결재선 웹 승인 완료

**백엔드 (`slack-hiware-approval/`)**

- [x] 운영용 파일 구조 리팩터
- [x] Express API 서버 (`/health`, `/slack/actions`)
- [x] Slack 서명 검증 middleware
- [x] DM Block Kit (`buildApprovalDm`)
- [x] Modal Block Kit (`buildApprovalDetailModal`) — 상세+코멘트+비밀번호+승인/반려
- [x] `htmlCnts` HTML → 평문 변환
- [x] Slack Interactivity 처리 (Modal 오픈 → 승인/반려 → job enqueue)
- [x] Worker + `slack_action_jobs` (HIWARE `batchApplyApv` 연결)
- [x] 처리 이력 DB 저장 (비밀번호 마스킹)
- [x] `setup.sh` (yum/dnf Node 설치 + npm + db:init)
- [x] Slack App manifest (`slack/app-manifest.yaml`)
- [x] DM 테스트 스크립트 (`npm run slack:test-dm`)
- [x] PM2 설정 (`ecosystem.config.cjs`)

## 🔜 남은 작업 (실사용 완성)

| 우선순위 | 작업 | 설명 |
|----------|------|------|
| P0 | 운영 서버 배포 | `172.25.2.101`에 setup.sh → PM2 기동 |
| P0 | Slack App 등록 | manifest import → 토큰 `.env` 입력 |
| P0 | E2E 테스트 | `slack:test-dm` → Modal → 실제 승인/반려 |
| P1 | intray 폴링 스케줄러 | 결재 발생 시 **자동 DM** 발송 |
| P1 | 사용자 매핑 | HIWARE email → Slack `users.lookupByEmail` |
| P2 | 기안자 최종 결과 DM | 결재 완료/반려 시 기안자 알림 |
| P2 | DM 상태 update | 다른 결재자 처리 시 `chat.update` |
| P3 | HTTPS 리버스 프록시 | Slack Interactivity용 (nginx 등) |

---

# 9. 배포 체크리스트 (운영)

```
[ ] 서버에 프로젝트 업로드
[ ] cp .env.example .env → 값 입력
      - MYSQL_PASSWORD
      - HIWARE_API_TOKEN
      - SLACK_BOT_TOKEN
      - SLACK_SIGNING_SECRET
[ ] chmod +x setup.sh && ./setup.sh
[ ] curl http://localhost:3000/health/ready  → 200
[ ] pm2 start ecosystem.config.cjs
[ ] Slack App 생성 (slack/app-manifest.yaml)
[ ] Interactivity URL → https://서버/slack/actions
[ ] npm run slack:test-dm  → DM 수신 확인
[ ] Modal → 승인/반려 E2E 테스트
```

---

# 10. Slack App 설정 (발표용 요약)

**Slack에서 할 일 = 3가지**

1. App 생성 (`slack/app-manifest.yaml` import)
2. Bot Token + Signing Secret → `.env`
3. Interactivity URL 등록 → `https://서버/slack/actions`

**Bot Scopes**

```
chat:write
im:write
users:read
users:read.email
```

**백엔드가 하는 일 (Slack 설정 불필요)**

- DM 메시지 디자인 (Block Kit)
- Modal UI 디자인 (Block Kit)
- HIWARE API 호출
- 승인/반려 처리 + 이력 저장

---

# 11. HIWARE API 사용 목록

| API | 용도 | PoC |
|-----|------|-----|
| `GET /users` | 사용자 목록 + Slack 매핑 | ✅ |
| `GET /users/{no}` | 사용자 상세 | ✅ |
| `GET /approval/auth-box/intray` | 미결재 폴링 → DM 대상 | ✅ |
| `GET /approval/aplt/{no}` | Modal 상세 표시 | ✅ |
| `POST /approval/aplt/applyApv` | 승인/반려 | 🔜 Worker E2E |

---

# 12. 관련 프로젝트/문서

| 경로 | 설명 |
|------|------|
| `slack-hiware-approval/` | **본 프로젝트** (Node.js 백엔드) |
| `hiware-api-scripts/` | HIWARE API PoC 스크립트 (`run.sh`) |
| `Slack_Hiware_결재시스템_연동계획서.md` | 전체 기획·설계서 |
| `docs/SETUP.md` | 설치·배포 상세 가이드 |

---

# 13. 발표 멘트 참고

**도입**

> HIWARE 결재를 Slack에서 바로 처리할 수 있도록 Node.js 백엔드를 구축했습니다.  
> Slack App은 봇만 만들면 되고, DM·Modal UI는 백엔드가 Block Kit으로 생성합니다.

**기술 포인트**

> Slack Interactivity는 3초 안에 응답해야 합니다.  
> 그래서 API는 검증 후 DB에 job을 넣고 바로 200을 반환하고,  
> HIWARE API 호출은 별도 Worker 프로세스가 비동기로 처리합니다.

**현재 상태**

> HIWARE API PoC는 users/intray/상세 조회까지 검증 완료했고,  
> 백엔드는 DM·Modal UI, Interactivity 처리, Worker 연동까지 구현했습니다.  
> 다음은 운영 서버 배포 후 Slack App 연결과 intray 자동 DM 발송입니다.

**데모 순서 (가능할 때)**

1. `npm run slack:test-dm` → DM 수신
2. [상세/처리하기] 클릭 → Modal
3. 코멘트 + 비밀번호 → [승인]
4. Modal "처리 중" → "처리 완료"
5. HIWARE에서 결재 상태 변경 확인

---

# 14. npm 명령어 치트시트

| 명령어 | 설명 |
|--------|------|
| `./setup.sh` | 최초 설치 (Node + npm + DB) |
| `npm start` | API 서버 |
| `npm run worker` | Job Worker |
| `npm run db:init` | DB 스키마 생성 |
| `npm run db:status` | DB 테이블 상태 |
| `npm run slack:test-dm` | Slack DM 테스트 |
| `pm2 start ecosystem.config.cjs` | PM2 운영 기동 |

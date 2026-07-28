# HIWARE Slack 결재 연동 — 설치·배포·Slack App 가이드

> **핵심:** Slack 쪽에서는 **App(봇)만 만들고** 토큰·URL만 넣으면 됩니다.  
> DM 메시지, Modal UI, 승인/반려 처리 로직은 **전부 이 백엔드**가 Block Kit으로 생성합니다.

---

## 1. 아키텍처

```text
HIWARE API  ←── Worker (batchApplyApv)
     ↑
  Backend (Node.js)
     ├── intray 폴링 → 결재자 DM 발송 (Block Kit)
     ├── POST /slack/actions ← Slack Interactivity
     │     ├── [상세/처리하기] → Modal 오픈 (HIWARE 상세 조회)
     │     └── Modal [승인]/[반려] → Job enqueue → Worker 처리
     └── MySQL (매핑, 이력, job 큐)

Slack App = 봇 토큰 + Interactivity URL만 설정
```

| Slack에서 할 일 | 백엔드에서 하는 일 |
|----------------|-------------------|
| App 생성, Bot Token 발급 | DM Block Kit 생성·발송 |
| Interactivity URL 등록 | Modal Block Kit 생성 |
| 워크스페이스에 앱 설치 | HIWARE API 호출, DB 저장 |
| (선택) manifest import | 서명 검증, 3초 타임아웃 대응 |

---

## 2. 최초 설치 (`setup.sh`)

운영 서버(RHEL/CentOS, yum/dnf)에서:

```bash
cd slack-hiware-approval
chmod +x setup.sh

# 1) .env 먼저 편집하거나, 생성 후 편집
cp .env.example .env
vi .env

# 2) 전체 설치 (Node + npm + DB init)
./setup.sh

# 이미 Node 있을 때
./setup.sh --skip-os

# DB만 나중에
./setup.sh --skip-db
```

### setup.sh 옵션

| 옵션 | 설명 |
|------|------|
| (없음) | Node 설치 + npm + .env 생성 + db:init |
| `--skip-os` | OS 패키지(Node) 설치 생략 |
| `--skip-db` | DB init 생략 |
| `--prod` | `npm ci --omit=dev` |

### .env 필수값

```env
MYSQL_PASSWORD=...
HIWARE_BASE_URL=https://172.25.2.101:11200/hiware/v1/ext
# 권장: ID/PW → 앱이 authKey 자동 발급·만료 시 재발급
HIWARE_USER_ID=...
HIWARE_USER_PWD=...
# 레거시(선택): HIWARE_API_TOKEN=...  (USER_ID/PWD 없으면 고정 토큰 모드)
HIWARE_INSECURE=true

SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

---

## 3. 서비스 시작

```bash
# 단독 실행
npm start          # API :3000
npm run worker     # HIWARE/Slack 비동기 처리

# PM2 (운영 권장)
pm2 start ecosystem.config.cjs
pm2 save
```

### 헬스체크

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/health/ready   # MySQL 연결
```

---

## 4. Slack App 등록 (실사용 준비)

### 4.1 Manifest로 한 번에 생성 (권장)

1. [Slack API](https://api.slack.com/apps) → **Create New App** → **From a manifest**
2. 워크스페이스 선택
3. `slack/app-manifest.yaml` 내용 붙여넣기
4. `request_url`을 실제 서버 URL로 수정:

```yaml
request_url: https://YOUR-SERVER/slack/actions
```

### 4.2 수동 설정

| 항목 | 값 |
|------|-----|
| **OAuth Scopes (Bot)** | `chat:write`, `im:write`, `users:read`, `users:read.email` |
| **Interactivity** | ON |
| **Request URL** | `https://YOUR-SERVER/slack/actions` |

### 4.3 토큰 → .env

앱 설치 후:

- **OAuth & Permissions** → Bot User OAuth Token → `SLACK_BOT_TOKEN`
- **Basic Information** → Signing Secret → `SLACK_SIGNING_SECRET`

```bash
vi .env   # 위 두 값 입력 후 API 재시작
pm2 restart all
```

### 4.4 DM 수신 조건

- 사용자가 워크스페이스에 앱(봇)을 **설치·허용**해야 함
- 봇이 사용자에게 **DM을 보낼 수 있는** 상태여야 함 (최초 1회 앱 열기/메시지 허용)

---

## 5. Slack UI 흐름 (백엔드 구현 완료)

### 5.1 결재자 DM

백엔드 `src/slack/blockKit.js` → `buildApprovalDm()`

```text
[결재 요청]
제목 / 기안자 / 요청일시 / 내용 요약
[상세/처리하기]  ← 버튼 (action_id: approval_open_modal)
```

### 5.2 처리 Modal

`buildApprovalDetailModal()` — HIWARE `GET /approval/aplt/{no}` 조회 후 표시

```text
제목, 기안자, 요청일시, 결재번호
내용 / 상세(htmlCnts → 평문 변환)
코멘트 입력 (5자 이상)
HIWARE 결재 비밀번호 (DB·로그 저장 안 함)
[승인] [반려]
```

### 5.3 처리 흐름

1. DM `[상세/처리하기]` → HIWARE 상세 조회 → Modal 오픈
2. 코멘트 + 비밀번호 입력 → `[승인]` 또는 `[반려]`
3. 3초 내: 검증 + `slack_action_jobs` INSERT + Modal "처리 중"
4. Worker: `batchApplyApv` → Modal "처리 완료"

---

## 6. Slack 연동 테스트

App 등록 + `.env` 설정 후:

```bash
# .env 에 추가
SLACK_TEST_USER_ID=U01234567    # 본인 Slack User ID
TEST_APV_APLT_NO=4              # HIWARE 결재번호

npm run slack:test-dm
```

Slack DM 수신 → `[상세/처리하기]` → Modal → 승인/반려까지 E2E 확인.

> **주의:** 실제 `batchApplyApv`는 Worker가 호출합니다. 테스트 결재 건·비밀번호를 사용하세요.

---

## 7. 파일 구조 (Slack 관련)

```text
slack-hiware-approval/
├── docs/SETUP.md              ← 이 문서
├── setup.sh                   ← 최초 설치 스크립트
├── slack/app-manifest.yaml    ← Slack App manifest
├── src/slack/
│   ├── blockKit.js            ← DM / Modal Block Kit
│   └── htmlToText.js          ← htmlCnts 정제
├── src/controllers/SlackController.js
├── src/services/ApprovalNotifyService.js   ← DM 발송
└── scripts/send-test-dm.js    ← DM 테스트
```

---

## 8. 아직 백엔드에서 이어갈 작업

| 항목 | 상태 |
|------|------|
| DM / Modal Block Kit | ✅ 완료 |
| Slack Interactivity (`/slack/actions`) | ✅ 완료 |
| HIWARE applyApv (Worker) | ✅ 완료 |
| intray 폴링 → 자동 DM 발송 | 🔜 다음 |
| HIWARE↔Slack 사용자 매핑 (email) | 🔜 다음 |
| 기안자 최종 결과 DM | 🔜 다음 |

Slack App만 만들면 **UI는 바로 테스트 가능**하고, **자동 DM 발송**은 intray 폴링 스케줄러 연결 후 실사용이 완성됩니다.

---

## 9. 트러블슈팅

| 증상 | 확인 |
|------|------|
| `Invalid Slack signature` | `SLACK_SIGNING_SECRET` 일치, HTTPS URL |
| DM 안 옴 | `SLACK_BOT_TOKEN`, 봇 설치 여부, `SLACK_TEST_USER_ID` |
| Modal 안 열림 | Interactivity URL, `HIWARE_USER_ID`/`PWD`(또는 TOKEN), 결재번호 유효성 |
| `패스워드 불일치` | HIWARE 결재 비밀번호 정확히 입력 |
| HIWARE SSL 오류 | `HIWARE_INSECURE=true` |

---

## 10. 참고 문서

- 기획안: `Slack_Hiware_결재시스템_연동계획서.md` §9~§10
- HIWARE PoC: `hiware-api-scripts/run.sh`

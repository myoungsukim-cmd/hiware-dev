# 배포 전 단계별 검증

기획서 §24.1 / §25.12 / 배포 체크리스트에 맞춰 **한 단계씩 OK**가 나오면 연동 코어가 정상입니다.

## 준비

```bash
cp .env.example .env
# HIWARE_USER_ID / HIWARE_USER_PWD (또는 HIWARE_API_TOKEN)
# DB_*, SLACK_* 입력
npm run db:mysql:up   # Docker MySQL 사용 시
npm run db:init
```

선택:

```env
INTRAY_USER_NOS=21,12,14   # §24.1 #3 타 userNo intray
TEST_APV_APLT_NO=4         # 상세 조회 (없으면 intray 첫 건)
VERIFY_BASE_URL=http://127.0.0.1:3000
```

## 실행

```bash
npm run verify           # 01 → 08 전부
npm run verify -- 02     # 02부터 끝까지
npm run verify -- 02 05  # 02~05만
npm run verify -- 01 06  # 지정 단계만 (공백 구분)
```

| Step | 내용 | 실패 시 |
|------|------|---------|
| 01 | `.env` (ID/PW 또는 TOKEN, DB) | 값 채우기 |
| 02 | HIWARE login / authKey | ID·PW·방화벽·Auth URL |
| 03 | `GET /users` | 토큰 권한 |
| 04 | `intray` (+ `INTRAY_USER_NOS`) | §24.1 #3 |
| 05 | 결재 상세 `htmlCnts` | `TEST_APV_APLT_NO` |
| 06 | MySQL 필수 테이블 | `npm run db:init` |
| 07 | `/health`, `/health/ready` | `npm start` 후 재실행 (미기동이면 SKIP) |
| 08 | Slack `auth.test` | Bot Token (미설정이면 SKIP) |

마지막에 `RESULT: OK` 가 나오면 코어 연동 통과입니다.

## E2E (수동)

```bash
npm start &
npm run worker &
npm run verify -- 07 08
npm run slack:test-dm    # SLACK_TEST_USER_ID, TEST_APV_APLT_NO
# Slack에서 [상세/처리하기] → Modal → 승인/반려
```

`applyApv` 실결재는 검증 스크립트에 넣지 않았습니다 (실데이터 변경). Slack Modal E2E로 확인하세요.

## 결재선 시나리오 A/B

팀장→병렬3 / 팀장→CISO→병렬3 은 `docs/SCENARIO_POC.md` + `npm run verify:scenario` 로 phase별 intray를 실측합니다.

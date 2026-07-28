# 결재선 시나리오 A/B PoC

백엔드는 결재선을 하드코딩하지 않습니다. **HIWARE intray에 지금 뜬 사람**에게 DM을 보내고, 같은 건이 여러 명에게 동시 노출되면 `ANY_ONE`으로 처리합니다.

| 시나리오 | 결재선 |
|----------|--------|
| **A** | 1차 팀장 → 2차 병렬 3명 중 1명 |
| **B** | 1차 팀장 → 2차 CISO → 3차 병렬 3명 중 1명 |

## 사전 준비

1. `.env`에 `HIWARE_USER_ID`/`PWD` (또는 TOKEN), DB, Slack 설정
2. 결재자 email → Slack 매핑 (`npm run worker` 사용자 동기화)
3. HIWARE에 시나리오별 테스트 결재선으로 상신 → `apvApltNo` 확보
4. 관련자 HIWARE `userNo` 확인

```env
# .env 예시 (PoC용)
POC_STEP1_USER_NOS=10
POC_PARALLEL_USER_NOS=21,22,23
POC_CISO_USER_NOS=30
```

## 시나리오 A — 명령 순서

```bash
# ① 상신 직후: 팀장만 intray
POC_SCENARIO=A POC_PHASE=after_submit POC_APV_APLT_NO=<번호> \
  POC_STEP1_USER_NOS=10 POC_PARALLEL_USER_NOS=21,22,23 \
  npm run verify:scenario

# ② 1차(팀장) 승인 후: 병렬 3명 전원 intray  ← §24.1 #4 핵심
POC_SCENARIO=A POC_PHASE=after_step1 POC_APV_APLT_NO=<번호> \
  POC_STEP1_USER_NOS=10 POC_PARALLEL_USER_NOS=21,22,23 \
  npm run verify:scenario

# (앱 기동 중이면) 병렬 3명 Slack DM 수신 확인
# ③ 병렬 중 1명만 Slack 승인 → 나머지 DM 갱신(SKIPPED)
POC_SCENARIO=A POC_PHASE=after_any_one POC_APV_APLT_NO=<번호> \
  POC_STEP1_USER_NOS=10 POC_PARALLEL_USER_NOS=21,22,23 \
  npm run verify:scenario
```

체크리스트:

- [ ] `after_submit` RESULT: OK
- [ ] `after_step1` RESULT: OK (3명 동시 노출)
- [ ] 팀장 DM 1통 → 승인 가능
- [ ] 병렬 DM 3통 → 1명 승인 시 나머지 SKIPPED
- [ ] `after_any_one` RESULT: OK

## 시나리오 B — 명령 순서

```bash
# ① 상신 직후: 팀장만
POC_SCENARIO=B POC_PHASE=after_submit POC_APV_APLT_NO=<번호> \
  POC_STEP1_USER_NOS=10 POC_CISO_USER_NOS=30 POC_PARALLEL_USER_NOS=21,22,23 \
  npm run verify:scenario

# ② 1차 승인 후: CISO만 (병렬 아직 없음)
POC_SCENARIO=B POC_PHASE=after_step1 POC_APV_APLT_NO=<번호> \
  POC_STEP1_USER_NOS=10 POC_CISO_USER_NOS=30 POC_PARALLEL_USER_NOS=21,22,23 \
  npm run verify:scenario

# ③ CISO 승인 후: 병렬 3명 전원
POC_SCENARIO=B POC_PHASE=after_ciso POC_APV_APLT_NO=<번호> \
  POC_STEP1_USER_NOS=10 POC_CISO_USER_NOS=30 POC_PARALLEL_USER_NOS=21,22,23 \
  npm run verify:scenario

# ④ 병렬 1명 처리 후: 전원 비움
POC_SCENARIO=B POC_PHASE=after_any_one POC_APV_APLT_NO=<번호> \
  POC_STEP1_USER_NOS=10 POC_CISO_USER_NOS=30 POC_PARALLEL_USER_NOS=21,22,23 \
  npm run verify:scenario
```

체크리스트:

- [ ] `after_submit` OK
- [ ] `after_step1` OK (CISO만)
- [ ] `after_ciso` OK (병렬 3명 동시)
- [ ] 단계별 Slack DM 대상이 intray와 일치
- [ ] `after_any_one` OK + SKIPPED UX

## FAIL 시

| 증상 | 조치 |
|------|------|
| 병렬 단계인데 1명만 intray | HIWARE 결재선(ANY_ONE/병렬) 설정 확인 — Slack 수정 대상 아님 |
| 다음 단계가 너무 일찍 intray | HIWARE 순차 정책 확인 |
| intray OK인데 DM 없음 | Slack 매핑·worker·`npm run verify -- 08` |
| ALL(전원 승인) 필요 | 현재 미지원 — 별도 보강 |

## 관련

- 설계: 기획서 §8, §24.1 #4
- 동기화: `src/services/ApprovalSyncService.js` (intray → DM, 동시 노출 시 ANY_ONE)
- 일반 검증: `docs/VERIFY.md`

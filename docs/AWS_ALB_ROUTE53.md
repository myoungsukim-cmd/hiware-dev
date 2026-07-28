# AWS ALB + Route53 인프라 가이드

> Slack Interactivity(`POST /slack/actions`)는 **공인 HTTPS**가 필요합니다.  
> 사용자는 백엔드 도메인에 접속하지 않습니다. **Slack 서버 → ALB → EC2:3000** 경로만 열리면 됩니다.

---

## 1. 한눈에 보는 구조

```text
인터넷 / Slack
    │  HTTPS :443
    ▼
ALB (internet-facing, ACM 인증서)
    │  HTTP :3000
    ▼
EC2  pm2 → slack-hiware-api (HOST=0.0.0.0, PORT=3000)
    │
Route53  A(Alias) → ALB
```

| 구성 | 역할 |
|------|------|
| Route53 | DNS만 (도메인 → ALB) |
| ALB | TLS 종료 + 443 → Target |
| Target Group | EC2:3000 + **헬스체크 `/health`** |
| EC2 SG | **3000은 ALB SG만** 허용 |
| Slack Request URL | `https://{도메인}/slack/actions` |

### 흔한 오해

| 잘못 | 맞음 |
|------|------|
| Route53에 `/health` 헬스체크만 설정 | **ALB Target Group**에 `GET /health` |
| 사용자가 백엔드 도메인에 접속해야 함 | 사용자는 Slack만 사용. Slack이 도메인으로 POST |
| EC2에 443 직접 오픈 | ALB만 443, EC2는 3000(ALB SG 소스) |

---

## 2. Target Group

| 항목 | 값 |
|------|-----|
| Target type | Instance (또는 IP) |
| Protocol / Port | **HTTP / 3000** |
| VPC | EC2와 동일 |
| Health check protocol | HTTP |
| Health check path | **`/health`** |
| Health check port | traffic port (3000) |
| Success codes | **200** |
| Healthy threshold | 2~3 |
| Interval | 30초 |
| Timeout | 5초 |
| Unhealthy threshold | 2~3 |

Targets에 앱 서버 인스턴스를 **포트 3000**으로 등록합니다.  
상태가 **healthy**여야 ALB가 트래픽을 보냅니다.

서버 로컬에서 사전 확인:

```bash
curl -s http://127.0.0.1:3000/health
# {"status":"ok","service":"slack-hiware-approval",...}
```

> ALB 헬스체크는 `/health`를 권장합니다.  
> `/health/ready`는 MySQL까지 검사하므로 DB 순단 시 인스턴스가 unhealthy로 빠질 수 있습니다.

---

## 3. Application Load Balancer

| 항목 | 값 |
|------|-----|
| Scheme | **internet-facing** (Slack이 인터넷에서 호출) |
| IP address type | ipv4 |
| Listener | **HTTPS :443** |
| Certificate | ACM (Route53 도메인과 일치) |
| Default action | Forward → 위 Target Group |

선택: HTTP :80 → HTTPS :443 Redirect.

> ALB가 **internal**이면 Slack(외부)에서 도달할 수 없습니다.

---

## 4. Security Group

### ALB SG (예: `sg-alb-slack-hiware`)

| Type | Port | Source | 설명 |
|------|------|--------|------|
| HTTPS | 443 | `0.0.0.0/0` | Slack + 검증용 (정책상 Slack IP만 가능) |
| HTTP | 80 | `0.0.0.0/0` | HTTPS 리다이렉트 사용 시 |

### EC2 SG (앱 서버)

| Type | Port | Source | 설명 |
|------|------|--------|------|
| Custom TCP | **3000** | **ALB SG** | ALB → Node만 허용 |
| SSH | 22 | 관리자 IP | 운영 접속 |

EC2에 443을 열 필요 없습니다.  
3000을 `0.0.0.0/0`으로 열지 마세요.

---

## 5. Route53

| 항목 | 값 |
|------|-----|
| Record type | **A** — Alias |
| Record name | 사용할 호스트 (예: `slack-hiware.example.com`) |
| Alias | Yes |
| Route traffic to | **Alias to Application Load Balancer** |
| Region / ALB | 위에서 만든 ALB |

Route53 Health Check는 필수가 아닙니다.  
Alias → ALB이면 Target Group 헬스체크만으로 충분합니다.

---

## 6. 앱 설정 (EC2)

`.env`:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
TRUST_PROXY=true
```

```bash
pm2 restart slack-hiware-api
# 또는
pm2 restart all
```

---

## 7. Slack App

1. [api.slack.com/apps](https://api.slack.com/apps) → 해당 앱
2. **Interactivity & Shortcuts** → On
3. Request URL:

```text
https://{Route53도메인}/slack/actions
```

4. Save Changes → **Verified** 확인  
   - 실패 시: ALB/SG/TG unhealthy 또는 DNS/인증서 문제

관련 앱 경로: `src/routes/slack.routes.js` → `POST /slack/actions`

---

## 8. 검증 체크리스트

### 8-1. EC2 로컬

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/health
# 200

curl -sS -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3000/slack/actions
# 401  (서명 없음 → 라우트 존재 확인)
```

### 8-2. 노트북(인터넷) — 이게 통과해야 Slack도 됨

```bash
curl -sS https://{도메인}/health
# {"status":"ok",...}

curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://{도메인}/slack/actions
# 401
```

타임아웃 / 연결 실패면 Slack 버튼도 동작하지 않습니다.

### 8-3. AWS 콘솔

- [ ] Target Group target = **healthy**
- [ ] ALB listener 443 → 해당 TG
- [ ] Route53 Alias가 올바른 ALB를 가리킴
- [ ] ACM 인증서 상태가 Issued, 도메인 일치

### 8-4. Slack 버튼 E2E

1. DM `[상세/처리하기]` 클릭
2. 모달 오픈 (로딩 → 상세)
3. DB 확인:

```sql
SELECT event_type, event_status, apv_aplt_no, slack_api_method, created_at
FROM slack_event_logs
ORDER BY id DESC
LIMIT 10;
```

`MODAL_OPENED`가 보이면 Slack → ALB → API 경로 OK.

> `LOG_LEVEL=info`일 때 pm2에 `slack action` 디버그 로그는 안 남을 수 있습니다.  
> 요청 도달 여부는 `slack_event_logs` 또는 실패 시 error 로그로 확인하세요.

---

## 9. 트러블슈팅

| 증상 | 원인 후보 |
|------|-----------|
| 노트북 `curl https://도메인/health` 무응답 | ALB internal, SG, DNS, ACM, TG unhealthy |
| TG unhealthy | EC2:3000 미기동, path≠`/health`, EC2 SG에 ALB→3000 없음 |
| Slack 버튼 무반응 + API 로그 없음 | 공인 HTTPS 미도달 (위 curl 실패와 동일) |
| Slack URL 저장 실패 (didn't respond) | 동일 — Slack이 Request URL에 못 붙음 |
| curl은 되고 서명 에러만 | `SLACK_SIGNING_SECRET` 불일치 |
| 401만 반복 (의도된 테스트 POST) | 정상 — Interactivity는 Slack 서명 헤더 필요 |

---

## 10. 인프라 요청 시 전달용 요약

```text
목적: Slack 결재봇 Interactivity용 공인 HTTPS

필요:
1) internet-facing ALB + ACM (HTTPS 443)
2) Target Group: HTTP 3000, Health check GET /health → 200
3) Target: EC2 (앱 서버) :3000
4) ALB SG: inbound 443 (0.0.0.0/0 또는 정책에 따름)
5) EC2 SG: inbound 3000 from ALB SG only
6) Route53 A Alias → ALB

Slack URL: https://{도메인}/slack/actions
완료 기준: 외부에서 curl https://{도메인}/health → 200
```

관련 문서: [DEPLOY_GUIDE.md](./DEPLOY_GUIDE.md) Step 9.

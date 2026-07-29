# HIWARE Slack — ALB / HTTPS / HTTP 구성 가이드

> Slack Interactivity(`POST /slack/actions`)는 **공인 HTTPS**가 필요합니다.  
> 사용자는 백엔드 도메인에 직접 접속하지 않습니다. **Slack 서버 → ALB → EC2:3000** 경로만 열리면 됩니다.

---

## 1. 한눈에 보는 구조

```text
[Slack / PC]
      │  HTTPS :443  (암호화, 인증서)
      ▼
[ALB]  ← ACM 인증서 종료(TLS termination)
      │  HTTP :3000  (내부망, 평문)
      ▼
[EC2 :3000]  Node (pm2 slack-hiware-api)
```

| 구간 | 프로토콜 | 포트 | 설명 |
|------|----------|------|------|
| 인터넷 ↔ ALB | **HTTPS** | **443** | Slack/브라우저가 호출 |
| ALB ↔ EC2 | **HTTP** | **3000** | 앱은 TLS 안 씀 |
| EC2 앱 | **HTTP** | **3000** | `HOST=0.0.0.0`, `PORT=3000` |

### 핵심 한 줄

**앞단만 HTTPS, 뒤(ALB→앱)는 HTTP:3000**

---

## 2. 운영 도메인 예시

| 항목 | 예시 |
|------|------|
| 도메인 | `hiware-slack.eximbay.com` |
| DNS | CNAME → ALB DNS 이름 |
| Health | `https://hiware-slack.eximbay.com/health` |
| Slack Interactivity URL | `https://hiware-slack.eximbay.com/slack/actions` |

### DNS 확인 (Windows PowerShell)

```powershell
Resolve-DnsName hiware-slack.eximbay.com

curl.exe -sS -o NUL -w "%{http_code}" https://hiware-slack.eximbay.com/health
```

정상 예:

- CNAME → `alb-....ap-northeast-2.elb.amazonaws.com`
- A 레코드 IP 존재
- health → **200**

---

## 3. ALB Listener (앞단)

| 항목 | 값 |
|------|-----|
| Scheme | **internet-facing** (Slack이 인터넷에서 호출) |
| Listener Protocol | **HTTPS** |
| Port | **443** |
| Certificate | ACM (`hiware-slack.eximbay.com` 포함) |
| Default action | Forward → Target Group |

> Slack은 HTTPS Request URL만 허용합니다. Listener를 HTTP:80만 두면 Interactivity가 동작하지 않습니다.

---

## 4. Target Group (ALB → EC2)

| 항목 | 값 |
|------|-----|
| Target type | Instance (또는 IP) |
| Protocol | **HTTP** ← HTTPS 아님 |
| Port | **3000** |
| VPC | EC2와 동일 |

> 현재 `tg-mgmt-eximbay-hiware-slack` 이 **HTTPS:443** 이면 잘못입니다.  
> 기존 TG는 프로토콜을 바꿀 수 없으므로 **HTTP:3000 TG를 새로 만들고**, Listener Forward만 그쪽으로 바꿉니다.

### Health check

| 항목 | 값 |
|------|-----|
| Protocol | **HTTP** |
| Path | **`/health`** |
| Port | traffic port (3000) |
| Success codes | **200** |
| Healthy threshold | 2~3 |
| Interval | 30초 |
| Timeout | 5초 |
| Unhealthy threshold | 2~3 |

### 한국어 콘솔 — 새 TG 생성 상세 순서

1. **EC2** → 왼쪽 **대상 그룹(Target Groups)** → **대상 그룹 생성**
2. **기본 구성**
   - 대상 유형: **인스턴스**
   - 대상 그룹 이름: 예) `tg-mgmt-eximbay-hiware-slack-http`
   - 프로토콜: **HTTP** ← 여기가 핵심 (HTTPS 금지)
   - 포트: **3000**
   - VPC: EC2(`ec2-mgmt-eximbay-hiware-slack`)와 **같은 VPC**
   - 프로토콜 버전: **HTTP1**
3. **상태 확인**
   - 상태 확인 프로토콜: **HTTP**
   - 상태 확인 경로: **`/health`**
   - 고급 상태 확인 설정 → 성공 코드: **200**
4. **다음** → 대상 등록
   - 인스턴스 `i-050f546302bd25155` 선택
   - 포트: **3000**
   - **보류 중인 것으로 포함**
5. **대상 그룹 생성**

### Listener만 새 TG로 바꾸기

1. **로드 밸런서** → `alb-mgmt-eximbay-hiware-slack`
2. **리스너** 탭 → **HTTPS:443**
3. 기본 규칙(우선 순위 default) → **편집**
4. 작업: **대상 그룹으로 전달**
5. 대상 그룹을 **새 HTTP:3000 TG**로 변경
6. **저장**

> 리스너는 **HTTPS:443 그대로** 둡니다.  
> 바꾸는 것은 **전달 대상 TG만**입니다.

### EC2 로컬 사전 확인

```bash
curl -sS http://127.0.0.1:3000/health
# {"status":"ok","service":"slack-hiware-approval",...}
```

> `/health/ready`는 MySQL까지 검사하므로, DB 순단 시 unhealthy가 될 수 있습니다. ALB 헬스체크는 `/health` 권장.

---

## 5. EC2 / 앱

| 항목 | 값 |
|------|-----|
| 리슨 | `0.0.0.0:3000` **HTTP** |
| `.env` | `PORT=3000` |
| `.env` | `TRUST_PROXY=true` 권장 (ALB 뒤) |
| EC2에서 443 리슨 | **필요 없음** (인증서는 ALB) |

프로세스:

- `slack-hiware-api` — Slack Interactivity 수신
- `slack-hiware-worker` — HIWARE sync / DM / applyApv

운영에서는 **appuser PM2**로 기동하는 구성이 있을 수 있음. root PM2와 혼용하지 말 것.

```bash
# appuser 기준 예시
sudo -u appuser pm2 status
sudo -u appuser pm2 restart ecosystem.config.cjs
```

---

## 6. 보안 그룹

### ALB Security Group

| Direction | Protocol | Port | Source |
|-----------|----------|------|--------|
| Inbound | TCP | **443** | `0.0.0.0/0` (또는 허용 대역) |
| Outbound | 보통 All | - | - |

### EC2 Security Group

| Direction | Protocol | Port | Source |
|-----------|----------|------|--------|
| Inbound | TCP | **3000** | **ALB Security Group** |
| Inbound | (관리용) SSH 등 | 22 | 관리망만 |

- EC2에 **443을 열 필요 없음**
- 3000을 `0.0.0.0/0`으로 열지 않는 것을 권장 (ALB SG만)

---

## 7. Slack App 설정

| 항목 | 값 |
|------|-----|
| Interactivity Request URL | `https://hiware-slack.eximbay.com/slack/actions` |
| Signing Secret | 서버 `.env`의 `SLACK_SIGNING_SECRET`과 동일 |
| Bot Token | `.env`의 `SLACK_BOT_TOKEN` |

> 로컬 cloudflare 터널 URL이 남아 있으면 운영 버튼이 앱에 안 들어옵니다.

---

## 8. 잘못된 조합 (502 / 버튼 무반응)

| 잘못된 설정 | 결과 |
|-------------|------|
| Target Group = HTTPS:3000 또는 HTTPS:443 | 앱은 HTTP만 → **502 / unhealthy** |
| Target Group = HTTP:80 | 앱은 3000 → 실패 |
| Listener = HTTP:80 only | Slack HTTPS 필요 → 불가 |
| DNS 없음 / 미전파 | Slack이 호스트를 못 찾음 → 버튼 무반응 |
| ALB Target **unhealthy** | 공인 URL **502 Bad Gateway** |
| EC2 SG에 ALB→3000 미허용 | unhealthy / 502 |
| root PM2와 appuser PM2 이중 기동 | `EADDRINUSE :3000` |

---

## 9. 장애 판별 순서

### ① DNS

```powershell
Resolve-DnsName hiware-slack.eximbay.com
```

- 답 없음 → Route53/DNS 레코드 확인
- ALB로 CNAME/A 정상 → 다음

### ② 공인 Health

```powershell
curl.exe -sS -o NUL -w "%{http_code}" https://hiware-slack.eximbay.com/health
```

| 결과 | 의미 |
|------|------|
| **200** | ALB→EC2 OK. Slack URL/서명 확인 |
| **502** | ALB는 닿음, Target/SG/포트 문제 |
| 이름 해석 실패 | DNS 문제 |

### ③ EC2 로컬

```bash
curl -sS http://127.0.0.1:3000/health
ss -lptn 'sport = :3000'
pm2 status   # 실제 기동 계정(appuser)으로
```

- 로컬 200 + 공인 502 → **인프라(ALB/TG/SG)**
- 로컬 실패 → **앱/PM2**

### ④ Slack 버튼 클릭 시

API 로그에 아래가 찍혀야 정상 도달:

- `slack action` / `approval_open_modal`

로그가 **전혀 없으면** 요청이 EC2에 안 온 것 (URL/ALB/DNS).

---

## 10. 배포 후 체크리스트

- [ ] DNS: `hiware-slack.eximbay.com` → ALB
- [ ] Listener: **HTTPS:443** + ACM
- [ ] Target Group: **HTTP:3000**
- [ ] Health: **HTTP `/health`** → target **healthy**
- [ ] EC2 SG: **3000 from ALB SG**
- [ ] 앱: HTTP 3000 리슨, `TRUST_PROXY=true`
- [ ] Slack Interactivity URL = `https://hiware-slack.eximbay.com/slack/actions`
- [ ] PC에서 `https://.../health` → **200**
- [ ] Slack 버튼 → API 로그에 action 기록

---

## 11. 참고

- 앱은 TLS를 직접 다루지 않습니다. 인증서/HTTPS는 **ALB 전담**.
- Worker(DM 발송)는 아웃바운드 `api.slack.com:443`만 되면 되고, Interactivity와는 별개입니다.
- DM은 가는데 버튼만 안 되면 → **거의 항상 Interactivity URL / ALB 502** 쪽입니다.

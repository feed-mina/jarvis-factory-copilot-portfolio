# Factory AI Copilot — 미니 현장 데이터 에이전틱 샘플

**공정 판단(규칙) → 원인 추적(Tool) → 행동 제안(JSON) → 사람 승인(8조건) → 모의 명령(1회)** 을 한 화면에서 보여 주는 샘플.
이 저장소의 Javis 가 "메일 초안은 사람이 승인해야만 Gmail 에 저장된다"를 구현한 것과 **같은 승인 구조**를 공장 센서 데이터(사이클·노드·이벤트)로 옮겼다.

- 데이터 30건은 전부 **허구**(`public/engine/data.js` 가 결정적으로 만든다). 실제 현장·회사 데이터가 아니다.
- **LLM·DB·로그인 없음.** Monitor 는 규칙 함수, Root Cause·Planner 는 Tool 결과를 조합하고 문장은 템플릿이다. 모델 키 없이 전부 돈다.
- 승인·명령은 브라우저 안(localStorage)에서만 기록된다. 명령은 `simulated: true`, `executor.kind: "none"` — 진짜 PLC·로봇에는 가지 않는다.

## 실행

```sh
cd samples/factory-copilot
npm test                 # node --test (테스트 30개: Monitor · Root Cause · Planner 계약 · 승인 8조건 · 질문 10개 · HTTP 창구)
npx wrangler dev         # http://127.0.0.1:8787  (Worker 는 읽기 전용 조회 창구 + 정적 화면)
npx wrangler deploy      # https://jarvis-factory-copilot-sample.<계정서브도메인>.workers.dev
```

브라우저만으로도 된다: `public/` 을 정적으로 띄우면 화면과 승인 흐름이 전부 돈다(`/api/*` 는 Worker 에서만).

## 공개하기

아직 어디에도 배포되어 있지 않다. 아래 둘 중 하나만 해도 방문자가 눌러 볼 수 있다.

**A. GitHub Pages — 비밀키 없음 (화면·승인 흐름 전부, `/api/*` 는 없음)**

1. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꾼다. (처음 한 번)
2. **Actions** 탭 → 왼쪽 **pages** → **Run workflow** (브랜치 `main`) 를 누른다.
3. 초록 체크가 뜨면 주소는 `https://feed-mina.github.io/jarvis-factory-copilot-portfolio/` 일 것이다 — **배포 후 확인 필요**.

이후에는 `main` 에서 `samples/factory-copilot/` 아래가 바뀔 때마다 자동으로 다시 올라간다. 1번을 하기 전에 워크플로가 돌면 실패(빨간 X)로 남는데, 1번을 한 뒤 다시 실행하면 된다.

**B. Cloudflare Workers — 선택 (화면 + 읽기 전용 `/api/*`)**

1. 저장소 **Settings → Secrets and variables → Actions → New repository secret** 로 2개를 넣는다.
   - `CLOUDFLARE_API_TOKEN` — Cloudflare 대시보드 → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" 템플릿
   - `CLOUDFLARE_ACCOUNT_ID` — Cloudflare 대시보드 → Workers & Pages 화면 오른쪽의 Account ID
2. **Actions** 탭 → **deploy-sample-worker** → **Run workflow**. (시크릿이 없으면 무엇이 빠졌는지 알려 주고 멈춘다)
3. 주소는 실행 로그 끝에 나온다: `https://jarvis-factory-copilot-sample.<계정서브도메인>.workers.dev` — **배포 후 확인 필요**.

화면은 `./style.css` · `./app.js` 처럼 상대 경로만 쓰므로 Pages 의 하위 경로(`/jarvis-factory-copilot-portfolio/`)와 Worker 의 루트(`/`) 양쪽에서 같은 파일로 돈다.

## 흐름과 멈추는 곳

```
CycleRecord ─▶ Monitor(규칙 2개) ─▶ MonitorResult
                 │ NEEDS_REVIEW(음수 속도·노드 결측·정상 사이클 2개 미만) → 확인 필요 큐
                 │ NO_ACTION(후보 0) → NO_ACTION 쪽지 → 확인(acknowledge)만
                 ▼ 후보마다
            Root Cause(Tool 2~3회, 앞 5사이클) ─▶ origin{node, cycle_id, event_ids[]} · trace[] · confidence
                 │ 동률·창 밖·Tool 없음 → NEEDS_REVIEW
                 ▼
            Action Planner ─▶ ActionProposal{action, evidence[], requiresApproval: true, state: PENDING_APPROVAL}
                 ▼  ← 여기서 나가는 자동 전이 0개
            사람: 승인 / 거절(메모 필수) / 근거 더 요청(메모 필수 → 재실행) / 확인
                 ▼ 승인 8조건 통과 · 24h 안
            모의 명령 1회 (재시도 없음 · 두 번 눌러도 1건)
```

| 설계 문서 (ME 볼트 Phase 3.5, 2026-10-05) | 이 샘플의 파일 |
|---|---|
| D09 역할 3개 · D10 JSON 계약 | `public/engine/monitor.js` · `rootCause.js` · `planner.js` · `validate.js` · `rules.js` |
| D11 순차 실행 · 멱등 · 원장 | `public/engine/pipeline.js` · `store.js` · `digest.js` |
| D12 승인 8조건 · D13 승인 전 실행 금지 · D14 결정 4개 · D15 명령 스키마 | `public/engine/approval.js` (Javis `server/workflow.py` `approve()` 7조건 이식 + 확신도-행동 짝) |
| D17 출처 사슬 · 화면 규칙 8줄 · D18 멈춤 경로 · 큐 4개 | `public/app.js` · `public/index.html` |
| E01~E10 샘플 데이터 · 조회 창구 · Tool 3종 | `public/engine/data.js` · `worker.js` |
| E04 · E22~E26 질문 10개 | `public/engine/questions.js` · `tests/questions-api.test.mjs` |

## 규칙과 숫자의 출처

| 항목 | 값 | 출처 |
|---|---|---|
| 속도 급변 | 변화 10 m/min 이상 ∧ 평균 대비 20% 이상 ∧ 정상 사이클 2개 이상 | 결정대장 2026-09-09 (R5 ⓐ) |
| 노드 불일치 | 노드 4개 속도가 서로 다름 | 결정대장 2026-08-11 |
| 노드 불일치 허용폭 2.0 m/min | 결정대장에 숫자 없음 | **AI 제안** (화면·코드에 표시) |
| 진동 | 사이클 내 최댓값을 **관측으로만** 기록, 상한 없음 | 결정대장 2026-08-20 · R5 ⓐ |
| 행동 4개 | STOP_LINE · SLOW_DOWN · INSPECT_NODE · NO_ACTION | R6 ⓐ |
| 행동 선택 (급변 ≥35% → 정지, ≥20% → 감속, 불일치 → 점검, 확신 낮음 → 점검만) | | **AI 제안** (`planner.js`) |
| 추적 창 5사이클 · "공정 단" = 노드·사이클·이벤트 | | R7 ⓐ |
| 확신도: 이벤트 근거 있으면 높음, 없으면 낮음 | | **AI 제안** (`rootCause.js`) |
| 승인 전부 사람 (NO_ACTION 은 확인) · 자동 전이 0 | | R8 ⓐ |
| 승인 만료 24시간 · 거절/근거 요청 메모 필수 | | Javis Release approval · case_review 규칙 |

## 질문 10개 (정답이 정해져 있다 — `npm test` 가 매번 확인)

| # | 질문 | 기대 결과 |
|---|---|---|
| Q01 | C-…-0112 에서 무슨 일? | 급변 −37% → **STOP_LINE** · 시작 node_3 · 이벤트 E-881 · 확신 높음 |
| Q02 | C-…-0118 노드 속도가 왜 다른가? | 불일치 → **INSPECT_NODE** · node_4 · E-902 |
| Q03 | C-…-0105 이상 있나? | NO_ACTION (확인만) |
| Q04 | C-…-0122 음수 속도가 정지인가? | NEEDS_REVIEW — 데이터 품질 |
| Q05 | C-…-0124 노드 3개뿐인데? | NEEDS_REVIEW — 결측 |
| Q06 | C-…-0127 급변, 뭘 해야? | INSPECT_NODE · 이벤트 없음 → 확신 낮음(정지·감속 승인 불가) |
| Q07 | C-…-0128 도 급변? | NEEDS_REVIEW — 앞 정상 사이클 1개뿐 |
| Q08 | C-…-0199 (없는 번호) | 404 · 추측하지 않음 |
| Q09 | C-…-0108 진동 높은데? | NO_ACTION · 진동 0.45 는 관측만 |
| Q10 | C-…-0118 node_2 속도 정확히? | exact 조회 44.0 (파이프라인 안 돌림) |

## 하지 않는 것

- 실제 PLC·로봇·MES 연결, 실제 센서 적재, LLM 호출, 사용자 인증, 서버 쪽 상태 저장.
- 결정대장에 없는 임계값 학습·추가. 승인 없는 명령. 자동 재실행.

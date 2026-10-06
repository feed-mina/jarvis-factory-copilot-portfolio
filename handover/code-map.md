# 화면·API·코드 대응

API(Application Programming Interface)는 프로그램이 요청을 보내고 결과를 받는 창구다. 목록은 소스의 실제 라우트 선언을 추출했다. 정적 분석이며 운영 도달 가능성 검사 결과는 아니다.


## server 라우트

|메서드|경로|핸들러|
|---|---|---|
|GET|`/health`|[health](../server/api.py)|
|POST|`/api/v1/mail/collect`|[collect](../server/api.py)|
|GET|`/api/v1/mail/jobs`|[jobs](../server/api.py)|
|GET|`/api/v1/mail/jobs/{id}`|[job](../server/api.py)|
|GET|`/api/v1/mail/jobs/{id}/events`|[events](../server/api.py)|
|POST|`/api/v1/mail/jobs/{id}/analyze`|[analyze](../server/api.py)|
|PATCH|`/api/v1/mail/jobs/{id}`|[edit](../server/api.py)|
|POST|`/api/v1/mail/jobs/{id}/approve`|[approve](../server/api.py)|
|POST|`/api/v1/mail/jobs/{id}/save-draft`|[save](../server/api.py)|
|POST|`/api/v1/mail/jobs/{id}/review`|[review](../server/api.py)|
|GET|`/api/v1/mail/evaluations`|[eval_list](../server/api.py)|
|GET|`/api/v1/mail/evaluations/{evaluation_id}`|[eval_get](../server/api.py)|
|POST|`/api/v1/mail/evaluations`|[eval_start](../server/api.py)|
|GET|`/api/v1/mail/releases/artifacts`|[release_artifacts](../server/api.py)|
|POST|`/api/v1/mail/releases/artifacts`|[release_register](../server/api.py)|
|GET|`/api/v1/mail/releases/experiments`|[release_experiments](../server/api.py)|
|POST|`/api/v1/mail/releases/experiments`|[release_start](../server/api.py)|
|GET|`/api/v1/mail/releases/experiments/{release_id}`|[release_detail](../server/api.py)|
|POST|`/api/v1/mail/releases/comparisons`|[release_compare](../server/api.py)|
|GET|`/api/v1/mail/releases/comparisons`|[release_comparisons](../server/api.py)|
|POST|`/api/v1/mail/releases/experiments/{release_id}/reviews`|[release_review](../server/api.py)|
|POST|`/api/v1/mail/releases/comparisons/{release_id}/approval`|[release_approve](../server/api.py)|

## backend 라우트

|메서드|경로|핸들러|
|---|---|---|
|POST|`/api/v1/setup/session`|[session](../backend/app.py)|
|GET|`/health`|[health](../backend/app.py)|
|GET|`/api/v1/setup/status`|[status](../backend/app.py)|
|POST|`/api/v1/setup/probe/{service}`|[probe](../backend/app.py)|
|GET|`/api/v1/setup/history`|[history](../backend/app.py)|
|GET|`/setup`|[setup](../backend/app.py)|

## 실제 메일 API 입력

|요청|필드|화면 결과|
|---|---|---|
|POST collect|limit 기본3, 1–10|추가한 작업 ID 목록|
|PATCH jobs/{id}|version ≥1, draft 1–16000자|검토 대기 상태와 새 버전|
|POST approve/save-draft/review|version ≥1|최신 상태 또는409 충돌|
|POST releases/experiments|baseline,candidate,request_key UUID; mode smoke/full|실험 ID와 상태|
|POST releases/comparisons|experiment_id|PASS/HOLD/FAIL 판정|
|POST experiments/{id}/reviews|slot,verdict accept/reject,note≤2000,evidence_digest 64자리|개별 검토 기록; reject는 이유 필수|
|POST comparisons/{id}/approval|evidence_digest|승인 기록; deployment=not_executed|

실제 브라우저 경로는 live-bridge의 허용 목록을 통과한다. `/api/live/session`은 브리지 세션/CSRF 발급용이다. Python API는 브라우저 Origin 직접 요청을 거절한다.

## 목업 계약

[contracts/openapi.yaml](../contracts/openapi.yaml)과 [src/api/schema.d.ts](../src/api/schema.d.ts)는 관제 계약과 생성 타입이다. `/api/v1/tasks` 등 목업 경로의 MSW 구현은 [handlers.ts](../src/mocks/handlers.ts)와 [workspace.ts](../src/mocks/workspace.ts)에 있다. 이 경로를 실제 server/api.py의 메일 API가 제공한다고 가정하지 않는다.

## 화면 자산

|화면|전체|부분1|부분2|
|---|---|---|---|
|S01 메일 작업실 · 수신에서 답장 검토|[전체](assets/pages/S01.png)|[확대](assets/components/S01-1.png)|[확대](assets/components/S01-2.png)|
|S02 수정·승인·Gmail 초안 저장|[전체](assets/pages/S02.png)|[확대](assets/components/S02-1.png)|[확대](assets/components/S02-2.png)|
|S03 에이전트 실행 · 실제 노드 이력|[전체](assets/pages/S03.png)|[확대](assets/components/S03-1.png)|[확대](assets/components/S03-2.png)|
|S04 Eval Studio · 합성 사례 평가|[전체](assets/pages/S04.png)|[확대](assets/components/S04-1.png)|[확대](assets/components/S04-2.png)|
|S05 Release Gate · 비교와 사람 검토|[전체](assets/pages/S05.png)|[확대](assets/components/S05-1.png)|[확대](assets/components/S05-2.png)|
|S06 목업 · 감독 그래프와 버전 판정|[전체](assets/pages/S06.png)|[확대](assets/components/S06-1.png)|[확대](assets/components/S06-2.png)|
|S07 로컬 연결 설정과 운영 도구|[전체](assets/pages/S07.png)|[확대](assets/components/S07-1.png)|[확대](assets/components/S07-2.png)|

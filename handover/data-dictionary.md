# 자비스 데이터 사전

소스에 선언된 PostgreSQL 자체 테이블5개를 기록했다. 운영 DB introspection이나 실제 마이그레이션 실행 결과는 아니다. PK(Primary Key)는 기본키, FK(Foreign Key)는 외래키다. PostgreSQL의 PRIMARY KEY는 NOT NULL을 포함한다.

## 저장소 구분

|저장소|담당|
|---|---|
|PostgreSQL mail_jobs/events|실제 메일 작업 원본·승인·이력|
|PostgreSQL eval_runs/release_records|합성 평가와 배포 검토 증거|
|별도 setup DB의 jarvis_setup_checks|연결 검사 이력|
|PostgresSaver 관리 테이블|LangGraph 체크포인트; 설치 라이브러리 소유 스키마|
|서버 비밀 파일|Gmail OAuth, 운영 토큰, LangSmith 설정; 값 제외|
|Node 브리지 메모리|8시간 세션과 CSRF; 재시작 시 소멸|
|Gmail|원본 메일과 실제 초안; DB와 별도 외부 상태|
|MSW 메모리|검수용 모의 상태; 업무 DB 아님|

## mail_jobs

메일 작업실 원본과 승인·저장 상태 — [server/repository.py](../server/repository.py)

|열|타입|NULL 허용|기본값|키|뜻|
|---|---|---|---|---|---|
|id|uuid|아니오|—|PK|내부 작업 ID|
|account|text|아니오|—|UNIQUE 조합|Gmail 연결 계정|
|gmail_id|text|아니오|—|UNIQUE 조합|외부 메시지 ID|
|state|text|아니오|'collected'|—|처리 상태|
|version|integer|아니오|1|—|상태/내용 변경 때 증가하는 비교 버전|
|payload|jsonb|아니오|—|—|원문과 분석·초안·검수 결과|
|approval|jsonb|예|—|—|승인 digest와 검토 버전·사용자·시각|
|operation|uuid|예|—|—|외부 초안 저장의 멱등 확인 표식|
|draft_id|text|예|—|—|Gmail이 반환한 초안 ID|
|created_at|timestamptz|아니오|now()|—|생성 시각|
|updated_at|timestamptz|아니오|now()|—|최근 변경 시각|

```sql
CREATE TABLE IF NOT EXISTS mail_jobs (
              id uuid PRIMARY KEY, account text NOT NULL, gmail_id text NOT NULL,
              state text NOT NULL DEFAULT 'collected', version integer NOT NULL DEFAULT 1,
              payload jsonb NOT NULL, approval jsonb, operation uuid, draft_id text,
              created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
              UNIQUE(account,gmail_id));
```

UNIQUE(account,gmail_id)가 같은 계정의 같은 메시지 중복 수집을 막는다. payload의 thread_id/message_id는 FK가 아니다.

## mail_events

메일 처리 이력과 실제 노드 그래프 — [server/repository.py](../server/repository.py)

|열|타입|NULL 허용|기본값|키|뜻|
|---|---|---|---|---|---|
|seq|bigserial|아니오|시퀀스|PK|이벤트 순서|
|job_id|uuid|예|—|FK mail_jobs.id|연결된 작업 ID|
|action|text|아니오|—|—|상태 또는 node_started/completed/failed|
|actor|text|아니오|—|—|system/operator 등 실행 주체|
|details|jsonb|아니오|'{}'|—|버전 또는 노드 실행 메타데이터|
|at|timestamptz|아니오|now()|—|이벤트 시각|

```sql
CREATE TABLE IF NOT EXISTS mail_events (
              seq bigserial PRIMARY KEY, job_id uuid REFERENCES mail_jobs(id),
              action text NOT NULL, actor text NOT NULL, details jsonb NOT NULL DEFAULT '{}', at timestamptz NOT NULL DEFAULT now());
```

job_id만 실제 FK다. ON DELETE 동작을 별도로 선언하지 않아 기본 NO ACTION이다. seq 기본키 외에 job_id/at 보조 인덱스가 setup SQL에 별도 선언되어 있지 않다.

## eval_runs

Eval Studio의 합성 평가 실행 — [server/evaluations.py](../server/evaluations.py)

|열|타입|NULL 허용|기본값|키|뜻|
|---|---|---|---|---|---|
|id|uuid|아니오|—|PK|평가 실행 ID|
|account|text|아니오|—|—|조회 계정 범위|
|state|text|아니오|—|—|running/completed/failed/interrupted 등|
|payload|jsonb|아니오|—|—|고정 사례·버전·실행 결과|
|created_at|timestamptz|예|now()|—|생성 시각|
|updated_at|timestamptz|예|now()|—|갱신 시각|

```sql
CREATE TABLE IF NOT EXISTS eval_runs(id uuid PRIMARY KEY,account text NOT NULL,state text NOT NULL,payload jsonb NOT NULL,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
```

## release_records

Release Gate의 실행물·실험·검토·판정·승인 — [server/release_gate.py](../server/release_gate.py)

|열|타입|NULL 허용|기본값|키|뜻|
|---|---|---|---|---|---|
|id|uuid|아니오|—|PK|레코드 ID|
|account|text|아니오|—|UNIQUE 조합|계정 범위|
|kind|text|아니오|—|UNIQUE 조합|artifact/experiment/case_review/comparison/approval|
|key|text|아니오|—|UNIQUE 조합|종류별 요청·중복 식별 키|
|payload|jsonb|아니오|—|—|종류별 상세 데이터|
|created_at|timestamptz|아니오|now()|—|기록 생성 시각|

```sql
CREATE TABLE IF NOT EXISTS release_records(id uuid PRIMARY KEY,account text NOT NULL,kind text NOT NULL,key text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(account,kind,key));
```

UNIQUE(account,kind,key). 서로 다른 kind 간 연결은 payload 속 ID와 애플리케이션 검증으로 관리한다.

## jarvis_setup_checks

로컬 연결 설정 검사 결과 — [backend/storage.py](../backend/storage.py)

|열|타입|NULL 허용|기본값|키|뜻|
|---|---|---|---|---|---|
|id|uuid|아니오|—|PK|검사 ID|
|service|text|아니오|—|—|검사한 연결 서비스|
|checked_at|timestamptz|아니오|—|—|UTC 검사 시각|
|result|jsonb|아니오|—|—|상태·사유·확인 근거|

```sql
CREATE TABLE IF NOT EXISTS jarvis_setup_checks (id uuid PRIMARY KEY, service text NOT NULL, checked_at timestamptz NOT NULL, result jsonb NOT NULL);
```

## JSON 필드 계약

|영역|주요 필드|뜻·소비 화면|
|---|---|---|
|메일 원문|subject,sender,recipient,body,thread_id,message_id,references|메일 원문·회신 대상과 같은 대화에 저장할 근거|
|분석 결과|category,summary,draft,needs_reply|분류·요약·제안과 승인 가능 여부|
|품질 검수|quality_gate,security_check,critic|passed/blocked/needs_review와 모델 판단|
|실행 측정|pipeline_version,prompt_version,pipeline_run_id,node_runs,role_models,duration_ms,tokens,cost_usd|실행 그래프·버전·지연; 토큰/비용은 null 미측정|
|승인|digest,review_version,actor,at|현재 내용에 대한 사람 승인|
|이벤트 상세|run_id,node,attempt,status,duration_ms,error_type,input_tokens,output_tokens,cost_usd|노드 선택 상세와 실패 지점|
|artifact|pipeline,role,child,manifest,digest|서버 소스 고정본; 공개 응답은 digest/manifest 중심|
|experiment|state,request,mode,dataset,dataset_hash,evaluator_hash,policy,repetitions,artifacts,slots,total|정해진 비교 집합과 실제 실행 결과|
|case_review|experiment_id,slot,verdict,note,actor,evidence_digest,at|사례 쌍의 사람 판단|
|comparison|status,rules,policy,metrics,experiment_id,evidence_digest|PASS/HOLD/FAIL 근거|
|approval 레코드|comparison_id,evidence_digest,actor,deployment,expires_at|배포 미실행 상태의 승인 기록; 만료 Unix 초|

## 스키마 변경과 체크포인트

자체 테이블은 CREATE TABLE IF NOT EXISTS로 준비한다. 기존 테이블의 열을 자동 변경하는 버전형 마이그레이션 체계와 같지 않다. 열을 추가할 때는 별도 변경·백업·기존 자료 검증 절차가 필요하다.

PostgresSaver.setup()은 의존 라이브러리의 체크포인트 스키마를 준비한다. 저장소에 해당 라이브러리 내부 DDL은 포함되지 않으므로 실제 테이블 정의를 확인하지 않은 상태에서 업무 테이블과 합쳐 ERD를 만들지 않았다. 버전 교체 시 설치된 라이브러리와 실제 DB 스키마를 함께 점검한다.

모든 PostgreSQL timestamptz는 시간대 정보를 가진다. 화면은 브라우저의 날짜 표시 함수를 사용하므로 서버 UTC 로그와 표시 시간을 비교할 때 사용자의 시간대도 확인한다. duration_ms는 밀리초, bridge expiry는 Unix 밀리초, release approval expires_at는 Unix 초다.

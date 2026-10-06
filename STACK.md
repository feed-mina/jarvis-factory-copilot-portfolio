# 자비스 관제 — 구현 스택 및 화면 유지 계약 v2

설계·PRD v0.3은 사용자 승인 완료. 현재는 실제 제품에 이어 사용할 프론트엔드 목업 단계다. 백엔드 업무 구현, 실제 연동, 운영 배포는 다음 단계의 별도 검수 대상이다.

## 기술 선택

| 영역            | 기준 기술                                      | 역할                                                         |
| --------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| 화면            | React + TypeScript + Vite                      | 실제 운영에도 사용하는 클라이언트 웹 앱                      |
| 화면 이동       | React Router                                   | 메일 작업실·에이전트 감독·버전 판정         |
| 디자인          | Tailwind CSS + shadcn/ui의 Radix 기반 컴포넌트 | 공통 버튼·대화상자·레이아웃·색상 토큰                        |
| 서버 데이터     | TanStack Query + fetch                         | 조회 캐시, 로딩·오류·갱신 상태                               |
| 그래프          | @xyflow/react + Recharts                                       | 노드·엣지 감독 그래프; 시계열은 Recharts                              |
| 데이터 규격     | OpenAPI 3.1 + openapi-typescript               | API 규격을 기준으로 화면의 TypeScript 형식 생성              |
| 목업 응답       | MSW(Mock Service Worker)                       | 실제 HTTP 요청을 가로채 계약과 같은 형식으로 예시 응답       |
| 백엔드          | Python + FastAPI + Pydantic                    | 사용자 요청, 조회·명령 API, 입력 검증                        |
| 에이전트        | Python LangGraph                               | 총괄·분야 감독·전문 에이전트, 중단·재개                      |
| LLMOps          | LangSmith SDK + Cloud                          | 실행 추적, 평가 데이터셋·실험·피드백·운영 관찰               |
| 영속 상태       | PostgreSQL + SQLAlchemy + Alembic              | 에이전트 등록부, 이벤트 원장, 평가·진단 요약, 승인·배포 이력 |
| 실행 복구       | langgraph-checkpoint-postgres                  | 작업별 체크포인트; 감사 원장과 별도 테이블                   |
| 백그라운드 작업 | 별도 Python worker + PostgreSQL 작업 테이블    | 리스·하트비트·재시도·전송 대기열. 프로세스 재시작에도 유지   |
| 실시간 갱신     | REST 조회 + SSE(Server-Sent Events)            | 서버에서 변경 이벤트 전송; 연결 복구 시 재조회               |
| Gmail           | Gmail API + Google OAuth 2.0 서버 인증         | 원문 조회, 승인된 초안 저장. 발송은 초기 범위 밖             |
| Hermes          | 기존 Hermes gateway + 프로젝트 전용 adapter    | 입출력 채널과 작업 API 연결                                  |
| 배포 대상       | Windows 11 / WSL2 / Docker Compose             | 로컬 web·api·worker·postgres. 외부 인터넷 연동               |
| 로컬 웹 제공    | Caddy                                          | React 빌드 파일, /api 역방향 프록시, 동일 출처 제공          |
| 검증            | TypeScript, Vitest, Playwright, pytest         | 타입·계약·핵심 승인/차단 흐름·백엔드 검증                    |
| 의존성 재현     | package-lock.json 및 향후 uv.lock              | npm ci / uv sync --frozen, 버전 임의 갱신 금지               |

프론트엔드에 Hermes·Gmail·LangSmith 비밀키를 넣지 않는다. 브라우저는 자체 API에만 연결하며, 상세 실행의 LangSmith 링크도 서버가 제공한다. 첫 운영은 localhost 단일 사용자로 제한한다. 인증은 FastAPI의 서버 세션(HttpOnly 쿠키) 및 명령의 CSRF 방어를 사용한다. Gmail OAuth는 앱 자체 사용자 인증과 별개다. 원격 접속 공개는 후속 보안·네트워크 설계가 필요하다.

LangSmith가 상세 추적과 평가의 중심이다. 자체 DB에는 추적 연결 ID, 누락 방지 원장, 판정 근거 스냅샷과 권한·승인 이력을 저장한다. 같은 기록을 서로 독립적으로 편집하는 구조로 만들지 않는다. 프론트엔드가 점수를 보고 독자적으로 배포 가능 여부를 계산하지 않는다. 서버의 eligibility와 blockers가 승인 버튼 상태를 결정하며, 명령 시 서버에서 다시 검사한다.

PostgreSQL 작업 테이블은 초기 로컬 규모의 선택이다. SKIP LOCKED, 리스 만료, 멱등 키와 재시도 상한을 구현 단계에서 검증한다. Redis·Celery·Kafka는 초기 필수 의존성에 포함하지 않는다. 이벤트 전달은 적어도 한 번 전달과 중복 제거를 기준으로 하며, 외부 작업의 exactly-once를 주장하지 않는다.

## 화면을 유지하는 구조

목업: React 화면 → 동일한 API client → HTTP 요청 → MSW 예시 응답.
운영: 동일 React 화면 → 동일한 API client → HTTP 요청 → FastAPI 실제 응답.

화면 컴포넌트에서 직접 예시 데이터를 import하지 않는다. 예시 데이터는 mocks에만 둔다. 실데이터 연결은 MSW 비활성화 및 API 주소 설정으로 전환하며 화면 구조와 컴포넌트를 재작성하지 않는 것을 인수 조건으로 삼는다. 연결 전환 시 계약 위반은 백엔드 또는 계약 어댑터에서 해결한다. 새 요구사항과 접근성 문제에 따른 변경 가능성은 남아 있으므로 화면 무변경을 절대 보장하지는 않는다.

MSW 자체의 예시 승인·저장 상태는 서버 상태가 아니며 목업 새로고침 시 초기화된다. 운영 모드에서 예시 실패를 실제 성공으로 대체하거나 응답 실패 시 mock으로 자동 전환하지 않는다. mock 사용은 환경 설정에서 명시한다.

### 고정할 표시 규칙

- 운영 버전과 검토 후보 버전을 별도 표시.
- 서비스 건강(normal/warning/incident/unknown), 배포 적격성(eligible/blocked/unknown), 작업 상태를 분리.
- unknown과 null을 0·정상으로 표시하지 않음.
- 기준값은 서버의 정책 버전에서 조회. 화면에 판정 상수 하드코딩 금지.
- 기록 시각은 UTC ISO 8601, 화면은 Asia/Seoul. 사람 대기 시간과 기계 처리 시간을 구분.
- 요청 목록은 cursor 페이지네이션. 이력 상세는 선택된 run만 추가 조회.
- 화면은 데이터 충분성, 기록 지연, 빈 결과, 로딩, 통신 오류, 권한 오류를 표현.
- 배포·초안 승인은 대상 ID와 revision 및 멱등 키를 포함. 변경 충돌은 HTTP 409로 재검토.
- SSE는 event_id와 연결 상태를 표시. Last-Event-ID로 복구하며 보존 범위를 벗어나면 전체 조회 갱신. 목업 v2에서는 EventSource와 MSW SSE 재생을 구현. 실제 에이전트 이벤트 연결과 보존 범위 복구는 백엔드 구현 단계.

## 목업 범위와 사용자 검수

1. 메일 작업실: 한 건의 원문·처리 단계·이벤트·초안·LLMOps와 저장 확인.
2. 에이전트 감독: 실시간 수신 어댑터·예시 재생·노드/엣지·메모리/전달 상세.
3. 버전 판정: Eval·Observe·Diagnose·제한 운영 승인 통합.

승인 대상은 재사용할 화면·상태·클릭 흐름이다. 목업 승인 후 백엔드와 연결 기능 구현, 통합 검증, 운영 전환 순서로 별도 검수한다.

## 실제 환경 확인이 필요한 설정

프론트엔드 스택과 독립적인 아래 값은 확인되지 않았다. 모두 확정되었다고 표시하지 않는다.

- Hermes 설치 버전·확장 인터페이스 및 기존 Hostinger 인스턴스 활용 여부: gateway 제품 기능으로 임의의 HTTP endpoint를 가정하지 않는다. adapter 경계만 확정한다.
- 모델 제공자, 정확한 모델 ID, API 인증 수단, 비용 상한: 서버 어댑터와 release manifest에 설정. 기존 ChatGPT OAuth를 일반 API 자격증명으로 사용할 수 있다고 가정하지 않는다.
- LangSmith Cloud 계정·지역·보존 기간·전송 허용 범위: 연결 전 사용자 설정 확인. 보호 원문은 서버측 암호화 파일 저장, 키는 저장 데이터와 분리한다.
- Gmail 계정·OAuth 클라이언트·권한 동의: 실제 연결 단계에서 설정. 목업은 자격증명을 요구하지 않는다.
- Python·PostgreSQL·LangGraph 등 백엔드 정확 버전은 연동 구현 시작 시 상호 호환성 검증 후 uv.lock 및 컨테이너 이미지 digest로 고정한다. 프론트엔드는 이번 설치에서 lockfile로 고정한다.

## 공식 근거

- https://react.dev/learn/build-a-react-app-from-scratch — React 앱의 빌드·라우팅·서버 데이터 계층.
- https://mswjs.io/docs/ — 네트워크 계층의 예시 응답과 개발/테스트 재사용.
- https://ui.shadcn.com/docs — 소스 기반 UI 컴포넌트.
- https://fastapi.tiangolo.com/features/ — OpenAPI·검증·클라이언트 생성의 기반.
- https://docs.langchain.com/oss/python/langgraph/persistence — 체크포인트와 지속 상태.
- https://docs.langchain.com/oss/python/langgraph/add-memory — PostgreSQL checkpointer.
- https://docs.langchain.com/langsmith/observability — 관찰·추적 기능.

확인일: 2026-09-11. 기술 선택은 본 프로젝트의 로컬 관제 요구를 바탕으로 한 설계 결정이다.

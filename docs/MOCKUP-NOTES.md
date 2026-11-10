> 이 문서는 2026-10-06 기준 README.md 원문을 그대로 옮긴 기록이다. 현재 소개는 [README.md](../README.md)를 본다(아래 상대 링크는 저장소 루트 기준으로 쓰인 원문 그대로다).

> **포트폴리오용 사본 · 회사 데이터 없음 · 원본은 비공개.** 2026-10-06 `mina-Hermes-javis` main `2be2605` 스냅샷(이력 없음).
> 운영 주소·계정 이메일은 `example.com` 자리표시자로 바꿨고, 생성 보고서 폴더(`work-map-guide/`, 45개)는 뺐다. 코드는 바꾸지 않았다.
> 제조 현장 데이터용 에이전틱 샘플은 [`samples/factory-copilot/`](samples/factory-copilot/README.md) — 이 저장소의 승인 구조(`server/workflow.py` approve)를 공정 판단 → 원인 추적 → 사람 승인 → 모의 명령으로 옮긴 것.

# 자비스 관제 목업 v2

메일 작업실 / 에이전트 감독 / 버전 판정 **화면 목업**(`VITE_ENABLE_MOCKS=true`)과, Gmail 수집 → Hermes 분류·초안 → Critic 검수 → 사람 승인 → Gmail 초안 저장까지 구현된 **운영 서버**(`server/`, FastAPI + PostgreSQL + LangGraph)를 함께 담은 저장소. 운영 상태는 `server/README-ko.md`·`OPERATIONS.md`·`LLMOPS-IMPLEMENTATION.md`에 있다.

## 실행
Node 22+ 환경에서 `npm ci`, `npm run dev`. `.env.development`가 MSW를 켠다. 목업 빌드는 `npm run build:mock`; 실제 연결용 `npm run build`는 mock 비활성. 실제 운영 백엔드는 `server/`에 있다(2026-09-13 실제 Gmail 초안 1건 DRAFT 검증, 발송 기능 없음). `backend/`는 로컬 연결 설정용이다.

## 재사용 구조
- src/v2: 실제 재사용할 화면. fixtures 직접 import 없음.
- src/api: OpenAPI 생성 타입, REST 클라이언트.
- src/mocks: API와 SSE 예시 응답. 실제 메일 저장/배포 없음.
- contracts/openapi.yaml: 작업 스냅샷·스트림·기존 평가/승인 계약.
- package-lock.json: 프론트엔드 의존성 고정. @xyflow/react 12.11.6 사용.
- STACK.md: 기술 선택과 운영 연결 경계.
- DESIGN-CONTRACT.md: Depth 2, 시나리오, 필수 상태, 검증 한계.

## 검수
`npm test`, `npm run build:mock`. 현재 타입/빌드 통과, 테스트 11개 통과.
브라우저 접근 정책으로 브라우저 상호작용·실제 스크린샷 검증은 미완료다. 테스트 통과를 브라우저 검수 통과로 간주하지 않는다.

`jarvis-review.html`은 동일 React 소스의 정적 검수본이다. 화면 선택과 상세 문서 열기를 지원하며 버튼의 실제 동작은 비활성이다.
`jarvis-mockup-v2-review.pdf`는 비브라우저 정적 렌더링이다. 실제 스크린샷이 아니며 폼과 SVG 라벨 등 표현 차이가 있다.
재생성: `npm run build:mock`, `node scripts/export-review.mjs`, WeasyPrint+pypdf를 설치한 Python에서 `python scripts/render-pdf.py`.

운영 연결 전 남은 작업: FastAPI/worker/LangGraph/LangSmith/Gmail/Hermes, 지속 이벤트 원장, 서버 권한 사전 조회, 실측 프로세스 메모리, 이벤트 보존 갭 복구, 실제 브라우저·통합 검수. 화면 계약을 유지하며 백엔드를 연결하는 것이 인수 기준이다.

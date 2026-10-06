# Javis 작업 전 보고서 검토 · 화면-코드 인수인계

## 핵심 한 줄

처음 보는 개발자는 `/widget-work` 화면에서 시작해 `WorkReportsConsole → /api/v1/work-reports → WorkReports → work_reports` 순서로 따라가면 보고서 수집·중복 제거·판정·표시를 유지보수할 수 있다.

## 제품 역할과 읽는 순서

이 기능은 개발 작업 전 보고서를 검토한다. 기존 `/work`는 개인 메일 답장 초안용이고 `/widget-work`는 에이전트 개발 작업용이다. 두 흐름의 DB 테이블과 API 경로도 분리되어 있다.

1. 화면: `src/v2/WorkReportsConsole.tsx`
2. 브라우저 API: `src/api/live.ts`의 `workReportApi`
3. 보안 프록시: `scripts/live-bridge.mjs`의 `allowed`
4. 서버 API: `server/api.py`의 `/api/v1/work-reports/*`
5. 업무 로직: `server/work_reports.py`의 `WorkReports`
6. Gmail 입력: `server/gmail.py`의 `search`, `attachment`
7. 저장: `WorkReportRepository.setup`

## 화면과 사용자 행동

### 보고서 메일 가져오기

- 입력: 사용자가 `보고서 메일 가져오기`를 누름
- 화면 함수: `collect` mutation
- API: `POST /api/v1/work-reports/collect`
- 처리: 허용 발신자 검사 → Markdown/HTML 첨부 제한 검사 → 작업 ID·버전 파싱 → 첨부 다이제스트 계산 → DB 연결
- 반환: 새 보고서 ID, 기존 보고서에 연결한 재발송 ID, 거절 이유
- 화면 결과: 새 보고서 수와 재발송 연결 수를 구분해 표시

### Javis 검토 실행

- 입력: 사용자가 보고서를 선택하고 `Javis 검토 실행`을 누름
- 화면 함수: `review` mutation
- API: `POST /api/v1/work-reports/{id}/review`
- 1차 처리: `contract_review`가 목표·저장소·기준·범위·완료 증거·권한 경계를 검사
- 2차 처리: 1차 통과 때만 `call_a01_review`가 A01 모델을 도구 없이 1회 호출
- 반환: `passed`, `needs_revision`, `needs_user` 중 하나와 이유·피드백
- 부수 효과: DB 상태와 이벤트 추가. 메일·Telegram 전송과 저장소 변경은 없음

### HTML 보고서 받기

- 입력: 사용자가 `HTML 보고서 받기`를 누름
- API: `GET /api/v1/work-reports/{id}/html`
- 처리: 같은 계정의 DB 행 조회 → 첨부 원문을 다운로드 응답으로 반환
- 화면 결과: 파일 다운로드
- 보안: `application/octet-stream`, `Content-Disposition: attachment`, `nosniff`, sandbox CSP. 화면 안에서 첨부 스크립트를 실행하지 않음

## 데이터 관계

```text
Gmail message 1 ─┐
                 ├─ work_report_messages ── work_reports
Gmail resend 2 ──┘                         │
                                           └─ work_report_events
```

### `work_reports`

- 계정, 작업 ID, 보고서 버전의 조합이 하나의 논리 보고서
- `content_digest`가 같은지 확인해 재발송과 변경본을 구분
- 같은 작업 ID·버전인데 첨부 내용이 다르면 충돌로 거절
- `payload`에는 정규화된 본문, 첨부 해시, 계약 검사, HTML 첨부를 저장
- `decision`에는 Javis 판정과 모델 메타데이터를 저장

### `work_report_messages`

- Gmail 메시지 ID 하나를 보고서 하나에 연결
- 재발송이 와도 `work_reports` 행은 늘리지 않고 이 연결만 추가

### `work_report_events`

- 수집, 재발송 연결, 보완 요청, 사용자 판단, 통과를 시간순으로 기록

## 성공·빈 결과·실패 분기

| 상황 | 서버 상태 | 화면 |
|---|---|---|
| 새 보고서 | `collected` | 검토 대기 |
| 같은 내용 재발송 | 기존 상태 유지 | 연결 메일 수 증가 |
| 같은 버전 내용 변경 | 수집 거절 | 거절 건수/이유 |
| 허용 발신자 아님 | 수집 거절 | 거절 건수/이유 |
| 필수 항목 또는 권한 충돌 | `needs_revision` | A01 보완 문장 |
| 사용자 결정 필요 | `needs_user` | 사용자 판단 필요 |
| 계약·모델 검토 통과 | `passed` | 실행 연결 대기 |
| A01 모델 호출 실패 | 기존 상태 유지, API 실패 | 재시도 가능한 오류 |

## GUI Before / After

### Before · 실제 기존 화면

상단에는 `메일 작업실`, `에이전트 실행`, `Eval Studio`, `Release Gate`가 있었다. 작업 전 보고서를 선택하거나 상태·HTML 링크를 볼 화면은 없었다.

### After · 구현된 코드 기준 화면

`위젯 작업` 메뉴와 별도 페이지가 생겼다. 왼쪽은 작업 ID·버전·연결 메일 수, 오른쪽은 저장소 기준·필수 계약·Javis 판정·HTML 다운로드·처리 이력을 보여준다. 운영 배포 전 실제 브라우저 확인은 아직 하지 않았다.

## 수정 영향과 검증 순서

- 식별 규칙을 바꾸면 `parse_report`와 중복 제거 테스트를 함께 수정한다.
- 권한 정책을 바꾸면 `REVIEW_PROMPT`, `contract_review`, Fix Guide를 함께 수정한다.
- API를 추가하면 `live-bridge.mjs` 허용 목록과 거부 테스트를 함께 수정한다.
- 화면 상태를 추가하면 `WorkReportState`, `labels`, DB 상태를 함께 수정한다.
- HTML 제공 방식을 바꾸면 바이너리 프록시 테스트와 콘텐츠 실행 방지를 다시 확인한다.

검증 순서는 Python 단위검사 → 브리지 보안검사 → 웹 단위검사 → 운영용 빌드 → 인증된 실제 Gmail/DB 시험 → 사용자 화면 확인이다. 마지막 두 단계와 배포는 이 PR에서 수행하지 않았다.

# Hermes Agent · Javis 현재 진행 상황

확인 시각: 2026-09-20 15:07~15:10 KST

최종 목표: 두 저장소의 구현·운영·미완료 경계를 확인하고 다음 작업 우선순위를 정한다.

## 전체 3줄

1. Agent는 공통 스킬·보고서 게시·인계 운영까지 구현되었다.
2. Javis는 메일 검토·실행 기록·평가·Release 검토가 구현되어 있으나 현재 메일 자동 수집이 실패한다.
3. 프로젝트 이력 PR #2와 운영 배포의 기준을 맞추고 메모리 동기화 장애를 확인해야 한다.

## 저장소 기준

|저장소|조사 시작 main|최근 변경|열린 PR / 이슈|
|---|---|---|---|
|Agent|270f15b|9/20 14:48 KST SDUI 파일럿 인계, 앞서 보고서 운영·스킬 갱신|0 / 0|
|Javis|e5b1f6a|9/19 21:48 KST 보고서 추가; 최근 기능 변경은 9/13 Release 검토|1 (#2) / 0|

열린 이슈가 없다는 것은 작업이 모두 완료됐다는 뜻이 아니다. 이 보고서 게시 커밋은 위 기능 진행 집계에서 제외한다.

## Agent · 보고서 운영

상태: 구현·일부 운영 확인

공통 스킬과 A05 → A01 → ME 게시 → Telegram 전달 경로가 main에 있습니다. 운영 컨테이너와 A01 라우터가 실행 중이며, 보고서 게시 서비스의 최근 실행은 성공했습니다. 이것만으로 각 에이전트의 모든 업무 수행을 보장하지 않습니다.

다음: 게시 실패 영수증 2건이 과거 복구된 건인지 대조하고 실제 Telegram 수신을 확인합니다.

근거: scripts/finance_reports.py:48,69 / docs/finance-reporting.md / 운영 서비스 최근 종료코드 0 [소스/PR](https://github.com/feed-mina/mina-Hermes-Agent/blob/270f15b7d32cffc90394ea5fa793c281aaf9a941/scripts/finance_reports.py#L48)

## Javis · 메일 처리

상태: 구현 완료 / 자동 수집 장애

메일 수집·분류·요약·초안 작성·사람 승인·Gmail 초안 저장 코드가 있습니다. API health는 200이고 PostgreSQL은 healthy입니다. 그러나 15:00 KST 정기 수집은 HTTPStatusError로 실패했고 같은 시간대 메일 서비스 로그에서 invalid_grant를 확인했습니다. 토큰 만료·철회 등 정확한 원인은 아직 미확정입니다.

다음: Gmail 인증 상태를 진단하고 필요 시 사용자 재인증 후 수집 1건과 중복 방지를 검증합니다. 이번 조사에서는 수집·승인·저장을 실행하지 않았습니다.

근거: server/api.py:44–66 / server/operations.py:24–28 / systemd 결과·정제된 오류 로그 [소스/PR](https://github.com/feed-mina/mina-Hermes-javis/blob/e5b1f6a655ce27541dea39cc7d8eb4b7d0ae42fc/server/api.py#L44)

## Javis · 프로젝트 이력

상태: PR #2 미병합 / 서버 파일 존재

프로젝트 이력 조회는 열린 PR #2의 5개 커밋·21개 파일에 있습니다. 현재 main에는 포함되지 않았습니다. 운영 서버에는 project-reader.mjs 파일이 존재하지만 전체 배포 SHA 일치와 인증된 최신 API 결과는 이번에 검증하지 않았습니다. GitHub 이력 조회는 에이전트에게 업무를 실행시키는 기능과 다릅니다.

다음: PR #2의 최종 변경과 운영 사본 차이를 비교한 뒤 테스트·병합·배포 기준을 맞춥니다.

근거: gh pr view 2 / main..origin/codex/project-history-integration / 운영 파일 존재·SHA256 [소스/PR](https://github.com/feed-mina/mina-Hermes-javis/pull/2)

## 실행 화면 · 통합 경계

상태: 메일 단계 조회 구현

RuntimeConsole은 메일 작업 목록과 해당 작업 이벤트를 조회해 intake → triage/security → draft → critic → approval를 그립니다. Hermes 호출 코드는 도구 사용을 끄는 설정을 포함합니다. 이 경로를 A01~A05 전체의 Git 작업·납품·일정 통합 실행 완료로 해석할 근거는 없습니다.

다음: 통합하려면 작업 ID → 담당 에이전트 → 상태 → 산출물 → 실패 원인을 연결하는 작은 읽기 전용 흐름부터 기준을 정합니다.

근거: src/v2/OperationsConsole.tsx:9–47 / server/role_runner.py:12 / src/api/live.ts [소스/PR](https://github.com/feed-mina/mina-Hermes-javis/blob/e5b1f6a655ce27541dea39cc7d8eb4b7d0ae42fc/src/v2/OperationsConsole.tsx#L34)

## 공유 메모리 동기화

상태: 반복 재시작 관측

운영 서버의 obsidian-headless-hermes-brain 서비스가 activating (auto-restart), Result=exit-code 상태였습니다. 누적 재시작 수치는 이번 장애의 시작 시각을 알려주지 않으므로 원인·현재 파일 동기화 성공 여부는 별도 진단 대상입니다.

다음: 비밀정보를 제외한 서비스 오류와 마지막 성공 동기화 시점을 확인합니다. 컨테이너가 켜져 있다는 사실만으로 보고서 인식 완료를 판정하지 않습니다.

근거: systemctl show: Result=exit-code / 상태 auto-restart [소스/PR](https://github.com/feed-mina/mina-Hermes-Agent)

## 이번 검증

|항목|결과|경계|
|---|---|---|
|Agent 보고서 테스트|이번 실행 3개 통과|임시 Git 게시·중복 방지 등, 실제 Telegram 수신 검증 아님|
|PORTABLE 스킬|이번 원본 일치 검사 통과|설치된 모든 운영 프로필의 사본 일치 검사는 별도|
|Javis 연결 검사|이번 실행 3개 통과|모의 세션·허용 경로·CSRF 검사|
|Javis 검토 입력|이번 실행 5개 통과|반려 사유·길이·digest 검사|
|전체 프런트 빌드·UI|이번 미실행|로그인·버튼·모바일 실사용 확인 미완료|
|메일 서버 / 웹 / DB|운영 실행 확인|health 200 / web active / DB healthy|
|메일 자동 수집|최근 실패|HTTPStatusError + invalid_grant 로그|
|보고서 게시 서비스|최근 성공|15:04 KST 종료코드 0, 타이머 예약 확인|
|보고서 영수증|13 published / 2 failed|총 15개 보존된 제출 기록. queued=15는 대기 15건 뜻이 아님|
|백업 / health 작업|최근 성공|백업 9/20 03:00 KST, health 15:05 KST. 복원 검사는 이번 미실행|
|GitHub Actions|두 저장소 조회 결과 0건|자동 CI 통과라고 주장할 수 없음|

## 우선순위

1. Javis 메일 인증 오류 진단·복구 후 자동 수집 실제 성공 확인.
2. 공유 메모리 동기화 오류와 마지막 성공 상태 확인.
3. Javis PR #2와 운영 사본 대조 후 main·배포 기준 일치.
4. 선택한 실제 작업 한 건을 접수 → 담당 → 결과 → 사용자 확인까지 검증.

## 문서와 코드의 차이

Javis 루트 README의 “운영 백엔드 미구현” 설명은 server/api.py 및 9/13 서버 결과 문서와 맞지 않는다. Agent 운영 문서의 고정 게시 경로 설명도 현재 코드의 docs/YYYY-MM-DD와 다르다. 실제 소스와 이번 운영 결과를 우선했다. 문서 수정은 이번에 하지 않았다.

## 조사 범위

저장소·PR·최근 기록·일부 로컬 검사·운영 상태를 읽기 전용으로 확인했다. 앱 수정·병합·배포·서비스 재시작·메일 수집·분석·승인·저장·발송은 실행하지 않았다. 과거 실제 분석·배포 기록과 이번 검증을 합산하지 않는다. invalid_grant의 상세 원인은 추가 진단 전 미확정이다.

## 에이전트 인계

다음 작업에서 이 보고서의 장애·PR 상태를 기준으로 확인한다. 보고서 파일 존재나 게시만으로 실행 중 에이전트가 읽었다고 기록하지 않는다. 수신 확인은 보고서 경로와 핵심 장애를 에이전트가 다시 설명하는 응답으로 판단한다.

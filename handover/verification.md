# 검증 기록

분석 기준 main: `b30f873b76964806e93db19e5c626bdb5009f28e`.

|검증|결과|범위|
|---|---|---|
|scripts/live-bridge.check.mjs|3개 통과|허용 경로·계정 세션·CSRF·host/origin의 모의 브리지 검사|
|server/test_review_input.py|5개 통과|실제 API 입력 클래스 추출, 반려 사유·길이·digest 검증|
|Python 소스 문법|36개 파일 AST 파싱 통과|외부 모듈 import·DB 연결·모델 실행 제외|
|DB 스키마 대조|자체 CREATE TABLE5개와 사전 대조|PostgreSQL에서 실행한 결과 아님|
|문서·이미지|상대 링크, 소스 심벌·자산 존재와 그림 시각 점검|코드 기반 설명용 재구성|

```bash
# 저장소 루트
node --test scripts/live-bridge.check.mjs
# server 폴더
python -m unittest test_review_input.py
```

## 미실행 범위

전체 Vitest·프런트엔드 빌드·브라우저 UI·PostgreSQL 통합 pytest를 실행하지 않았다. 분석 환경에는 관련 Node/Python 런타임 의존성과 전용 테스트 DB가 없다. 실제 Gmail 수집·승인·초안 저장, Hermes 호출, LangSmith 전송, full/smoke 유료 평가, SSH 연결, 서비스 재시작·백업·배포를 실행하지 않았다.

저장소에 기록된 과거 실서비스 검증은 역사적 근거이며 이번에 재검증한 결과로 합산하지 않았다. 특히 Release Gate 코드 분석은 현재 후보에 대한 PASS 판정을 내린 것이 아니다.

## 완료 보고 규칙

AGENTS.md의 work-map-guide 스킬을 설치된 스킬 목록과 로컬 경로에서 찾았으나 없었다. 해당 스킬을 사용했다고 주장하지 않고, 지정 폴더에 독립 HTML 진행·완료 보고서를 추가했다. 기존 보고서는 보존한다.

[이번 HTML 보고서](../work-map-guide/handover-report-20260919-022831-c4f6edd9.html)

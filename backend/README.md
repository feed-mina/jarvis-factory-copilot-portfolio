# 자비스 로컬 도구 연동 — 2026-09-12

## 현재 상태

| 항목 | 구현과 검증 | 남은 작업 |
|---|---|---|
| PostgreSQL | Docker 전용 DB 실행, 127.0.0.1:15432 연결 확인 | 없음 |
| LangGraph | PostgreSQL 체크포인트 저장 후 새 연결에서 복원 확인 | 실제 메일 처리 그래프 구현 |
| 로컬 Hermes | 기존 설치·모델 설정 재사용 브리지 구현 | Nous 재로그인 및 모델 응답 재검증 |
| 개인 Gmail | OAuth 및 Windows 암호화 토큰 저장, 조회·답장 초안 어댑터 구현 | OAuth 클라이언트 준비, 사용자 로그인 동의, 실계정 검증 |
| LangSmith | 키 설정 및 인증된 프로젝트 조회 검사 구현 | 프로젝트/API 키 설정 및 실제 실행 추적 연결 |
| 관제 화면 | 기존 승인 목업 유지 | 실제 업무 API와 연결 |

현재 연결 설정 화면: http://127.0.0.1:8000/setup
기존 목업 화면: http://127.0.0.1:5173/work/mail-014
서버가 실행 중인 이 컴퓨터에서만 열립니다. 기존 목업의 승인 버튼은 실제 Gmail 작업을 수행하지 않습니다.

## 재실행

압축을 풀고 backend 폴더에서 PowerShell로 실행합니다. Docker Desktop을 먼저 실행합니다.

```powershell
.\start.ps1
```

첫 실행 시 의존성 설치와 개인 .env 설정을 생성합니다. 다른 컴퓨터에서는 Hermes/uv, Python 실행 환경, Docker 설치가 필요합니다. Hermes 설정·토큰·DB 데이터는 ZIP에 포함되지 않으며 자동 동기화되지 않습니다. 8000 포트가 이미 사용 중이면 실행 중인 설정 서버를 사용하세요.

목업은 프로젝트 루트에서 다음으로 실행합니다.

```powershell
npm.cmd ci
npm.cmd run dev -- --mode mock
```

## 계정 연결 순서

1. Hermes: backend 폴더에서 아래 명령을 실행하고 브라우저에서 Nous 로그인을 완료합니다. 기존 제공자와 모델 선택은 유지합니다. 현재 설정은 nous / tencent/hy3:free이며, 로그인 후 모델 호환성까지 재검증해야 합니다.

```powershell
.\connect-hermes.ps1
```

2. Gmail: Google Cloud에서 Gmail API를 켜고 OAuth 동의 화면과 데스크톱 앱 클라이언트를 준비합니다. 테스트 상태라면 개인 Gmail을 테스트 사용자로 등록합니다. 다운로드한 JSON 파일 경로를 다음 명령에 넣고 본인이 Google 로그인·권한 동의를 완료합니다.

```powershell
.\connect-gmail.ps1 -ClientFile 'C:\경로\client_secret.json'
```

JSON 원문이나 API 키를 채팅에 붙이지 마세요. 토큰은 backend/.private에 Windows 사용자 암호화로 저장됩니다. 다른 컴퓨터에서는 다시 인증해야 합니다. 앱에는 메일 발송 기능이 없으나 Google gmail.compose 권한 자체에는 발송 권한도 포함됩니다.

3. 연결 설정 화면에서 Hermes와 Gmail의 ‘연결 확인’을 누릅니다. Gmail 검사는 계정 프로필만 조회합니다. 실제 초안을 생성하지 않습니다.

4. LangSmith를 사용하려면 backend/.env의 LANGSMITH_API_KEY와 LANGSMITH_PROJECT를 로컬에서 설정하고 설정 서버를 다시 실행합니다. 현재는 인증 확인만 구현했으며 실제 메일 내용이나 실행 추적은 업로드하지 않습니다.

## 다음 구현 단계

계정 연결이 검증된 뒤 Gmail 수집 → Hermes 분류·답장 제안 → LangGraph 상태 저장 → 관제의 사람 승인 → Gmail 초안 저장을 연결합니다. 업무 API, 승인 버전 충돌 검사, 중복 실행 방지, 오류 재처리, 실제 상태 이벤트와 추적도 구현해야 합니다. 이 단계까지 끝나야 실제 업무 연동이 완료됩니다.

## 검증 및 운영 범위

- 백엔드 테스트: 요청 출처/세션 검사, 허용된 연결 대상, Gmail 초안 MIME/스레드 처리, 타임아웃 재시도 방지, 헤더 삽입 방지, Windows 암호화 왕복.
- PostgreSQL 연결 및 LangGraph 체크포인트 복원을 실제 로컬 DB로 검증했습니다.
- Hermes 실제 모델 검사는 AuthError와 재로그인 필요 상태를 반환했습니다. 응답 성공으로 처리하지 않았습니다.
- Gmail 어댑터는 모의 HTTP로 검증했습니다. 실계정 OAuth/초안 생성 검증은 아직 하지 않았습니다.
- 설정 서버는 로컬 전용입니다. 인터넷 공개나 클라우드 배포용 인증 서버가 아닙니다.
- 패키지에서 .env, .private, 인증 파일, 가상 환경, node_modules, 실행 로그를 제외했습니다. Docker DB도 별도 로컬 저장소입니다.

공식 참고: [Gmail OAuth 준비](https://developers.google.com/workspace/gmail/api/quickstart/python), [Gmail 초안 형식](https://developers.google.com/workspace/gmail/api/guides/drafts), [LangGraph 상태 저장](https://docs.langchain.com/oss/python/langgraph/persistence).

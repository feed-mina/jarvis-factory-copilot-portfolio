# 자비스 운영 설정 — 2026-09-13

## 서버에 적용하고 확인한 항목

- jarvis-collect.timer: 10분 간격, 최근 7일 받은편지함 최신 최대 10건 수집. 중복 제외. 자동 분석·승인·초안 저장·발송은 하지 않습니다.
- jarvis-backup.timer: 매일 18:00 UTC / 한국시간 다음 날 03:00, PostgreSQL custom-format 백업. 최신 14개 보관.
- jarvis-health.timer: 5분 간격 내부 API·DB 점검. 실패는 systemd 실패 상태와 operations/health.json에 기록됩니다. 외부 알림 발송은 설정하지 않았습니다.
- 백업 위치: /docker/jarvis-integration/backups. 디렉터리 700, 파일 600. 인증 키는 DB 백업에 포함하지 않습니다.
- 첫 백업을 새 jarvis_restore_* 임시 DB에 복원하고 작업 1건·이벤트 3건을 확인했습니다. 검증 후 임시 DB만 삭제했습니다.
- 서버 테스트 12개 통과. jarvis-mail 서비스 재시작 후 API 정상, 자동 수집 활성화 확인.

백업은 현재 같은 VPS 안에 있습니다. 서버 전체 손실에 대비한 외부 백업 저장소는 아직 구성하지 않았습니다. 공유 서버 전체 재부팅은 수행하지 않았습니다.

## 운영 명령

```bash
systemctl list-timers 'jarvis-*'
systemctl status jarvis-collect.service jarvis-backup.service jarvis-health.service
cd /docker/jarvis-integration/server
.venv/bin/python operations.py backup
.venv/bin/python operations.py restore-check
```

operations/*.json과 위 서비스 로그는 메일 본문·인증 키 없이 성공 여부와 건수만 기록합니다.
정기 수집 일시 중지는 systemctl disable --now jarvis-collect.timer 입니다.

## 아직 완료하지 않은 항목

1. Hostinger 제공 주소 https://jarvis.example.com 확정. 웹 로그인용 OAuth JSON 등록, HTTPS·로그인 배포 및 외부 비로그인 접근 차단 검증은 대기 중.
2. 다른 PC에서 로그인 후 사용 검증. 현재는 기존 PC의 SSH 터널 주소로 접속합니다.
3. 테스트 메일 도착 → Hermes 분석 → 사용자 내용 승인 → 실제 Gmail 초안 저장 검증.
4. 외부 백업 위치와 오류 알림 수신 방식 결정.

## 사용자가 보낼 테스트 메일

다른 Gmail 계정에서 편지쓰기를 선택합니다.

- 보내는 계정: owner@example.com
- 받는 사람: mailbox@example.com
- 제목: [Jarvis 테스트] 일정 확인
- 본문: 내일 오후 3시 일정이 가능한지 답장 부탁드립니다.

보낸 뒤 Codex에 알려주세요. 분석 후 자비스 화면에서 답장 내용과 받는 사람을 직접 검토하고 승인합니다. Gmail 초안 저장까지 확인하며 실제 발송은 하지 않습니다.

구현 참고: [PostgreSQL pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html), [systemd timer](https://github.com/systemd/systemd/blob/main/man/systemd.timer.xml), [OAuth2 Proxy 계정 제한](https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/).

## 계정 변경 반영

- Gmail 수집 대상: mailbox@example.com. 새 OAuth 승인 및 서버 계정 검증 완료.
- 웹 로그인 허용: owner@example.com, mailbox@example.com.
- 새 계정 인증 확인 후 자동 수집 타이머를 재활성화했습니다. 첫 수집 5건 성공. 백업·상태 점검도 유지합니다.
- 기존 계정의 작업은 보존하며 새 계정 목록·조회·승인 경로에서는 제외합니다.
- 웹 서버는 127.0.0.1:8011에서만 실행 중이며 허용된 로그인 헤더 없는 요청은 401을 반환합니다. Google 로그인 프록시와 공개 HTTPS는 OAuth JSON 등록 후 검증합니다.
- 추가 테스트: 서버 13개, 브리지 3개 통과.

## 웹 로그인 배포 확인

웹 OAuth JSON을 서버에 저장하고 Google 로그인 프록시를 배포했습니다. https://jarvis.example.com 의 TLS 검증 성공. 비로그인 화면·세션·메일 목록 API는 모두 Google 로그인으로 302 이동합니다. 이메일 인증 헤더를 위조한 외부 요청도 로그인으로 이동하여 차단됐습니다. 실제 허용 계정 로그인 후 화면 확인, 미허용 계정 로그인 거부 확인 및 실제 Gmail 초안 저장은 사용자 검증이 남아 있습니다. 테스트 메일은 아직 발견되지 않았습니다.

## 실제 Gmail 검증 완료

2026-09-13 사용자 웹 로그인 완료 보고 후 테스트 메일을 수집·분석했습니다. 사용자가 화면에서 승인·초안 저장한 뒤 Gmail API로 읽기 검증했습니다.

- 작업: a4a09c49-9374-487a-ba96-9cf9e316117e / saved / 버전 6
- 연결 계정: mailbox@example.com
- 수신자·제목·본문이 검토 내용과 일치
- 원래 대화 및 In-Reply-To 일치
- 해당 대화의 Gmail 초안 1개, DRAFT 상태 확인, SENT 아님
- 수집 → 분석 → 검토 → 승인 → 저장 처리 이력 확인

8단계 실제 초안 저장 검증은 완료됐습니다. 7단계 웹 로그인·HTTPS·자동 수집·서버 내 백업과 복원·상태 점검은 적용했습니다. 외부 백업 저장소, 외부 오류 알림, 미허용 Google 계정의 실제 로그인 거부 검증, 다른 PC 실사용 검증은 별도 후속 사항입니다. 위쪽 대기 표시는 이전 시점 기록이며 이 최종 결과를 우선합니다.

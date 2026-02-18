# ISSUE #75 feat: 프라이빗 방명록(게스트-관리자 1:1 대화)

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/75
- Issue 번호: 75
- 기준 브랜치: main
- 작업 브랜치: issue-75-feat-프라이빗-방명록-게스트-관리자-1-1-대화
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/issue-75-feat-프라이빗-방명록-게스트-관리자-1-1-대화
- 작성일: 2026-02-18

## 배경/문제
- 게스트가 로그인 없이 글을 남기면, 해당 게스트와 관리자만 볼 수 있는 1:1 대화 스레드(프라이빗 방명록)가 생성되어야 한다.
- 게스트는 스레드 로그인(아이디 + 비밀번호) 기반으로 자신의 스레드에서만 대화를 이어갈 수 있어야 한다.
- 관리자는 관리자 화면에서 전체 스레드 목록을 확인하고 답장할 수 있어야 한다.
- 외부 노출(검색/크롤링)을 최소화해야 한다.

## 목표
- [ ] 게스트(아이디 + 비밀번호) 기반 스레드 생성/조회/메시지 작성이 가능하다.
- [ ] 관리자(관리자 세션) 전용 스레드 목록/상세/답장 기능이 가능하다.
- [ ] 스레드/메시지 접근 제어가 우회되지 않고, 검색/크롤링 노출을 최소화한다.

## 범위
### 포함
- DB 스키마: 스레드/메시지 테이블 및 인덱스
- API: 게스트 스레드 생성/조회/메시지 추가
- API: 관리자 스레드 목록/상세/답장(admin_session 쿠키 + CSRF, 기존 관리자 API 패턴 사용)
- UI: 게스트 작성 폼 + 스레드 대화 화면
- UI: 관리자 인박스(목록) + 스레드 상세/답장 UI
- 노출 최소화: X-Robots-Tag, sitemap/robots 정책 검토 (robots.txt는 접근제어가 아니며, noindex 신호는 크롤러가 페이지를 실제로 가져갈 수 있어야 적용됨)
- 남용 완화: 최소한의 rate limit 또는 제출 빈도 제한
- 테스트: Playwright + 권한(다른 게스트 접근 불가) 테스트

### 제외
- 실시간(WebSocket) 채팅, 푸시 알림
- 일반 사용자 계정 시스템(회원가입/이메일/비밀번호 재설정/프로필 등)
- 첨부파일/이미지 업로드

## 코드베이스 매핑(초안)
- DB: `src/lib/db.ts`에 스레드/메시지 테이블 마이그레이션 추가(신규 schema version)
- 게스트 API: `src/app/api/guestbook/**/route.ts` (신규)
- 관리자 API: `src/app/api/admin/guestbook/**/route.ts` (신규, `requireAdminSession*` 패턴 사용)
- UI: 게스트 `src/app/guestbook/**`, 관리자 `src/app/admin/guestbook/**` (기존 admin page redirect 가드 패턴 사용)

## 완료 기준(DoD)
- [ ] 게스트: 스레드 생성 -> 조회 -> 메시지 추가가 가능하다.
- [ ] 게스트: 다른 스레드(다른 로그인/세션)로는 조회/작성할 수 없다.
- [ ] 관리자: 관리자 세션으로 전체 스레드 목록/상세/답장이 가능하다.
- [ ] 관리자: 상태 변경/답장 등 상태 변경 요청은 CSRF 미포함 시 403(CSRF_FAILED)로 실패한다.
- [ ] 노출 최소화: 방명록 관련 페이지/API 응답에 `X-Robots-Tag: noindex`(등) 정책이 적용된다. (정책은 관점 6에서 확정)
- [ ] 남용 완화: 최소한의 레이트리밋이 적용되고, 초과 시 429 + `Retry-After`가 동작한다.
- [ ] Playwright: 권한(다른 게스트 접근 불가/관리자만 가능) + 스크린샷(360/768/1440) 시나리오가 통과한다.

## 상세 설계(초안)
### 권한/세션 모델
- 게스트는 로그인 없이 스레드를 생성한다.
- 게스트 스레드 접근은 “세션 쿠키 보유”를 기준으로 한다.
- 게스트는 “스레드 로그인(아이디 + 비밀번호)”로 다른 기기/브라우저에서 재접속할 수 있다. (관점 6 확정)
  - 아이디: 3~20자, 소문자 정규화, `a-z0-9_`만 허용, UNIQUE
  - 비밀번호: 8~64자
  - 로그인/생성/메시지 작성에는 레이트리밋을 적용한다. (아래 정책 참고)
- 게스트 세션은 DB 기반 세션(`guestbook_sessions`)으로 관리한다. 로그인 성공 시 `session_id`를 발급하고, HttpOnly 쿠키에는 `session_id`만 저장한다.
- 관리자는 `admin_session` 기반 인증(기존 관리자 UI/API 패턴)을 사용한다.

### DB 스키마(초안)
- `guestbook_threads`
  - `id` (INTEGER PK)
  - `guest_username` (TEXT UNIQUE) : 게스트 로그인 아이디(소문자 정규화)
  - `guest_password_hash` (TEXT) : 게스트 로그인 비밀번호 해시(느린 해시)
  - `created_at`, `updated_at`
  - (옵션) `closed_at` : 스레드 종료(추후 확장)
- `guestbook_sessions`
  - `id` (TEXT PK) : 세션 ID
  - `thread_id` (INTEGER, FK -> guestbook_threads.id, ON DELETE CASCADE)
  - `created_at`, `expires_at`, `last_seen_at`
  - `ip_hash`, `user_agent` (옵션)
- `guestbook_messages`
  - `id` (INTEGER PK)
  - `thread_id` (FK -> guestbook_threads.id, ON DELETE CASCADE)
  - `role` (TEXT, CHECK: 'guest'|'admin')
  - `content` (TEXT)
  - `created_at`
  - 인덱스: `(thread_id, id)` 또는 `(thread_id, created_at)`

### API 엔드포인트(초안)
- 게스트(public)
  - `POST /api/guestbook/threads` : 스레드 생성(아이디+비밀번호 설정)
  - `POST /api/guestbook/login` : 스레드 로그인(성공 시 HttpOnly 세션 쿠키 발급)
  - `GET /api/guestbook/thread` : 내 스레드 조회(세션 쿠키 기반)
  - `POST /api/guestbook/messages` : 내 스레드에 메시지 추가(세션 쿠키 기반)
  - (옵션) `POST /api/guestbook/logout` : 세션 만료/로그아웃
- 관리자(admin)
  - `GET /api/admin/guestbook/threads` : 스레드 목록
  - `GET /api/admin/guestbook/threads/:id` : 스레드 상세 + 메시지 목록
  - `POST /api/admin/guestbook/threads/:id/messages` : 관리자 답장(CSRF required)
  - (옵션) `PATCH /api/admin/guestbook/threads/:id` : 스레드 상태 변경(예: close)

### 남용 완화(관점 6 확정: 선택 1)
- 스레드 생성: `3회/1시간/IP`
- 로그인 실패: `10회/10분/IP`
- 메시지 작성: `30회/10분/(IP+thread)`
- 초과 시 429 + `Retry-After`

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리

## 리스크 및 확인 필요 사항
- 세션 쿠키 또는 게스트 로그인 정보 유출/도난 시 스레드가 노출될 수 있다. (세션은 HttpOnly + SameSite로 보호, 만료/로그아웃 정책 필요)
- 아이디 열거/비밀번호 대입(brute force)을 줄이기 위한 레이트리밋/에러 메시지 정책이 필요하다.
- CSRF/오용을 줄이기 위한 SameSite 설정(Strict/Lax) 및 요청 검증이 필요하다.
- 스팸/남용(봇) 대응을 최소 비용으로 어디까지 할지(예: IP 기반 제한, honeypot 등) 결정이 필요하다.

## 검증 계획
- [ ] Playwright: 게스트 스레드 생성 후 동일 스레드 이어쓰기, 다른 게스트 로그인/세션으로 접근 불가, 관리자만 목록/답장 가능
- [ ] Playwright: 뷰포트 360/768/1440 스크린샷 비교(toHaveScreenshot)
- [ ] Playwright/API: 로그인 성공 시 게스트 세션 쿠키(guestbook_session 등)에 session_id가 설정된다.
- [ ] Playwright/API: (구현 시) 로그아웃 또는 세션 만료 후에는 조회/작성 요청이 401로 실패한다.
- [ ] Playwright/API: 관리자 답장/상태변경 API는 CSRF 헤더 누락 시 403(CSRF_FAILED)로 실패한다.
- [ ] Playwright/API: 게스트/관리자 방명록 관련 응답에 X-Robots-Tag(noindex 등) 헤더가 포함된다.
- [ ] Playwright: 게스트 세션 쿠키가 HttpOnly/SameSite로 설정된다(개발환경에서는 secure=false 허용).
- [ ] Playwright/API: 메시지 작성 엔드포인트 레이트리밋 동작(429 + Retry-After)을 확인한다.
- [ ] 단위/통합 테스트: 비밀번호 해시/검증, 권한 체크, DB 제약

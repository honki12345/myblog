# ISSUE #45 Feature: Add /api/inbox (POST/GET/PATCH) for iOS Shortcuts URL ingestion queue

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/45
- Issue 번호: 45
- 기준 브랜치: main
- 작업 브랜치: issue-45-api-inbox-ios-shortcuts-ingestion-queue
- Worktree 경로: .../.worktrees/issue-45-api-inbox-ios-shortcuts-ingestion-queue
- 작성일: 2026-02-16

## 배경/문제
- iOS에서 X/Tweet URL을 보다가 Share Sheet(Shortcuts)에서 1-tap으로 서버에 전달해 "수집 큐"에 적재하고 싶다.
- 서버 인입(ingestion)은 빠르게 끝내고, 실제 스크래핑/번역/발행은 별도 워커(Mac mini)가 나중에 처리한다.
- 이슈 본문(2026-02-16 업데이트) 기준 MVP 요구사항을 구현한다.
- 참고: 이슈 본문에서 언급된 `my-opencodex/x-mobile-share-to-server-mvp-plan.md`는 repo 외부 문서로 간주한다.

## 목표
- [x] iOS Shortcuts에서 호출 가능한 인입 API(`POST /api/inbox`)를 제공한다.
- [x] 워커가 큐를 가져가고 상태를 갱신할 수 있는 API(`GET /api/inbox`, `PATCH /api/inbox/:id`)를 제공한다.
- [x] URL 검증/인증/레이트리밋/로그 정책을 포함한 최소 보안 요구를 충족한다.
- [x] Curl 기반 acceptance test와 자동화 테스트로 회귀를 고정한다.

## 범위
### 포함
- `/api/inbox` API 라우트 3종(POST/GET/PATCH) 구현
- DB 테이블 `inbox_items` 추가
- 인증: `Authorization: Bearer <INBOX_TOKEN>` (기존 `BLOG_API_KEY`와 분리)
- X URL 검증/정규화
  - `https` only
  - host allowlist: `x.com`, `twitter.com`, `t.co`
  - `t.co`는 리다이렉트 follow 후 최종 host가 `x.com|twitter.com`일 때만 허용
  - path: `/status/<digits>` 또는 `/i/web/status/<digits>`
  - status id를 추출해 canonical URL(`https://x.com/i/web/status/<id>`)로 정규화 후 저장(멱등성/UNIQUE 기준)
- 레이트리밋(토큰/IP)
- 멱등성(idempotency): 동일 URL 중복 요청 처리 정책 확정 및 구현

### 제외
- 실제 스크래핑/번역/발행 워커 구현(별도)
- iOS Shortcuts 공유/배포(별도)
- CORS 정책 확장(Shortcuts는 브라우저 fetch가 아니므로 MVP에서는 필수 아님)

## 구현 단계
1. [x] 분석 및 설계 확정
2. [x] 구현
3. [x] 테스트
4. [x] 문서화/정리

### 결정 사항(확정 필요)
- [x] 중복 URL 요청 처리(확정)
  - 200 + `{ ok: true, id: <existing_id>, status: 'duplicate' }`
- [x] 레이트리밋 구현 방식(확정)
  - `src/lib/rate-limit.ts` in-memory(Map) 기반을 재사용한다. (단일 인스턴스 전제 MVP)
- [x] `inbox_items.url` 유니크 키 정책(확정)
  - status id 기반으로 canonical URL 정규화 후 저장하고, 이를 UNIQUE 키로 사용
- [x] canonical URL 저장 포맷(확정)
  - `inbox_items.url`은 항상 `https://x.com/i/web/status/<id>`로 저장한다.

### 완료 기준(DoD)
- [x] `POST /api/inbox`
  - [x] 유효 토큰 + 유효 URL(신규) -> 201, DB에 `queued`로 적재 + `{ ok: true, id, status: 'queued' }`
  - [x] 중복 URL -> 200 + `{ ok: true, id: <existing_id>, status: 'duplicate' }`, DB 중복 적재 없음
  - [x] 토큰 없음/오류 -> 401
  - [x] 유효하지 않은 URL -> 400
  - [x] 레이트리밋 초과 -> 429(`RATE_LIMITED`) + `retryAfterMs` + `Retry-After` 헤더(초 단위, `ceil(retryAfterMs/1000)`, 최소 1)
- [x] `GET /api/inbox`
  - [x] 기본값: `status=queued`, `limit=50`(max 100), 오래된 순(`id ASC`)
  - [x] status 허용값: `queued|processed|failed`
  - [x] 응답: `{ items: InboxItem[] }`
    - [x] `InboxItem` = `{ id, url, source, client, note, status, error, created_at, updated_at }`
  - [x] invalid token -> 401
  - [x] invalid query(status/limit) -> 400 `INVALID_INPUT`
  - [x] GET은 조회만 수행한다(상태 변경/claim 없음). 워커는 처리 후 `PATCH`로만 상태를 반영한다.
- [x] `PATCH /api/inbox/:id`
  - [x] `queued -> processed|failed`만 허용한다. (그 외 전이는 400 `INVALID_INPUT`)
  - [x] `status=failed`일 때 `error`를 저장할 수 있다.
  - [x] invalid token -> 401
  - [x] invalid id -> 400 `INVALID_INPUT`
  - [x] not found -> 404 `NOT_FOUND`
- [x] 토큰/민감 헤더가 로그에 남지 않는다.
- [x] 에러 응답이 기존 공통 형태 `{ error: { code, message, details } }`를 따른다.
- [x] `npm run test:all` 통과

### 세부 작업
- [x] 환경 변수/설정
  - [x] `.env.example`에 `INBOX_TOKEN` 추가
  - [x] prod에서는 secret로만 주입(문서화)
- [x] DB
  - [x] `inbox_items` 테이블 생성(`src/lib/db.ts`의 `runMigrations()`에 schema version 추가)
  - [x] 컬럼: `id`(INTEGER PK), `url`(TEXT UNIQUE), `source`(TEXT), `client`(TEXT), `note`(TEXT NULL), `status`(TEXT), `error`(TEXT NULL), `created_at`, `updated_at`
  - [x] `url` UNIQUE
  - [x] `status` 기본값 `queued`
  - [x] `created_at`, `updated_at` 저장
  - [x] 조회 성능을 위한 인덱스(예: `status, id`) 추가 검토
- [x] API
  - [x] 구현 파일 위치
    - [x] `src/app/api/inbox/route.ts` (POST/GET)
    - [x] `src/app/api/inbox/[id]/route.ts` (PATCH)
  - [x] Bearer token 검증(`INBOX_TOKEN`, 상수시간 비교)
    - [x] `src/lib/auth.ts`에 `INBOX_TOKEN` 전용 검증 함수 추가(`verifyInboxToken()` 등)
  - [x] body validation: `{ url, source: 'x', client: 'ios_shortcuts', note? }`
  - [x] X URL validation/정규화
    - [x] scheme: `https`
    - [x] host allowlist: `x.com`, `twitter.com`, `t.co`
    - [x] `t.co`는 리다이렉트 follow 후 최종 host가 `x.com|twitter.com`일 때만 허용
    - [x] 리다이렉트 제한: 최대 5 hops, 요청 타임아웃(예: 3s), hop마다 host allowlist 강제
    - [x] path: `/status/<digits>` 또는 `/i/web/status/<digits>`
    - [x] status id 추출 후 DB 저장 URL은 항상 `https://x.com/i/web/status/<id>`로 정규화
  - [x] enqueue(insert) 및 멱등성 처리
  - [x] 응답 형식: `{ ok, id, status }`
  - [x] 에러 응답: `{ error: { code, message, details } }` (기존 API 규약)
  - [x] 목록 조회(GET): `status`, `limit` 파라미터 검증 + 기본값/최대값 적용 + 오래된 순 반환
  - [x] 상태 갱신(PATCH): `queued -> processed|failed` 전이만 허용, `status=failed`에서만 `error` 저장
    - [x] `updated_at = datetime('now')` 갱신
  - [x] `export const dynamic = "force-dynamic"` 적용
- [x] 레이트리밋
  - [x] key 구성(token/ip)
    - [x] IP 식별: `x-forwarded-for` → `x-real-ip` → fallback 순으로 사용
  - [x] 적용 범위(MVP): `POST /api/inbox`에만 적용한다. (`GET`/`PATCH` 미적용)
  - [x] 기본값(권장): 10 req/60s
  - [x] env로 오버라이드: `INBOX_RATE_LIMIT_MAX_REQUESTS`, `INBOX_RATE_LIMIT_WINDOW_MS`
  - [x] 429(`RATE_LIMITED`) + `retryAfterMs` + `Retry-After` 헤더 적용(초 단위, `ceil(retryAfterMs/1000)`, 최소 1)
- [x] 테스트
  - [x] Curl 시나리오(이슈 본문 Acceptance Criteria) 문서화
  - [x] 자동화 테스트 추가
    - [x] URL validator 단위 테스트
    - [x] URL variant 케이스(`/status/<id>`, `/i/web/status/<id>`)
    - [x] `t.co` 리다이렉트 follow 로직은 네트워크 비의존 테스트로 고정
      - [x] 리다이렉트 해석 로직을 fetch 주입 가능한 함수로 분리
      - [x] 테스트에서 stubbed fetch로 최종 host allowlist 검증
    - [x] auth(401), validation(400), rate limit(429) 케이스
    - [x] UNIQUE/멱등성(중복 URL) 케이스
    - [x] 429 응답에서 `Retry-After` 헤더(초 단위)가 존재하고 `retryAfterMs`와 정합됨
    - [x] 로그 마스킹: 성공/실패 모두에서 Authorization 값/토큰 문자열이 출력되지 않음
    - [x] `scripts/test-step-3.mjs`에 `/api/inbox` 시나리오 추가(중복/검증/레이트리밋)
    - [x] `scripts/test-step-3.mjs`에서 dev 서버 실행 env에 `INBOX_TOKEN` 주입 후 시나리오에서 사용
    - [x] `scripts/test-step-3.mjs`에서 큐 소비 플로우 통합 검증
      - [x] POST(queued) -> GET(status=queued) -> PATCH(processed|failed) -> GET 반영 확인
    - [x] `scripts/test-step-3.mjs`에서 서버 stdout/stderr를 버퍼링해 로그 마스킹을 자동 단언
- [x] 문서
  - [x] `docs/codebase.md`에 `/api/inbox` 엔드포인트 및 `INBOX_TOKEN` 환경변수 반영

## 리스크 및 확인 필요 사항
- UNIQUE 충돌(동시 요청) 처리 방식(insert ignore/try-catch) 확정 필요
- 레이트리밋 in-memory는 재시작 시 초기화됨(현재 단일 인스턴스 운영이면 MVP로 수용 가능)
- `t.co` 리다이렉트 follow는 네트워크 호출이 추가되고, SSRF/redirect loop 방지(호스트 제한, 최대 횟수 제한)가 필요

## 검증 계획
- [ ] 이슈 본문 Acceptance Criteria 기반 확인(T0/T1/T3/T4/T5)
  - [ ] T0. `https://honki12345.me/api/inbox` (prod-like) curl 1회 이상 성공(200/201 + JSON)
  - [x] T1. 중복 URL이 200 + `{ ok: true, status: 'duplicate', id: <existing_id> }`로 응답
  - [x] T3. invalid token=401, invalid URL=400, rate limit=429
  - [x] T4. `/status/<id>` 및 `/i/web/status/<id>` 둘 다 허용
  - [x] T5. 성공/실패 모두에서 로그에 Authorization 값/토큰 문자열이 남지 않음
- [x] DB에 `queued -> processed/failed` 상태 전이가 정확히 기록됨
- [x] 토큰 없는 요청/잘못된 토큰이 항상 401로 차단됨
- [x] PR 전 `npm run test:all` 실행 및 실패 시 수정 후 전체 재실행

## PR 리뷰 반영 내역 (2026-02-17)
- (CodeRabbit inline #2812802454) `/api/inbox` PATCH 경로 문서 수정: `docs/codebase.md`
- (Copilot inline #2812806712) totp-setup 라우트에서 설정 오류를 JSON 에러 응답으로 처리: `src/app/api/admin/auth/totp-setup/route.ts`
- (Copilot inline #2812806740, #2812806760) inbox 요청 JSON 파싱 실패만 400으로 처리: `src/app/api/inbox/route.ts`, `src/app/api/inbox/[id]/route.ts`
- (Copilot inline #2812806775) inbox 상태 갱신을 원자적으로 처리: `src/app/api/inbox/[id]/route.ts`
- 검증: `npm run format:check`, `npm run test:all`

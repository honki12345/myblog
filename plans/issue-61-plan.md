# ISSUE #61 fix: /api/inbox 호출 시 BLOG_API_KEY 사용하면 401 (INBOX_TOKEN 분리)

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/61
- Issue 번호: 61
- 기준 브랜치: main
- 작업 브랜치: issue-61-fix-inbox-auth-blog-api-key
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/issue-61-fix-inbox-auth-blog-api-key
- 작성일: 2026-02-17

## 배경/문제
- 현재 `/api/posts`는 `Authorization: Bearer <BLOG_API_KEY>`로 인증된다.
- 반면 `/api/inbox`는 별도 토큰 `INBOX_TOKEN`을 요구한다.
- 결과적으로 iOS Shortcuts 등 클라이언트가 동일한 키(`BLOG_API_KEY`)로 `/api/inbox`를 호출하면 401이 발생한다.

## 목표
- [x] `/api/inbox` 인증을 `BLOG_API_KEY` 기반으로 통일한다. (`/api/posts`와 동일)
- [x] 문서/테스트/예시 커맨드에서 `INBOX_TOKEN`을 제거하고 `BLOG_API_KEY`로 정리한다.

## 범위
### 포함
- `/api/inbox`(POST/GET) + `/api/inbox/:id`(PATCH) 인증 로직을 `verifyApiKey()`로 변경
- `.env.example`, `docs/codebase.md`, 테스트 스크립트(`scripts/test-step-3.mjs`)의 토큰명 정리

### 제외
- admin 2FA 세션 인증(Phase 2 Step 9) 관련 변경
- 키 롤테이션/다중 키 지원 등 추가 인증 기능

## 구현 단계
1. [x] 분석
   - `verifyInboxToken()` 사용처 확인 및 제거 (사용처 0)
2. [x] 구현
   - `src/app/api/inbox/route.ts` / `src/app/api/inbox/[id]/route.ts`에서 `verifyApiKey()`로 교체
   - `src/lib/auth.ts`에서 `verifyInboxToken()` 제거
3. [x] 테스트
   - [x] `npm run test:all`
   - [x] `scripts/test-step-3.mjs`의 inbox 시나리오가 `BLOG_API_KEY`로 통과하는지 확인
4. [x] 문서화/정리
   - [x] `docs/codebase.md`: `/api/inbox` 인증 설명을 `BLOG_API_KEY`로 갱신
   - [x] `.env.example`: `INBOX_TOKEN` 제거

## 리스크 및 확인 필요 사항
- 운영 환경에서 `INBOX_TOKEN`만 사용 중인 클라이언트가 있다면 배포 후 깨질 수 있다.
  - 확인: iOS Shortcuts(및 워커) 호출 토큰이 무엇인지 점검 필요
- 배포 시 systemd 환경변수에 `BLOG_API_KEY`는 이미 존재한다고 가정한다.

## 검증 계획
- [x] 로컬에서 `Authorization: Bearer $BLOG_API_KEY`로 `/api/inbox` 호출이 성공하는지 확인 (`scripts/test-step-3.mjs`)
- [ ] prod에서 동일 헤더로 `POST /api/inbox`가 201/200을 반환하는지 확인

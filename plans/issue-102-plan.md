# ISSUE #102 feat: 댓글 태그 기반 위키 뷰 구현

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/102
- Issue 번호: 102
- 기준 브랜치: main
- 작업 브랜치: issue-102-comments-tag-wiki-view
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/issue-102-comments-tag-wiki-view
- 작성일: 2026-02-21

## 배경/문제
- AI 수집글에 달린 댓글을 태그 경로 기반으로 구조화해 위키처럼 탐색 가능한 정보 구조를 제공해야 한다.
- 위키 데이터를 별도 저장하지 않고 `post_comments`를 단일 소스(SSOT)로 유지해야 한다.
- 댓글은 관리자만 작성/수정/삭제하고, 위키 조회는 공개하되 숨김/삭제 댓글은 노출되지 않아야 한다.

## 목표
- [ ] 댓글 + 태그 기반 데이터 모델(`post_comments`, `comment_tags`)을 추가하고 SSOT 원칙을 유지한다.
- [ ] 관리자 전용 댓글 CRUD와 공개 위키 조회(`/wiki`, `/wiki/[...path]`)를 구현한다.
- [ ] 숨김/삭제 상태 제외, 카테고리 집계 반영, 테스트 자동화를 포함해 회귀를 방지한다.

## 범위
### 포함
- `post_comments`, `comment_tags` 스키마/인덱스/제약 추가 및 마이그레이션
- `/posts/[slug]` 댓글 작성/수정/삭제 UI + 태그 1개 필수 선택 UX
- 댓글 CRUD API(관리자 세션 필수)와 위키 조회 API(카테고리 트리/경로별 조회)
- 댓글 CRUD 상태 변경 API는 관리자 세션 + signed double-submit CSRF(`x-csrf-token` + `admin_csrf`)를 필수로 적용
- `/wiki`, `/wiki/[...path]` UI(브레드크럼, 원문 AI 글 링크, 반응형 레이아웃)
- 단위/통합/Playwright(`360/768/1440`, screenshot, a11y) 테스트 보강

### 제외
- 비관리자 댓글 작성/수정/삭제 권한
- 초기 MVP 범위를 넘는 대규모 캐시/선계산 테이블 도입
- 자유 입력 태그 또는 복수 태그 선택 정책 도입

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리
5. [ ] 기능/테스트 변경분에 대한 `plans/use-cases.md` 유스케이스/Traceability Matrix 동기화
6. [ ] 라우트/스키마 변경분에 대한 `docs/codebase.md`(Architecture/API/Task Context Map) 동기화

## 구현 상세 (파일 단위)
- DB 마이그레이션: `src/lib/db.ts`
  - [ ] `schema_versions` 신규 버전(예: v7) 추가
  - [ ] `post_comments`, `comment_tags` 테이블/인덱스/FK/삭제 정책 SQL 추가
  - [ ] `post_comments.deleted_at` 컬럼 추가(soft delete) 및 공개 제외 조건 인덱스 반영
  - [ ] 숨김/삭제 상태를 쿼리에서 일관되게 제외할 수 있는 컬럼/인덱스 설계 반영
- API 라우트
  - [ ] 관리자 댓글 CRUD 라우트(관리자 세션 + CSRF 필수) 추가
  - [ ] 공개 위키 조회 라우트(카테고리 트리/경로 상세) 추가
- UI 라우트
  - [ ] `src/app/posts/[slug]/page.tsx`에 댓글 작성/수정/삭제 UI(관리자 전용) 연동
  - [ ] `src/app/wiki/page.tsx`, `src/app/wiki/[...path]/page.tsx` 신규 생성
- 쿼리/헬퍼
  - [ ] 위키 트리/경로 조회 공통 헬퍼(`src/lib/*`) 추가로 중복 SQL 방지
  - [ ] 태그 path 검증/정규화 규칙 `^[a-z0-9-]+(?:/[a-z0-9-]+)*$` 적용(소문자 정규화, depth 4/segment 32/total 120 제한)
- 캐시 무효화
  - [ ] 댓글 생성/수정/삭제 시 `/wiki`, `/wiki/[...path]`, `/posts/[slug]` revalidate 규칙 명시 및 적용

## 리스크 및 확인 필요 사항
- 카테고리 집계/하위 경로 조회의 쿼리 성능 저하 가능성
- 기존 공개 페이지와 관리자 페이지 권한 노출 조건 회귀 가능성

## 결정 필요 항목 (Decision Log)
| 항목 | 현재 상태 | 결정 기한 | 적용 파일/영역 | 비고 |
| --- | --- | --- | --- | --- |
| 태그 path 허용 문자/정규화 규칙 | 확정 (`^[a-z0-9-]+(?:/[a-z0-9-]+)*$`) | 완료 | `src/lib/*`(path validator), API 입력 검증, DB 제약 | 저장 전 소문자 정규화 |
| 태그 path 최대 depth/segment 길이/전체 길이 | 확정 (depth 4 / segment 32 / total 120) | 완료 | `src/lib/*`(validator), DB CHECK 또는 앱 레벨 검증 | 과도한 depth로 인한 성능 저하 방지 |
| 댓글 삭제 정책(soft delete + hidden 병행) | 확정 | 완료 | `src/lib/db.ts`, 관리자 댓글 API, 공개 위키 조회 쿼리 | `deleted_at` 추가, `is_hidden` 유지 |
| 공개 위키 제외 조건(숨김/삭제/기타 상태) | 확정 (`is_hidden=0 AND deleted_at IS NULL`) | 완료 | 공개 위키 API/페이지 쿼리 | 회귀 시 노출 사고 위험도가 높음 |
| 위키 집계 쿼리 성능 기준(허용 응답시간/인덱스 전략) | 확정 (p95 500ms 이하, 10k 댓글/2k 경로 기준) | 완료 | DB 인덱스, wiki query helper, `scripts/test-step-11.mjs` | 기준 초과 시 인덱스/쿼리 튜닝 수행 |

## 검증 계획
- [ ] 단위 테스트: 태그 path 정규화/검증, 하위 경로 매칭, 권한 체크
- [ ] DB 통합 테스트: `scripts/test-step-2.mjs` 확장으로 `post_comments`, `comment_tags` 테이블/인덱스/FK/마이그레이션 버전 검증
- [ ] API 통합 테스트: 관리자 댓글 CRUD(세션+CSRF) + 공개 위키 조회(`/wiki`, `/wiki/[...path]`) 검증(신규 `scripts/test-step-11.mjs`)
- [ ] 통합 테스트: 댓글 생성/수정/삭제 후 위키 집계/상세 반영, 숨김/삭제 댓글 비노출, 경로 하위 조회 일치성 확인
- [ ] UI 테스트: Playwright `360/768/1440` + `toHaveScreenshot` + `@axe-core/playwright`로 `/posts/[slug]` 관리자 댓글 조작, `/wiki`, `/wiki/[...path]` 브레드크럼/원문 링크/빈 상태 검증
- [ ] 접근성 테스트: `tests/ui/accessibility.spec.ts` 대상 경로에 wiki 뷰 추가
- [ ] 성능 테스트: `scripts/test-step-11.mjs`에서 wiki 집계/경로 조회 p95 500ms 이하(10k 댓글/2k 경로 기준) 검증
- [ ] 전체 회귀: `npm run test:all` 실행 + 위키 신규 테스트 스크립트/스펙 포함 여부 확인
- [ ] 유스케이스 동기화: `plans/use-cases.md`에 위키 조회/관리자 댓글 CRUD UC와 테스트 매핑 추가

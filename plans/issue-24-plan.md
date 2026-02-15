# Issue 24 해결 계획 (재배포 시 posts 데이터 유실 방지)

> 관련 이슈: `#24` fix: 재배포 시 posts 데이터가 유실되어 상세 URL이 404로 바뀜
> 이슈 링크: <https://github.com/honki12345/myblog/issues/24>
> 작업 브랜치: `fix/issue-24-redeploy-posts-data-loss`
> 상태: Draft
> 작성일: 2026-02-15

## 1. 문제 정의

재배포 시 릴리즈 경로(`/opt/blog-v{N}`)가 교체되면서 DB 파일도 릴리즈별로 분리되어 기존 게시글이 사라진 것처럼 보이는 문제가 발생한다.

- 실제 관찰: 이전 릴리즈 DB에는 `posts > 0`, 신규 릴리즈 DB에는 `posts = 0`
- 사용자 영향: 기존 상세 URL 404, `/api/posts` 결과 0건
- 심각도: 운영 데이터 신뢰도 훼손 (High)

## 2. 목표 / 비목표

### 목표

- 재배포 후에도 기존 `posts` 데이터가 유지된다.
- DB/업로드 경로가 릴리즈 수명과 분리된다.
- 배포 파이프라인에서 데이터 유지 여부를 검증할 수 있다.

### 비목표

- DB 엔진 변경 (SQLite 유지)
- 스키마 변경/마이그레이션 구조 개편

## 3. 설계 원칙

- 영속 데이터는 릴리즈 외부 고정 경로로 분리한다.
- WAL 모드 백업/복사는 `sqlite3 .backup` 기반으로 처리한다.
- 앱은 `DATABASE_PATH`로 절대 경로를 명시해 릴리즈 경로 의존을 제거한다.
- 실패 시 즉시 이전 릴리즈로 롤백 가능해야 한다.

### 3-1. 운영 표준 경로 변경 선언

- 이번 이슈에서 운영 표준 `DATABASE_PATH`를 `/var/lib/blog/data/blog.db`로 변경한다.
- 기존 문서의 `/opt/blog/data/blog.db` 표기는 본 작업과 함께 동시 갱신한다.
  - `plans/step2-plan.md`
  - `plans/blog-architecture.md`
  - `docs/codebase.md`

### 3-2. 시스템 경계 (Repo 내/외)

- systemd 유닛 파일(`/etc/systemd/system/blog.service`) 변경은 서버 운영 작업(Repo 외)으로 분리한다.
- 본 PR에는 systemd 반영 절차와 검증 명령(`systemctl show blog`, `journalctl -u blog`)을 문서화한다.

## 4. 구현 범위

### 4-1. 배포 스크립트(`.github/workflows/deploy.yml`) 수정

- 공유 경로 도입
  - `PERSIST_ROOT=/var/lib/blog`
  - `PERSIST_DB_PATH=/var/lib/blog/data/blog.db`
  - `PERSIST_UPLOADS_PATH=/var/lib/blog/uploads`
- VM 배포 단계에서 공유 경로를 선생성/권한 설정
  - `install -d -m 755 -o blog -g blog ...`
- 릴리즈 경로의 `data`, `uploads`는 공유 경로를 가리키도록 처리
  - 디렉터리 생성 대신 심볼릭 링크로 연결
- 최초 1회 데이터/파일 이관 가드 (배포 단계 자동 수행)
  - 공유 DB가 없고 이전 릴리즈 DB가 있으면 `.backup`으로 이관
  - 공유 DB가 이미 존재하면 DB 이관은 완전 스킵(덮어쓰기 금지)
  - 공유 uploads가 비어 있고 이전 릴리즈 uploads가 있으면 최초 1회 자동 이관
  - 예시: `sqlite3 /opt/blog-v{N-1}/data/blog.db ".backup /var/lib/blog/data/blog.db"`

### 4-2. 런타임 DB 경로 고정

- PR 범위: `deploy.yml`의 원격 실행 환경 변수에 `DATABASE_PATH=/var/lib/blog/data/blog.db`를 명시 전달
- 운영 범위(Repo 외): systemd drop-in 또는 유닛 파일에 `Environment=DATABASE_PATH=/var/lib/blog/data/blog.db` 영구 반영
- (필요 시) 배포 스크립트에서 실행 전 환경 검증 로그 추가

### 4-3. 배포 검증 게이트 강화

- 배포 후 헬스체크 외 데이터 유지 검증 추가
  - 배포 전 `posts` 개수 조회
  - 배포 후 `posts` 개수 비교 (감소/0건이면 실패 처리)
- 최소 기준
  - `POST_STATUS` 기존 글 URL 200 유지
  - `/api/posts` count 유지 또는 증가

### 4-4. 운영 문서 업데이트

- `plans/step2-plan.md`의 운영 DB 경로 표준값을 `/var/lib/blog/data/blog.db`로 업데이트
- `plans/blog-architecture.md`의 systemd 예시/운영 경로를 영속 경로 정책과 일치하도록 업데이트
- `docs/codebase.md`의 운영 `DATABASE_PATH` 설명을 영속 경로 정책으로 업데이트
- `docs/runbooks/deploy-log.md`에 영속 경로 체크 항목 및 systemd 검증 명령을 추가

### 4-5. 영향 파일

- `.github/workflows/deploy.yml`
- `scripts/test-step-6.mjs`
- `docs/runbooks/deploy-log.md`
- `plans/step2-plan.md`
- `plans/blog-architecture.md`
- `docs/codebase.md`

## 5. 테스트 계획

### 5-1. 로컬 정적 검증

- `npm run test:step6` (workflow 정책/standalone 무결성 회귀)
- `scripts/test-step-6.mjs`에 workflow 정책 단언 추가
  - `/var/lib/blog` 영속 경로 문자열 존재
  - `DATABASE_PATH=/var/lib/blog/data/blog.db` 전달 문자열 존재
  - 릴리즈 내부 `data/uploads` 실디렉터리 고정 생성 대신 심볼릭 링크 처리 단언

### 5-2. 스테이징/운영 리허설

#### 시나리오 A: 최초 1회 이관 검증

1. 공유 DB 없음 + 이전 릴리즈 DB(`posts > 0`) 상태를 준비한다.
2. 재배포 1회 실행
3. 검증
   - `.backup` 이관 이후 기존 slug URL 200
   - 기존 이미지 URL 정상 응답(깨진 링크 없음)
   - `post_count_after >= post_count_before`
   - `systemctl show blog -p Environment`에서 `DATABASE_PATH=/var/lib/blog/data/blog.db` 확인

#### 시나리오 B: 재배포 멱등성 검증 (공유 DB 존재)

1. 공유 DB가 이미 존재하는 상태에서 재배포 1회 실행
2. 검증
   - 공유 DB 파일이 overwrite되지 않음(수정 시간/카운트 기반 확인)
   - 공유 uploads가 overwrite되지 않음(파일 수/수정 시간 기반 확인)
   - `post_count_after >= post_count_before`

#### 시나리오 C: 롤백 데이터 보존 검증

1. 헬스체크 실패 조건을 의도적으로 주입해 롤백 경로를 실행한다.
2. 검증
   - 롤백 후 `systemctl is-active blog`가 active
   - 기존 slug URL 200
   - `post_count_after_rollback >= post_count_before`

### 5-3. 회귀 검증

- AGENTS 규칙에 따라 기능 변경 후 `npm run test:all` 실행
- 실패 시 수정 후 전체 재실행

## 6. 롤백 계획

- 배포 실패 또는 데이터 검증 실패 시:
  - `/opt/blog`를 이전 릴리즈로 재연결
  - `systemctl restart blog`
- 데이터 경로 변경 직후 이슈 발생 시:
  - 공유 DB 백업본에서 복구 (`sqlite3 .backup`)
  - 이전 릴리즈 DB를 읽기 전용 보관
- 롤백 직후 검증:
  - `systemctl is-active blog`
  - `GET /api/posts` count 확인
  - 기존 slug URL 200 확인

## 7. 완료 기준 (DoD)

- 같은 게시글 slug가 재배포 전후 동일하게 200 응답
- 기존 이미지 URL이 재배포 전후 동일하게 정상 응답
- `/api/posts` count가 재배포 후 0으로 떨어지지 않음
- DB 파일이 릴리즈 디렉터리가 아닌 `/var/lib/blog/data/blog.db`에 고정
- 관련 문서와 테스트가 함께 업데이트됨

## 8. 실행 순서 (체크리스트)

1. 코드 변경
   - `.github/workflows/deploy.yml` 영속 경로/이관/검증 로직 반영
   - `scripts/test-step-6.mjs` workflow 정책 단언 반영
2. 문서 동기화
   - `plans/step2-plan.md`, `plans/blog-architecture.md`, `docs/codebase.md`, `docs/runbooks/deploy-log.md` 반영
3. 로컬/CI 검증
   - `npm run test:step6`
   - `npm run test:all`
4. 운영 반영(Repo 외)
   - systemd drop-in 또는 유닛에 `DATABASE_PATH` 영구 반영
5. 재배포 리허설
   - 시나리오 A/B/C 수행 및 결과 기록

## 9. 책임/산출물

### 개발 PR 산출물

- 배포/검증 코드 변경(`deploy.yml`, `test-step-6.mjs`)
- 운영 문서 동기화 변경
- 테스트 실행 결과(`test:step6`, `test:all`) 기록

### 운영 작업 산출물 (Repo 외)

- systemd `DATABASE_PATH` 반영 내역(명령/설정 파일)
- 검증 로그
  - `systemctl show blog -p Environment`
  - `journalctl -u blog`

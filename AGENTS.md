# 프로젝트 개요

AI(크론잡)가 웹 스크래핑한 정보를 자동으로 올리고, 사용자도 직접 글을 쓸 수 있는 개인 블로그.

## 기술 스택

- **프레임워크**: Next.js 16 (App Router, standalone 모드)
- **DB**: SQLite (better-sqlite3, raw SQL, WAL 모드, FTS5)
- **스타일링**: Tailwind CSS v4
- **마크다운**: unified + remark-gfm + remark-math + rehype-shiki + rehype-katex + rehype-sanitize
- **배포**: GitHub Actions → Oracle Free Tier AMD VM (1/8 OCPU, 1GB RAM)
- **배포 주소**: https://honki12345.me/
- **리버스 프록시**: Caddy (자동 HTTPS)
- **프로세스 관리**: systemd

## 프로젝트 구조

```
.
├── CLAUDE.md
├── docs/
│   ├── codebase.md              # 코드베이스 설명/운영 메모
│   └── runbooks/
│       └── deploy-log.md        # 배포/운영 로그
├── plans/
│   ├── blog-architecture.md      # 아키텍처 설계
│   ├── implementation-plan.md    # 구현+테스트+결정 통합 계획
│   ├── use-cases.md              # 유스케이스 명세 + 테스트 매핑(단일 문서)
│   └── issue-<번호>-plan.md      # 이슈별 작업 계획(계획 문서 단일 위치)
├── src/
│   ├── app/                      # App Router 페이지 & API
│   ├── lib/                      # DB, 인증, 마크다운 등 유틸
│   └── components/               # React 컴포넌트
├── scripts/                      # 마이그레이션, 테스트 스크립트
├── data/                         # SQLite DB (gitignore)
├── uploads/                      # 이미지 저장 (gitignore)
├── next.config.ts
├── package.json
├── .env.local                    # 환경변수 (gitignore)
└── .env.example                  # 환경변수 템플릿
```

## 문서 참조

- **아키텍처**: @plans/blog-architecture.md
- **구현 계획**: @plans/implementation-plan.md
- **유스케이스 명세**: @plans/use-cases.md
- **이슈 계획**: @plans/issue-<번호>-plan.md
- **코드베이스 문서**: @docs/codebase.md
- **런북/운영 로그**: @docs/runbooks/deploy-log.md
- **이슈 템플릿**: @.github/ISSUE_TEMPLATE/feature.md, @.github/ISSUE_TEMPLATE/bug.md
- **PR 템플릿**: @.github/pull_request_template.md

### 문서 디렉토리 규칙

- 계획 문서는 `plans/`에만 저장한다. (`docs/plan` 사용 금지)
- 일반 문서/운영 기록은 `docs/`에 저장한다.

---

## 커밋 컨벤션

### 원자적 커밋

- 하나의 커밋은 하나의 논리적 변경만 포함합니다.
- 커밋 단위로 revert가 가능하도록 독립적으로 작성합니다.

### 커밋 타입

| 타입     | 설명                                                |
| -------- | --------------------------------------------------- |
| feat     | 새로운 기능 추가                                    |
| fix      | 버그 수정                                           |
| style    | 코드 포맷팅, 세미콜론 누락 등 코드 변경이 없는 수정 |
| refactor | 기능 변경 없이 코드 구조 개선                       |
| docs     | 문서 수정                                           |
| test     | 테스트 코드 추가, 수정                              |
| setting  | 빌드, 패키지 매니저 등 환경 설정 관련 변경          |
| chore    | 위 타입에 포함되지 않는 기타 작업                   |

### 커밋 메시지 형식

```
{타입}: {설명}
```

- 설명은 한글로 작성합니다.
- 복잡한 변경은 본문에 Why/What을 추가합니다.

### 커밋 예시

```
feat: 글 생성 API 구현
fix: slug 중복 시 suffix 미적용 버그 수정
setting: standalone 빌드 설정 추가
docs: 구현 계획에 Phase 2 로드맵 추가
```

---

## 브랜치 컨벤션

### 브랜치 전략

| 브랜치             | 용도                                             |
| ------------------ | ------------------------------------------------ |
| `main`             | 프로덕션 배포 브랜치. 항상 배포 가능한 상태 유지 |
| `feat/{기능명}`    | 새 기능 개발                                     |
| `fix/{버그명}`     | 버그 수정                                        |
| `refactor/{대상}`  | 리팩토링                                         |
| `docs/{문서명}`    | 문서 작업                                        |
| `setting/{설정명}` | 환경 설정                                        |

### 브랜치 이름 예시

```
feat/api-posts
feat/write-page
fix/slug-duplicate
setting/ci-cd-pipeline
docs/architecture-update
```

### 규칙

- 브랜치명은 영문 소문자 + 하이픈 사용
- `main`에 직접 커밋하지 않고 PR을 통해 머지
- 머지 후 feature 브랜치는 삭제

---

## 이슈 컨벤션

### 이슈 제목 형식

```
{타입}: {설명}
```

커밋 타입과 동일한 접두사를 사용합니다.

### 이슈 라벨

- 이슈 생성 시 최소 1개 라벨(타입 라벨)을 반드시 붙입니다.
- 타입 라벨 매핑:
  - `feat:` → `feat`
  - `fix:` → `fix` (버그 성격이면 `bug`도 함께)
  - `refactor:` → `refactor`
  - `docs:` → `documentation`
  - `test:` → `test` (없으면 생성)
  - `setting:` → `setting` (없으면 생성)
  - `style:` → `style` (없으면 생성)
  - `chore:` → `chore`

- 적절한 라벨이 없으면 먼저 생성해서 붙입니다. (`gh label` 서브커맨드가 없으므로 `gh api` 사용)

```bash
# 라벨 목록
gh api repos/{owner}/{repo}/labels --paginate --jq '.[].name'

# 라벨 생성 예시
gh api repos/{owner}/{repo}/labels \
  -f name='test' \
  -f color='1D76DB' \
  -f description='테스트/QA'
```

### 이슈 생성 (CLI)

```bash
gh issue create \
  --title "feat: 기능 제목" \
  --label "feat" \
  --body "$(cat <<'EOF'
## 설명
> 무엇을 구현/수정해야 하는지

## 작업 내용
- [ ] TODO 1
- [ ] TODO 2

## 참고
- 관련 문서/코드 참조
EOF
)"
```

### 이슈 조회 (CLI)

```bash
gh issue list
gh issue view <번호>
```

---

## PR 컨벤션

### PR 작성 원칙

- PR은 하나의 기능 또는 하나의 버그 단위로 생성합니다.
- PR 제목은 커밋 타입 형식을 따릅니다: `feat: 글 생성 API 구현`
- PR 본문만 읽어도 작업 내용을 이해할 수 있도록 작성합니다.

### PR 생성 (CLI)

```bash
gh pr create \
  --title "feat: 기능 제목" \
  --body "$(cat <<'EOF'
## 관련 이슈
- close: #이슈번호

## 작업 내용
- 변경 사항 상세 기술
- 관련 파일 함께 명시

## 테스트
- 어떻게 테스트했는지 기술

## 체크리스트
- [ ] PR 제목을 형식에 맞게 작성했나요?
- [ ] 빌드가 성공하나요? (`npm run build`)
- [ ] 관련 문서를 업데이트했나요?
EOF
)"
```

---

## 주의사항

- 1GB RAM 제약: shiki 언어 10개 제한, systemd MemoryMax=400M
- better-sqlite3는 동기 API — 비동기 래핑 불필요
- standalone 빌드: `serverExternalPackages: ['better-sqlite3']` 필수
- DB 백업: `cp` 대신 `sqlite3 .backup` 사용 (WAL 안전성)
- API Key 인증: `crypto.timingSafeEqual`로 비교 (타이밍 공격 방지)
- 회귀 규칙: Step 2 이후 기능 변경/PR 전 `npm run test:all`을 실행하고, 실패 시 수정 후 전체 재실행
- UI 테스트 규칙: 수동 브라우저 확인 대신 Playwright 기반 자동화 테스트를 사용한다.
- UI 판별 기본값: Playwright 스크린샷 비교(`toHaveScreenshot`)를 사용하고, 최소 뷰포트 `360/768/1440`을 포함한다.
- UI 테스트 권장 보완: 스크린샷 비교 + 기능 assertion + 접근성 검사(`@axe-core/playwright`)를 함께 적용한다.
- UI 스크린샷 안정화: 애니메이션 비활성화, 고정 시드 데이터, 고정 타임존/로케일을 적용하고 실패 시 diff 이미지를 CI 아티팩트로 보관한다.
- 작업 시작 전 `docs/codebase.md`의 `Sync Anchor (main)`과 `Task Context Map`을 먼저 확인한다.
- 기능/테스트 변경 시 `plans/use-cases.md`의 유스케이스 명세/Traceability Matrix를 함께 갱신한다.

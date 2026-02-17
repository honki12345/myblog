# ISSUE #60 feat: 파비콘을 GitHub 프로필 이미지로 변경

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/60
- Issue 번호: 60
- 기준 브랜치: main
- 작업 브랜치: issue-60-favicon-github-avatar
- Worktree 경로: .../.worktrees/issue-60-favicon-github-avatar
- 작성일: 2026-02-17

## 배경/문제
현재 사이트 파비콘이 Next.js 기본 파비콘으로 보인다.

사이트 브랜딩을 위해 파비콘을 본인 GitHub 프로필 이미지(avatar) 기반으로 교체하고, 브라우저/OS(홈 화면 등)에서 사용하는 앱 아이콘도 함께 정리한다.

## 목표
- [ ] GitHub 프로필 이미지(avatar) 원본을 확보한다.
- [ ] 파비콘/앱 아이콘 세트를 생성한다. (예: favicon.ico, icon.png, apple-icon.png)
- [ ] Next.js(App Router) 아이콘 엔트리를 교체/추가한다.
- [ ] 주요 환경에서 아이콘 표시를 확인한다. (데스크탑 탭, iOS/iPadOS 홈 화면)
- [ ] 캐시 무효화(또는 재검증) 전략을 정해 배포 후에도 변경이 확실히 반영되게 한다.

## 범위
### 포함
- 아이콘 원본(avatar) 다운로드 및 정사각형 크롭/리사이즈
- `src/app/favicon.ico` 교체
- `src/app/icon.png` 추가(또는 교체): 범용 앱 아이콘
- `src/app/apple-icon.png` 추가(또는 교체): iOS 홈 화면 아이콘
- (필요 시) `src/app/layout.tsx`의 `metadata.icons` 적용
- 배포 후 캐시 확인/무효화 대응

### 제외
- 브랜드 리뉴얼(색/로고/타이포 등) 전반
- PWA manifest/설치형 앱(오프라인, 서비스 워커 등) 기능 확장
- Open Graph 이미지/트위터 카드 이미지 작업

## 결정 사항
- 아이콘 엔트리 방식
  - 1차: `src/app/favicon.ico`, `src/app/icon.png`, `src/app/apple-icon.png` (file-based)
  - 2차(캐시 반영이 불안정할 때만): `public/`에 버전 포함 파일명으로 두고 `metadata.icons`로 명시
  - 전환 시 주의: file-based 메타데이터는 config-based(`metadata.icons`)를 override할 수 있으므로, 2차 전략을 채택하면 `src/app/favicon.ico`, `src/app/icon.png`, `src/app/apple-icon.png`는 제거(또는 이름 변경)하고 `public/` + `metadata.icons`로만 관리한다. (`/favicon.ico` 관례 요청 대응은 `public/favicon.ico`로 유지)
- avatar 원본/관리 방식
  - GitHub avatar를 다운로드해 리포지토리에 아이콘 산출물(`src/app/*`)로 커밋한다. (빌드 시 네트워크 의존 없음)
- 홈 화면 아이콘 확인 범위
  - iOS/iPadOS 홈 화면만 확인한다. (Android 및 manifest 정리는 이번 이슈 범위에서 제외)
- Playwright 아이콘 검증 엄격도
  - `<link>` 존재 + `href` 리소스 200 응답 + `content-type`(png/ico) 확인
- 캐시/반영 전략
  - 1차: 동일 파일명 교체 후 강력 새로고침/시크릿으로 확인
  - 2차: 아이콘 파일명 버전업 + `metadata.icons` 링크 갱신
  - 참고: `icon`/`apple-icon`은 Next가 쿼리/해시 기반 캐시 bust가 적용되는 경우가 있어, 캐시 이슈는 `/favicon.ico`에서 더 강하게 체감될 수 있다.
- avatar 크롭/여백 기준
  - 원본이 정사각형이면 그대로 사용
  - 원본이 원형/여백 포함이면: 중앙 기준 정사각형 크롭 + 작은 사이즈 가독성 기준으로 여백 조정(대략 8~12%)

## 구현 단계
1. [ ] 분석 및 재현
2. [ ] 구현
3. [ ] 테스트
4. [ ] 문서화/정리

### 세부 작업
- [ ] 현재 아이콘 경로/사용 방식 확인
  - [ ] `src/app/favicon.ico` 존재 확인 및 현재 파비콘이 기본값인지 확인
  - [ ] `src/app/layout.tsx`에 `metadata.icons` 사용 여부 확인
- [ ] GitHub avatar 원본 확보
  - [ ] GitHub 프로필 페이지에서 원본 이미지 다운로드(또는 avatar URL 사용)
  - [ ] 원본이 원형/여백 포함일 경우: 결정 사항 기준으로 정사각형 크롭/여백 조정
- [ ] 아이콘 세트 생성
  - [ ] `favicon.ico`: 16/32/48 등 멀티 사이즈 포함(가능하면)로 생성
  - [ ] `icon.png`: 정사각형 PNG 준비 (예: 512x512). Next는 파일 메타데이터 기반으로 `sizes`/`type`를 설정한다.
  - [ ] `apple-icon.png`: 180x180 준비
  - [ ] 투명 배경/여백/가독성(작은 사이즈) 확인
- [ ] Next.js 아이콘 엔트리 반영
  - [ ] 1차: file-based(`src/app/*`)로 적용하고, 반영이 불안정할 때만 `metadata.icons` + 파일명 버전업으로 fallback 한다.
  - [ ] `npm run build`로 빌드 산출물/경고 확인
- [ ] 캐시 무효화/반영 확인
  - [ ] 같은 파일명 교체만으로 반영되는지 확인(브라우저 강력 새로고침/시크릿)
  - [ ] 반영이 불안정하면: 아이콘 파일명을 버전업하고(`public/` + `metadata.icons`) 링크 갱신 검토

## 리스크 및 확인 필요 사항
- 브라우저 파비콘 캐시가 강하게 남아 변경이 바로 반영되지 않을 수 있음
- 작은 사이즈(16x16/32x32)에서 식별성이 떨어질 수 있음: 여백/대비 조정 필요
- `metadata.icons` 적용 시, 일부 브라우저가 `/favicon.ico`를 추가로 요청하는 fallback 존재 가능

## 영향 파일(예상)
- `src/app/favicon.ico`
- `src/app/icon.png` (신규)
- `src/app/apple-icon.png` (신규)
- `src/app/layout.tsx` (필요 시)
- `public/*` (버전업 전략을 택할 경우)

## 완료 기준(DoD)
- [ ] 데스크탑 브라우저 탭에서 파비콘이 GitHub avatar 기반으로 표시된다.
- [ ] iOS(또는 iPadOS) 홈 화면 추가 시 앱 아이콘이 의도한 이미지로 표시된다.
- [ ] `/favicon.ico` 요청이 200으로 응답하며, 최신 아이콘으로 교체되어 있다.
- [ ] Playwright에서 아이콘 `<link>` 및 `href` 리소스 200 검증 테스트가 추가되어 통과한다.
- [ ] PR 전 `npm run test:all` 통과

## 검증 계획
- 원칙: 가능한 범위는 Playwright 기반 자동 검증으로 커버하고, iOS 홈 화면 아이콘 등 자동화가 어려운 항목만 예외로 수동 확인한다.
- [ ] 자동 검증(가능한 범위)
  - [ ] Playwright에서 `/` 렌더 후 `<link rel="icon">`, `<link rel="apple-touch-icon">` 존재를 확인하고, 각 `href` 리소스가 200으로 응답하는지 + `content-type`(png/ico)가 기대값인지 확인한다. (예: `tests/ui/favicon.spec.ts`)
  - [ ] Playwright(또는 스크립트)로 `/favicon.ico` 200 응답 확인
- [ ] 수동 확인(예외)
  - [ ] Chrome/Firefox/Safari(가능 범위)에서 탭 파비콘 확인
  - [ ] iOS에서 "홈 화면에 추가" 후 아이콘 확인
  - [ ] 캐시: 시크릿/다른 디바이스에서 확인

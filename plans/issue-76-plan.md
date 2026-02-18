# ISSUE #76 feat: /api/inbox 문서 링크(doc) 인입 지원

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/76
- Issue 번호: 76
- 기준 브랜치: main
- 작업 브랜치: issue-76-api-inbox-doc
- Worktree 경로: .../.worktrees/issue-76-api-inbox-doc
- 작성일: 2026-02-18

## 배경/문제
현재 `POST /api/inbox`는 `source="x"`(X status 링크)만 인입한다.
이를 확장해 문서(기사/블로그/문서/PDF 등) 링크도 같은 ingestion queue(`inbox_items`)로 적재할 수 있도록 `source="doc"`를 지원해야 한다.

이번 작업의 핵심은 “인입 + 안전한 URL 검증/정규화 + 중복(멱등성) 처리”까지이며, 실제 문서 스크래핑/요약/발행은 별도 워커 이슈에서 처리한다.

## 목표
- [ ] `POST /api/inbox`에서 `source="doc"` 요청을 허용한다.
- [ ] 문서 링크에 대해 안전한 URL 검증/정규화를 수행한다. (`https` only, credentials 금지, 비표준 포트 금지(없음 또는 443만), fragment 제거, `:443` canonical 저장 시 제거, SSRF 차단, 제한적 redirect follow, 추적 파라미터 제거)
- [ ] `inbox_items.url`의 UNIQUE/멱등성이 깨지지 않도록 canonical URL로 저장한다.
- [ ] 기존 `source="x"` 동작은 그대로 유지한다(회귀 금지).

## 비목표
- 문서 실제 스크래핑/요약/발행 파이프라인 구현(워커)
- 문서 컨텐츠 기반 canonicalization(본문 파싱, `<link rel=canonical>` 추출 등)
- 관리자 UI/워커 UI 추가

## 정책 결정(확정)
- [x] 문서 링크 허용 범위: 옵션 B(범용 허용 + SSRF 방지)
  - `localhost`/IP literal 또는 DNS resolve 결과가 private/loopback/link-local/reserved 대역이면 차단한다. (IPv4/IPv6)
  - SSRF 차단 대역(OWASP 권고 기반, 대표 범주):
    - loopback: `127.0.0.0/8`, `::1/128`
    - RFC1918 private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
    - link-local: `169.254.0.0/16`, `fe80::/10`
    - unique local(IPv6): `fc00::/7`
    - multicast: `224.0.0.0/4`, `ff00::/8`
    - 0.0.0.0/8 및 기타 reserved 범위는 차단한다.
    - cloud metadata(대표): `169.254.169.254`는 반드시 차단한다.
- [x] 리다이렉트 처리: 옵션 2(제한적으로 follow)
  - 최대 3회 follow + hop마다 안전 규칙/SSRF 검사 + loop 방지, 타임아웃 3s
- [x] canonicalization 범위
  - fragment(`#...`) 제거는 필수
  - 추적 파라미터만 제거(옵션 2): `utm_*`, `fbclid`, `gclid`, `msclkid` (그 외 query는 유지)

## 구현 범위
### 포함
- API 스키마 확장
  - `src/app/api/inbox/route.ts`: `source`를 `z.enum(["x","doc"])`로 확장
  - `source="x"`: 기존 `normalizeXStatusUrl()` 유지
  - `source="doc"`: 신규 `normalizeDocUrl()` 적용
- DB
  - `inbox_items.url` UNIQUE/멱등성 기준은 유지한다(정규화된 canonical URL 문자열).
  - `inbox_items.source`는 DB CHECK 제약이 없어 `source="doc"` 추가를 위해 스키마 마이그레이션은 필요 없다. (허용값 제한은 API 레벨에서 수행)
- 문서 URL 정규화/검증
  - `src/lib/inbox-url.ts`에 `normalizeDocUrl()` 추가(또는 파일 분리)
  - 안전 규칙: `https` only, credentials 금지, 비표준 포트 금지(없음 또는 443만), 길이 제한, fragment 제거, `:443` canonical 저장 시 제거
  - SSRF 방지(옵션 B): `localhost`/IP literal 및 DNS resolve 결과가 private/loopback/link-local/reserved 대역이면 차단
  - 리다이렉트 follow(옵션 2): 최대 3회 follow + hop마다 안전 규칙/SSRF 검사 + loop 방지, 타임아웃 3s(HEAD 우선, 405/501이면 GET)
  - query canonicalization(옵션 2): 추적 파라미터(`utm_*`, `fbclid`, `gclid`, `msclkid`) 제거
- 테스트
  - `scripts/test-step-3.mjs`: `source="doc"` 인입(201)/중복(200)/invalid(400) 시나리오 추가
  - `normalizeDocUrl()` 케이스 고정(허용/차단)
  - 회귀: 기존 `source="x"` 시나리오 유지
- 문서 업데이트
  - `docs/codebase.md`에 `source="doc"` 및 정책(SSRF/redirect/query) 기록
    - `/api/inbox` 엔드포인트 설명/예시 업데이트(Endpoints 표, Inbox curl quickstart)
    - doc URL 정규화/검증 규칙 및 canonical 저장 규칙을 명시한다.

### 제외
- 문서 실제 처리 워커(스크래핑/요약/발행)
- 문서 canonicalization 고도화(페이지 fetch 및 canonical tag 기반)

## 설계안
1. 요청 스키마(초안)
- `{ url, source: "x" | "doc", client: "ios_shortcuts", note? }`
- 기존 클라이언트(iOS Shortcuts) 호환을 유지하되, 필요 시 `client` 확장은 별도 이슈로 분리

2. `normalizeDocUrl(input, options?)`
- `new URL()` 파싱 실패/빈 문자열/과도한 길이(>2048) 차단
- `https:`만 허용
- `username` 또는 `password` 포함 시 차단 (예: `https://u@...`, `https://u:p@...`)
- 비표준 포트 포함 차단 (없음 또는 443만)
- `hash`는 항상 제거(예: PDF `#page=1` 등)
- SSRF 방지(옵션 B): `localhost`, loopback, RFC1918, link-local 등으로 resolve되는 호스트 차단(실행/성능/캐시 전략 포함)
  - 구현 스케치:
    - `normalizeDocUrl(input, { resolveHostname? })` 형태로 resolver 주입을 허용한다. (기본 구현은 Node `dns.lookup(hostname, { all: true })` 래핑)
    - URL의 hostname이 IP literal인 경우에도 동일 규칙으로 차단/허용을 판정한다.
    - resolve 결과가 private/loopback/link-local/reserved 대역을 포함하면 차단한다. (IPv4/IPv6 모두)
  - 테스트 스케치:
    - 네트워크 비의존으로 고정하기 위해 `resolveHostname`를 stub으로 주입해 public/private IP 케이스를 단언한다.
- 리다이렉트 follow(옵션 2)
  - `normalizeDocUrl(input, { fetch?, maxRedirects?, timeoutMs?, resolveHostname? })` 형태로 fetch 주입을 허용한다. (기본 구현은 global `fetch`)
  - 최대 3회 follow, 타임아웃 3s
  - `timeoutMs`는 hop(각 요청)별로 적용한다. (HEAD 및 405/501 fallback GET에도 각각 적용)
  - HEAD 우선으로 확인하고, 405/501이면 GET으로 fallback한다.
  - hop마다 안전 규칙/SSRF 검사를 수행하고, redirect loop 및 too many redirects를 차단한다.
- query canonicalization(옵션 2)
  - `utm_*`, `fbclid`, `gclid`, `msclkid` 파라미터를 제거하고 나머지는 유지한다. (query 정렬/재배치는 하지 않는다)
- canonical은 `url.toString()` 기반으로 저장하되, `:443`은 허용하더라도 저장 시 port는 제거한다(멱등성).

3. 멱등성/중복 처리
- 기존 `INSERT OR IGNORE` + existing id 조회 + `status: "duplicate"` 응답 정책을 `source="doc"`에도 동일 적용
- UNIQUE 기준은 “정규화된 canonical URL 문자열”로 고정

## 리스크 및 확인 필요 사항
- 범용 허용(옵션 B)은 SSRF 방지 구현/테스트가 까다롭고, DNS/네트워크 의존성이 생길 수 있음
- 추적 파라미터 제거는 멱등성에 유리하지만, 제거 대상 목록은 운영 중 확장이 필요할 수 있음
- 리다이렉트 follow는 네트워크 호출 증가 + loop/타겟 안전성(SSRF 포함) 검증 필요

## 테스트 계획
- [ ] `normalizeDocUrl()` 유닛 성격 테스트(허용/차단)
  - [ ] 허용: `https://example.com/a#b` -> fragment 제거(`https://example.com/a`)
  - [ ] 허용: `https://example.com:443/a#b` -> fragment 제거 + default port 제거(`https://example.com/a`) (멱등성)
  - [ ] 허용: `https://example.com/a?utm_source=x&x=1#b` -> `https://example.com/a?x=1` (추적 파라미터/fragment 제거)
  - [ ] 차단: `http://...`
  - [ ] 차단: credential 포함(`https://u:p@...`)
  - [ ] 차단: credential 포함(`https://u@...`)
  - [ ] 차단: 비표준 포트(`https://example.com:8443/...`)
  - [ ] 리다이렉트 follow: stubbed fetch로 302 hop을 구성해 최종 URL로 canonicalize 되는지 단언한다.
  - [ ] SSRF 차단: `resolveHostname` stub으로 대표 차단 케이스(`127.0.0.1`, `10.0.0.1`, `169.254.169.254`, `::1`, `fe80::1`, `fc00::1`) 및 public IP 허용 케이스를 단언한다.
- [ ] API 시나리오
  - [ ] `source="doc"` + 유효 URL(신규) -> 201 + `{ ok: true, id, status: "queued" }`
  - [ ] 동일 canonical URL -> 200 + `{ ok: true, id: <existing_id>, status: "duplicate" }`
  - [ ] fragment만 다른 doc URL 2회 요청이 200 duplicate로 합쳐진다(멱등성).
  - [ ] 추적 파라미터만 다른 doc URL 2회 요청이 200 duplicate로 합쳐진다(멱등성).
  - [ ] 유효하지 않은 URL -> 400
  - [ ] `GET /api/inbox` 응답 아이템에 `source="doc"`가 포함된다.
  - [ ] `resolveHostname` stub 주입으로 public/private resolve 케이스를 단언한다. (SSRF 방지)
- [ ] 회귀: 기존 `source="x"` 시나리오가 그대로 통과
- [ ] `npm run test:step3` 통과
- [ ] PR 전 `npm run test:all` 통과

## 완료 기준(DoD)
- [ ] `POST /api/inbox`에 `source="doc"` + 유효 `https` 문서 URL을 보내면 201로 적재된다.
- [ ] 동일 canonical URL 재요청 시 DB 중복 적재가 없다(멱등성).
- [ ] `http://`, credential 포함 URL, 비표준 포트 등은 400으로 차단된다.
- [ ] SSRF 차단 대상(예: `localhost`/IP literal 또는 내부망/loopback/link-local/reserved로 resolve)은 400으로 차단된다.
- [ ] 리다이렉트 URL은 최대 3 hop follow 후 최종 URL이 canonical로 저장된다(안전/SSRF 검사 통과 시).
- [ ] `utm_*`, `fbclid`, `gclid`, `msclkid`는 canonical 저장 시 제거되어 멱등성에 반영된다.
- [ ] 기존 `source="x"`는 동일하게 동작한다.
- [ ] `docs/codebase.md`에 정책/환경변수 및 사용법이 반영된다.

## PR 리뷰 반영 내역 (2026-02-18)

- CodeRabbit: DNS rebinding(TOCTOU) SSRF 우회 가능성 지적
  - 반영: redirect hop fetch 시 `undici.Agent(connect.lookup)`를 사용해 lookup 결과 IP로 연결을 pin 하도록 변경
  - 변경: `src/lib/inbox-url.ts`
  - 테스트: `npm run test:step3`
- CodeRabbit: redirect 이후 최종 canonical URL이 2048 제한을 우회할 수 있음 지적
  - 반영: 최종 `canonicalUrl` 길이 재검증(>2048 차단) + 유닛 테스트 추가
  - 변경: `src/lib/inbox-url.ts`, `scripts/test-step-3.mjs`
  - 테스트: `npm run test:step3`

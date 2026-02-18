# ISSUE #95 /api/inbox source=doc INVALID_INPUT(fetch failed) 대응 계획

## 메타 정보
- Issue URL: https://github.com/honki12345/myblog/issues/95
- Issue 번호: 95
- 기준 브랜치: main
- 작업 브랜치: issue-95-bug-api-inbox-source-doc-returns-invalid-input-fetch-failed-in-production
- Worktree 경로: /home/fpg123/Workspace/honki12345/.worktrees/issue-95-bug-api-inbox-source-doc-returns-invalid-input-fetch-failed-in-production
- 작성일: 2026-02-18

## 배경/문제
- 운영 환경에서 `POST /api/inbox` 요청 시 `source="doc"` 경로만 `INVALID_INPUT`(`reason: "fetch failed"`)로 실패한다.
- 동일한 토큰/환경에서 `source="x"`는 `queued`로 성공한다.
- `src/lib/inbox-url.ts`의 undici DNS lookup callback 호환 수정(`5f96fe1`)이 배포본에 반영되지 않았거나, 동일 경로에서 fetch 예외가 충분히 관찰되지 않는 가능성이 있다.

## 목표
- [ ] 운영 환경 `source="doc"` 요청이 정상적으로 `queued` 또는 후속 정상 상태로 진행되도록 복구한다.
- [ ] 원인(배포 리비전 불일치/네트워크 fetch 실패/검증 로직 문제)을 코드와 로그로 식별 가능하게 만든다.

## 범위
### 포함
- `/api/inbox`의 `source="doc"` URL 정규화/검증/패치(fetch) 경로 점검
- undici lookup callback 호환 코드 반영 여부 확인
- 입력 계약 확정: 클라이언트는 `source`를 보내지 않고 서버가 URL 기준으로 `x/doc`를 분기하도록 정리, legacy `source` 명시 payload는 즉시 `400 INVALID_INPUT`으로 거부
- 실패 시 원인 파악 가능한 서버 로그 또는 에러 details 개선
- 재현 케이스 기반 회귀 테스트 추가 또는 보강

### 제외
- `source="x"` 처리 경로 기능 변경
- 인프라 전면 재구성(Caddy/systemd 구조 변경 등)
- 이번 이슈와 무관한 UI 개선

## 구현 단계
1. [ ] 분석 및 재현: 재현 요청 payload/응답, 서버 로그, 배포 리비전 정보를 수집해 원인 가설별 증적을 확보
2. [ ] 구현: `/api/inbox` 입력 계약(source 서버 자동 분기) 및 doc lookup/fetch 예외 처리·호환 코드 반영
3. [ ] 테스트: `test:step3`/`test:all` 및 운영 유사 시나리오로 원인 분기별 결과를 확인
4. [ ] 문서화/정리: `docs/runbooks/deploy-log.md` 포함 운영 확인 결과와 최종 원인/조치 내역 기록

## 리스크 및 확인 필요 사항
- 운영 배포 리비전이 로컬/원격 저장소 기준과 다를 수 있어 코드 수정만으로 즉시 해소되지 않을 수 있음
- 외부 문서 URL의 DNS/리다이렉트/차단 정책에 따라 환경별 재현 편차가 있을 수 있음
- Node 20+ `autoSelectFamily` 경로에서 custom lookup callback이 `options.all=true`를 받을 수 있으며, 콜백 형식 불일치 시 `fetch failed`로 이어질 수 있음
- 확인 필요: 현재 운영 서버가 commit `5f96fe1` 이후 리비전으로 배포되어 있는지
- 문서화 필요: 운영 리비전 검증 결과(배포 run-id, release-path, 서버 반영 커밋 SHA, 확인 시각)를 `docs/runbooks/deploy-log.md` 형식에 맞춰 기록해야 함

## 검증 계획
- [ ] 단위/통합 테스트: `source="doc"` 성공/실패 케이스 및 details reason 검증
- [ ] 통합 테스트 안정화: `INBOX_DOC_TEST_STUB_NETWORK=1`로 `source="doc"` 경로 회귀를 우선 검증하고, 별도 스모크로 실제 네트워크 경로 1건 확인
- [ ] Node 20+/22 재현 검증: lookup `options.all=true` 경로를 강제로 재현해 `source="doc"` 실패/성공을 확인하고, 원인 분기(배포 미반영 vs callback 형식 불일치)를 로그로 구분
- [ ] API 계약 검증: 클라이언트에서 `source` 미전송 payload가 서버 자동 분기로 `queued` 처리되는지 확인
- [ ] 계약 엄격성 검증: legacy `source` 명시 payload가 `400 INVALID_INPUT`으로 즉시 거부되는지 확인
- [ ] 운영 원인 분기 판정 기준 고정: (a) 서버 반영 커밋 SHA, (b) doc normalize 에러 reason, (c) source 자동 분기 결과를 동일 요청 ID로 대조
- [ ] API 시나리오 검증: 실운영 도메인에서 운영과 동일 payload(클라이언트 `source` 미전송)로 `/api/inbox` 직접 호출 1건 확인
- [ ] 회귀 검증: `npm run test:all` 전체 통과 확인

## 완료 기준 (Definition of Done)
- [ ] 운영 환경에서 `source` 미전송 payload 1건 이상이 `queued`로 처리됨을 확인
- [ ] 원인 분기 결론 1개(배포 미반영 / callback 형식 불일치 / 기타)를 확정하고 근거 로그를 남김
- [ ] `npm run test:step3` 및 `npm run test:all` 통과
- [ ] legacy `source` 명시 payload 즉시 거부(`400 INVALID_INPUT`) 동작을 검증
- [ ] `docs/runbooks/deploy-log.md`와 관련 문서에 최종 반영 내역 기록

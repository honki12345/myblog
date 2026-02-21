# Deploy Log Runbook

Append one line per production deployment.

Format:
`run-id | deployed-at(UTC/KST) | release-path | result`

## Pre-deploy checklist

- [ ] Oracle VM is prepared (Node.js 22, Caddy, `blog` systemd service).
- [ ] Release directories are ready (`/opt/blog-v{N}` strategy).
- [ ] Persistent directories are ready (`/var/lib/blog/data`, `/var/lib/blog/uploads`).
- [ ] GitHub Secrets are set (`BLOG_DOMAIN`, `VM_HOST`, `VM_USER`, `VM_SSH_KEY`).
- [ ] Rollback target exists (`/opt/blog-v{N-1}` or current `/opt/blog` symlink target).
- [ ] systemd environment includes `DATABASE_PATH=/var/lib/blog/data/blog.db` (`systemctl show blog -p Environment`).

## Deploy log

| run-id | deployed-at(UTC/KST) | release-path | result |
| ------ | -------------------- | ------------ | ------ |

## Issue #95 조사 기록 (2026-02-18)

- 대상: `POST /api/inbox` `source="doc"` 경로 `INVALID_INPUT(reason: fetch failed)` 대응
- 코드 기준 원인 분기 결론:
  - Node 20+/22에서 undici lookup callback이 `options.all=true`로 호출될 때, pinned lookup callback이 단일 주소 시그니처만 반환하면 `fetch failed`로 이어질 수 있음
  - 클라이언트 `source` 명시 payload와 서버 계약 불일치가 함께 존재해 운영 원인 식별이 어려웠음
- 조치:
  - `/api/inbox` 입력 계약을 `source` 미전송 + URL 호스트 기반 서버 자동 분기(`x/doc`)로 변경
  - legacy `source` 필드는 즉시 `400 INVALID_INPUT`으로 거부
  - normalize 실패 응답 details에 `requestId`, `source`, `reason`을 포함하고 서버 로그에 `deployRevision`, `source`, `host`, `requestId`를 함께 기록
  - `src/lib/inbox-url.ts` lookup callback을 `options.all=true` 경로(주소 배열 반환 시그니처)까지 호환
- 검증:
  - `npm run test:step3` PASS (2026-02-18)
  - `npm run test:all` PASS (2026-02-18, 8m 35s)
- 운영 확인 필요(배포 후):
  - 서버 반영 커밋 SHA(`BLOG_RELEASE_SHA` 또는 `GIT_COMMIT_SHA`) 확인
  - 실운영 도메인에서 `source` 미전송 payload로 `/api/inbox` 1건 이상 `queued` 확인

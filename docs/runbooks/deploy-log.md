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

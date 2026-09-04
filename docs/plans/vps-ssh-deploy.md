# OVH VPS deploy on main (SSH)

## Progress

- [x] Add reusable deploy workflow (SSH pull/up/migrate)
- [x] Wire deploy into [`.github/workflows/release.yml`](../../.github/workflows/release.yml) after `publish-images`
- [x] Document required GitHub secrets + VPS assumptions
- [x] Short README blurb under Deployment

## Todos

- [x] Create `.github/workflows/deploy-vps.yml` (`workflow_call` + `workflow_dispatch`, SSH pull/up/migrate)
- [x] Add `deploy-vps` job to `release.yml` needing `publish-images`, `secrets: inherit`
- [x] Write this plan with Progress, secrets, and VPS assumptions
- [x] Add short CI deploy note under README Deployment section

## Context

Every push to `main` publishes `backend-latest` / `frontend-latest` to GHCR via
`release.yml` → `docker-publish.yml`, then SSHs into the OVH VPS and rolls the
already-running default compose stack forward (frontend on :80, no TLS).

## Remote commands

The deploy job runs this on the VPS (non-interactive):

```bash
set -euo pipefail
cd "$DEPLOY_PATH"
git fetch origin main
git reset --hard origin/main
docker compose pull
docker compose up -d --force-recreate
docker compose exec -T backend alembic upgrade head
```

`.env` is untracked, so `git reset --hard` does not overwrite it.

The VPS runs the **default** [`docker-compose.yml`](../../docker-compose.yml)
stack (`wardrobe-frontend` on `:80`), not `docker-compose.prod.yml`. When a
domain exists and you move to prod+TLS, change these commands accordingly.

### Deviations from the plan

- Deploy uses default `docker-compose.yml`, not prod+TLS: the VPS serves the
  site on the public IP via `wardrobe-frontend:80` with no Caddy/nginx.
- Deploy uses `up -d --force-recreate` so containers actually pick up new
  `:latest` image digests (plain `up -d` left 10-day-old containers running).
- Docker Publish builds `linux/amd64` only (dropped `linux/arm64` + QEMU).
  Multi-arch arm64 via QEMU hung ~58m on `npm ci` with
  `Illegal instruction`; the OVH VPS is `x86_64`.

## GitHub secrets / variables

Set these once under the repo Settings:

| Name | Type | Purpose |
|------|------|---------|
| `VPS_HOST` | secret | OVH public IP or hostname |
| `VPS_USER` | secret | SSH user (e.g. `ubuntu` / `debian`) |
| `VPS_SSH_KEY` | secret | Private key for a deploy-only user (ed25519 preferred) |
| `VPS_SSH_PORT` | secret (optional) | Defaults to `22` if omitted |
| `VPS_DEPLOY_PATH` | variable | Absolute path to the clone, e.g. `/opt/wardrowbe` |

Manual redeploy: Actions → **Deploy VPS** → Run workflow.

## VPS assumptions

- Deploy directory is a git clone of this repo on `main`.
- Deploy user can `git fetch` (deploy key or HTTPS token with `contents:read` if the repo is private).
- Deploy user can run `docker compose` without interactive sudo (docker group or root).
- If GHCR packages are private, the VPS is already logged in to `ghcr.io` (same as for manual pulls).
- Stack is `docker compose` with default `docker-compose.yml` (not prod/TLS).

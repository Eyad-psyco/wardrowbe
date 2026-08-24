# VPS deployment with email + password authentication

## Progress

- [x] Establish what production auth actually exists in the codebase
- [x] Weigh an external OIDC provider against building password auth into the app
- [x] `password_hash` column + migration (`e9f0a1b2c3d4`)
- [x] Password hashing helpers with a 72-byte bcrypt guard
- [x] Signed, single-use signup invites (no invites table)
- [x] `POST /auth/login`, `POST /auth/register`, `POST /auth/invites`
- [x] `scripts/manage_users.py` for bootstrapping and password resets
- [x] NextAuth password provider, login form, `/register` page, EN strings
- [x] `Caddyfile` + `docker-compose.tls.yml` for automatic TLS
- [x] Point the prod stack at this fork's images instead of upstream's
- [x] Remove the dead forward-auth config that advertised protection nothing enforced
- [x] Tests (25 backend, 4 frontend) and verification against the running stack
- [x] Point every compose file at this fork's images, not just prod
- [x] Show one credential form at a time (dev form was doubling up with password)
- [ ] Deploy on the VPS and confirm login (needs a real domain — owner action)

## Background: what auth existed

The app had **no email + password authentication**, and no password column on
`users`. `Settings.get_auth_mode()` returned exactly three values:

| mode | trigger | prod-safe |
|---|---|---|
| `oidc` | `OIDC_ISSUER_URL` + `OIDC_CLIENT_ID` | yes |
| `dev` | `DEBUG=true` and no OIDC | **no** — any email, no password |
| `unknown` | neither | nobody can authenticate |

`dev` is not a weak password login, it is *no* password login: the
`dev-credentials` provider returns a valid user for any email string.

### Why the auth lives in the backend

The first pass ran [dex](https://dexidp.io) as an in-stack OIDC provider, on the
reasoning that password handling is worth not writing yourself. That was
reconsidered and dropped, because in *this* codebase the argument is much weaker
than it looks:

- The backend is **already the token issuer**. `create_access_token()` and
  `decode_token`/`get_current_user` already mint and validate the HS256 JWT that
  every API call carries. OIDC is consulted exactly once, at `/auth/sync`. An
  identity provider would have supplied one bcrypt comparison.
- This repo is a fork that **already carries its own migrations**, so "don't
  touch upstream's schema" did not apply.
- It deletes more than it adds: no second container, no second hostname or
  certificate, no ACME dependency for *logging in*, and none of the
  container-reaches-the-issuer config this repo already carries
  (`OIDC_HOST`, `OIDC_HOST_IP`, `LOCAL_DNS`, `OIDC_CA_BUNDLE`,
  `OIDC_SKIP_SSL_VERIFY`).

OIDC support is untouched and still works; `password_hash` is nullable, so OIDC
and local accounts coexist.

## How it works

**Sign-in.** The NextAuth `password` provider posts to `/auth/login`, which
verifies the bcrypt hash and returns the same `UserSyncResponse` the OIDC path
returns. The `jwt` callback short-circuits on the token it already holds rather
than calling `/auth/sync`, which would reject it (no `id_token`, not dev mode).

**Signup is invite-only.** There is no public registration. An invite is a
short-lived JWT signed with `SECRET_KEY` naming exactly one email address:

- The email comes from the *signed token*, never the request body, so holding
  one invite cannot register a different address (covered by
  `test_email_comes_from_invite_not_body`).
- Single use falls out of the existing unique constraint on `users.email`: the
  token can only ever create the one account it names, so a replay hits a 409.

That is why there is no `signup_invites` table — the constraint that makes
invites single-use already existed.

**Rate limits.** `/auth/login` is 10 per IP per 5 minutes and `/auth/register` 5
per IP per hour, using the Redis limiter that was already in `auth.py`.

**Enumeration.** A wrong password and an unknown email return byte-identical
401s, and an OIDC-only account (no hash) fails the same way.

## Files

| File | Purpose |
|---|---|
| `backend/app/utils/password.py` | bcrypt hash/verify, length policy |
| `backend/app/utils/invite.py` | signed invite tokens |
| `backend/app/api/auth.py` | `/auth/login`, `/auth/register`, `/auth/invites` |
| `backend/scripts/manage_users.py` | create user, set password, mint invite |
| `backend/migrations/versions/e9f0a1b2c3d4_*.py` | nullable `password_hash` |
| `frontend/lib/auth.ts` | NextAuth `password` provider |
| `frontend/app/register/page.tsx` | invite redemption |
| `Caddyfile`, `docker-compose.tls.yml` | automatic TLS |

## Deploying

1. Point an A record for `APP_DOMAIN` at the VPS, and open ports 80 and 443.
2. Publish this fork's images — run the **Docker Publish** workflow
   (`workflow_dispatch`, or cut a release). The prod stack now defaults to
   `ghcr.io/eyad-psyco/wardrowbe`; override with `IMAGE_REPO` if you push
   elsewhere.
3. Fill in the `.env` blocks documented at the bottom of `.env.example`. Use
   `openssl rand -hex 32` for `SECRET_KEY` and `NEXTAUTH_SECRET`.
4. Start and migrate:
   ```
   docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml pull
   docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
   docker compose -f docker-compose.prod.yml exec backend alembic upgrade head
   ```
5. Create the first account (nothing else can — signup is invite-only):
   ```
   docker compose exec backend python scripts/manage_users.py \
       create you@example.com --display-name "You"
   ```
6. Confirm: `curl -s https://<domain>/api/v1/auth/status` → `{"configured":true,"mode":"password"}`

Adding someone: `manage_users.py invite them@example.com` prints a
`/register?token=…` link, or any signed-in user can call `POST /auth/invites`.

## Verification performed

Against the running dev stack:

- 25 new tests in `backend/tests/test_password_auth.py`, all passing
- existing `test_auth.py`, `test_oidc.py`, `test_users.py` — 50 passing, so the
  OIDC and dev paths are unaffected
- `npx tsc --noEmit` clean
- live API: correct password issues a token that opens `/auth/session` (200);
  wrong password, unknown email, and an OIDC-only account all return an
  identical 401; invite → register → replay returns 409; a forged invite and a
  5-character password are rejected

Known-failing, both **pre-existing and unrelated**:

- `tests/i18n-dynamic-keys.test.ts` and `npm run i18n:check` fail because
  non-English catalogs lag English. Already failing at HEAD
  (`wardrobe.uploadQueue.cancel` exists in `en`, not in `de`), and CLAUDE.md
  requires English-only string additions, so this change adds to it by design.
- `tests/utils.test.ts` timed out during a full run under concurrent build load;
  it passes 16/16 on its own.

Not verified: the deployed stack behind a real domain and certificate.

## Deviations from the plan

- **Dropped dex after building it.** See "Why the auth lives in the backend".
  The dex config, the second hostname, and the base64 hash workaround it needed
  are all gone.
- **No invites table.** Signed tokens plus the existing unique email constraint
  give single-use invites with no new schema. Marked with a `ponytail:` comment
  in `invite.py`: there is no revocation list, so killing an outstanding invite
  early means rotating `SECRET_KEY`. Add a table with a `used_at` column if
  revocation or auditing is ever needed.
- **`FamilyInvite` was not reused.** It looked like the obvious existing model,
  but `family_id` and `invited_by` are both NOT NULL, and the very first account
  has neither an inviter nor a family. Loosening upstream's table to bootstrap
  signup would have conflated "join my family" with "create an account".
- **`UserSyncResponse` gained `external_id`.** `session.user.id` is expected to
  be the external id, not the row UUID (see the comment in
  `dashboard/family/page.tsx`), and the login response had no way to supply it.
- **Prod pulled upstream's images (pre-existing bug, fixed here).**
  `docker-compose.prod.yml` hardcoded `ghcr.io/anyesh/wardrowbe`, so a deploy
  would have run upstream's app without any of this fork's features — and
  without this auth code. Now `${IMAGE_REPO:-ghcr.io/eyad-psyco/wardrowbe}`.
- **Removed dead forward-auth config.** `AUTH_TRUST_HEADER`,
  `AUTH_HEADER_NAME: Remote-User` and `AUTH_TRUST_PROXY` were read by nothing —
  no matching field on `Settings` — while `docker-compose.prod.yml` claimed
  "auth is handled by external proxy". Fronting the stack with a forward-auth
  proxy on that basis would have left the API unauthenticated.
- **`NODE_TLS_REJECT_UNAUTHORIZED` flipped back to `1`** in the TLS overlay; the
  prod default of `0` disables TLS verification for every outbound request the
  frontend makes.
- **Two sign-in forms appeared in development.** `docker-compose.yml` sets
  `DEV_MODE` from `DEBUG`, so locally the dev provider and the new password
  provider both registered and the login page rendered both forms. The dev form
  now renders only when password auth is off, since a working password login
  supersedes it. Covered by `frontend/tests/login-forms.test.tsx`, which asserts
  exactly one credential form in each provider combination.
- **`docker-compose.yml` also pulled upstream images.** Only
  `docker-compose.prod.yml` was fixed at first; the base file's three image
  references were still `ghcr.io/anyesh/wardrowbe`. The dev overlay builds from
  source so local work was unaffected, but a plain `docker compose up` would
  have pulled upstream. All of them now use
  `${IMAGE_REPO:-ghcr.io/eyad-psyco/wardrowbe}`. The `k8s/` manifests were left
  alone — they reference neutral `wardrobe/backend:latest` placeholders, not
  upstream. The buymeacoffee links are upstream author attribution and were also
  left alone.
- **`PASSWORD_AUTH_ENABLED` wired into `docker-compose.yml` too**, so the switch
  works in the dev stack and not only in production. Verified: with it off, both
  `/auth/login` and `/auth/register` return 404 and `/auth/config` reports
  `password_enabled: false`.

## Not done

- **Password reset by email.** Resets are `manage_users.py set-password`. The
  SMTP settings already exist if you later want a reset link — it would reuse
  the same signed-token trick as invites.
- **Account lockout.** Only per-IP rate limiting; there is no per-account lock
  after N failures, so a distributed attacker is throttled per source, not per
  target. Fine at this size, worth revisiting if the instance grows.
- **Backups** of the postgres and uploads volumes — unrelated to auth, but the
  next thing worth setting up on a VPS.

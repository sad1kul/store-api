# Smoke Time Store API

Backend REST API service for Smoke Time Store — South Africa's premier tobacco and smoke product e-commerce platform.

## Features

- **Authentication**: JWT access tokens, an HttpOnly refresh cookie, and revocable database sessions
- **Products**: Search, filter, pagination, category & slug lookups
- **Orders**: Server-side price recalculations, bulk pricing tier evaluation, VAT (15%), stock deduction, price tampering protection (409)
- **Cart**: Server-validated cart pricing single source of truth (`/api/cart/validate`)
- **Wholesale**: Application workflow, admin review & role promotion
- **Content**: Dynamic banner & hero content configuration
- **Users**: Admin management

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm run start
```

## Authentication security update

Apply `sql/004-auth-security.sql` once to an existing database before deploying
this version. It adds `users.auth_version`, `auth_sessions`, and
`auth_rate_limits`. The server checks these objects before accepting requests.
Existing tokens have no session identifier and will require a new sign-in.
This repository does not apply the migration automatically.

Access and refresh tokens must use independent secrets. Lifetimes accept a
positive integer followed by `s`, `m`, `h`, or `d`, such as `15m` and `7d`.
Sessions have an absolute expiry: refreshing issues an access token without
extending the session or rewriting its cookie. Logout removes that session;
changing a password increments the account version, invalidating every session.
Requests already authorized before revocation may finish.

The frontend account menu links to `/account/security`. It provides password
changes, a session list, individual revocation, and sign-out of other sessions.
The page lists sign-in/expiry times, not inferred device or location information.

| Client operation | Endpoint | Authorization |
| --- | --- | --- |
| Sign in | `POST /api/auth/login` | Credentials |
| Restore session | `POST /api/auth/refresh` | Refresh cookie plus live database session |
| Sign out | `POST /api/auth/logout` | Revokes the cookie's session; safe to repeat |
| Account details | `GET /api/auth/me` | Access token plus live database session |
| Change password | `PATCH /api/auth/password` | Active session and current password |
| List sessions | `GET /api/auth/sessions` | Own sessions only, most recent 100 |
| Revoke other sessions | `DELETE /api/auth/sessions/others` | Own sessions except the current one |
| Revoke one session | `DELETE /api/auth/sessions/:id` | Own session only |

Login, registration, refresh/logout, and password-change limits use separate
MySQL-backed counters shared by API processes. The general request limiter
remains process-local. Authentication limits fail closed when their database
store is unavailable. Counters store keyed hashes rather than raw client IPs.
Configure every instance with the same secrets and database.

`TRUST_PROXY` defaults to `0`. Before setting a nonzero hop count, verify the
actual browser → Next.js → reverse proxy → API route for the deployment, how
forwarding headers are overwritten, and whether a shorter/direct route exists.
Restrict direct API access. Do not copy a hop count from an unrelated server.
The deployed chain has not been verified by the source changes.

Schedule `npm run security:prune` to remove up to 1,000 expired sessions and
1,000 rate counters expired for more than a day per run. The command is bounded
and does not remove active sessions. Increase its frequency if expired rows
accumulate. No cleanup job is installed automatically.

Unexpected errors return a safe message and request ID. Temporary database
connection errors return `503`, not `401`. Request logs omit query strings,
IP addresses, cookies, request bodies, and user agents. The frontend preserves
session state during temporary outages and displays a retry notice.

## Security verification

`npm test` builds the backend and runs the authentication/security tests. Backend
tests simulate database operations; frontend tests execute the real TypeScript
modules in memory with controlled HTTP responses. The frontend checkout is
discovered at `../Smoke Time Store`, or can be set with `FRONTEND_ROOT`.
Frontend tests are explicitly skipped if that checkout is absent.

These checks cover revocation, password-change races, refresh coordination,
logout races, account isolation, error redaction, and rate-store cleanup after
failure. They do not replace a migrated staging-MySQL test or browser acceptance.
Before rollout, validate shared counters from two API processes and revoked
access/refresh tokens against the real database. Migrate before starting the
new backend, deploy both repositories together, and verify client IP handling.

## Maintenance-script safety

`db:create-admin` and `db:fresh` require `ADMIN_NAME`, `ADMIN_EMAIL`, and
`ADMIN_PASSWORD`. Passwords must contain at least 14 characters and fit within
72 UTF-8 bytes. There is no built-in reset/admin password. Provide credentials
through the runtime environment, not committed files or command-line literals.
If an earlier embedded password was ever used, rotate that account's password.

`db:fresh` is destructive and is not transactional: MySQL `TRUNCATE` cannot be
rolled back. Verify the database target and a recoverable backup, stop all API
instances and other database writers, and only then use it on an intentionally
disposable database. It clears `auth_sessions` before reusing user IDs; migration
`004-auth-security.sql` must already be present, or the reset fails before any
users are cleared. It attempts to restore foreign-key checks after a truncation
failure and reports that partial changes may remain. This is not an online-reset
mechanism. Shared authentication rate-limit counters are intentionally retained.

`db:seed` requires `NODE_ENV=development` or `test` and a runtime `SEED_PASSWORD`
with the same 14-character/72-byte limits. It rejects production or unspecified
environments. This flag is a guardrail, not verification of the database target:
check `DB_HOST` and `DB_NAME` independently. The seed password is used for newly
created fixture accounts; existing accounts are unchanged. Script credentials
and raw database errors are not printed. The legacy shell smoke script still
contains fixture-specific login assumptions; it was syntax-checked, not run.

`npm test` also covers maintenance-script credential validation, session cleanup
ordering, failure cleanup, and redacted output using a simulated database. These
tests do not run any destructive script against MySQL. Real reset acceptance
requires a separate, disposable migrated database with all writers stopped.

# Retrofit

A support-ticket web application for a fictional SaaS project management product, built as the base for a training on adding AI features to an existing app. What it must eventually do is described in [requirements.md](requirements.md).

`master` is the ticket app without AI: one Spring Boot module serving a React SPA and a JSON API, with session login for `USER` (customer) and `SUPPORT` accounts, an English/Polish UI, customer organizations and support teams, and tickets with comments, internal notes, links, SLAs and audit history. The `lesson-N` branches add the training's AI features on top of it, one module at a time.

## Prerequisites

- JDK 25 or newer
- Docker (Spring Boot starts PostgreSQL from `compose.yaml`; the tests use Testcontainers)
- Node 24 on PATH for frontend work (pinned in `.nvmrc`): from a version manager that reads `.nvmrc` (`nvm use`, `fnm use`) or from a system package such as Fedora's `nodejs24`. The Maven build downloads its own Node, so a plain `./mvnw` run does not need it.

## Run

```
./mvnw spring-boot:run
```

This uses the `dev` profile: it starts the `postgres:18` container, runs the Liquibase changelog including the dev seed, builds the SPA into the jar's static resources and serves everything at http://localhost:8080.

### Frontend hot reload

Run the backend without the frontend build, and Vite next to it:

```
./mvnw -Dskip.frontend spring-boot:run
pnpm -C frontend dev
```

Open http://localhost:5173/login. Vite proxies `/api` and `/actuator` to :8080, including the CSRF cookie.

To run a second stack beside one that already holds :8080 and :5173 (another worktree, say), give it other ports and point Vite at its backend:

```
./mvnw -Dskip.frontend spring-boot:run -Dspring-boot.run.arguments=--server.port=8081
RETROFIT_API_URL=http://localhost:8081 pnpm -C frontend dev --port 5174
```

### Demo data

Seeded by Liquibase changesets with `context: dev`, so they exist only under the `dev` profile, never in tests or any other environment. The demo data lives in `src/main/resources/db/seed/demo-data.sql`: three organizations (Acme Corp, Globex and Initech, with first-response SLAs of 4, 8 and 24 hours), the support teams Identity, Projects and Billing, and fifty tickets, RET-1001 to RET-1050, with conversations, internal notes, links and audit history. Among them are similar problems with different resolutions, vague descriptions, SLA breaches, fictional personal data and prompt injection attempts. Later dev-only changesets complete it as features arrive, with the seed alignment files next to it (`demo-data-created-audit.sql`, `demo-data-link-audit.sql`).

Every account's password is `password`:

| Email | Role | Organization or team |
|---|---|---|
| `user@example.com` | USER | Acme Corp |
| `adam.novak@acme.example` | USER | Acme Corp |
| `alice.moreau@acme.example` | USER | Acme Corp |
| `greta.lind@globex.example` | USER | Globex |
| `gil.ortega@globex.example` | USER | Globex |
| `ian.chu@initech.example` | USER | Initech |
| `irene.walsh@initech.example` | USER | Initech |
| `support@example.com` | SUPPORT | Projects |
| `ivy.ingram@example.com` | SUPPORT | Identity |
| `ben.barker@example.com` | SUPPORT | Billing |

Ticket timestamps are relative to the moment the seed ran, so an unanswered ticket that was within its SLA then is breached a few hours later. To return the demo data to its initial state, run the reset script against the compose PostgreSQL, with the app running or not:

```
scripts/reset-demo-data
```

In one transaction it removes the demo data and everything added to it (tickets, comments, links, audit history, idempotency keys), restarts the ticket numbers at 1001 and seeds again, so the tickets are RET-1001 to RET-1050 and the next one is RET-1051, with fresh timestamps. The seeded accounts return to their seeded state, `user@example.com` and `support@example.com` included. Accounts you added to a demo team or organization stay, in the same team or organization. Sessions stay valid and Liquibase's changelog is untouched. The script stops and says why, changing nothing, on a database the app has not yet seeded and on one with tickets outside the demo organizations. To recreate the whole database instead, recreate it and restart the app:

```
docker compose down -v
./mvnw spring-boot:run
```

### Safari and the Secure cookie

The session cookie is always `Secure`. Chrome and Firefox accept it on `http://localhost`; Safari may not, so use Chrome or Firefox for local development. Off localhost the app must be served over HTTPS.

## Tests

```
./mvnw verify                                  # SPA build, backend tests, contract export
./mvnw -Dskip.frontend verify                  # backend only
cd frontend && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test    # Node 24 on PATH
```

`pnpm install` in `frontend/` installs a lefthook pre-commit hook that formats staged frontend files with oxfmt and lints them with oxlint. `pnpm format` reformats the whole frontend.

Backend tests run against a real PostgreSQL in Testcontainers, so Docker must be running.

## API contract

The backend's OpenAPI document is the single source of the wire types. `OpenApiExportTests` writes it to `docs/api/openapi.json` during `verify`, and the SPA types in `frontend/src/api/types.gen.ts` are generated from it:

```
pnpm -C frontend generate:api
```

CI runs the same check on every pull request; run it before committing an API change:

```
pnpm -C frontend generate:api && git diff --exit-code docs/api/openapi.json frontend/src/api/types.gen.ts
```

Commit a regenerated contract only from a full `./mvnw verify`, never from a single-test run.

## First build on a fresh checkout

The frontend build needs `src/api/types.gen.ts`, which comes from `docs/api/openapi.json`, which the backend tests write. Both generated files are committed, so a normal checkout builds directly. If they are missing, bootstrap in this order:

1. `./mvnw -Dskip.frontend verify` (writes `docs/api/openapi.json`)
2. `cd frontend && pnpm install && pnpm generate:api` (Node 24 on PATH)
3. `./mvnw verify`

## Docker image

```
./mvnw package
docker build -t retrofit:dev .
```

The `Dockerfile` copies the fat jar from `target/`, so package first. The image takes its database settings from `DB_URL`, `DB_USERNAME` and `DB_PASSWORD` (see `.env.example`). Outside the `dev` and `test` profiles they have no defaults: an instance started without them fails at startup rather than trying a local database. The error does not name the variable: a missing `DB_URL` stops startup with `'url' must start with "jdbc"`. A missing `DB_USERNAME` or `DB_PASSWORD` is sent to PostgreSQL as the literal `${DB_USERNAME}` or `${DB_PASSWORD}` text, so it shows up as a Postgres authentication error (`password authentication failed`).

### Health probes

`/actuator/health` is public, and so are the probe groups for an orchestrator or load balancer:

- `/actuator/health/liveness`: the process is alive (restart it if not);
- `/actuator/health/readiness`: it can take traffic.

### Creating a user

There is no sign-up and no admin screen yet, and the seeded accounts exist only under the `dev` profile. Outside it, create a user with SQL. Generate a bcrypt hash of the password first, for example with `htpasswd` (Apache utilities):

```
htpasswd -bnBC 12 "" 'the-password' | tr -d ':\n'
```

Then insert the row, prefixing the hash with `{bcrypt}` so the delegating password encoder knows the algorithm:

```sql
INSERT INTO app_user (id, email, display_name, password_hash, roles, team_id, language, created_at, updated_at)
VALUES (gen_random_uuid(), 'jane@example.com', 'Jane Doe', '{bcrypt}$2y$12$...', '{SUPPORT}',
        (SELECT id FROM team WHERE name = 'Identity'), 'en', now(), now());
```

`roles` is `{USER}` for a customer, who also needs an `organization_id`, or `{SUPPORT}` for support staff, who also need a `team_id`, never both; `language` is `en` or `pl`. Outside the `dev` profile there are no organizations or teams either, so insert the one the user belongs to first. Emails are unique case-insensitively. To revoke access, set `enabled = false`: the user's live sessions end on their next request.

## Layout

```
src/main/java/app/retrofit/
  platform/      problem+json errors, validation helpers, SPA serving, GET /api/meta
  auth/          session login, CSRF, users, language preference
  ticket/        ticket reads and writes (services and /api/tickets): visibility, SLA, search, commands, audit
  organization/  organization and team reads (GET /api/organizations, GET /api/teams)
src/main/resources/
  application.yml
  db/changelog/  Liquibase master and changes-<year>/ changesets
  db/seed/       dev demo data, applied by a changeset
src/test/java/   Testcontainers-backed tests
frontend/        React 19 + Vite + Chakra UI v3 SPA
  src/api/       fetch client, problem errors, generated types
  src/i18n/      en and pl translations
  src/components/ui/  shared UI primitives
  src/features/  auth, meta, home, organization, tickets
docs/api/openapi.json  committed API contract
```

One Maven module with plain feature packages and one shared database schema. New features are sibling packages of `platform` and `auth`.

## Standards

Coding standards and conventions live in `.maister/docs/standards/`, indexed by [.maister/docs/INDEX.md](.maister/docs/INDEX.md). Read the index before changing code.

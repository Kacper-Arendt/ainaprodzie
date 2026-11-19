# Retrofit

A support-ticket web application for a fictional SaaS project management product, built as the base for a training on adding AI features to an existing app. What it must eventually do is described in [requirements.md](requirements.md).

`master` is the ticket app without AI: one Spring Boot module serving a React SPA and a JSON API, with session login for `USER` (customer) and `SUPPORT` accounts, an English/Polish UI, customer organizations and support teams, and tickets with comments, internal notes, links, SLAs and audit history. The `lesson-N` branches add the training's AI features on top of it, one module at a time, as [BRANCHES.md](BRANCHES.md) describes.

## Prerequisites

- JDK 25 or newer
- Docker (Spring Boot starts PostgreSQL from `compose.yaml`; the tests use Testcontainers)
- A Gemini API key for the chat, as `GEMINI_API_KEY`, or an Anthropic one, as `ANTHROPIC_API_KEY`, in `.env` or exported (see [The chat's model](#the-chats-model)).
- Node 24 on PATH for frontend work (pinned in `.nvmrc`): from a version manager that reads `.nvmrc` (`nvm use`, `fnm use`) or from a system package such as Fedora's `nodejs24`. The Maven build downloads its own Node, so a plain `./mvnw` run does not need it.

## Run

```
./mvnw spring-boot:run
```

This uses the `dev` profile: it starts the `postgres:18` container, runs the Liquibase changelog including the dev seed, builds the SPA into the jar's static resources and serves everything at http://localhost:8080.

### The chat's model

The chat reaches its model through a [LiteLLM](https://docs.litellm.ai/) proxy, the `litellm` service in `compose.yaml`, which `./mvnw spring-boot:run` starts next to PostgreSQL on http://localhost:4000. The app names only an alias, `chat-gemini` until support staff choose another on the Settings page, and `litellm/config.yaml` maps it to `gemini/gemini-3.5-flash-lite` with the key from `GEMINI_API_KEY`:

```
cp .env.example .env        # then set GEMINI_API_KEY in .env, from https://aistudio.google.com/apikey
./mvnw spring-boot:run
```

Docker Compose reads `.env` from the project root, next to `compose.yaml` (not from `litellm/`), when Spring Boot starts the containers, and passes the keys only to LiteLLM; the app never reads them. A key exported in the shell (`export GEMINI_API_KEY=...`) works too and wins over `.env`. After changing a key, restart the app: Compose recreates the LiteLLM container with the new value. Spring Boot skips starting the containers while they still run, so after an app that did not stop cleanly, `docker compose up -d litellm` picks up the new key.

The LiteLLM image is about 1.2 GB, so the first start takes a while to download it.

The app does not call LiteLLM with its master key but with a virtual key of its own (chat ADR 0002). Once LiteLLM is ready, the `litellm-app-key` service in `compose.yaml` runs `litellm/app_key.py`, which creates the key `sk-retrofit-app-key` (alias `retrofit-app`), or updates it to match the script, and the app sends that key (`LITELLM_KEY`). The key reaches only the aliases in the access group `app` of `litellm/config.yaml`, spends at most $1 a day and sends at most 60 requests a minute. Over the budget LiteLLM answers 422 `budget_exceeded` until midnight UTC, and the chat answers with an error; over the rate limit the chat says it is rate limited. An alias the app should call goes into the access group, or LiteLLM refuses it with 403. A 401 `token_not_found_in_db` means LiteLLM does not know the key it received: check that `litellm-app-key` is healthy (`docker compose ps`) and that neither `LITELLM_KEY` nor `SPRING_AI_OPENAI_API_KEY` is set to another key, such as a provider's.

LiteLLM's admin UI is on http://localhost:4000/ui (user `admin`, password `sk-retrofit-dev`, the master key): Virtual Keys lists the app's key with what it has spent. LiteLLM keeps its tables, the keys among them, in the `litellm` schema of the app's PostgreSQL.

In production the same setup changes in four places. The master key is a secret only administrators hold, and the app's key is created once (with the requests of `app_key.py`, or in the admin UI) and handed to the app as the secret `LITELLM_KEY`. LiteLLM gets a database of its own. Several LiteLLM instances share a Redis, or each counts the rate limit on its own. The admin UI is not reachable from the internet.

Gemini's free tier limits requests per minute and per day, per model. Reports put Flash-Lite at about 500 requests a day and `gemini-3.8-flash` at about 20 (Google does not confirm them). One question costs one request, so stay on Flash-Lite on a free key. To use another model or provider, change the `chat-gemini` entry in `litellm/config.yaml` (the alias must keep `gemini` in its name for Gemini models) or add an alias to `litellm/config.yaml` and to `retrofit.chat.models` in `application.yml`, and choose it on the Settings page. The traces name and price the provider model from LiteLLM's own span, so nothing else names it.

`litellm/config.yaml` has two more aliases. `chat-anthropic` maps to `anthropic/claude-haiku-5-5` with the key from `ANTHROPIC_API_KEY`:

```
# ANTHROPIC_API_KEY in .env, from https://console.anthropic.com/settings/keys
./mvnw spring-boot:run
```

Then sign in as support staff and choose `chat-anthropic` under Model on the Settings page. The next question goes to it, with no restart; the choice is stored and holds for every user.

Haiku is Anthropic's counterpart of Flash-Lite, so the two compare models of one class. A commented entry below it switches the alias to `claude-sonnet-5-5`, a stronger model at several times the price: ask both the same questions and compare what the price buys.

`chat-local`, commented out, is a local model served by [Ollama](https://ollama.com/) on the host, which needs no key and costs nothing per request. Uncomment it, add `chat-local` to `retrofit.chat.models` in `application.yml`, restart the app, choose it on the Settings page, and compare its answers, speed and cost in the traces with the hosted models'. For the local model, run `ollama pull qwen3:8b` first. It reasons before it answers, which on a laptop can take longer than the 15 seconds LiteLLM gives a provider call and the 35 seconds the app waits for a model by default. The commented entry raises LiteLLM's with `timeout: 120`; raise the app's with `CHAT_MODEL_TIMEOUT`, for example `CHAT_MODEL_TIMEOUT=150s`, and the 70 seconds a whole question may take with `CHAT_TURN_TIMEOUT`, for example `CHAT_TURN_TIMEOUT=300s`. On Linux, Ollama listens only on loopback by default, and the LiteLLM container cannot reach it there: set `OLLAMA_HOST=0.0.0.0` for the Ollama service. Ollama has no authentication, so this opens it to every network the machine is on unless a firewall blocks port 11434 from outside.

### Personal data

LiteLLM's Presidio guardrail (`personal-data` in `litellm/config.yaml`) masks the personal data in every request on every alias the app calls before it reaches the provider: an email address, phone number, IBAN or PESEL becomes its type, such as `<EMAIL_ADDRESS>`, and a request holding a card number is refused with 400, which the chat answers by saying that the question was not sent because of personal data such as a card number (chat ADR 0017). Its class, `litellm/personal_data_guardrail.py`, is LiteLLM's Presidio guardrail with one rule added: a card number Presidio finds inside an IBAN does not refuse the request. It does not look for names, and it restores nothing. Presidio runs as two services in `compose.yaml`, `presidio-analyzer` (port 5002) and `presidio-anonymizer` (port 5001); the analyzer loads the recognizers of `presidio/recognizers.yaml`, among them Presidio's PESEL recognizer for English, which checks the checksum. When Presidio does not answer within 2 seconds, LiteLLM refuses the request instead of sending it unmasked.

### Timeouts and retries

`chat-chaos` is a fake provider for watching them (`chaos/chaos_provider.py`, the `chaos-provider` service in `compose.yaml`): it calls no model, and the question says what it does. Choose `chat-chaos` on the Settings page, follow `docker compose logs -f chaos-provider`, which logs every request it receives with the attempt number of its question, and ask:

- `1x 500`: the first attempt fails and LiteLLM's retry answers, so the user reads the answer and the log shows 2 attempts.
- `429`: every attempt is rate limited. LiteLLM tries twice for each of the SDK's two attempts, so the log shows 4 and the chat says it is rate limited.
- `500`: the same 4 attempts, and the chat says it is unavailable.
- `slow 20`: LiteLLM cuts each attempt after 15 seconds and retries once, then the SDK retries, and the app gives up 35 seconds after the question with a `timeout` error.
- `1x slow 20`: LiteLLM cuts the first attempt after 15 seconds, and its retry answers.
- `2x slow 20`: LiteLLM cuts both its attempts and answers 408 after about 31 seconds, and the SDK's retry answers within the app's 35 seconds. `3x slow 20` ends with `timeout` at 35 seconds, as `slow 20` does.
- `Nx` works for `429` and `500` too: `2x 500` answers on the SDK's retry, the third attempt.

The answer of any other question is `chaos answered:` and the question. A delay of 15 seconds or more outlasts LiteLLM's timeout; at exactly 15 the answer is written as LiteLLM gives up, so the log shows a 200 that LiteLLM dropped and retried. A question counts its attempts from 1 again when it is asked more than 5 seconds after its answer.

### The chat's traces

LiteLLM traces every model call to [Arize Phoenix](https://arize.com/docs/phoenix), the `phoenix` service in `compose.yaml`: open http://localhost:6006, project `retrofit`, to see each call's provider model, tokens, cost, duration and the request's metadata (`metadata.requester_metadata.prompt_name`, `.prompt_version`, `.conversation_id`, which Phoenix filters on), with the caller's id as `user.id` and the conversation as `session.id`, so Phoenix's Sessions show one conversation each and LiteLLM counts spend per end user. Its spans, and its admin UI's Logs, carry each prompt and answer as the provider received them. `litellm/phoenix_callback.py` keeps LiteLLM from pricing each call twice (chat ADR 0014).

The app adds its own spans (the request, the chat client and the model call, with the prompt's version `retrofit.prompt.version` and the OpenInference kind Phoenix lists them by: `CHAIN` or `LLM`) only while support staff turn on "App traces to Phoenix" on the Settings page (`/settings`, linked in the header for support staff). It is off on a fresh database, so a new setup shows LiteLLM's calls alone, one trace per model call, unless "Group LiteLLM calls per chat message" is on, which puts one chat message's calls into one trace, each call still a row of its own in Phoenix, since the app's spans never arrive; with app traces on, a question is one trace, and each of LiteLLM's calls sits under the app's model span that made it (chat ADR 0015). With app traces on, Phoenix counts each model call's tokens twice, on the app's model span and on LiteLLM's `litellm_request`; turning "App LLM traces to Phoenix" off on the Settings page makes the app's model span a plain step, so only LiteLLM's counts the tokens and cost (chat ADR 0016). It is on on a fresh database, to show the problem first. The change applies from the next question, and spans already batched leave or drop by the state at export time. The app sends the spans over OTLP to `OTLP_TRACES_URL` (`http://localhost:6006/v1/traces` in `dev`). Phoenix keeps them in its container, so a restart forgets them.

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

Backend tests run against a real PostgreSQL in Testcontainers, so Docker must be running. They need neither LiteLLM nor a key: a scripted model replaces the real one.

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
  chat/          the chat without tools: POST /api/chat/conversations/{id}/messages
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
litellm/config.yaml    the chat's model aliases for the LiteLLM proxy
```

One Maven module with plain feature packages and one shared database schema. New features are sibling packages of `platform` and `auth`.

## Standards

Coding standards and conventions live in `.maister/docs/standards/`, indexed by [.maister/docs/INDEX.md](.maister/docs/INDEX.md). Read the index before changing code.

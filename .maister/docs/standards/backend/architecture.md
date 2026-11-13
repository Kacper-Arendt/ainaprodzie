Structural conventions for the Spring Boot backend: package layout, auth, the API contract and migrations.

# Backend Architecture Standards

### One Module, Packages by Feature
The backend is one Maven module (`app.retrofit:retrofit`) and one jar that also serves the built SPA. Code is organised in plain feature packages under `app.retrofit`, with no Spring Modulith, no `package-info` module declarations and no multitenancy:

- `app.retrofit.platform`: cross-cutting infrastructure (problem+json errors, validation helpers, SPA serving and static cache headers, `GET /api/meta`).
- `app.retrofit.auth`: session login, CSRF, the `app_user` table and the session endpoints.
- Future features (organizations, tickets, and so on) are new sibling packages, `app.retrofit.<feature>`, not sub-packages of `platform` or `auth`.

A feature package holds its controller, services, repositories and DTO records side by side; there are no `controller`/`service`/`repository` layer packages.

### Package-Private by Default
Classes, records and their members are package-private unless another package needs them. A type is public only when it has a caller outside its package; today those are `ProblemException`, `FieldError`, `Validations` and `RefusalLog` in `platform`, which `auth` uses (`RefusalLog` from `SecurityConfig`), `Role` in `auth`, which `organization.CallerLookup` reads and the server test helpers (`TestUsers`) use to create users, `AuthProblems` in `auth`, whose `unauthenticated` refusal `organization.CallerLookup` throws for a caller who is disabled or gone, and `Caller` and `CallerLookup` in `organization`, through which `ticket` resolves the signed-in user. A caller in `src/test` counts: a type the tests need from another package is public for them, and its Javadoc says so. Making a type public is a deliberate API decision for the package, not an IDE default.

### Session-Cookie Authentication
Spring Security with session cookies (same-origin SPA), not JWT or token auth. `POST /api/auth/login` takes JSON credentials, invalidates any existing session and creates a new one (session fixation protection), and stores the `SecurityContext` there. Sessions are stored by Spring Session JDBC in PostgreSQL with an 8h inactivity timeout; the cookie is HttpOnly, Secure and SameSite=Lax. Every login failure (wrong password, unknown or disabled account, blank fields) answers the same 401 `auth/invalid-credentials`. CSRF uses Spring Security's `csrf.spa()` with a `CookieCsrfTokenRepository.withHttpOnlyFalse()` bean (SameSite=Lax); the `XSRF-TOKEN` cookie is rendered on every response, so the SPA's first session query primes it. Login rotates the token and logout clears it, because with formLogin and logout disabled Spring Security does neither. Roles are `USER` and `SUPPORT`, held on the `app_user` row; `EnabledUserFilter` reloads that row on every signed-in `/api` request (login, logout and the public `GET /api/meta` excepted), so a disabled or deleted account loses its live sessions at once with a 401 `auth/unauthenticated`. Every refusal is logged once with its slug, path and principal, never a credential: by `ProblemDetailAdvice`, or by `SecurityConfig` for the filter chain's own 401 and 403, both through the shared format in `platform.RefusalLog`.

### OpenAPI as Single Contract Source of Truth
The API contract is defined by springdoc-openapi on the backend. `OpenApiExportTests` writes it to the committed `docs/api/openapi.json`, and the SPA's TypeScript types (`frontend/src/api/types.gen.ts`) are generated from that file with openapi-typescript (`pnpm -C frontend generate:api`). Never hand-maintain duplicate wire types. Until CI exists, drift is checked by hand: regenerate and run `git diff --exit-code docs/api/openapi.json frontend/src/api/types.gen.ts`.

### Liquibase Migration Conventions
The PostgreSQL schema is managed exclusively by Liquibase, run by the application itself at startup. The master changelog `src/main/resources/db/changelog/db.changelog-master.yaml` includes one directory per year, `changes-<year>/` (`changes-2026/` today; a new year adds one line).

Every schema change is a separate file `db-YYYYMMDDHHmm-name.yaml`, where the timestamp is the UTC clock time at which the file is created (`date -u +%Y%m%d%H%M`) and `name` is a kebab-case description. The timestamp comes from the author's own clock, never from the numbering of the existing tree, so two feature branches cannot mint the same identifier. Each file holds exactly one changeSet whose `id` is the filename stem, raw SQL with a rollback, and apply order is the alphabetical filename order, which the timestamp prefix makes chronological.

Changesets carry Liquibase contexts. Schema changes use `context: schema`; development data (the seeded accounts) uses `context: dev`. The base configuration pins `spring.liquibase.contexts` to `schema` and the `dev` profile sets `schema,dev`, so development data never reaches any other environment. The contexts list must never be empty: with no runtime context, Liquibase runs every changeset, the dev seed included.

Once a changeSet has been applied to a deployed database it is never edited: corrections are new changesets.

An index on a table that already holds data is built `CONCURRENTLY`, in a changeSet with `runInTransaction: false` (a concurrent build cannot run inside a transaction), so the table stays writable while it builds; its rollback drops it `CONCURRENTLY` too.

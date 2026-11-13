Conventions for the test toolchain and the checks every change must pass.

# Test Infrastructure Standards

### Testcontainers with Real PostgreSQL
Backend integration tests use JUnit with Testcontainers running a real PostgreSQL instance (`postgres:18`): no H2 or in-memory substitutes. `TestcontainersConfiguration` declares the container as a `@Bean` annotated `@ServiceConnection`, so Spring Boot wires `spring.datasource.*` from it with no `@DynamicPropertySource`. Liquibase runs the real changelog against it under the `test` profile (contexts `schema` only), so tests see the production schema and never the dev seed. The one exception is `ResetDemoDataScriptTests`: it tests `scripts/reset-demo-data`, so it adds the `dev` context through `@TestPropertySource`, which gives it an application context and therefore a container of its own, never the shared database. Server suites that need a real port extend `RandomPortContext` (`RANDOM_PORT`, the shared container, `@ActiveProfiles("test")`), which also holds the shared HTTP helpers (a non-throwing `RestClient`, cookie handling, CSRF priming, `login`).

### Every SPA API Path Is Checked Against the Contract by the Type Checker
Every `/api/...` path the SPA calls must exist in the exported OpenAPI contract. A screen whose hook calls an endpoint the backend never mapped is dead in the running app, and nothing else catches it: backend tests never call the endpoint, frontend unit tests mock `fetch`, and `docs/api/openapi.json` faithfully records the gap, so the contract drift check stays green on a contract that is accurate and incomplete.

The guard is the type checker. Each path is a named constant in its feature hook (`frontend/src/features/auth/use-auth.ts`, `frontend/src/features/meta/use-meta.ts`) declared with `satisfies keyof paths`, where `paths` comes from the generated `frontend/src/api/types.gen.ts`; `pnpm typecheck` then fails on a path the contract does not have. Never pass an inline `/api/...` string to `api()`: declare the constant first. A path with parameters is declared in its templated contract form (`'/api/tickets/{id}' satisfies keyof paths`) and filled in at the call site.

### Spy Sets and Imported Configurations Are Part of the Context Key
Spring's test context cache keys a context on every `@MockitoSpyBean`/`@MockitoBean` set, every `@Import`-ed or nested `@TestConfiguration` class, `@ActiveProfiles`, property source and `@DynamicPropertySource` method, so a suite that declares its own copy of any of these starts its own application context (and past 32 contexts the cache evicts and restarts them). Share a base or a configuration instead of per-suite copies:
- `RANDOM_PORT` suites extend `RandomPortContext`;
- spy suites share one base class holding the union of the spies, reset before each test;
- a `@TestConfiguration` goes top-level once a second suite imports it, because a nested one only ever matches its own suite.

Separate contexts stay only where the difference is the point of the test (another profile, a startup refusal).

### A Resource-Removal Red Gate Needs `target/classes` Cleared Too
When proving a red gate by **removing** a resource (a Liquibase changeset, a fixture file), deleting it from `src/` is not enough. `maven-resources-plugin` copies resources into `target/classes` but never deletes one that has disappeared from the source tree, so the stale copy is still on the classpath and still gets applied. The gate then passes **vacuously**: it is exercising a resource that should no longer exist. Delete the file from `target/classes` (or `target/test-classes`) as well, or run `./mvnw clean` before the red run. A red gate that will not go red is the signal: check what is actually on the classpath before concluding the guard works.

### Contract Export and the Drift Check
`OpenApiExportTests` **is** the contract generator: it rewrites `docs/api/openapi.json` during `verify`, so a scoped `-Dtest=` run rewrites it too. Never commit an export produced by a partial run; regenerate with a full `./mvnw verify` first.

A change that adds to the contract something the SPA already uses (a new response field, a new path constant) cannot get there in one full build. The full build builds the SPA first, and its `tsc -b` checks the code against the old `types.gen.ts`, so it fails on the very field the tests would export. Export with the SPA build skipped, regenerate the types, then run the full build, which rewrites the same contract:

```
./mvnw -Dskip.frontend verify
pnpm -C frontend generate:api
./mvnw verify
```

Run the drift check after `./mvnw verify`, before every commit that touches the API:

```
pnpm -C frontend generate:api
git diff --exit-code docs/api/openapi.json frontend/src/api/types.gen.ts
```

A non-empty diff means the committed contract or the generated types are stale: commit the regenerated files together with the change that caused them.

### Frontend Tooling Runs on Node 24
`frontend/package.json` requires `node >=24` and `.nvmrc` says so; on an older default Node, Vitest aborts before loading any test (`webidl.util.markAsUncloneable is not a function` from undici/jsdom), which reads like a broken suite rather than a wrong runtime. Every frontend command (`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm format:check`, `pnpm dev`) runs with Node 24 on PATH, whether it comes from a version manager that reads `.nvmrc` (`nvm use`, `fnm use`) or from a system package; an agent or script that finds Vitest failing on import checks the Node version first. The Maven build downloads its own Node for the packaged frontend build.

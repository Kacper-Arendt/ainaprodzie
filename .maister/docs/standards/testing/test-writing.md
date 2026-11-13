## Test Writing

### Test Behaviour Through the Public Surface
Test what the code does through what its callers use: the HTTP API, the rendered component, a package's public method. A refactor that keeps the behaviour keeps the tests green.

### Names State the Behaviour
A test method's name is the behaviour as a sentence in camelCase, with no `should` or `test` prefix (`seededAccountsAreAbsentUnderTestProfile`, `healthIsPublicAndUp`).

### Real Database, Fakes Only Outside the Process
Backend tests run against real PostgreSQL ([test-infrastructure.md](test-infrastructure.md)), never a mocked repository; only what leaves the process is faked. Frontend tests stub `fetch` with `stubFetch` from `frontend/src/test/harness.tsx`, routed by URL.

### Depth Follows Risk
The rules that cost most when wrong (who may see and do what, the ticket lifecycle, the SLA clock, conflicts) are tested at every edge; plain wiring gets one test that it works.

### jsdom Asserts `data-*` State, Never a Computed Colour
jsdom does no layout and resolves no `var()`: a token-driven `border-color` computes to `rgba(0,0,0,0)` and a `background` shorthand may keep the raw token string, so an assertion on a computed colour is either always green or always red for reasons unrelated to the behaviour. A component that has a state worth testing exposes it as an attribute (`data-state`, `data-selected`) and the test reads that; `aria-pressed`, `aria-disabled`, `aria-busy` and accessible names remain the first choice when the state is one a reader would hear. Computed `min-height` is the exception that jsdom answers faithfully and is how touch-target floors are pinned.

### A Fixture Never Bypasses the Schema to Build a State It Forbids
A test must not switch off foreign keys or triggers (`SET LOCAL session_replication_role = replica`, dropping or disabling constraints) to build a row the schema cannot hold. Such a test proves behaviour for a state production can never reach, works only because the Testcontainers role is a superuser, and silently disables every trigger, including any immutability or audit trigger added later. Test the reachable contract instead; if a defensive filter guards an unreachable state, keep the filter with a one-line comment saying what it mirrors and leave it untested.

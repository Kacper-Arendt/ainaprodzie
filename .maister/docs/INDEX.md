# Documentation Index

**IMPORTANT**: Read this file at the beginning of any development task to understand available documentation and standards.

## Quick Reference

### Product Context
What the application is for, what it must eventually do, and how it looks.

### Architecture Decisions
Why the code is shaped the way it is, where a reader would otherwise assume the opposite.

### Technical Standards
Coding standards, conventions, and best practices organized by domain: global, frontend, backend and testing.

---

## Product Context

### Requirements ([requirements.md](../../requirements.md))
The training application's requirements: a support-ticket system for a fictional SaaS product, with customers in organizations, support staff in teams, tickets with categories, priorities, statuses, SLAs and audit history, and the AI features added during the training (read-only chat, chat that performs operations, knowledge base, automated triage with human review). On `master` the codebase is the ticket app without AI: session login for USER and SUPPORT accounts, organizations and teams, tickets with comments, internal notes, links, SLAs and audit history, and an English/Polish SPA; the `lesson-N` branches add the AI features.

### Design System ([DESIGN.md](../../DESIGN.md))
The visual design: the "Paper and Ink" direction (the course's own world), the palette with what each colour means, the type scale, layout, elevation, shapes, every shared component with its states, accessible names and focus moves, and the named rules (Ink Acts, Red Means Trouble, Lamps Say Who Owes, Three Voices, Nothing Moves, One Row Height, Touch Floor, Hard Shadows Lift). Read the sections a UI change touches; the frontend standards say how the code holds it.

### Glossary ([GLOSSARY.md](../../GLOSSARY.md))
The domain vocabulary: one preferred term per concept (organization, customer, support staff, team, ticket, reference number, assignee, public comment and internal note, related ticket and potential duplicate, audit history, the waiting for customer, resolved and closed statuses, SLA, first response, waiting time, response deadline, SLA breach) with the synonyms to avoid. Use these terms in code, API, UI copy, tickets and commit messages.

---

## Architecture Decisions

Located in `docs/adr/`. Each record states one decision, its reason and the alternatives rejected. Read the ones that touch the area you change, and follow them; if a task conflicts with one, ask the user. A lesson branch adds its feature's decisions in a subdirectory with its own numbering (`docs/adr/chat/` from `lesson-0`).

- [0001](../../docs/adr/0001-ticket-visibility-in-one-read-service.md): ticket reads go through one read service (`TicketQueries`) that enforces visibility and computes the SLA, and every caller, the REST layer included, uses it.
- [0002](../../docs/adr/0002-ticket-writes-go-through-one-command-service.md): every ticket write goes through one command service (`TicketCommands`); a write that does one thing is its own command, and support staff edit the ticket's fields in one merge patch (`PATCH` with `TicketChanges`), because the ticket page saves them in one form.
- [0003](../../docs/adr/0003-conflicts-by-version-and-retries-by-shape.md): conflicts are detected by the ticket's version; retries are safe because operations are idempotent by shape, with an optional `Idempotency-Key` only for raising a ticket and adding a comment.
- [0004](../../docs/adr/0004-ticket-lifecycle.md): the allowed status transitions, who may close a ticket, the status changes caused by comments and when the author may edit a ticket.
- [0005](../../docs/adr/0005-hand-written-sql-and-a-ticket-record-for-writes.md): data access is hand-written SQL on `JdbcClient` without an ORM; ticket writes go through the transitions of the `Ticket` record and one conditional write, while who may act stays in `TicketCommands`.

---

## Technical Standards

### Global Standards

Located in `.maister/docs/standards/global/`

#### Coding Style ([standards/global/coding-style.md](standards/global/coding-style.md))
Names from the domain (`GLOSSARY.md`), automatic formatting (oxfmt, enforced by a lefthook pre-commit hook and `pnpm format:check`), no dead code, no backward compatibility unless required, DRY for logic that must change together, null-guarded set membership (Java's `Set.of`/`List.of`/`Map.of` throw on `contains(null)`, so a membership test on a nullable value checks the null first).

#### Commenting ([standards/global/commenting.md](standards/global/commenting.md))
Let code speak for itself, comment sparingly (only the non-obvious "why"), no change or history comments.

#### Development Conventions ([standards/global/conventions.md](standards/global/conventions.md))
Documentation updated in the same change (the ADRs of a touched area read first and amended by a change that departs from them), Conventional Commit titles (`type(scope)!: description`, scopes such as `auth`, `platform`, `frontend`, `deps`), configuration from environment variables and no committed secrets, a dependency only when the platform cannot do the job.

#### Error Handling ([standards/global/error-handling.md](standards/global/error-handling.md))
Refusals as problem+json with a stable slug (`ProblemException`, `ProblemDetailAdvice`), user messages that name the cause without internals, graceful degradation.

#### Minimal Implementation ([standards/global/minimal-implementation.md](standards/global/minimal-implementation.md))
Build only what a current caller uses (no stubs, speculative abstractions or unused options), delete what exploration left behind.

#### Validation ([standards/global/validation.md](standards/global/validation.md))
Server-side always with client-side for feedback, every invalid field at once as `FieldError`s with stable codes (`platform.Validations`), allowlists over blocklists, business rules in `TicketCommands` and the `Ticket` record, text stored as written with injection prevented where it is used.

### Frontend Standards

Located in `.maister/docs/standards/frontend/`

#### Accessibility ([standards/frontend/accessibility.md](standards/frontend/accessibility.md))
Semantic HTML, keyboard navigation with the ink focus ring, text and non-text contrast (4.5:1 and 3:1), labels and alt text, screen reader checks through the accessibility tree, ARIA when needed, heading structure, focus management.

#### Components ([standards/frontend/components.md](standards/frontend/components.md))
Single responsibility, reuse a `components/ui` primitive before building, one owner per ticket fact (a status, priority or response clock shown in two places renders through the same component), composability, typed props with doc comments only for the non-obvious, encapsulation, consistent naming, local state, minimal props.

#### CSS ([standards/frontend/css.md](standards/frontend/css.md))
Styling through Chakra, one geometry for controls sharing a form row, no context shifts when state changes (what the reader unfolds grows downward from the touched control), verified at phone and desktop widths, fixed table layout for state-dependent cells.

#### Design System ([standards/frontend/design-system.md](standards/frontend/design-system.md))
`DESIGN.md` as the description of the design system (read it before building UI, update it with the change), Chakra UI v3, semantic tokens defined once in `frontend/src/theme.ts` (paper and ink, ink for action and focus, red for trouble, amber and green for lamps and notes), self-hosted fonts, the button recipe, font sizes still literals as known drift, no colour literals in components, shared primitives in `frontend/src/components/ui`.

#### Responsive Design ([standards/frontend/responsive.md](standards/frontend/responsive.md))
Mobile-first responsive props, Chakra's breakpoints as the only width switch points, fixed pixel geometry where state varies, testing at phone widths, the touch floor on a coarse pointer, readable typography, source order as reading order.

#### SPA Architecture ([standards/frontend/spa-architecture.md](standards/frontend/spa-architecture.md))
Vite SPA with no SSR, i18n with English default and Polish translation, English URL paths, plural keys, a link inside a sentence through `Trans` under a tag name that is no HTML element (a void one such as `link` renders empty), bundles registered centrally in `i18n/index.ts`, TypeScript strict with generated API types, exhaustive enum-keyed maps with a guarded lookup, TanStack Query for server state, ticket-page writes through `useTicketWrites`, list filters and paging in the URL (invalid values dropped, a page past the end moved to the last, a no-op change written nowhere), a failed refetch keeps the loaded view (`isLoadingError`, not `error`), React local state otherwise (a draft that survives leaving the page in `sessionStorage`), flat state with derived values in render.

### Backend Standards

Located in `.maister/docs/standards/backend/`

#### API Design ([standards/backend/api.md](standards/backend/api.md))
Plural kebab-case resources under `/api` nested at most two levels, ticket writes as commands with the support field edit as one merge patch (ADR 0002), no version in the path, status codes by what the caller can do (`409`, `412`/`428`, `422`), honest OpenAPI schemas (`requiredMode = REQUIRED` on responses, `anyOf` for nullable refs), optional request fields boxed in Java, no explicit `type` on an enum `@Schema`.

#### Architecture ([standards/backend/architecture.md](standards/backend/architecture.md))
One Maven module with plain feature packages (`platform`, `auth`, future features as siblings), no Spring Modulith and no multitenancy, package-private by default, session-cookie authentication, OpenAPI as the single contract source, Liquibase run by the app with contexts `schema` and `dev`, one changeset per timestamped file with a rollback, never edited once applied, and indexes on populated tables built `CONCURRENTLY`.

#### Java Language ([standards/backend/java.md](standards/backend/java.md))
Modern Java 25 (records, sealed interfaces, pattern matching, text blocks), Markdown `///` as the only documentation-comment style, checked by `-Xlint:dangling-doc-comments`, JSpecify `@NullMarked` packages with type-use `@Nullable`, sealed types instead of nullable fields that depend on a variant.

#### Models ([standards/backend/models.md](standards/backend/models.md))
Singular snake_case tables (`app_user` because `user` is reserved), `created_at`/`updated_at` as `timestamptz`, constraints in the database too, indexed foreign keys and list columns, role lists as sets.

#### Queries ([standards/backend/queries.md](standards/backend/queries.md))
Named parameters on `JdbcClient` without an ORM (ADR 0005), no N+1, select only needed columns, reading and writing `timestamptz` through `Timestamp`, caller-supplied instants bound as UTC `OffsetDateTime`, a transaction per multi-row command, no query cache (per-request data read once per operation).

### Testing Standards

Located in `.maister/docs/standards/testing/`

#### Test Infrastructure ([standards/testing/test-infrastructure.md](standards/testing/test-infrastructure.md))
Testcontainers PostgreSQL via `@ServiceConnection` and the shared `RandomPortContext` (only the reset-script suite seeds the dev data, in a database of its own), every SPA API path is a constant typed `satisfies keyof paths` so `pnpm typecheck` checks it against the contract, spy sets and imports are part of the context key, resource-removal red gates need `target/classes` cleared, the contract export (backend first with `-Dskip.frontend` when the SPA already uses what it adds) and the drift check (run locally), frontend tooling on Node 24.

#### Test Writing ([standards/testing/test-writing.md](standards/testing/test-writing.md))
Behaviour through the public surface, names that state the behaviour (no `should` prefix), real PostgreSQL with fakes only outside the process (`stubFetch` on the frontend), depth that follows risk, jsdom asserts `data-*` and `aria-*` state rather than computed colours, fixtures never bypass the schema.

---

## How to Use This Documentation

1. **Start Here**: Always read this INDEX.md first to understand what documentation exists
2. **Product Context**: Read `requirements.md` for what the application is for
3. **Standards**: This index only points to the standards: open and follow the specific standard files relevant to your task; don't rely on the index alone
4. **Keep Updated**: Update documentation when making significant changes

## Updating Documentation

- Technical standards should be updated when team conventions evolve
- Always update INDEX.md when adding, removing, or significantly changing documentation

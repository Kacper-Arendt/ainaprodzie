# Retrofit

## Project Documentation & Standards

Before writing or changing any code (even for quick, direct requests that don't go through a `/maister:*` workflow), ground yourself in the project's documentation:

1. Read @.maister/docs/INDEX.md to see what's documented. It is the map to the coding standards by domain and to the product context (`requirements.md`).
2. Then open and read the specific files it points to that are relevant to your task. The index alone is not enough.
3. Follow the standards as you work (they represent team decisions; if one conflicts with the task, ask the user) and use the product context to understand the domain.

### Standards Evolution

When you notice recurring patterns, fixes, or conventions during implementation that aren't yet captured in standards, suggest adding them. Examples:
- A bug fix reveals a pattern that should be standardized (e.g., "always validate X before Y")
- PR review feedback identifies a convention the team wants enforced
- The same type of fix is needed across multiple files
- A new library/pattern is adopted that should be documented

When this happens, briefly suggest the standard to the user. If approved, invoke `/maister:standards-update` with the identified pattern.

## Maister Workflows

This project uses the maister plugin for structured development workflows. When any `/maister:*` command is invoked, execute it via the Skill tool immediately; do not skip workflows for "straightforward" tasks. The user chose the workflow intentionally; complexity assessment is the workflow's job.

## Build and Run

- `./mvnw spring-boot:run`: dev profile, PostgreSQL from compose, dev seed, app on :8080
- `./mvnw -Dskip.frontend spring-boot:run` plus `pnpm -C frontend dev`: hot reload on :5173
- `./mvnw verify`: SPA build, backend tests (Testcontainers, Docker required), contract export
- `cd frontend && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`: frontend checks (Node 24 on PATH, pinned in `.nvmrc`)
- `pnpm -C frontend generate:api && git diff --exit-code docs/api/openapi.json frontend/src/api/types.gen.ts`: contract drift check (CI runs it too)

## Course Branches

`master` is the app without AI; `lesson-N` branches stack the training's AI features on top. Read `BRANCHES.md` before branching, opening a PR or merging: it says which branch a change targets and how changes flow between branches.

## Architecture Rule

One Maven module, plain feature packages, no Spring Modulith, no multitenancy. New features are sibling packages of `app.retrofit.platform` and `app.retrofit.auth`.

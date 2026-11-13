## Development Conventions

### Documentation Changes With the Code
A change updates the documents it makes wrong in the same pull request: `README.md`, `DESIGN.md`, `GLOSSARY.md`, the ADRs and these standards. Before writing to an area an ADR covers, read that ADR: a change that departs from it amends the ADR in the same pull request, and a review checks the ADRs of the area it touches. An ADR written ahead of the code is checked again when the code lands, because the course's slides quote the ADRs.

### Conventional Commit Titles
A PR title is a Conventional Commit, because main is built from squash merges whose message is the PR title: `<type>(<scope>)!: <description>`.
- Types: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`
- Scope optional, free-form, lowercase kebab-case (`auth`, `platform`, `frontend`, `deps`)
- `!` marks a breaking change
- Description in English, states the outcome, no trailing period
- Branch commits are squashed away and stay free-form

Example: `fix(auth): a disabled account gets the same 401 as a wrong password`

### Configuration and Secrets
Configuration that differs per environment comes from environment variables, read in `application.yml`; secrets and API keys are never committed.

### Minimal Dependencies
Add a dependency only when the platform (Spring Boot, Chakra UI, the JDK) has no way to do the job.

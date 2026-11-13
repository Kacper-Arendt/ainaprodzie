# Data access is hand-written SQL, and ticket writes go through the ticket's own transitions

The app reads and writes PostgreSQL through Spring's `JdbcClient` with SQL in text blocks, without an ORM. Most of what the database does here is SQL that an ORM would not express: the SLA (response deadline, waiting time, breach) is computed in the query, the ticket list filters and sorts by it, visibility is a condition on every read (ADR 0001), and every change of ticket fields is one conditional `UPDATE ... WHERE version = :expected` (ADR 0003). Plain SQL keeps each of these readable in one place, and nothing runs that the code does not show: no lazy loading, no flush at commit, no session state.

Ticket writes keep that SQL out of the business flow. `Ticket` is a record of what a write decides on, and each command turns it into the ticket it asks for through a transition (`closed`, `commented`, `withContent`, `withFacts`). `changesTo` names what a transition changes, and that list is both the audit history and the test of a command that changes nothing. `JdbcTicketRepository.update` stores the result with the version check, and `TicketCommands` holds one copy of the conditional write and its conflict handling for the commands that take `If-Match`; a comment holds the row lock, so its write cannot miss. Who may make a change, and in which status they may make it, stays in `TicketCommands` (and the moves in `TicketStatus`), not in `Ticket`. A transition takes only what its outcome depends on, such as whether a comment comes from support staff, which decides where the status moves.

## Considered Options

- **JPA (Hibernate).** Rejected because the reads are projections computed in SQL, which would become native queries or the Criteria API, and the writes would trade one visible `UPDATE` for dirty checking, a flush at commit and an `OptimisticLockException` raised outside the command.
- **Spring Data JDBC.** Would fit the ticket write, but the reads would still be native `@Query` strings, so it adds a second way to reach the database and saves little.
- **jOOQ.** The best fit for the dynamic reads (typed conditions, `MULTISET`), but its code generator needs a live PostgreSQL at compile time, because the Liquibase changelogs are raw PostgreSQL SQL, and participants would learn a DSL as well as SQL.
- **Jakarta Data with a Hibernate `StatelessSession`.** Checks queries at compile time and has none of JPA's session state, but its Spring integration is little tried, and the SLA queries would still be native.

## Consequences

- `Ticket` does not know who the caller is, and it never refuses. The checks of who may act, and in which status, depend on the caller and run in an order ADR 0003 fixes around `If-Match` and the `Idempotency-Key`, so they belong to the command.

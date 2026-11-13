## Models

### Singular snake_case Tables
Tables and columns are singular snake_case (`ticket`, `ticket_comment`, `organization`); the user table is `app_user` because `user` is reserved in PostgreSQL. A record mirrors its table's name in Java (`Ticket`).

### Timestamps as timestamptz
A row that changes records `created_at` and `updated_at` as `timestamptz` ([queries.md](queries.md) says how to read and write them).

### Constraints in the Database Too
Rules the data must always satisfy are also database constraints (`NOT NULL`, `UNIQUE`, `CHECK`, foreign keys), so no path that skips the service, such as a migration or a script, can break them. The service still validates first, to answer with a field error instead of a constraint violation.

### Index Foreign Keys
Index foreign key columns and the columns a list filters or orders by.

### Role Lists Are Sets
A user's roles are a set, even when stored as an array column or carried as a `List`: duplicates are meaningless and order carries no information. Store them in one canonical order (the declaration order of the role enum) so equal sets are stored identically, and compare two role lists as sets, never with `List` equality: the same roles sent in another order are no change, and must not trigger whatever a change would (an audit entry, a reissued invitation, a session refresh). If one role must be picked from the set, pick the first in canonical order, never the first as received.

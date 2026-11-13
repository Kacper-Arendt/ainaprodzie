## Database Queries

### Named Parameters, Never Concatenation
Every value is bound as a named parameter on `JdbcClient` (`:id`); SQL text never contains a value, even one the server produced. Data access is hand-written SQL without an ORM (ADR 0005).

### Avoid N+1
A list loads what its rows need with a join or one query per relation for all rows (`WHERE id IN (:ids)`), never a query per row.

### Select Only Needed Columns
Request only the columns you need rather than SELECT *.

### Reading and Writing timestamptz Columns
Read `timestamptz` via `rs.getTimestamp(col).toInstant()`, never `rs.getObject(col, Instant.class)`: the PostgreSQL JDBC driver rejects the latter ("conversion to class java.time.Instant from timestamptz not supported"), so the code compiles, passes every test that skips the read, then 500s on the first real call. Use a null-safe helper for nullable columns. A repository without direct tests only exercises its read path through HTTP, which is how this defect slips past review.

The write direction fails identically and needs the same discipline: binding an `Instant` as a statement parameter throws `Can't infer the SQL type to use for an instance of java.time.Instant`. Same failure shape (compiles clean, passes anything that skips the write, dies on the first real call) and the same fix shape: pass `Timestamp.from(instant)`, with a null-safe helper for nullable columns.

```java
// Wrong: throws at runtime
Instant createdAt = rs.getObject("created_at", Instant.class);

// Right
Instant createdAt = rs.getTimestamp("created_at").toInstant();

// Right: nullable column
private static Instant instantOrNull(ResultSet rs, String col) throws SQLException {
	Timestamp ts = rs.getTimestamp(col);
	return ts == null ? null : ts.toInstant();
}

// Wrong: throws at runtime
ps.setObject(1, user.updatedAt());

// Right
ps.setTimestamp(1, Timestamp.from(user.updatedAt()));

// Right: nullable parameter
private static void setInstantOrNull(PreparedStatement ps, int idx, Instant value) throws SQLException {
	ps.setTimestamp(idx, value == null ? null : Timestamp.from(value));
}
```

Bind a caller-supplied instant as `instant.atOffset(ZoneOffset.UTC)`; `Timestamp` shifts dates before 1582-10-15 by days. `Timestamp.from` stays for server-made instants such as `now`.

```java
// Right: a filter bound from a request parameter
params.addValue("createdFrom", createdFrom.atOffset(ZoneOffset.UTC));
```

### Transactions
A command that writes more than one row, or reads before it writes, runs in one transaction (`@Transactional` on the service method).

### No Query Cache
Queries are not cached. Read data that changes per request (the session user, settings a user can edit) per call, and read it once per operation.

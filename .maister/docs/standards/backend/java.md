## Java Language

### Modern Java 25
Write with the language the toolchain offers: records for data carriers, sealed interfaces for a closed set of variants, switch expressions and pattern matching (`instanceof` and record patterns) instead of `if`/`else` chains and casts, text blocks for SQL and other multi-line strings, sequenced-collection methods (`getFirst()`, `getLast()`), and `var` where the right-hand side makes the type evident.

### Markdown Documentation Comments
Documentation comments are Markdown `///` comments (JEP 467), never `/** */` Javadoc: backticks for code, `[Type]` and `[Type#member]` for links, an empty `///` line between paragraphs, `-` for list items. Text Markdown would read as markup, such as a path glob (`/api/**`) or a literal `{type, errors[]}`, goes in a code span. The compiler runs with `-Xlint:dangling-doc-comments`, which reports a `///` block attached to no declaration.

```java
/// The read side of tickets. Visibility is enforced here and nowhere else.
///
/// See [TicketFilter] for the criteria a list accepts.
class TicketQueries {
```

### JSpecify Nullness
A package declares `@NullMarked` (`org.jspecify.annotations`) in its `package-info.java`, so every type in it is non-null unless annotated `@Nullable`. This `package-info.java` is a nullness declaration, not the Spring Modulith module declaration the architecture standard rules out. JSpecify comes with Spring Framework 7, so there is no extra dependency. Every new package starts `@NullMarked`; `auth` and `platform` predate this rule and get it when their nullness is reviewed.

`@Nullable` is a type-use annotation and sits next to the type it qualifies: `private @Nullable String category`, `@Nullable UUID teamId` as a record component, `static @Nullable Instant optionalInstant(...)` as a return type.

A value that is absent only for some kinds of object is modelled as a sealed type, not as a `@Nullable` field that callers must check against a flag: a `Caller` is a `Customer(UUID id, UUID organizationId)` or a `Support(UUID id)`, rather than one record with a role and a nullable organization.

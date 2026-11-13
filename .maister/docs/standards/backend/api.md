## API Design

### Resources and Commands
Paths sit under `/api`, name resources by plural nouns in lowercase kebab-case (`/api/tickets`, `/api/tickets/customer-counts`) and nest at most two resource levels, with a command's noun after them (`/api/tickets/{reference}/links/{linkedReference}`, `/api/tickets/{reference}/close`). Filters, sorting and paging are query parameters. A ticket write that does one thing is a command of its own (`POST /api/tickets/{reference}/close`, `/comments`). The fields a form saves together are one merge patch (`PATCH /api/tickets/{reference}`), whose body tells an absent field from `null` through a sealed type (ADR 0002).

### No Version in the Path
The API has no version segment: the SPA ships in the same jar as the API, and the committed contract with its drift check keeps the two in step ([architecture.md](architecture.md)).

### Status Codes Say What the Caller Can Do
`201` for a created resource, `401` without a session, `403` for an action the caller may not take, `404` for what does not exist or is not visible to the caller, `409` for a conflict with the current state, `412` and `428` for a stale or missing `If-Match` (ADR 0003), `422` for invalid fields ([validation.md](../global/validation.md)). Every refusal is problem+json ([error-handling.md](../global/error-handling.md)).

### Honest OpenAPI Schemas for Generated Clients
The committed OpenAPI contract is the source of truth for generated TypeScript types and the contract drift check: a schema that misstates a field's shape propagates wrong types to every consumer. Mark response record components with `@Schema(requiredMode = REQUIRED)` so generated clients carry no dead null-fallbacks for values the server always sends; a field that is always present but sometimes null is required **and** nullable. Nullable object references need `anyOf: [{$ref}, {"type": "null"}]`: `@Schema(nullable = true)` on a `$ref` property is not enough, because springdoc renders it as a `$ref` with an ignored sibling and the generated type then claims the field is always present. The first response that needs a nullable reference also brings a central `OpenApiCustomizer` that rewrites such properties, so later ones are covered automatically.

```yaml
# Broken: sibling nullable is ignored, type claims non-null
lastComment:
  $ref: '#/components/schemas/CommentSummary'
  nullable: true

# Correct
lastComment:
  anyOf:
    - $ref: '#/components/schemas/CommentSummary'
    - type: 'null'
```

### Optional Request Fields Must Be Boxed Types
The rule above keeps *responses* honest; this is its request-side twin. A field the published contract marks OPTIONAL must never be declared as a Java primitive on the request DTO. Jackson 3 (auto-configured by Spring Boot 4) refuses to construct a record when a primitive creator property is absent from the body rather than defaulting it, so the server rejects exactly the payloads its own schema told clients to send, with a 400 "The request body could not be read." The fix is to box the type and read it with `Boolean.TRUE.equals(...)`; the contract needs no change and regenerates byte-identical, which is the proof that the schema was right and only the implementation disagreed with it.

This is a standard rather than a code comment because no test layer can see it: backend tests build the record in Java (never absent), frontend tests mock `fetch` (never parsed). It surfaces only when a real browser hits the real jar. State the invariant as a pairing, **optional in the schema means boxed in Java**, not as a ban on primitives: a primitive is correct on a field marked `requiredMode = REQUIRED`.

```java
// Broken: schema says optional, the SPA omits it, Jackson 3 rejects the body
public record CloseTicketRequest(String resolution, boolean notifyCustomer) {}

// Correct: optional in the schema, boxed in Java
public record CloseTicketRequest(String resolution, @Schema(description = "...") Boolean notifyCustomer) {
	public boolean notifyRequested() {
		return Boolean.TRUE.equals(notifyCustomer);
	}
}
```

### Never Set an Explicit `type` on a `@Schema` Annotating an Enum
Annotating a Java enum with `@Schema(type = "string", ...)` makes springdoc treat it as a plain string primitive and inline it, **discarding the derived `enum` values**. The published contract loses the vocabulary and every generated client widens the field to a bare `string`: the annotation written to *describe* the vocabulary is precisely what suppresses it. Like its siblings above, it is invisible to every test layer except a contract assertion: the server still accepts only the valid constants and the SPA still compiles, because a union silently degraded to `string[]` type-checks everywhere the union did.

The fix is to **remove** the explicit `type` and let springdoc derive the constants from the enum, **not** to add `allowableValues`, which writes the vocabulary down a second time and recreates exactly the drift the single-source-of-truth rule exists to end. Pin the outcome with a contract test in `OpenApiExportTests` rather than trusting review.

```java
// Broken: the explicit type suppresses the derived enum; clients get `string`
@Schema(type = "string", description = "Account role.")
public enum Role { USER, SUPPORT }

// Correct: springdoc derives the constants; one source of truth
@Schema(description = "Account role.")
public enum Role { USER, SUPPORT }
```

These rules form one family: **every one is a contract defect no ordinary test layer can see.** Unit tests pass, the service behaves, the client is simply built against a contract that misdescribes it, which is why each is guarded by a contract test over the generated `openapi.json` rather than by a test of the code that produced it.

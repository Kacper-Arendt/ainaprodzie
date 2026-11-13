## Coding Style

### Automatic Formatting
Use automated tools to enforce consistent indentation, spacing, and line breaks. The frontend is formatted by oxfmt (`frontend/.oxfmtrc.jsonc`): the lefthook pre-commit hook formats staged files, and `pnpm format:check` is part of the frontend checks, so unformatted code fails before review rather than piling up.

### Names From the Domain
Name things after the domain terms in `GLOSSARY.md` and the way the surrounding code already names them, without cryptic abbreviations.

### No Dead Code
Remove unused imports, commented-out blocks, and orphaned functions instead of leaving them behind.

### No Backward Compatibility Unless Required
Avoid extra code paths for backward compatibility unless explicitly needed.

### DRY (Don't Repeat Yourself)
Extract logic that is repeated and must change together; a single caller is no reason for an abstraction ([minimal-implementation.md](minimal-implementation.md)).

### Set Membership on a Nullable Value Guards the Null
Java's immutable collections (`Set.of`, `List.of`, `Map.of`) throw `NullPointerException` from `contains(null)` instead of answering false, so a membership test on a value that can be null (an optional role, an optional context) must check the null first and state in one place what null means (here: null is in no value set).

```java
return values == null || value != null && values.contains(value);
```

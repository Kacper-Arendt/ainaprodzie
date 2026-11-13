# Conflicts are detected by version, retries are made safe by the shape of each operation

Requirements ask for safe retries without duplicated operations and for detecting a ticket that changed since it was read. Both matter most for the chat, where a model reads a ticket, asks the user to confirm, and may call the same tool twice.

**Conflicts.** The ticket's `version` is part of its details and its `ETag`. Every operation that changes ticket fields takes the expected version (`If-Match` over HTTP, a parameter in-process). A stale version is `412`, a missing one `428`, so no client skips the check by accident. Comments append, and a link's type switch is last-write-wins and recorded in both tickets' audit history, so neither takes a version. A write that would change nothing succeeds whatever the version: the ticket already holds what the caller asked for, and a retry after a lost response, or two people making the same change, should not end in a conflict that misleads them.

**Retries.** Most operations are idempotent by their shape: field changes set values (and succeed unchanged when the values are already there), and links are added and removed at their own address. Only the two operations that create something new every time they run, raising a ticket and adding a comment, take an `Idempotency-Key`. The key is stored with a fingerprint of the request and the response in the same transaction as the operation, so a retry under the same key answers the first outcome, and the same key with another request is refused. The key is optional: a request without one is simply not idempotent. The SPA sends one with every submission, the same key while the payload stays the same.

## Considered Options

- **An `Idempotency-Key` on every write.** Rejected because a key table would then guard operations that cannot be duplicated anyway, and every caller would carry a header that protects nothing.
- **A required key.** Rejected because a plain API client, `curl` included, could not raise a ticket or add a comment without inventing a key, while the SPA sends one anyway. A client that leaves the key out gives up only its own safe retry.
- **Rejecting every write with a stale version.** Rejected because a successful write whose response was lost would then fail on retry with "the ticket was changed", although the change was the caller's own.

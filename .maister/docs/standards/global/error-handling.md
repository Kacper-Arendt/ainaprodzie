## Error Handling

### Refusals Are problem+json With a Stable Slug
A refusal is a `ProblemException` carrying its own problem+json body, type `https://retrofit.app/problems/<slug>`; `ProblemDetailAdvice` turns every exception into that shape, so features throw rather than catch. The slug is the contract the SPA switches on; the title and detail are English text that may be reworded.

### Clear User Messages
The SPA names the cause the reader can act on, in the domain's words; it never shows a stack trace, an internal identifier or anything security-sensitive. Every login failure is the same 401, so a response never tells which accounts exist.

### Graceful Degradation
When a part that is not needed for the task fails, the rest keeps working: a failed refetch keeps the loaded view ([spa-architecture.md](../frontend/spa-architecture.md)), and the offline notice says what still works.

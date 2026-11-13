## Validation

### Server-Side Always, Client-Side for Feedback
The server validates every request, whatever the SPA checked first; the SPA validates only to give feedback before a round trip, and shows the server's verdict when they disagree.

### Every Problem at Once, by Field
Field checks collect `FieldError`s with the helpers in `platform.Validations` and throw once, so one 422 reports every invalid field. A `FieldError`'s `code` (`language.unknown`, `field.required`) is the contract the SPA translates; its `message` is developer text.

### Allowlists Over Blocklists
A value from a fixed vocabulary is checked against the allowed values (`requireAllowed`), never against a list of forbidden ones.

### Business Rules in the Domain
Who may do what, and which state allows it, is checked where ADR 0002 and ADR 0005 put it (`TicketCommands` for who may act, the `Ticket` record's transitions for what the state allows), never in a controller.

### Store Text as Written
Text people write (titles, descriptions, comments) is stored and returned exactly as written, never escaped or stripped on input. Injection is prevented where the text is used: bound as a parameter in SQL ([queries.md](../backend/queries.md)) and rendered as text by React.

# Ticket writes go through one command service, and support staff edit a ticket's fields in one merge patch

Every change to a ticket goes through one Java command service, `TicketCommands`, the write-side counterpart of `TicketQueries` (ADR 0001). It enforces who may do what, writes the audit history and applies the rules that follow from a change (first response, status changes caused by comments, the assignee cleared by a team change). The REST endpoints are a thin layer over it, and a later caller, such as the chat's tools or a background job, calls it in-process with the acting user's id. As with reads, the reason is that a rule kept in a controller would be copied by every new caller, and a copy that drifts lets one caller do what another forbids.

A write that does one thing is a command of its own: raising a ticket, commenting, closing (the only way to closed, ADR 0004), editing the title and description, linking and unlinking. Support staff edit the rest of the ticket's fields (status, resolution, priority, category, team and assignee) in one command, `update`, because the ticket page edits them in one form with one Save. Its body is a merge patch: each field is absent (kept), `null` (cleared, such as unassigning someone) or a value. `TicketChanges.Field` spells these three out as a sealed type, because a nullable record component cannot tell an absent field from `null`. Only support staff may send it, so it has one permission rule whatever fields it carries.

Both edits share `PATCH /api/tickets/{reference}` with `If-Match`. A body with the title or description goes to the content edit, whose rule differs (the author while the ticket is new, support staff until it is closed, ADR 0004), and a body that mixes them with other fields is refused with `422` (`field.not-combinable`).

## Considered Options

- **One command per intent** (change the status, classify, assign), each with an endpoint of its own. Rejected because the form saves its fields together. It would send up to three requests, each raising the version, so each one needs the previous one's `ETag`, and a refusal in the middle leaves the edit half saved. Commands per intent pay off for a caller that acts on one intent at a time and must know beforehand which ones it may take. Until such a caller exists, they only split one save.
- **One edit of every field, the title and description included.** Rejected because the title and description have a rule of their own (ADR 0004). Mixed into the same edit, the permission would depend on which fields happen to be in the body.
- **A later caller going through the REST endpoints.** Rejected for the reasons ADR 0001 gives for reads: a background job has no session, and HTTP plumbing in every call adds nothing.

## Consequences

- Who may act lives in the commands as refusals, and the read side does not report which actions the caller may take or which statuses it may set next. The SPA keeps its own copy of these rules (`NEXT_STATUSES`, `mayClose`) to hide what the server would refuse, so the copy can drift from the commands.

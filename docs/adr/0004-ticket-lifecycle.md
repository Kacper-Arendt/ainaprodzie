# The ticket lifecycle moves forward and ends at closed

The requirements list the statuses but not the moves between them. We fixed them so that a status always tells the truth about where a ticket stands, and so that the UI, the chat and HITL all get the same answer to "can I do this now".

| From | To |
|---|---|
| new, in progress, waiting for customer | any other status except new |
| resolved | in progress, closed |
| closed | none |

Support staff make these moves, except that closing is an action of its own: support staff close only a resolved ticket, and only the author closes one that is not resolved (see below).

- **Nothing returns to new.** New means nobody has looked at the ticket yet, and once someone has, that is no longer true.
- **Resolved requires a resolution**, given in the same change or already on the ticket. Reopening keeps the text; the next resolution replaces it, and the audit history keeps both.
- **Closed is final.** A recurring problem is a new ticket linked as related to the closed one, so the closed ticket's status, fields and SLA stay as they were. Nothing can be done on a closed ticket except comments by support staff and links. Support staff may add public comments and internal notes, to record a follow-up or point to the new ticket; a customer may not comment, and a support comment moves no status. Support staff may add, switch and remove links on a closed ticket at either end, because a link records how tickets relate and changes neither the closed ticket's status, fields nor SLA; the change is recorded in its audit history and raises its version and last-update time.
- **Support staff close only a resolved ticket.** A duplicate or a ticket that needs no work is resolved with a resolution saying so, then closed, so every ticket support staff close says why it ended. A ticket its author withdraws may close without a resolution.
- **A customer closes only a ticket they raised, from any status:** before resolution that withdraws it, after resolution it confirms it. Other customers of the organization can still comment. A customer changes no other status.
- **Comments move a ticket back to whoever acts next.** A customer's public comment on a ticket waiting for customer or resolved moves it to in progress: it is the awaited answer, or a sign the resolution did not work. The first public comment by support staff on a new ticket moves it to in progress. These changes are recorded in the audit history with the comment's author as the actor.
- **The author edits the title and description only while the ticket is new.** After that support staff are working from that text, and a silent change would change the request under them. A correction is a comment. Support staff may edit until closing, to make a vague report clear.

## Considered Options

- **Free transitions, any status to any status.** Rejected because statuses would stop meaning anything (a closed ticket reopened without trace, a resolved ticket without a resolution), and the chat and triage could not rely on them.
- **Reopening closed tickets.** Rejected because it rewrites a finished ticket's waiting time and SLA, and a recurring problem is better tracked as a new ticket with a link to the old one.
- **A customer closing any ticket of their organization.** Rejected because the requirements give customers "their own tickets", and a colleague's ticket closed by someone else would surprise its author.

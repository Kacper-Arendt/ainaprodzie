# Ticket visibility lives in one read service that the chat calls in-process

The requirements say the read-only chat answers "using the API", which suggests the chat's tools call the REST endpoints with the user's session. We decided instead that ticket reads go through one Java read service that enforces visibility itself (a customer sees only their organization's tickets and never internal notes; support staff see everything) and also computes waiting time, response deadline and SLA breach. The chat's tools call that service in-process, and the REST endpoints are a thin layer over the same service. The reason is to keep the visibility and SLA rules in one place: if they lived in the controllers, every new caller (chat, triage, HITL) would have to copy them, and a copy that drifts would leak data between organizations.

## Considered Options

- **Chat as an HTTP client of the REST API**: the chat would follow the same rules as the UI without extra effort, but every tool call would carry HTTP plumbing and session forwarding, and triage and HITL, which run as background jobs without a session, would still need the in-process route.

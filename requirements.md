**AI Retrofit — Training Application Requirements**

A web application for handling customer support tickets for a fictional SaaS project management product. The application initially works without AI. During the training, we progressively add a read-only chat, a chat that performs operations, a knowledge base, and automated triage with human-in-the-loop (HITL), and finally prepare them for production.

**1. Users and Organizations**

- Each customer belongs to an organization.
- Customers can view their organization’s tickets, create tickets, add comments, and close their own tickets.
- Support staff can handle tickets across all organizations, including changing priorities and assignments.
- Support staff belong to teams and can review triage decisions.
- The backend enforces permissions and organization isolation.

**2. Tickets**

Each ticket contains:

- Reference number, title, and description.
- Customer organization and author.
- Category: bug, question, or feature request.
- Priority: low, normal, high, or critical.
- Status: new, in progress, waiting for customer, resolved, or closed.
- Assigned team and optional assignee.
- Creation timestamp, last update timestamp, and first support response timestamp.
- Optional resolution description and links to related tickets.

Category and assignment may initially be empty.

**3. Ticket Management**

- Create and edit tickets; change status, priority, and assignment.
- Add public comments and internal notes that customers cannot see.
- Link related tickets and flag potential duplicates.
- Maintain an audit history recording who changed what and when, including previous and new values.
- Search by reference number, title, and description.
- Filter by organization, status, category, priority, team, and assignee.

**4. SLAs and Teams**

- Each organization has an SLA defining the time allowed for the first public response from support staff.
- Time is measured continuously, 24/7, without business calendars.
- The application displays waiting time, response deadline, and SLA breaches.
- Each team has a name and a description of its responsibilities, such as Identity, Projects, or Billing.

**5. User Interface and API**

Core views: ticket list, ticket details with conversation and audit history, and a new-ticket form.

Operations are available through an API and follow the same business rules as the user interface. User and organization context comes from authentication.

The application supports safe retries without duplicating operations and detects conflicts when a ticket has changed since it was read.

**6. Features Added During the Training**

| Stage | Functionality |
|---|---|
| Read-only chat | Answer questions about accessible tickets, statuses, and waiting times using the API |
| Chat that performs operations | Create and close tickets, add comments, and change assignments within the user’s permissions; request confirmation for selected actions |
| Knowledge base | Articles and imported materials with a title, content, source, update date, and visibility; search and RAG |
| Automated triage | Analyze new tickets, retrieve relevant context, and propose a category, priority, and team with supporting rationale |
| HITL | Automatically apply clear-cut decisions; send uncertain cases to a queue for support staff to approve or correct |
| Production | Choose a model per task, fall back to tested models, gate releases on evaluations, roll automation out in shadow mode and gradually, with a switch that stops the AI's actions and a way to roll back a version |

Triage state is separate from ticket status: pending analysis, analyzing, awaiting review, completed, or failed.

The HITL queue displays the proposed changes, sources, escalation reason, waiting time, and reviewer. Approval triggers the changes after checking that the ticket has not changed in a way that invalidates the proposal.

**7. Training Data**

Synthetic data: at least three organizations, three support teams, several customer and support accounts, approximately 50 historical tickets, and 10–15 source documents for building the knowledge base later.

Scenarios include:

- Product questions, bugs, and feature requests.
- Similar problems with different resolutions.
- Incomplete and ambiguous descriptions.
- SLA breaches.
- Internal notes and data belonging to different organizations.
- Fictional personal data and prompt injection attempts.

A separate evaluation dataset contains expected classifications and identifies cases requiring human review. Demo data can be reset to its initial state.

**8. Technical Scope**

One application, one database, and background job processing. LiteLLM provides access to models, and Presidio detects and masks personal data. Tracing, prompt versioning, evaluations, and cost tracking are introduced progressively.

Out of scope: sprints, epics, email integration, payments, CRM and monitoring integrations, and a configurable workflow engine.

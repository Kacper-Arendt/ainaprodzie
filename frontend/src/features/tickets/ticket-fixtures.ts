import type { TicketDetails, TicketSummary } from './use-tickets.ts'

/** Test-only payloads shaped by the generated contract types. */
export function ticketSummary(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    reference: 'RET-1042',
    title: 'Export does not work',
    organization: { id: '00000000-0000-0000-0000-0000000b0001', name: 'Acme Corp' },
    author: { id: '00000000-0000-0000-0000-00000000a003', name: 'Adam Novak' },
    category: null,
    priority: 'NORMAL',
    status: 'NEW',
    team: null,
    assignee: null,
    createdAt: '2026-10-08T08:00:00Z',
    updatedAt: '2026-10-08T08:00:00Z',
    firstResponseAt: null,
    closedAt: null,
    sla: {
      responseDeadline: '2026-10-08T12:00:00Z',
      waitingSeconds: 5 * 3600 + 3 * 60,
      breached: true,
    },
    unansweredCustomerCommentAt: null,
    ...overrides,
  }
}

export function ticketDetails(overrides: Partial<TicketDetails> = {}): TicketDetails {
  return {
    summary: ticketSummary({
      status: 'IN_PROGRESS',
      category: 'BUG',
      team: { id: '00000000-0000-0000-0000-0000000c0002', name: 'Projects' },
      firstResponseAt: '2026-10-08T09:00:00Z',
      sla: { responseDeadline: '2026-10-08T12:00:00Z', waitingSeconds: 3600, breached: false },
    }),
    description: 'Clicking Export does nothing.',
    resolution: null,
    comments: [
      {
        id: '00000000-0000-0000-0000-0000000d0001',
        author: { id: '00000000-0000-0000-0000-00000000a002', name: 'Sam Support' },
        fromSupport: true,
        internal: false,
        body: 'Which browser do you use?',
        createdAt: '2026-10-08T09:00:00Z',
      },
      {
        id: '00000000-0000-0000-0000-0000000d0002',
        author: { id: '00000000-0000-0000-0000-00000000a002', name: 'Sam Support' },
        fromSupport: true,
        internal: true,
        body: 'Probably the Safari bug.',
        createdAt: '2026-10-08T09:10:00Z',
      },
    ],
    history: [
      {
        actor: { id: '00000000-0000-0000-0000-00000000a002', name: 'Sam Support' },
        changedAt: '2026-10-08T09:00:00Z',
        field: 'STATUS',
        oldValue: 'NEW',
        newValue: 'IN_PROGRESS',
      },
      {
        actor: { id: '00000000-0000-0000-0000-00000000a002', name: 'Sam Support' },
        changedAt: '2026-10-08T09:05:00Z',
        field: 'LINK',
        oldValue: null,
        newValue: 'POTENTIAL_DUPLICATE RET-1030',
      },
    ],
    links: [
      {
        relation: 'POTENTIAL_DUPLICATE_OF',
        reference: 'RET-1030',
        title: 'Export broken',
        status: 'RESOLVED',
      },
    ],
    version: 3,
    ...overrides,
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionGate } from '../auth/session-gate.tsx'
import { jsonResponse, renderRoutes, stubFetch, type FetchCall } from '../../test/harness.tsx'
import { ticketDetails, ticketSummary } from './ticket-fixtures.ts'
import { TicketList } from './ticket-list.tsx'
import { TicketPage } from './ticket-page.tsx'

const SUPPORT_ID = '00000000-0000-0000-0000-000000000001'
const ORGANIZATION_ID = '00000000-0000-0000-0000-0000000b0001'
const TEAM_ID = '00000000-0000-0000-0000-0000000c0001'
const OTHER_TEAM_ID = '00000000-0000-0000-0000-0000000c0002'
const TEAMMATE_ID = '00000000-0000-0000-0000-00000000a101'
const OTHER_MEMBER_ID = '00000000-0000-0000-0000-00000000a102'

const TEAMS = [
  {
    id: TEAM_ID,
    name: 'Billing',
    description: 'Invoices and payments',
    member: true,
    members: [
      { id: SUPPORT_ID, name: 'Jane Doe' },
      { id: TEAMMATE_ID, name: 'Tom Lee' },
    ],
  },
  {
    id: OTHER_TEAM_ID,
    name: 'Projects',
    description: 'Project features',
    member: false,
    members: [{ id: OTHER_MEMBER_ID, name: 'Ola Nowak' }],
  },
]
const ORGANIZATIONS = [
  { id: ORGANIZATION_ID, name: 'Acme Corp', firstResponseSlaMinutes: 240 },
  { id: '00000000-0000-0000-0000-0000000b0002', name: 'Globex', firstResponseSlaMinutes: 480 },
]

const session = (role: 'USER' | 'SUPPORT') => ({
  id: SUPPORT_ID,
  email: 'jane@example.com',
  displayName: 'Jane Doe',
  roles: [role],
  language: 'en',
})

function page(items = [ticketSummary()], total = items.length) {
  return () => jsonResponse({ items, total })
}

function renderList(
  role: 'USER' | 'SUPPORT',
  tickets: (url: string) => Response = page(),
  url = '/',
  overrides: Array<[string, (url: string) => Response]> = [],
) {
  const calls = stubFetch([
    ...overrides,
    ['/api/auth/session', () => jsonResponse(session(role))],
    ['/api/tickets/RET-1042', () => jsonResponse(ticketDetails())],
    // Answered only where a case passes the counts in `overrides`.
    ['/api/tickets/counts', () => jsonResponse({ title: 'Not Found', status: 404 }, 404)],
    ['/api/tickets/customer-counts', () => jsonResponse({ title: 'Not Found', status: 404 }, 404)],
    ['/api/tickets', tickets],
    ['/api/teams', () => jsonResponse(TEAMS)],
    ['/api/organizations', () => jsonResponse(ORGANIZATIONS)],
  ])
  const router = renderRoutes(
    [
      {
        path: '/',
        element: (
          <SessionGate>
            <TicketList />
          </SessionGate>
        ),
      },
      {
        path: '/tickets/:reference',
        element: (
          <SessionGate>
            <TicketPage />
          </SessionGate>
        ),
      },
    ],
    url,
  )
  return { calls, router }
}

function optionNames(label: string): string[] {
  return within(screen.getByLabelText(label))
    .getAllByRole('option')
    .map((option) => option.textContent ?? '')
}

const SEARCH = /^Search by/

/** The filters fold away until asked for, or until the URL brings some. */
async function openFilters() {
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }))
}

function lastListQuery(calls: FetchCall[]): URLSearchParams {
  const last = calls.filter((call) => call.url.startsWith('/api/tickets?')).at(-1)
  return new URLSearchParams(last?.url.split('?')[1])
}

describe('TicketList', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows each ticket with a link, its status, priority, assignee and clock, marking an SLA breach', async () => {
    // Only the clock is faked: the deadline passed 5 h 3 min before this instant.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T17:03:00Z'))
    renderList('SUPPORT')

    const link = await screen.findByRole('link', { name: 'RET-1042' })
    expect(link.getAttribute('href')).toBe('/tickets/RET-1042')
    const row = screen.getAllByRole('row')[1]
    expect(within(row).getByText('Export does not work')).toBeTruthy()
    // In its column, and under the title between `lg` and `xl`, where the column folds away.
    expect(within(row).getAllByText('Acme Corp')).toHaveLength(2)
    expect(within(row).getByText('Unassigned')).toBeTruthy()
    expect(within(row).getByText('New')).toBeTruthy()
    expect(within(row).getByText('Normal')).toBeTruthy()
    expect(within(row).getByText('5 h 3 min over')).toBeTruthy()
    expect(within(row).getByText('SLA breached')).toBeTruthy()
    // The chip's short word is for the eye; a screen reader hears the sentence once.
    expect(within(row).getByText('SLA').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('keeps red for a live breach and reads a past one as a muted settled clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
    const breach = {
      responseDeadline: '2026-10-08T12:00:00Z',
      waitingSeconds: 10 * 3600,
      breached: true,
    }
    const live = ticketSummary({ reference: 'RET-1001' })
    const answeredLate = ticketSummary({
      reference: 'RET-1002',
      status: 'IN_PROGRESS',
      firstResponseAt: '2026-10-08T18:00:00Z',
      sla: breach,
    })
    const closedLate = ticketSummary({
      reference: 'RET-1003',
      status: 'CLOSED',
      closedAt: '2026-10-08T15:00:00Z',
      sla: breach,
    })
    renderList('SUPPORT', page([live, answeredLate, closedLate]))

    await screen.findByRole('link', { name: 'RET-1001' })
    const [, liveRow, answeredRow, closedRow] = screen.getAllByRole('row')
    expect(liveRow.querySelector('[data-tone="danger"]')).not.toBeNull()
    expect(within(liveRow).getByText('1 d over').dataset.clock).toBe('over')

    expect(answeredRow.querySelector('[data-tone="danger"]')).toBeNull()
    expect(within(answeredRow).queryByText('SLA breached')).toBeNull()
    const answeredClock = within(answeredRow).getByText('Answered 6 h late')
    expect(answeredClock.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(answeredClock.closest('[data-clock]')?.getAttribute('data-clock')).toBe('answeredLate')
    expect(
      within(answeredRow).getByText('First response 6 h after the response deadline'),
    ).toBeTruthy()

    expect(closedRow.querySelector('[data-tone="danger"]')).toBeNull()
    expect(within(closedRow).getByText('Closed unanswered, late')).toBeTruthy()
    expect(
      within(closedRow).getByText('Closed without a first response, after the response deadline'),
    ).toBeTruthy()
  })

  it('reads the clock as the time left, the time to the first response or a close without one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T11:20:00Z'))
    const due = ticketSummary({
      reference: 'RET-1001',
      sla: { responseDeadline: '2026-10-08T12:00:00Z', waitingSeconds: 0, breached: false },
    })
    const answered = ticketSummary({
      reference: 'RET-1002',
      firstResponseAt: '2026-10-08T10:00:00Z',
      assignee: { id: TEAMMATE_ID, name: 'Tom Lee' },
      sla: { responseDeadline: '2026-10-08T12:00:00Z', waitingSeconds: 2 * 3600, breached: false },
    })
    const closed = ticketSummary({
      reference: 'RET-1003',
      status: 'CLOSED',
      closedAt: '2026-10-08T09:00:00Z',
      sla: { responseDeadline: '2026-10-08T12:00:00Z', waitingSeconds: 3600, breached: false },
    })
    renderList('SUPPORT', page([due, answered, closed]))

    await screen.findByRole('link', { name: 'RET-1001' })
    const [, dueRow, answeredRow, closedRow] = screen.getAllByRole('row')
    const dueClock = within(dueRow).getByText('Due in 40 min')
    expect(dueClock.getAttribute('data-soon')).toBe('true')
    expect(within(answeredRow).getByText('Answered in 2 h')).toBeTruthy()
    expect(within(answeredRow).getByText('Tom Lee')).toBeTruthy()
    expect(within(closedRow).getByText('Closed unanswered')).toBeTruthy()
  })

  it('tells a customer which tickets need their answer and how long the others have waited, without the SLA', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T17:03:00Z'))
    const waiting = ticketSummary({ reference: 'RET-1001', status: 'WAITING_FOR_CUSTOMER' })
    const answered = ticketSummary({
      reference: 'RET-1002',
      status: 'IN_PROGRESS',
      firstResponseAt: '2026-10-08T10:00:00Z',
      sla: { responseDeadline: '2026-10-08T12:00:00Z', waitingSeconds: 2 * 3600, breached: false },
    })
    renderList('USER', page([waiting, ticketSummary(), answered]))

    await screen.findByRole('link', { name: 'RET-1001' })
    const [, waitingRow, newRow, answeredRow] = screen.getAllByRole('row')
    expect(within(waitingRow).getByText('Needs your answer')).toBeTruthy()
    expect(within(waitingRow).queryByText('Waiting for customer')).toBeNull()
    // Unanswered but waiting for the customer: no clock beside "Needs your answer".
    expect(within(waitingRow).queryByText(/support|answered/i)).toBeNull()
    expect(within(newRow).getByText('New')).toBeTruthy()
    // The fixture's deadline passed hours ago: the clock says so in words, with no SLA or red.
    const newClock = within(newRow).getByText(
      'Waiting for support for 9 hours, longer than the 4 hours we aim for',
    )
    expect(newClock.hasAttribute('data-clock')).toBe(false)
    expect(newClock.hasAttribute('data-soon')).toBe(false)
    expect(within(answeredRow).getByText('Answered after 2 hours')).toBeTruthy()
    expect(within(screen.getByRole('table')).queryByText(/SLA/)).toBeNull()
  })

  it('shows support staff the status of a ticket waiting for the customer', async () => {
    renderList('SUPPORT', page([ticketSummary({ status: 'WAITING_FOR_CUSTOMER' })]))

    await screen.findByRole('link', { name: 'RET-1042' })
    const row = screen.getAllByRole('row')[1]
    expect(within(row).getByText('Waiting for customer')).toBeTruthy()
    expect(within(row).queryByText('Needs your answer')).toBeNull()
  })

  it('opens the support queue on the response deadline and a customer list on the latest update', async () => {
    const support = renderList('SUPPORT')
    await screen.findByRole('link', { name: 'RET-1042' })
    expect(lastListQuery(support.calls).get('sort')).toBe('RESPONSE_DEADLINE')
    expect((screen.getByLabelText('Sort') as HTMLSelectElement).value).toBe('RESPONSE_DEADLINE')

    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'LONGEST_WAITING')
    await waitFor(() => expect(lastListQuery(support.calls).get('sort')).toBe('LONGEST_WAITING'))
    expect(support.router.state.location.search).toBe('?sort=LONGEST_WAITING')

    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'RESPONSE_DEADLINE')
    await waitFor(() => expect(support.router.state.location.search).toBe(''))
  })

  it('lists a customer by the latest update first', async () => {
    const { calls } = renderList('USER')
    await screen.findByRole('link', { name: 'RET-1042' })
    expect(lastListQuery(calls).get('sort')).toBe('RECENTLY_UPDATED')
  })

  it('switches views as presets of the filters, and shows a view pressed only for its own filters', async () => {
    const { calls } = renderList('SUPPORT')
    await screen.findByRole('link', { name: 'RET-1042' })
    const views = within(screen.getByRole('group', { name: 'View' }))
    expect(views.getByRole('button', { name: 'All tickets' }).getAttribute('aria-pressed')).toBe(
      'true',
    )

    await userEvent.click(views.getByRole('button', { name: 'Assigned to me' }))
    await waitFor(() => expect(lastListQuery(calls).get('assigneeId')).toBe(SUPPORT_ID))
    expect(views.getByRole('button', { name: 'Assigned to me' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeTruthy()

    await userEvent.click(await views.findByRole('button', { name: 'My team' }))
    await waitFor(() => expect(lastListQuery(calls).get('teamId')).toBe(TEAM_ID))
    expect(lastListQuery(calls).has('assigneeId')).toBe(false)

    await openFilters()
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'HIGH')
    await waitFor(() => expect(lastListQuery(calls).get('priority')).toBe('HIGH'))
    for (const view of views.getAllByRole('button')) {
      expect(view.getAttribute('aria-pressed')).toBe('false')
    }

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(lastListQuery(calls).has('priority')).toBe(false))
    expect(lastListQuery(calls).has('teamId')).toBe(false)
  })

  it('offers a customer the tickets they raised as a view', async () => {
    const { calls } = renderList('USER')
    await screen.findByRole('link', { name: 'RET-1042' })

    await userEvent.click(screen.getByRole('button', { name: 'Raised by me' }))
    await waitFor(() => expect(lastListQuery(calls).get('authorId')).toBe(SUPPORT_ID))
  })

  it('offers a customer the tickets waiting for their answer as a view the URL keeps', async () => {
    const { calls, router } = renderList('USER')
    await screen.findByRole('link', { name: 'RET-1042' })
    const views = within(screen.getByRole('group', { name: 'View' }))

    await userEvent.click(views.getByRole('button', { name: 'Needs my answer' }))
    await waitFor(() =>
      expect(lastListQuery(calls).getAll('status')).toEqual(['WAITING_FOR_CUSTOMER']),
    )
    expect(router.state.location.search).toBe('?status=WAITING_FOR_CUSTOMER')
    expect(
      views.getByRole('button', { name: 'Needs my answer' }).getAttribute('aria-pressed'),
    ).toBe('true')

    // A second status narrows it past the view.
    await openFilters()
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: 'New' }))
    await waitFor(() => expect(lastListQuery(calls).getAll('status')).toHaveLength(2))
    expect(
      views.getByRole('button', { name: 'Needs my answer' }).getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('opens a customer on the Needs my answer view from its URL, dropping a status it does not know', async () => {
    const { calls } = renderList('USER', page(), '/?status=WAITING_FOR_CUSTOMER&status=ON_HOLD')
    await screen.findByRole('link', { name: 'RET-1042' })

    expect(lastListQuery(calls).getAll('status')).toEqual(['WAITING_FOR_CUSTOMER'])
    const views = within(screen.getByRole('group', { name: 'View' }))
    expect(
      views.getByRole('button', { name: 'Needs my answer' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it.each([
    ['a customer', 'USER' as const, TEAMMATE_ID],
    ['support staff', 'SUPPORT' as const, SUPPORT_ID],
  ])(
    'ignores an author in the URL for %s when no view shows it',
    async (_reader, role, authorId) => {
      const { calls } = renderList(role, page(), `/?authorId=${authorId}`)
      await screen.findByRole('link', { name: 'RET-1042' })

      expect(lastListQuery(calls).has('authorId')).toBe(false)
      expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy()
      const views = within(screen.getByRole('group', { name: 'View' }))
      expect(views.getByRole('button', { name: 'All tickets' }).getAttribute('aria-pressed')).toBe(
        'true',
      )
    },
  )

  it('opens the filters by itself when the URL brings some', async () => {
    renderList('SUPPORT', page(), '/?slaBreached=true')

    expect(await screen.findByRole('button', { name: 'Filters (1)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Filters (1)' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
    // No view holds the breaches, so none reads as pressed.
    const views = within(screen.getByRole('group', { name: 'View' }))
    for (const view of views.getAllByRole('button')) {
      expect(view.getAttribute('aria-pressed')).toBe('false')
    }
  })

  it('counts Within SLA as a filter, so All tickets is not pressed while it narrows the list', async () => {
    renderList('SUPPORT', page(), '/?slaBreached=false')

    expect(await screen.findByRole('button', { name: 'Filters (1)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy()
    const views = within(screen.getByRole('group', { name: 'View' }))
    expect(views.getByRole('button', { name: 'All tickets' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it("counts support staff's views and the desk's open work, whatever the search", async () => {
    const counts = {
      all: 50,
      assignedToMe: 4,
      myTeam: 1,
      pastDeadline: 7,
      dueWithinHour: 3,
      unansweredCustomerComment: 1,
      unassigned: 0,
    }
    const { calls } = renderList('SUPPORT', page(), '/?text=export', [
      ['/api/tickets/counts', () => jsonResponse(counts)],
    ])
    await screen.findByRole('link', { name: 'RET-1042' })

    const views = within(screen.getByRole('group', { name: 'View' }))
    expect(await views.findByRole('button', { name: 'All tickets, 50 tickets' })).toBeTruthy()
    expect(views.getByRole('button', { name: 'Assigned to me, 4 tickets' })).toBeTruthy()
    expect(views.getByRole('button', { name: 'My team, 1 ticket' })).toBeTruthy()
    // The desk's breach count is the one way in to the breaches, so no view repeats it.
    expect(views.getAllByRole('button')).toHaveLength(3)
    const desk = screen.getByRole('list', { name: 'Across all tickets:' })
    expect(
      within(desk)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '7 SLA breaches still unanswered',
      '3 due within an hour',
      '1 with an unanswered customer comment',
      '0 open and unassigned',
    ])
    expect(within(desk).getByText('7').hasAttribute('data-attention')).toBe(true)
    expect(within(desk).getByText('0').hasAttribute('data-attention')).toBe(false)
    // Each count opens the list narrowed to it; an empty one has nothing to open.
    expect(
      within(desk)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/?attention=PAST_DEADLINE',
      '/?attention=DUE_WITHIN_HOUR',
      '/?attention=UNANSWERED_CUSTOMER_COMMENT',
    ])
    expect(calls.filter((call) => call.url.startsWith('/api/tickets/counts')).at(-1)?.url).toBe(
      '/api/tickets/counts',
    )
    expect(calls.some((call) => call.url.startsWith('/api/tickets/customer-counts'))).toBe(false)
  })

  it('opens the list narrowed to a desk count, naming it as a filter, above the search it ignores', async () => {
    const counts = {
      all: 50,
      assignedToMe: 4,
      myTeam: 1,
      pastDeadline: 7,
      dueWithinHour: 3,
      unansweredCustomerComment: 2,
      unassigned: 4,
    }
    const { calls, router } = renderList('SUPPORT', page(), '/?text=export&priority=HIGH', [
      ['/api/tickets/counts', () => jsonResponse(counts)],
    ])
    await screen.findByRole('link', { name: 'RET-1042' })
    const desk = await screen.findByRole('list', { name: 'Across all tickets:' })
    expect(
      desk.compareDocumentPosition(screen.getByLabelText(SEARCH)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    await userEvent.click(
      within(desk).getByRole('link', { name: '2 with an unanswered customer comment' }),
    )

    await waitFor(() =>
      expect(router.state.location.search).toBe('?attention=UNANSWERED_CUSTOMER_COMMENT'),
    )
    await waitFor(() =>
      expect(lastListQuery(calls).get('attention')).toBe('UNANSWERED_CUSTOMER_COMMENT'),
    )
    expect(lastListQuery(calls).get('text')).toBeNull()
    expect(
      within(desk)
        .getByRole('link', { name: '2 with an unanswered customer comment' })
        .getAttribute('aria-current'),
    ).toBe('page')
    expect((screen.getByLabelText('Needs attention') as HTMLSelectElement).value).toBe(
      'UNANSWERED_CUSTOMER_COMMENT',
    )

    // Narrowed further, the list is no longer that count's.
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'HIGH')
    await waitFor(() =>
      expect(
        within(desk)
          .getByRole('link', { name: '2 with an unanswered customer comment' })
          .hasAttribute('aria-current'),
      ).toBe(false),
    )
  })

  it('tells support staff a customer wrote since their last public comment, in Ink, not red', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
    const commented = ticketSummary({
      reference: 'RET-1036',
      status: 'IN_PROGRESS',
      firstResponseAt: '2026-10-08T09:00:00Z',
      sla: { responseDeadline: '2026-10-08T12:00:00Z', waitingSeconds: 3600, breached: false },
      unansweredCustomerCommentAt: '2026-10-09T11:40:00Z',
    })
    renderList('SUPPORT', page([commented]))

    await screen.findByRole('link', { name: 'RET-1036' })
    const row = screen.getAllByRole('row')[1]
    const clock = within(row).getByText('Customer wrote 20 min ago')
    expect(clock.dataset.clock).toBe('customerComment')
    expect(row.querySelector('[data-tone="danger"]')).toBeNull()
    expect(within(row).queryByText('Answered in 1 h')).toBeNull()
  })

  it("drops the desk filter from a customer's URL", async () => {
    const { calls } = renderList('USER', page(), '/?attention=UNASSIGNED')
    await screen.findByRole('link', { name: 'RET-1042' })

    expect(lastListQuery(calls).get('attention')).toBeNull()
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy()
  })

  it("counts a customer's views, so they see how many tickets wait for their answer", async () => {
    const counts = { all: 13, waitingForCustomer: 3, raisedByMe: 1 }
    renderList('USER', page(), '/', [['/api/tickets/customer-counts', () => jsonResponse(counts)]])
    await screen.findByRole('link', { name: 'RET-1042' })

    const views = within(screen.getByRole('group', { name: 'View' }))
    const needsAnswer = await views.findByRole('button', { name: 'Needs my answer, 3 tickets' })
    expect(views.getByRole('button', { name: 'All tickets, 13 tickets' })).toBeTruthy()
    expect(views.getByRole('button', { name: 'Raised by me, 1 ticket' })).toBeTruthy()
    // Only the tickets waiting for the customer stand out, and only while there are some.
    expect(within(needsAnswer).getByText('3').hasAttribute('data-attention')).toBe(true)
    expect(views.getByText('13').hasAttribute('data-attention')).toBe(false)
  })

  it('keeps the Needs my answer count quiet when nothing waits for the customer', async () => {
    const counts = { all: 13, waitingForCustomer: 0, raisedByMe: 1 }
    renderList('USER', page(), '/', [['/api/tickets/customer-counts', () => jsonResponse(counts)]])
    await screen.findByRole('link', { name: 'RET-1042' })

    const views = within(screen.getByRole('group', { name: 'View' }))
    const needsAnswer = await views.findByRole('button', { name: 'Needs my answer, 0 tickets' })
    expect(within(needsAnswer).getByText('0').hasAttribute('data-attention')).toBe(false)
  })

  it('never asks a customer for the desk counts', async () => {
    const { calls } = renderList('USER')
    await screen.findByRole('link', { name: 'RET-1042' })

    expect(calls.some((call) => call.url.startsWith('/api/tickets/counts'))).toBe(false)
    expect(screen.queryByRole('list', { name: 'Across all tickets:' })).toBeNull()
    expect(screen.getByRole('button', { name: 'All tickets' })).toBeTruthy()
  })

  it('leads the title of a critical ticket with its priority, for a screen reader too', async () => {
    const critical = ticketSummary({ reference: 'RET-1036', priority: 'CRITICAL' })
    const high = ticketSummary({ reference: 'RET-1001', priority: 'HIGH' })
    renderList('SUPPORT', page([critical, high]))

    await screen.findByRole('link', { name: 'RET-1036' })
    const [, criticalRow, highRow] = screen.getAllByRole('row')
    expect(within(criticalRow).getByText(/^Critical priority:/)).toBeTruthy()
    expect(within(criticalRow).getAllByText('Critical')).toHaveLength(2)
    expect(within(highRow).queryByText(/^Critical priority:/)).toBeNull()
  })

  it('leaves out the organization column for a customer, who only sees their own', async () => {
    renderList('USER')

    await screen.findByRole('link', { name: 'RET-1042' })
    expect(screen.queryByRole('columnheader', { name: 'Organization' })).toBeNull()
  })

  it('sends the search text and filters, each starting again from the first page', async () => {
    const { calls } = renderList('SUPPORT', page([ticketSummary()], 45), '/?page=2')
    await screen.findByRole('link', { name: 'RET-1042' })
    expect(lastListQuery(calls).get('page')).toBe('2')

    await userEvent.type(screen.getByLabelText(SEARCH), 'export')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(lastListQuery(calls).get('text')).toBe('export'))
    expect(lastListQuery(calls).get('page')).toBe('0')

    await openFilters()
    await userEvent.selectOptions(screen.getByLabelText('SLA'), 'breached')
    await waitFor(() => expect(lastListQuery(calls).get('slaBreached')).toBe('true'))
    expect(lastListQuery(calls).get('text')).toBe('export')
  })

  it('asks for several statuses at once, and for any again', async () => {
    const { calls } = renderList('SUPPORT')
    await screen.findByRole('link', { name: 'RET-1042' })

    await openFilters()
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: 'In progress' }))
    await waitFor(() => expect(lastListQuery(calls).getAll('status')).toEqual(['IN_PROGRESS']))
    await userEvent.click(screen.getByRole('option', { name: 'New' }))
    await waitFor(() =>
      expect(lastListQuery(calls).getAll('status')).toEqual(['NEW', 'IN_PROGRESS']),
    )
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toContain(
      'New, In progress',
    )

    await userEvent.click(screen.getByRole('option', { name: 'Any status' }))
    await waitFor(() => expect(lastListQuery(calls).has('status')).toBe(false))
  })

  it('narrows by one category and one priority, and by any again', async () => {
    const { calls } = renderList('USER')
    await screen.findByRole('link', { name: 'RET-1042' })

    await openFilters()
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'BUG')
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'HIGH')
    await waitFor(() => expect(lastListQuery(calls).getAll('priority')).toEqual(['HIGH']))
    expect(lastListQuery(calls).getAll('category')).toEqual(['BUG'])

    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Any category')
    await waitFor(() => expect(lastListQuery(calls).has('category')).toBe(false))
  })

  it('offers support staff My team and Me as their own ids, combined with the organization', async () => {
    const { calls } = renderList('SUPPORT')
    await screen.findByRole('link', { name: 'RET-1042' })

    await openFilters()
    await userEvent.selectOptions(screen.getByLabelText('Organization'), 'Acme Corp')
    await userEvent.selectOptions(await screen.findByLabelText('Team'), 'My team')
    await userEvent.selectOptions(screen.getByLabelText('Assignee'), 'Me')

    await waitFor(() => expect(lastListQuery(calls).get('assigneeId')).toBe(SUPPORT_ID))
    expect(lastListQuery(calls).get('teamId')).toBe(TEAM_ID)
    expect(lastListQuery(calls).get('organizationId')).toBe(ORGANIZATION_ID)
  })

  it('offers the support staff of the chosen team, Me only on my own team or with no team', async () => {
    const { calls } = renderList('SUPPORT')
    await screen.findByRole('link', { name: 'RET-1042' })

    await openFilters()
    await waitFor(() => expect(optionNames('Team')).toEqual(['Any team', 'My team', 'Projects']))
    expect(optionNames('Assignee')).toEqual(['Anyone', 'Me', 'Ola Nowak', 'Tom Lee'])

    await userEvent.selectOptions(screen.getByLabelText('Team'), 'My team')
    expect(optionNames('Assignee')).toEqual(['Anyone', 'Me', 'Tom Lee'])

    await userEvent.selectOptions(screen.getByLabelText('Assignee'), 'Me')
    await userEvent.selectOptions(screen.getByLabelText('Team'), 'Projects')

    expect(optionNames('Assignee')).toEqual(['Anyone', 'Ola Nowak'])
    await waitFor(() => expect(lastListQuery(calls).get('teamId')).toBe(OTHER_TEAM_ID))
    expect(lastListQuery(calls).has('assigneeId')).toBe(false)
  })

  it('shows a team or person from the URL that the reader cannot name as unknown', async () => {
    const stranger = '00000000-0000-0000-0000-00000000ffff'
    renderList('SUPPORT', page(), `/?assigneeId=${stranger}`)

    await waitFor(() => expect(optionNames('Assignee')).toContain('Unknown'))
    expect((screen.getByLabelText('Assignee') as HTMLSelectElement).value).toBe(stranger)
  })

  it('names a team and a person from the URL even outside the listed choices', async () => {
    const { calls } = renderList(
      'SUPPORT',
      page(),
      `/?teamId=${TEAM_ID.toUpperCase()}&assigneeId=${OTHER_MEMBER_ID}`,
    )
    await screen.findByRole('link', { name: 'RET-1042' })

    await waitFor(() => expect(optionNames('Assignee')).toContain('Ola Nowak'))
    const team = screen.getByLabelText('Team') as HTMLSelectElement
    expect(team.selectedOptions[0]?.textContent).toBe('My team')
    const assignee = screen.getByLabelText('Assignee') as HTMLSelectElement
    expect(assignee.selectedOptions[0]?.textContent).toBe('Ola Nowak')
    expect(lastListQuery(calls).get('teamId')).toBe(TEAM_ID)
  })

  it('says so when the teams or organizations behind the filters fail to load', async () => {
    const failure = () => jsonResponse({ type: 'https://retrofit.app/problems/internal' }, 500)
    renderList('SUPPORT', page(), '/', [['/api/teams', failure]])

    await screen.findByRole('link', { name: 'RET-1042' })
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy()
  })

  it('offers a customer no organization, team, assignee or SLA filter and never asks for teams', async () => {
    const { calls } = renderList('USER')
    await screen.findByRole('link', { name: 'RET-1042' })

    expect(screen.getByLabelText('Priority')).toBeTruthy()
    expect(screen.queryByLabelText('Organization')).toBeNull()
    expect(screen.queryByLabelText('Team')).toBeNull()
    expect(screen.queryByLabelText('Assignee')).toBeNull()
    expect(screen.queryByLabelText('SLA')).toBeNull()
    expect(calls.some((call) => call.url.startsWith('/api/teams'))).toBe(false)
  })

  it('shows the same filters and page after opening a ticket and going back', async () => {
    const { calls, router } = renderList('SUPPORT', page([ticketSummary()], 45))
    await screen.findByRole('link', { name: 'RET-1042' })

    await userEvent.type(screen.getByLabelText(SEARCH), 'export')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await openFilters()
    await userEvent.selectOptions(screen.getByLabelText('SLA'), 'breached')
    await userEvent.selectOptions(await screen.findByLabelText('Team'), 'My team')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastListQuery(calls).get('page')).toBe('1'))

    await userEvent.click(screen.getByRole('link', { name: 'RET-1042' }))
    await screen.findByRole('link', { name: 'All tickets' })
    await act(() => router.navigate(-1))

    await screen.findByRole('link', { name: 'RET-1042' })
    expect((screen.getByLabelText(SEARCH) as HTMLInputElement).value).toBe('export')
    expect((screen.getByLabelText('SLA') as HTMLSelectElement).value).toBe('breached')
    expect((screen.getByLabelText('Team') as HTMLSelectElement).value).toBe(TEAM_ID)
    expect(screen.getByText('21–40 of 45')).toBeTruthy()
    const query = lastListQuery(calls)
    expect(query.get('page')).toBe('1')
    expect(query.get('text')).toBe('export')
    expect(query.get('teamId')).toBe(TEAM_ID)
  })

  it("brings the next page's first row into view and leaves the focus on the pager", async () => {
    const { calls } = renderList('SUPPORT', page([ticketSummary()], 45))
    await screen.findByRole('link', { name: 'RET-1042' })
    // Paged from the bottom of a long list: the table starts 600px above the viewport.
    const table = screen.getByRole('table')
    vi.spyOn(table, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, -600, 800, 900))
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)

    const next = screen.getByRole('button', { name: 'Next' })
    await userEvent.click(next)

    await waitFor(() => expect(lastListQuery(calls).get('page')).toBe('1'))
    expect(scrollBy).toHaveBeenCalledWith({ top: -612 })
    expect(document.activeElement).toBe(next)
  })

  it('hands the focus to the other pager button when the pressed one disables', async () => {
    renderList('SUPPORT', page([ticketSummary()], 45), '/?page=1')
    await screen.findByText('21–40 of 45')

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('41–45 of 45')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Previous' }))

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await screen.findByText('1–20 of 45')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next' }))
  })

  it('leaves the scroll alone when the table top is already in view', async () => {
    const { calls } = renderList('SUPPORT', page([ticketSummary()], 45))
    await screen.findByRole('link', { name: 'RET-1042' })
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(lastListQuery(calls).get('page')).toBe('1'))
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it("returns to the same filters and page from the ticket's All tickets link", async () => {
    const { calls } = renderList(
      'SUPPORT',
      page([ticketSummary()], 45),
      '/?slaBreached=true&page=1',
    )
    await screen.findByRole('link', { name: 'RET-1042' })

    await userEvent.click(screen.getByRole('link', { name: 'RET-1042' }))
    await userEvent.click(await screen.findByRole('link', { name: 'All tickets' }))

    await screen.findByRole('link', { name: 'RET-1042' })
    expect((screen.getByLabelText('SLA') as HTMLSelectElement).value).toBe('breached')
    expect(lastListQuery(calls).get('page')).toBe('1')
  })

  it('moves a page past the end, such as one a closed ticket left behind, to the last page', async () => {
    const lastPageOnly = (url: string) => {
      const requested = new URLSearchParams(url.split('?')[1]).get('page')
      return jsonResponse({ items: requested === '1' ? [ticketSummary()] : [], total: 21 })
    }
    const { calls } = renderList('SUPPORT', lastPageOnly, '/?page=5')

    await screen.findByRole('link', { name: 'RET-1042' })
    expect(lastListQuery(calls).get('page')).toBe('1')
    expect(screen.getByText('21–21 of 21')).toBeTruthy()
  })

  it('keeps the focus in the search box after a search, and takes text a URL brings', async () => {
    const { calls, router } = renderList('SUPPORT')
    await screen.findByRole('link', { name: 'RET-1042' })

    await userEvent.type(screen.getByLabelText(SEARCH), 'export{Enter}')
    await waitFor(() => expect(lastListQuery(calls).get('text')).toBe('export'))
    expect(document.activeElement).toBe(screen.getByLabelText(SEARCH))

    await act(() => router.navigate('/?text=invoice'))
    expect((screen.getByLabelText(SEARCH) as HTMLInputElement).value).toBe('invoice')
  })

  it('stays on its page when a pick or a search changes nothing', async () => {
    const { calls } = renderList('SUPPORT', page([ticketSummary()], 45), '/?text=export&page=2')
    await screen.findByRole('link', { name: 'RET-1042' })
    await openFilters()
    const requests = calls.length

    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Any status' }))
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(screen.getByText('41–45 of 45')).toBeTruthy()
    expect(calls.length).toBe(requests)
  })

  it('lists what the URL asks for: repeated statuses, category, priority, SLA and page', async () => {
    const { calls } = renderList(
      'SUPPORT',
      page([ticketSummary()], 45),
      '/?text=export&status=NEW&status=IN_PROGRESS&category=BUG&priority=HIGH&slaBreached=true&page=2',
    )
    await screen.findByRole('link', { name: 'RET-1042' })

    const query = lastListQuery(calls)
    expect(query.get('text')).toBe('export')
    expect(query.getAll('status')).toEqual(['NEW', 'IN_PROGRESS'])
    expect(query.getAll('category')).toEqual(['BUG'])
    expect(query.getAll('priority')).toEqual(['HIGH'])
    expect(query.get('slaBreached')).toBe('true')
    expect(query.get('page')).toBe('2')
  })

  it('drops what the API would refuse from a hand-edited URL', async () => {
    const { calls } = renderList(
      'SUPPORT',
      page(),
      '/?status=OPEN&status=NEW&category=bug&priority=&teamId=team-1' +
        `&assigneeId=${SUPPORT_ID}&slaBreached=yes&page=-1`,
    )
    await screen.findByRole('link', { name: 'RET-1042' })

    const query = lastListQuery(calls)
    expect(query.getAll('status')).toEqual(['NEW'])
    expect(query.has('category')).toBe(false)
    expect(query.has('priority')).toBe(false)
    expect(query.has('teamId')).toBe(false)
    expect(query.get('assigneeId')).toBe(SUPPORT_ID)
    expect(query.has('slaBreached')).toBe(false)
    expect(query.get('page')).toBe('0')
    expect(screen.queryByText('Something went wrong. Please try again.')).toBeNull()
  })

  it("ignores the organization, team, assignee and SLA in a customer's URL", async () => {
    const { calls } = renderList(
      'USER',
      page(),
      `/?organizationId=${ORGANIZATION_ID}&teamId=${TEAM_ID}&assigneeId=${SUPPORT_ID}` +
        '&slaBreached=true&status=NEW',
    )
    await screen.findByRole('link', { name: 'RET-1042' })

    const query = lastListQuery(calls)
    expect(query.getAll('status')).toEqual(['NEW'])
    expect(query.has('organizationId')).toBe(false)
    expect(query.has('teamId')).toBe(false)
    expect(query.has('assigneeId')).toBe(false)
    expect(query.has('slaBreached')).toBe(false)
    // Nothing the customer cannot see is counted or offered as a chip to remove.
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeTruthy()
    expect(screen.queryByText(/^SLA/)).toBeNull()
  })

  it('says so when no ticket matches', async () => {
    renderList('SUPPORT', page([]))

    expect(await screen.findByText('No tickets')).toBeTruthy()
    expect(screen.getByText('No ticket has been raised yet.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('names the search and the filters that matched nothing, and clears each apart', async () => {
    const { router } = renderList(
      'SUPPORT',
      page([]),
      '/?text=invoice&priority=HIGH&slaBreached=true',
    )

    const both = await screen.findByText(
      'No ticket matches “invoice” with the filters Priority: High and SLA: Breached.',
    )
    await userEvent.click(within(both).getByRole('button', { name: 'Clear search' }))
    await waitFor(() =>
      expect(router.state.location.search).toBe('?priority=HIGH&slaBreached=true'),
    )
    expect(document.activeElement).toBe(screen.getByLabelText(SEARCH))

    const filtersOnly = await screen.findByText(
      'No ticket matches the filters Priority: High and SLA: Breached.',
    )
    expect(within(filtersOnly).queryByRole('button', { name: 'Clear search' })).toBeNull()
    await userEvent.click(within(filtersOnly).getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filters' }))
    expect(await screen.findByText('No ticket has been raised yet.')).toBeTruthy()
  })

  it('offers only Clear search when a search alone matched nothing', async () => {
    renderList('SUPPORT', page([]), '/?text=invoice')

    const hint = await screen.findByText('No ticket matches “invoice”.')
    expect(within(hint).getByRole('button', { name: 'Clear search' })).toBeTruthy()
    expect(within(hint).queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('names a single filter, and a team by its name from the teams list', async () => {
    renderList('SUPPORT', page([]), `/?teamId=${OTHER_TEAM_ID}`)

    const hint = await screen.findByText('No ticket matches the filter Team: Projects.')
    expect(within(hint).getByRole('button', { name: 'Clear filters' })).toBeTruthy()
    expect(within(hint).queryByRole('button', { name: 'Clear search' })).toBeNull()
  })

  it('keeps folded filters in sight as chips that each lift one, moving the focus along', async () => {
    const { router } = renderList(
      'SUPPORT',
      page(),
      '/?status=NEW&status=IN_PROGRESS&priority=HIGH',
    )
    await screen.findByRole('link', { name: 'RET-1042' })
    // Open, the fields show the filters themselves.
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Filters (2)' }))
    const chips = within(screen.getByRole('list', { name: 'Active filters' }))
    expect(
      chips
        .getAllByRole('button', { name: /^Remove filter/ })
        .map((chip) => chip.getAttribute('aria-label')),
    ).toEqual([
      'Remove filter Status: New',
      'Remove filter Status: In progress',
      'Remove filter Priority: High',
    ])

    await userEvent.click(chips.getByRole('button', { name: 'Remove filter Status: New' }))
    await waitFor(() =>
      expect(router.state.location.search).toBe('?status=IN_PROGRESS&priority=HIGH'),
    )
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        'Remove filter Status: In progress',
      ),
    )

    await userEvent.click(chips.getByRole('button', { name: 'Remove filter Priority: High' }))
    await waitFor(() => expect(router.state.location.search).toBe('?status=IN_PROGRESS'))
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe(
        'Remove filter Status: In progress',
      ),
    )

    await userEvent.click(chips.getByRole('button', { name: 'Remove filter Status: In progress' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull()
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filters' })),
    )
  })

  it('clears every folded filter at once, keeping the search, and hands the focus to Filters', async () => {
    const { router } = renderList(
      'SUPPORT',
      page(),
      '/?text=export&priority=HIGH&attention=UNASSIGNED',
    )
    await screen.findByRole('link', { name: 'RET-1042' })
    await userEvent.click(screen.getByRole('button', { name: 'Filters (2)' }))
    const chips = within(screen.getByRole('list', { name: 'Active filters' }))
    expect(
      chips.getByRole('button', { name: 'Remove filter Needs attention: Open, unassigned' }),
    ).toBeTruthy()

    await userEvent.click(chips.getByRole('button', { name: 'Clear all' }))

    await waitFor(() => expect(router.state.location.search).toBe('?text=export'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filters' }))
  })

  it('offers Clear all only beside several chips', async () => {
    renderList('SUPPORT', page(), '/?priority=HIGH')
    await screen.findByRole('link', { name: 'RET-1042' })
    await userEvent.click(screen.getByRole('button', { name: 'Filters (1)' }))

    expect(screen.getByRole('button', { name: 'Remove filter Priority: High' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()
  })

  it('marks which fields of the open filters narrow the list', async () => {
    renderList('SUPPORT', page(), `/?priority=HIGH&organizationId=${ORGANIZATION_ID}`)
    await screen.findByRole('link', { name: 'RET-1042' })

    const setMark = (label: string) => screen.getByLabelText(label).closest('[data-set]') !== null
    expect(setMark('Priority')).toBe(true)
    expect(setMark('Organization')).toBe(true)
    expect(setMark('Category')).toBe(false)
    expect(setMark('Team')).toBe(false)
    expect(setMark('SLA')).toBe(false)
    expect(setMark('Needs attention')).toBe(false)
  })

  it('shows no pager buttons when every ticket fits on one page', async () => {
    renderList('SUPPORT', page([ticketSummary()], 3))
    await screen.findByText('1–3 of 3')

    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it("names a customer's Raised by me as a chip beside another filter", async () => {
    const { calls } = renderList('USER', page(), `/?authorId=${SUPPORT_ID}&category=BUG`)
    await screen.findByRole('link', { name: 'RET-1042' })

    await userEvent.click(screen.getByRole('button', { name: 'Filters (2)' }))
    const chips = within(screen.getByRole('list', { name: 'Active filters' }))
    expect(
      chips
        .getAllByRole('button', { name: /^Remove filter/ })
        .map((chip) => chip.getAttribute('aria-label')),
    ).toEqual(['Remove filter Category: Bug', 'Remove filter Raised by me'])
    expect(calls.some((call) => call.url.startsWith('/api/teams'))).toBe(false)
  })

  it('shows no chips while a pressed view names the filters', async () => {
    renderList('SUPPORT')
    await screen.findByRole('link', { name: 'RET-1042' })

    await userEvent.click(screen.getByRole('button', { name: 'Assigned to me' }))
    await screen.findByRole('button', { name: 'Filters (1)' })
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull()

    await openFilters()
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'HIGH')
    await userEvent.click(screen.getByRole('button', { name: 'Filters (2)' }))
    const chips = within(screen.getByRole('list', { name: 'Active filters' }))
    expect(chips.getByRole('button', { name: 'Remove filter Assignee: Me' })).toBeTruthy()

    await userEvent.click(chips.getByRole('button', { name: 'Remove filter Priority: High' }))
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filters (1)' }))
  })

  it('shows only the error when the list fails to load, not the empty state', async () => {
    renderList('SUPPORT', () =>
      jsonResponse({ type: 'https://retrofit.app/problems/internal', status: 500 }, 500),
    )

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy()
    expect(screen.queryByText('No tickets')).toBeNull()
  })

  it('loads the list again from Try again after a failure', async () => {
    let failing = true
    const answer = page()
    renderList('SUPPORT', () =>
      failing
        ? jsonResponse({ type: 'https://retrofit.app/problems/internal', status: 500 }, 500)
        : answer(),
    )

    const retry = await screen.findByRole('button', { name: 'Try again' })
    failing = false
    await userEvent.click(retry)

    expect(await screen.findByRole('link', { name: 'RET-1042' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
})

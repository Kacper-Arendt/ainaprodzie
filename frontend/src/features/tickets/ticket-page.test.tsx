import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { focusManager } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { jsonResponse, renderRoutes, stubFetch } from '../../test/harness.tsx'
import { ticketDetails, ticketSummary } from './ticket-fixtures.ts'
import { TicketPage } from './ticket-page.tsx'
import type { TicketDetails, TicketSummary } from './use-tickets.ts'

const TICKET_URL = '/api/tickets/RET-1042'

// The customer is the fixture ticket's author, so they may close it.
const session = (role: 'USER' | 'SUPPORT') => ({
  id: role === 'USER' ? ticketSummary().author.id : '00000000-0000-0000-0000-000000000001',
  email: 'jane@example.com',
  displayName: 'Jane Doe',
  roles: [role],
  language: 'en',
})

const CUSTOMER_COMMENT = 'Public comment, visible to support staff and your colleagues at Acme Corp'

const problem = (slug: string, status: number) =>
  jsonResponse({ type: `https://retrofit.app/problems/${slug}`, title: slug, status }, status)

/** The closed-ticket notice, whose way on is a link inside the sentence. */
const closedNotice = (_: string, element: Element | null) =>
  element?.tagName === 'P' &&
  element.textContent === 'This ticket is closed. To follow up, create a new ticket.'

const closedTicket = () =>
  ticketDetails({
    summary: ticketSummary({ status: 'CLOSED', closedAt: '2026-10-09T11:20:00Z' }),
    resolution: 'Fixed in release 2.4.1.',
    version: 4,
  })

function renderTicket(reference: string) {
  renderRoutes([{ path: '/tickets/:reference', element: <TicketPage /> }], `/tickets/${reference}`)
}

/**
 * The ticket page as `role` sees it. Each GET of the ticket answers the next
 * entry of `tickets` (the last one repeats), so a refetch can see a newer state.
 */
function renderAs(
  role: 'USER' | 'SUPPORT',
  tickets: TicketDetails[],
  writes: Array<[string, () => Response]> = [],
) {
  let read = 0
  const calls = stubFetch([
    ['/api/auth/session', () => jsonResponse(session(role))],
    ...writes,
    [TICKET_URL, () => jsonResponse(tickets[Math.min(read++, tickets.length - 1)])],
  ])
  renderTicket('RET-1042')
  const reads = () => calls.filter((call) => call.url === TICKET_URL && call.method === 'GET')
  return { calls, reads }
}

async function openTicket() {
  await screen.findByRole('heading', { level: 1, name: 'RET-1042 · Export does not work' })
}

const searchAnswer =
  (...summaries: TicketSummary[]) =>
  () =>
    jsonResponse({ items: summaries, total: summaries.length })

const SEARCH_RESULTS = searchAnswer(
  ticketSummary(),
  ticketSummary({ reference: 'RET-1003', title: 'SSO login loop on Safari', status: 'CLOSED' }),
  ticketSummary({ reference: 'RET-1001', title: 'Login fails on SSO' }),
)

/**
 * Types like a person rather than in one burst: the combobox writes the
 * controlled text back to its input after a render, so keystrokes with no
 * pause between them land on a stale value in jsdom.
 */
function typeSearch(input: HTMLElement, text: string) {
  return userEvent.type(input, text, { delay: 20 })
}

/** The search's options; the native selects on the page hold options too. */
function searchOptions() {
  const listbox = screen.queryByRole('listbox')
  return listbox === null ? [] : within(listbox).queryAllByRole('option')
}

function findSearchOptions() {
  return waitFor(() => {
    const options = searchOptions()
    expect(options).not.toEqual([])
    return options
  })
}

/** A JSON answer whose body arrives only when `release` is called, so its request stays pending. */
function heldAnswer(body: unknown, status = 200) {
  let release = () => {}
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        release = () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(body)))
          controller.close()
        }
      },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
  return { response, release: () => release() }
}

const linkTo = (reference: string) => ({
  relation: 'RELATED' as const,
  reference,
  title: `Ticket ${reference}`,
  status: 'NEW' as const,
})

// Drops focus as a browser does from a button disabled while its write is pending; jsdom keeps it.
function blurActive() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

/** Unfolds Link a ticket and returns its Ticket field, which takes the focus. */
async function openLinkForm() {
  await userEvent.click(await screen.findByRole('button', { name: 'Link a ticket' }))
  return screen.getByRole('combobox', { name: 'Ticket' })
}

function linksPanel() {
  return screen.getByRole('heading', { name: 'Linked tickets' }).parentElement!.parentElement!
}

/** Each history line as a screen reader hears it: without what is `aria-hidden`. */
function historyLines() {
  const history = screen.getByRole('heading', { name: 'History' }).parentElement!.parentElement!
  return within(history)
    .getAllByRole('listitem')
    .map((line) => {
      const heard = line.cloneNode(true) as HTMLElement
      heard.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove())
      return heard.textContent
    })
}

describe('TicketPage when loading fails', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('offers Try again and the way back when the ticket cannot be loaded', async () => {
    let failing = true
    stubFetch([
      ['/api/auth/session', () => jsonResponse(session('USER'))],
      [TICKET_URL, () => (failing ? problem('internal', 500) : jsonResponse(ticketDetails()))],
    ])
    renderTicket('RET-1042')

    expect(await screen.findByRole('heading', { level: 1, name: 'RET-1042' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'All tickets' })).toBeTruthy()
    failing = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await openTicket()
  })

  it('keeps a loaded ticket and its draft on screen when a refetch fails', async () => {
    let failing = false
    stubFetch([
      ['/api/auth/session', () => jsonResponse(session('USER'))],
      [TICKET_URL, () => (failing ? problem('internal', 500) : jsonResponse(ticketDetails()))],
    ])
    renderTicket('RET-1042')
    await openTicket()
    await userEvent.type(screen.getByLabelText(CUSTOMER_COMMENT), 'Still broken')

    failing = true
    // Coming back to the tab refetches the ticket, which is stale at once.
    act(() => focusManager.setFocused(true))
    focusManager.setFocused(undefined)
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === TICKET_URL).length).toBe(
        2,
      ),
    )

    await openTicket()
    expect((screen.getByLabelText(CUSTOMER_COMMENT) as HTMLTextAreaElement).value).toBe(
      'Still broken',
    )
  })
})

describe('TicketPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows the ticket with its facts, conversation, links and history', async () => {
    const calls = stubFetch([['/api/tickets/RET-1042', () => jsonResponse(ticketDetails())]])

    renderTicket('RET-1042')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'RET-1042 · Export does not work' }),
    ).toBeTruthy()
    expect(calls[0].url).toBe('/api/tickets/RET-1042')
    expect(screen.getByText('In progress')).toBeTruthy()
    expect(screen.getByText('Bug')).toBeTruthy()
    expect(screen.getByText('Projects')).toBeTruthy()
    const statusLine = within(screen.getByTestId('status-line'))
    expect(statusLine.getByText('In progress')).toBeTruthy()
    expect(statusLine.getByText('Normal priority')).toBeTruthy()
    expect(statusLine.getByText('Unassigned')).toBeTruthy()
    expect(statusLine.getByText('Answered after 1 hour')).toBeTruthy()
    expect(screen.getAllByText('Unassigned')).toHaveLength(2)
    // The status line says the priority, so the facts do not repeat it.
    expect(screen.queryByText('Priority')).toBeNull()
    expect(screen.getByText('Clicking Export does nothing.')).toBeTruthy()
    const messages = screen.getAllByRole('listitem').filter((item) => item.dataset.internal)
    expect(messages.map((item) => item.dataset.internal)).toEqual(['false', 'true'])
    expect(within(messages[1]).getByText('Internal note')).toBeTruthy()
    expect(screen.getByText('May duplicate')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'RET-1030' }).getAttribute('href')).toBe(
      '/tickets/RET-1030',
    )
    expect(historyLines()[0]).toContain('Sam Support,Status: New to In progress')
    expect(screen.getByText('Marked as a potential duplicate of RET-1030')).toBeTruthy()
  })

  it('sets a ticket title of the longest length in the smallest display step, the reference above it', async () => {
    const title = 'x'.repeat(200)
    stubFetch([
      [
        '/api/tickets/RET-1042',
        () => jsonResponse(ticketDetails({ summary: ticketSummary({ title }) })),
      ],
    ])

    renderTicket('RET-1042')

    const heading = await screen.findByRole('heading', { level: 1, name: `RET-1042 · ${title}` })
    expect(heading.dataset.step).toBe('long')
    expect(heading.querySelector('[data-reference]')?.textContent).toMatch(/^RET-1042/)
  })

  it('marks a comment from support staff with a role chip that does not read as part of the name', async () => {
    renderAs('USER', [ticketDetails()])
    await openTicket()

    const comment = screen.getAllByRole('listitem').find((item) => item.dataset.internal)!
    expect(within(comment).getByText('Support staff')).toBeTruthy()
    expect(comment.textContent).toMatch(/^Sam Support,Support staff/)
  })

  it.each([
    [
      'a customer',
      'USER' as const,
      'Waiting for support for 17 days, longer than the 4 hours we aim for',
      null,
    ],
    [
      'support staff',
      'SUPPORT' as const,
      'First response 17 d 1 h past the response deadline',
      'SLA breached',
    ],
  ])(
    'reads the clock of an unanswered ticket in the words of %s, with the SLA breach marked once',
    async (_reader, role, clock, chip) => {
      // Only the clock is faked: the ticket was raised 17 d 5 h before this instant.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-25T13:00:00Z'))
      const breached = ticketDetails({ summary: ticketSummary() })
      renderAs(role, [breached])
      await openTicket()

      const statusLine = within(screen.getByTestId('status-line'))
      expect(await statusLine.findByText(clock)).toBeTruthy()
      if (chip === null) {
        expect(screen.queryByText('SLA breached')).toBeNull()
      } else {
        expect(statusLine.getByText(chip)).toBeTruthy()
        expect(screen.getAllByText(chip)).toHaveLength(1)
      }
    },
  )

  it('tells support staff a past breach in the settled clock, with no SLA breached chip', async () => {
    const answeredLate = ticketDetails({
      summary: ticketSummary({
        status: 'IN_PROGRESS',
        firstResponseAt: '2026-10-08T18:00:00Z',
        sla: {
          responseDeadline: '2026-10-08T12:00:00Z',
          waitingSeconds: 10 * 3600,
          breached: true,
        },
      }),
    })
    renderAs('SUPPORT', [answeredLate])
    await openTicket()

    const statusLine = within(screen.getByTestId('status-line'))
    const clock = await statusLine.findByText('First response 6 h after the response deadline')
    expect(clock.dataset.clock).toBe('answeredLate')
    expect(screen.queryByText('SLA breached')).toBeNull()
    expect(screen.getByTestId('status-line').querySelector('[data-tone="danger"]')).toBeNull()
  })

  it('tells support staff, after the settled clock, how long an unanswered customer comment has waited, never to a customer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T10:20:00Z'))
    const commented = ticketDetails({
      summary: {
        ...ticketDetails().summary,
        unansweredCustomerCommentAt: '2026-10-08T10:00:00Z',
      },
    })
    renderAs('SUPPORT', [commented])
    await openTicket()

    const statusLine = screen.getByTestId('status-line')
    const comment = await within(statusLine).findByText('Customer wrote 20 min ago')
    expect(comment.dataset.clock).toBe('customerComment')
    const settled = within(statusLine).getByText('First response after 1 h')
    expect(settled.compareDocumentPosition(comment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(statusLine.querySelector('[data-tone="danger"]')).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    renderAs('USER', [commented])
    await openTicket()
    expect(screen.queryByText(/Customer wrote/)).toBeNull()
  })

  it('stops telling a customer the ticket waits for support once it waits for them', async () => {
    const awaitsCustomer = ticketDetails({
      summary: ticketSummary({ status: 'WAITING_FOR_CUSTOMER' }),
    })
    renderAs('USER', [awaitsCustomer])
    await openTicket()

    const statusLine = within(screen.getByTestId('status-line'))
    expect(await statusLine.findByText('Support is waiting for your answer')).toBeTruthy()
    expect(statusLine.queryByText(/answered|Waiting for support/)).toBeNull()
  })

  it('puts the details after the conversation and before the links in reading order, as a landmark', async () => {
    renderAs('SUPPORT', [ticketDetails()])
    await openTicket()

    const details = await screen.findByRole('complementary', { name: 'Details' })
    const composer = screen.getByRole('textbox', { name: 'Public comment, visible to Acme Corp' })
    const follows = (a: Node, b: Node) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(within(details).getByRole('combobox', { name: 'Status' })).toBeTruthy()
    expect(follows(composer, details)).toBe(true)
    expect(follows(details, screen.getByRole('heading', { name: 'Linked tickets' }))).toBe(true)
  })

  it('says how long ago a recent comment was written, and when an older one was, with the exact time kept', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T09:30:00Z'))
    renderAs('USER', [ticketDetails()])
    await openTicket()

    const [comment] = screen.getAllByRole('listitem').filter((item) => item.dataset.internal)
    const time = within(comment).getByText('30 minutes ago')
    expect(time.tagName).toBe('TIME')
    expect(time.getAttribute('dateTime')).toBe('2026-10-08T09:00:00Z')
    expect(time.getAttribute('title')).toMatch(/^Oct 8, /)

    cleanup()
    vi.unstubAllGlobals()
    vi.setSystemTime(new Date('2026-10-10T09:30:00Z'))
    renderAs('USER', [ticketDetails()])
    await openTicket()

    const [older] = screen.getAllByRole('listitem').filter((item) => item.dataset.internal)
    const absolute = older.querySelector('time')!
    expect(absolute.textContent).toBe(absolute.getAttribute('title'))
    expect(absolute.textContent).toMatch(/^Oct 8, /)
  })

  it('gives a customer whose answer support awaits a Reply that takes them to the composer', async () => {
    const awaitsCustomer = ticketDetails({
      summary: ticketSummary({ status: 'WAITING_FOR_CUSTOMER' }),
    })
    renderAs('USER', [awaitsCustomer])
    await openTicket()

    const statusLine = within(screen.getByTestId('status-line'))
    await userEvent.click(await statusLine.findByRole('button', { name: 'Reply' }))

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: CUSTOMER_COMMENT }))
    // The sentence says whose turn it is, so the status chip would only repeat it.
    expect(statusLine.queryByText('Waiting for customer')).toBeNull()
  })

  it('lets a customer support awaits answer instead of closing, from the close dialog to the composer', async () => {
    const awaitsCustomer = ticketDetails({
      summary: ticketSummary({ status: 'WAITING_FOR_CUSTOMER' }),
    })
    const { calls } = renderAs('USER', [awaitsCustomer])
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Close ticket' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('Support asked you a question on this ticket. Close it anyway?'),
    ).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Answer instead' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: CUSTOMER_COMMENT })),
    )
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('keeps the status chip and offers no Reply to support staff, nor to a customer support owes an answer', async () => {
    const awaitsCustomer = ticketDetails({
      summary: ticketSummary({ status: 'WAITING_FOR_CUSTOMER' }),
    })
    renderAs('SUPPORT', [awaitsCustomer])
    await openTicket()
    await screen.findByRole('combobox', { name: 'Status' })

    const statusLine = within(screen.getByTestId('status-line'))
    expect(statusLine.getByText('Waiting for customer')).toBeTruthy()
    expect(statusLine.queryByRole('button', { name: 'Reply' })).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    renderAs('USER', [ticketDetails()])
    await openTicket()
    expect(await screen.findByRole('button', { name: 'Close ticket' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull()
  })

  it.each([
    [
      'a customer whose answer support awaits',
      'USER' as const,
      ticketDetails({ summary: ticketSummary({ status: 'WAITING_FOR_CUSTOMER' }) }),
      'How was it solved? (optional)',
      true,
    ],
    ['a customer', 'USER' as const, ticketDetails(), 'How was it solved? (optional)', false],
    [
      'support staff',
      'SUPPORT' as const,
      ticketDetails({
        summary: ticketSummary({ status: 'RESOLVED' }),
        resolution: 'Fixed in release 2.4.1.',
      }),
      'Resolution (optional)',
      false,
    ],
  ])(
    'asks %s to confirm the close in their own words',
    async (_reader, role, ticket, field, asked) => {
      renderAs(role, [ticket])
      await openTicket()

      await userEvent.click(await screen.findByRole('button', { name: 'Close ticket' }))
      const dialog = within(await screen.findByRole('dialog', { name: 'Close RET-1042?' }))

      expect(dialog.getByRole('textbox', { name: field })).toBeTruthy()
      const question = dialog.queryByText(
        'Support asked you a question on this ticket. Close it anyway?',
      )
      expect(question !== null).toBe(asked)
    },
  )

  it.each([
    ['a customer', 'USER' as const, false],
    ['support staff', 'SUPPORT' as const, true],
  ])(
    'lists the response deadline and waiting time among the details to support staff only, read by %s',
    async (_reader, role, shown) => {
      renderAs(role, [ticketDetails()])
      await openTicket()

      const details = within(
        screen.getByRole('heading', { name: 'Details' }).parentElement!.parentElement!,
      )
      // The session arrives after the ticket, so support's facts are waited for.
      if (shown) {
        expect(await details.findByText('Response deadline')).toBeTruthy()
        expect(details.getByText('Waiting time')).toBeTruthy()
      } else {
        await screen.findByRole('button', { name: 'Close ticket' })
        expect(details.queryByText('Response deadline')).toBeNull()
        expect(details.queryByText('Waiting time')).toBeNull()
      }
      expect(details.getByText('First response')).toBeTruthy()
    },
  )

  it('says a ticket the user may not see does not exist', async () => {
    stubFetch([
      [
        '/api/tickets/RET-9999',
        () =>
          jsonResponse(
            {
              type: 'https://retrofit.app/problems/ticket/not-found',
              title: 'Ticket not found',
              status: 404,
            },
            404,
          ),
      ],
    ])

    renderTicket('RET-9999')

    expect(await screen.findByText('Ticket not found')).toBeTruthy()
    expect(screen.getByText('There is no ticket RET-9999 you can see.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'All tickets' }).getAttribute('href')).toBe('/')
  })

  it("moves a non-canonical reference to the ticket's own URL, where writes keep its cache", async () => {
    const calls = stubFetch([['/api/tickets/', () => jsonResponse(ticketDetails())]])

    renderTicket('ret-1042')

    await openTicket()
    const reads = calls.filter((call) => call.url.startsWith('/api/tickets/'))
    expect(reads.map((call) => call.url)).toEqual(['/api/tickets/ret-1042', TICKET_URL])
  })

  it('keeps the list it was opened from for All tickets, through a redirect and a linked ticket', async () => {
    const linked = ticketDetails({
      summary: ticketSummary({ reference: 'RET-1030', title: 'Export broken' }),
    })
    stubFetch([
      ['/api/tickets/RET-1030', () => jsonResponse(linked)],
      ['/api/tickets/', () => jsonResponse(ticketDetails())],
    ])
    renderRoutes([{ path: '/tickets/:reference', element: <TicketPage /> }], {
      pathname: '/tickets/ret-1042',
      state: { listSearch: 'status=NEW&page=1' },
    })
    await openTicket()

    await userEvent.click(screen.getByRole('link', { name: 'RET-1030' }))

    await screen.findByRole('heading', { level: 1, name: 'RET-1030 · Export broken' })
    const back = screen.getByRole('link', { name: 'All tickets' })
    expect(back.getAttribute('href')).toBe('/?status=NEW&page=1')
  })

  it('opens another cached ticket with nothing carried over from the previous one', async () => {
    const other = ticketDetails({
      summary: ticketSummary({ reference: 'RET-1030', title: 'Export broken' }),
      links: [
        {
          relation: 'HAS_POTENTIAL_DUPLICATE',
          reference: 'RET-1042',
          title: 'Export does not work',
          status: 'IN_PROGRESS',
        },
      ],
    })
    stubFetch([
      ['/api/auth/session', () => jsonResponse(session('USER'))],
      ['/api/tickets/RET-1030', () => jsonResponse(other)],
      [TICKET_URL, () => jsonResponse(ticketDetails())],
    ])
    renderTicket('RET-1042')
    await openTicket()
    await userEvent.click(screen.getByRole('link', { name: 'RET-1030' }))
    await screen.findByRole('heading', { level: 1, name: 'RET-1030 · Export broken' })
    await userEvent.type(
      screen.getByRole('textbox', { name: CUSTOMER_COMMENT }),
      'Half-written reply',
    )

    await userEvent.click(screen.getByRole('link', { name: 'RET-1042' }))

    await openTicket()
    const textarea = screen.getByRole('textbox', { name: CUSTOMER_COMMENT }) as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('keeps a half-written comment when the reader leaves the ticket and comes back', async () => {
    const other = ticketDetails({
      summary: ticketSummary({ reference: 'RET-1030', title: 'Export broken' }),
      links: [
        {
          relation: 'HAS_POTENTIAL_DUPLICATE',
          reference: 'RET-1042',
          title: 'Export does not work',
          status: 'IN_PROGRESS',
        },
      ],
    })
    stubFetch([
      ['/api/auth/session', () => jsonResponse(session('USER'))],
      ['/api/tickets/RET-1030', () => jsonResponse(other)],
      [TICKET_URL, () => jsonResponse(ticketDetails())],
    ])
    renderTicket('RET-1042')
    await openTicket()
    await userEvent.type(screen.getByRole('textbox', { name: CUSTOMER_COMMENT }), 'Half-written')

    await userEvent.click(screen.getByRole('link', { name: 'RET-1030' }))
    await screen.findByRole('heading', { level: 1, name: 'RET-1030 · Export broken' })
    await userEvent.click(screen.getByRole('link', { name: 'RET-1042' }))

    await openTicket()
    const textarea = screen.getByRole('textbox', { name: CUSTOMER_COMMENT }) as HTMLTextAreaElement
    expect(textarea.value).toBe('Half-written')
  })

  it('sends a comment with Ctrl+Enter, announces it and moves focus to an empty one', async () => {
    const { calls } = renderAs(
      'USER',
      [ticketDetails()],
      [[`${TICKET_URL}/comments`, () => jsonResponse(ticketDetails({ version: 4 }), 201)]],
    )
    await openTicket()

    const textarea = await screen.findByRole('textbox', { name: CUSTOMER_COMMENT })
    await userEvent.click(screen.getByRole('button', { name: 'Send to support and Acme Corp' }))
    expect(document.activeElement).toBe(textarea)
    expect(textarea.getAttribute('aria-invalid')).toBe('true')

    await userEvent.type(textarea, 'Firefox 130{Control>}{Enter}{/Control}')

    await waitFor(() => expect(screen.getByText('Comment sent.')).toBeTruthy())
    expect(calls.filter((call) => call.url === `${TICKET_URL}/comments`)).toHaveLength(1)
  })

  it('lets a customer post a public comment with an Idempotency-Key and no note toggle', async () => {
    const { calls } = renderAs(
      'USER',
      [ticketDetails()],
      [[`${TICKET_URL}/comments`, () => jsonResponse(ticketDetails({ version: 4 }), 201)]],
    )
    await openTicket()

    expect(screen.queryByRole('button', { name: 'Internal note' })).toBeNull()
    const textarea = await screen.findByRole('textbox', { name: CUSTOMER_COMMENT })
    await userEvent.type(textarea, 'Firefox 130')
    await userEvent.click(screen.getByRole('button', { name: 'Send to support and Acme Corp' }))

    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe(''))
    const post = calls.find((call) => call.url === `${TICKET_URL}/comments`)
    expect(post?.method).toBe('POST')
    expect(post?.body).toEqual({ body: 'Firefox 130', internal: false })
    expect(post?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('lets support switch the composer to an internal note', async () => {
    const { calls } = renderAs(
      'SUPPORT',
      [ticketDetails()],
      [[`${TICKET_URL}/comments`, () => jsonResponse(ticketDetails({ version: 4 }), 201)]],
    )
    await openTicket()

    const note = await screen.findByRole('button', { name: 'Internal note' })
    expect(note.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('group', { name: 'Comment visibility' })).toBeTruthy()
    expect(
      screen.getByRole('textbox', { name: 'Public comment, visible to Acme Corp' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send to Acme Corp' })).toBeTruthy()
    await userEvent.click(note)

    expect(note.getAttribute('aria-pressed')).toBe('true')
    const textarea = screen.getByRole('textbox', {
      name: 'Internal note, visible to support staff only',
    })
    expect(textarea.dataset.note).toBe('true')
    expect(screen.queryByRole('button', { name: 'Send to Acme Corp' })).toBeNull()
    await userEvent.type(textarea, 'Safari bug confirmed')
    await userEvent.click(screen.getByRole('button', { name: 'Add internal note' }))

    await waitFor(() =>
      expect(calls.find((call) => call.url === `${TICKET_URL}/comments`)?.body).toEqual({
        body: 'Safari bug confirmed',
        internal: true,
      }),
    )
  })

  it.each([
    [
      'a public comment',
      null,
      'Public comment, visible to Acme Corp',
      'Send to Acme Corp',
      'Comment sent.',
    ],
    [
      'an internal note',
      'Internal note',
      'Internal note, visible to support staff only',
      'Add internal note',
      'Internal note added.',
    ],
  ])(
    'keeps the focus in the composer once %s is sent, and announces it',
    async (_kind, mode, field, send, announcement) => {
      const answer = heldAnswer(ticketDetails({ version: 4 }), 201)
      renderAs('SUPPORT', [ticketDetails()], [[`${TICKET_URL}/comments`, () => answer.response]])
      await openTicket()
      if (mode !== null) await userEvent.click(await screen.findByRole('button', { name: mode }))
      const textarea = (await screen.findByRole('textbox', { name: field })) as HTMLTextAreaElement
      await userEvent.type(textarea, 'Safari 18 too')

      const button = screen.getByRole('button', { name: send }) as HTMLButtonElement
      await userEvent.click(button)
      await waitFor(() => expect(button.disabled).toBe(true))
      blurActive()
      answer.release()

      await waitFor(() => expect(textarea.value).toBe(''))
      expect(document.activeElement).toBe(textarea)
      expect(await screen.findByText(announcement)).toBeTruthy()
    },
  )

  it('shows a customer the closed notice instead of the composer, while support keeps it', async () => {
    renderAs('USER', [closedTicket()])
    await openTicket()

    expect(await screen.findByText(closedNotice)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'create a new ticket' }).getAttribute('href')).toBe(
      '/tickets/new',
    )
    expect(screen.queryByRole('textbox', { name: CUSTOMER_COMMENT })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close ticket' })).toBeNull()
    expect(screen.getByText('Fixed in release 2.4.1.')).toBeTruthy()

    cleanup()
    vi.unstubAllGlobals()
    renderAs('SUPPORT', [closedTicket()])
    await openTicket()

    expect(
      await screen.findByRole('textbox', { name: 'Public comment, visible to Acme Corp' }),
    ).toBeTruthy()
    expect(screen.queryByText(closedNotice)).toBeNull()
  })

  it.each([
    ['a customer', 'RESOLVED' as const, 'USER' as const],
    ['a customer', 'CLOSED' as const, 'USER' as const],
    ['support staff', 'CLOSED' as const, 'SUPPORT' as const],
  ])(
    'gives %s the resolution of a %s ticket a panel before the conversation',
    async (_reader, status, role) => {
      const ticket = ticketDetails({
        summary: ticketSummary({ status }),
        resolution: 'Fixed in release 2.4.1.',
        history: [
          {
            actor: { id: '00000000-0000-0000-0000-00000000a002', name: 'Sam Support' },
            changedAt: '2026-10-09T11:00:00Z',
            field: 'RESOLUTION',
            oldValue: null,
            newValue: 'Fixed in release 2.4.1.',
          },
        ],
      })
      renderAs(role, [ticket])
      await openTicket()

      const panel = within(await screen.findByRole('region', { name: 'Resolution' }))
      expect(panel.getByText('Fixed in release 2.4.1.')).toBeTruthy()
      expect(panel.getByText('Sam Support')).toBeTruthy()
      const conversation = screen.getByRole('heading', { name: 'Conversation' })
      expect(
        panel.getByRole('heading', { name: 'Resolution' }).compareDocumentPosition(conversation) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      const details = within(screen.getByRole('complementary', { name: 'Details' }))
      expect(details.queryByText('Fixed in release 2.4.1.')).toBeNull()
    },
  )

  it('leaves the resolution of a resolved ticket to the editor for support staff', async () => {
    renderAs('SUPPORT', [
      ticketDetails({
        summary: ticketSummary({ status: 'RESOLVED' }),
        resolution: 'Fixed in release 2.4.1.',
      }),
    ])
    await openTicket()

    expect(await screen.findByRole('textbox', { name: 'Resolution (optional)' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Resolution' })).toBeNull()
  })

  it.each(['WAITING_FOR_CUSTOMER' as const, 'IN_PROGRESS' as const])(
    "keeps Reply's height in a customer's status line on a ticket %s, so answering moves nothing",
    async (status) => {
      renderAs('USER', [ticketDetails({ summary: ticketSummary({ status }) })])
      await openTicket()

      expect(getComputedStyle(screen.getByTestId('status-line')).minHeight).toBe('36px')
    },
  )

  it('offers Close to the author from any status and to support only once resolved', async () => {
    const otherAuthor = ticketDetails({
      summary: ticketSummary({
        status: 'IN_PROGRESS',
        author: { id: '00000000-0000-0000-0000-00000000a009', name: 'Alice Moreau' },
      }),
    })
    const { calls } = renderAs('USER', [otherAuthor])
    await openTicket()
    // The stub answers at once, so one macrotask after the session request it is in the cache.
    await waitFor(() => expect(calls.some((call) => call.url === '/api/auth/session')).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('button', { name: 'Close ticket' })).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    renderAs('SUPPORT', [ticketDetails()])
    await openTicket()
    await screen.findByRole('combobox', { name: 'Status' })
    expect(screen.queryByRole('button', { name: 'Close ticket' })).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    const resolved = ticketDetails({
      summary: ticketSummary({ status: 'RESOLVED' }),
      resolution: 'Fixed in release 2.4.1.',
    })
    renderAs('SUPPORT', [resolved])
    await openTicket()
    expect(await screen.findByRole('button', { name: 'Close ticket' })).toBeTruthy()
  })

  it('closes with If-Match from the version and the resolution', async () => {
    const { calls } = renderAs(
      'USER',
      [ticketDetails()],
      [[`${TICKET_URL}/close`, () => jsonResponse(closedTicket())]],
    )
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Close ticket' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close RET-1042?' })
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'How was it solved? (optional)' }),
      'Fixed in release 2.4.1.',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close ticket' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const close = calls.find((call) => call.url === `${TICKET_URL}/close`)
    expect(close?.method).toBe('POST')
    expect(close?.headers.get('If-Match')).toBe('"3"')
    expect(close?.body).toEqual({ resolution: 'Fixed in release 2.4.1.' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close ticket' })).toBeNull())
  })

  it('closes the dialog on a 412 and reloads the ticket from the conflict alert', async () => {
    const { reads } = renderAs(
      'USER',
      [ticketDetails(), ticketDetails({ version: 4 })],
      [[`${TICKET_URL}/close`, () => problem('ticket/modified', 412)]],
    )
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Close ticket' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close RET-1042?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close ticket' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'Someone changed this ticket after you opened it. Your changes were not saved.',
    )
    // Close acts from the page header, so its refusal is read before the panels (first on a phone).
    const description = screen.getByRole('heading', { level: 2, name: 'Description' })
    expect(
      alert.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(reads()).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Reload the ticket' }))

    await waitFor(() => expect(reads()).toHaveLength(2))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close ticket' }))
  })

  it('closes the dialog on a 409 already-closed, says so and refetches the ticket', async () => {
    const { reads } = renderAs(
      'USER',
      [ticketDetails(), closedTicket()],
      [[`${TICKET_URL}/close`, () => problem('ticket/already-closed', 409)]],
    )
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Close ticket' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close RET-1042?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close ticket' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This ticket has already been closed.',
    )
    await waitFor(() => expect(reads()).toHaveLength(2))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close ticket' })).toBeNull())
  })

  it('says a comment was refused on a ticket closed meanwhile and refetches it', async () => {
    const { reads } = renderAs(
      'USER',
      [ticketDetails(), closedTicket()],
      [[`${TICKET_URL}/comments`, () => problem('ticket/closed', 409)]],
    )
    await openTicket()

    await userEvent.type(
      await screen.findByRole('textbox', { name: CUSTOMER_COMMENT }),
      'Any news?',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Send to support and Acme Corp' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'This ticket is closed and can no longer be changed.',
    )
    await waitFor(() => expect(reads()).toHaveLength(2))
    expect(await screen.findByText(closedNotice)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(
      'This ticket is closed and can no longer be changed.',
    )
  })

  it('drops a refused comment once the reader changes it', async () => {
    renderAs(
      'SUPPORT',
      [ticketDetails()],
      [[`${TICKET_URL}/comments`, () => problem('ticket/forbidden', 403)]],
    )
    await openTicket()

    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Public comment, visible to Acme Corp' }),
      'Any news?',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Send to Acme Corp' }))
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Internal note' }))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('drops a refused close once the reader changes the resolution', async () => {
    renderAs(
      'USER',
      [ticketDetails()],
      [[`${TICKET_URL}/close`, () => problem('ticket/forbidden', 403)]],
    )
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Close ticket' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close RET-1042?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close ticket' }))
    await within(dialog).findByRole('alert')
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'How was it solved? (optional)' }),
      'Done.',
    )

    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('tells who created the ticket in the history', async () => {
    renderAs('USER', [
      ticketDetails({
        history: [
          {
            actor: { id: '00000000-0000-0000-0000-00000000a003', name: 'Adam Novak' },
            changedAt: '2026-10-08T08:00:00Z',
            field: 'CREATED',
            oldValue: null,
            newValue: 'Export does not work',
          },
          ...ticketDetails().history,
        ],
      }),
    ])
    await openTicket()

    const lines = historyLines()
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('Adam Novak,Created the ticket')
    expect(lines[1]).toContain('Status: New to In progress')
  })

  it('tells a description edit in one line and keeps both versions behind Show the change', async () => {
    renderAs('USER', [
      ticketDetails({
        history: [
          {
            actor: { id: '00000000-0000-0000-0000-00000000a003', name: 'Adam Novak' },
            changedAt: '2026-10-08T08:30:00Z',
            field: 'DESCRIPTION',
            oldValue: '',
            newValue: 'Clicking Export does nothing.',
          },
        ],
      }),
    ])
    await openTicket()

    const [line] = historyLines()
    expect(line).toContain('Adam Novak,Description: edited')
    const history = screen.getByRole('heading', { name: 'History' }).parentElement!.parentElement!
    const details = within(history).getByText('Show the change').closest('details')!
    expect(details.open).toBe(false)
    await userEvent.click(within(details).getByText('Show the change'))
    expect(details.open).toBe(true)
    expect(within(details).getByText('Before').nextElementSibling?.textContent).toBe('—')
    expect(within(details).getByText('After').nextElementSibling?.textContent).toBe(
      'Clicking Export does nothing.',
    )
  })

  it('quotes a short resolution in its line and previews a long one, keeping it whole behind Show the change', async () => {
    const long =
      'The report added the repeated hour of the daylight saving change twice. Fixed in release 4.11.4.'
    const resolution = (oldValue: string | null, newValue: string | null) => ({
      actor: { id: '00000000-0000-0000-0000-00000000a002', name: 'Sam Support' },
      changedAt: '2026-10-08T09:05:00Z',
      field: 'RESOLUTION' as const,
      oldValue,
      newValue,
    })
    renderAs('USER', [
      ticketDetails({
        history: [
          resolution(null, 'Fixed in release 4.9.1.'),
          resolution('Fixed in release 4.9.1.', long),
        ],
      }),
    ])
    await openTicket()

    const lines = historyLines()
    expect(lines[0]).toContain('Resolution set to “Fixed in release 4.9.1.”')
    expect(lines[0]).not.toContain('Show the change')
    expect(lines[1]).toContain(
      'Resolution: “Fixed in release 4.9.1.” to “The report added the repeated hour of the daylight saving change twice. Fixed in…”',
    )
    const history = screen.getByRole('heading', { name: 'History' }).parentElement!.parentElement!
    const details = within(history).getByText('Show the change').closest('details')!
    expect(within(details).getByText('After').nextElementSibling?.textContent).toBe(long)
  })

  it('always shows support the Linked tickets panel with the form folded, and customers only read-only rows', async () => {
    renderAs('SUPPORT', [ticketDetails({ links: [] })])
    await openTicket()

    expect(await screen.findByText('No linked tickets yet.')).toBeTruthy()
    const panel = linksPanel()
    expect(within(panel).queryByRole('combobox', { name: 'Ticket' })).toBeNull()
    const search = await openLinkForm()
    expect(document.activeElement).toBe(search)
    expect(within(panel).getByRole('form', { name: 'Link a ticket' })).toBeTruthy()
    expect(search.getAttribute('placeholder')).toBe('RET-1042 or words')
    const type = within(panel).getByRole('combobox', { name: 'Link as' }) as HTMLSelectElement
    expect(type.value).toBe('RELATED')
    // Outline, not blue: the composer's Send is the page's one filled action.
    expect(within(panel).getByRole('button', { name: 'Link' })).toBeTruthy()

    await typeSearch(search, 'sso')
    await userEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))

    expect(within(panel).queryByRole('combobox', { name: 'Ticket' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Link a ticket' }))
    expect((await openLinkForm()).getAttribute('value') ?? '').toBe('')

    cleanup()
    vi.unstubAllGlobals()
    renderAs('USER', [ticketDetails({ links: [] })])
    await openTicket()

    expect(screen.queryByRole('heading', { name: 'Linked tickets' })).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    renderAs('USER', [ticketDetails()])
    await openTicket()

    expect(within(linksPanel()).getByRole('link', { name: 'RET-1030' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove link to RET-1030' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Ticket' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Link a ticket' })).toBeNull()
  })

  it("removes a link with DELETE for that row's reference, without a dialog, and shows the answer", async () => {
    const { calls } = renderAs(
      'SUPPORT',
      [ticketDetails()],
      [
        [
          `${TICKET_URL}/links/RET-1030`,
          () => jsonResponse(ticketDetails({ links: [], version: 4 })),
        ],
      ],
    )
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Remove link to RET-1030' }))

    expect(await screen.findByText('No linked tickets yet.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    const removal = calls.filter((call) => call.url === `${TICKET_URL}/links/RET-1030`)
    expect(removal.map((call) => call.method)).toEqual(['DELETE'])
    expect(removal[0]!.body).toBeUndefined()
  })

  it('offers Undo after a removal, which links the ticket again as it was and returns focus to its row', async () => {
    let removals = 0
    const { calls } = renderAs(
      'SUPPORT',
      [ticketDetails()],
      [
        [
          `${TICKET_URL}/links/RET-1030`,
          () =>
            removals++ === 0
              ? jsonResponse(ticketDetails({ links: [], version: 4 }))
              : jsonResponse(ticketDetails({ version: 5 })),
        ],
      ],
    )
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Remove link to RET-1030' }))

    expect(await screen.findByText('Removed the link to RET-1030.')).toBeTruthy()
    await userEvent.click(
      screen.getByRole('button', { name: 'Undo removing the link to RET-1030' }),
    )

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Remove link to RET-1030' }),
      ),
    )
    expect(screen.queryByText('Removed the link to RET-1030.')).toBeNull()
    const writes = calls.filter((call) => call.url === `${TICKET_URL}/links/RET-1030`)
    // A potential duplicate is stored from the later ticket whichever end asks, so its type restores it.
    expect(writes.map((call) => [call.method, call.body])).toEqual([
      ['DELETE', undefined],
      ['PUT', { type: 'POTENTIAL_DUPLICATE' }],
    ])
  })

  it('drops the Undo once another link is removed or Link a ticket is opened', async () => {
    renderAs(
      'SUPPORT',
      [ticketDetails({ links: [linkTo('RET-1030'), linkTo('RET-1031')] })],
      [
        [
          `${TICKET_URL}/links/RET-1030`,
          () => jsonResponse(ticketDetails({ links: [linkTo('RET-1031')], version: 4 })),
        ],
        [
          `${TICKET_URL}/links/RET-1031`,
          () => jsonResponse(ticketDetails({ links: [], version: 5 })),
        ],
      ],
    )
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Remove link to RET-1030' }))
    await screen.findByText('Removed the link to RET-1030.')
    await userEvent.click(screen.getByRole('button', { name: 'Remove link to RET-1031' }))

    expect(await screen.findByText('Removed the link to RET-1031.')).toBeTruthy()
    expect(screen.queryByText('Removed the link to RET-1030.')).toBeNull()

    await openLinkForm()
    expect(screen.queryByText('Removed the link to RET-1031.')).toBeNull()
  })

  it('shows a refused removal below Link a ticket, refocuses its Remove and clears the refusal on the next Remove', async () => {
    const refusal = heldAnswer(
      { type: 'https://retrofit.app/problems/ticket/forbidden', title: 'forbidden', status: 403 },
      403,
    )
    let attempts = 0
    renderAs(
      'SUPPORT',
      [ticketDetails()],
      [
        [
          `${TICKET_URL}/links/RET-1030`,
          () =>
            attempts++ === 0
              ? refusal.response
              : jsonResponse(ticketDetails({ links: [], version: 4 })),
        ],
      ],
    )
    await openTicket()
    const remove = (await screen.findByRole('button', {
      name: 'Remove link to RET-1030',
    })) as HTMLButtonElement

    await userEvent.click(remove)
    await waitFor(() => expect(remove.disabled).toBe(true))
    // jsdom neither drops focus from a disabled button nor blurs one, so focus is moved away here.
    within(linksPanel()).getByRole('link', { name: 'RET-1030' }).focus()
    expect(document.activeElement).not.toBe(remove)
    refusal.release()

    const alert = await within(linksPanel()).findByRole('alert')
    expect(alert.textContent).toBe('You are not allowed to do this.')
    expect(
      screen.getByRole('button', { name: 'Link a ticket' }).compareDocumentPosition(alert) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(within(linksPanel()).getByRole('link', { name: 'RET-1030' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(remove))

    await userEvent.click(remove)

    expect(await screen.findByText('No linked tickets yet.')).toBeTruthy()
    expect(within(linksPanel()).queryByRole('alert')).toBeNull()
  })

  it('drops a refused link once the reader changes the link type', async () => {
    renderAs(
      'SUPPORT',
      [ticketDetails()],
      [
        [`${TICKET_URL}/links/RET-1003`, () => problem('ticket/forbidden', 403)],
        ['/api/tickets?', SEARCH_RESULTS],
      ],
    )
    await openTicket()

    await typeSearch(await openLinkForm(), 'sso')
    await userEvent.click((await findSearchOptions())[0]!)
    await userEvent.click(screen.getByRole('button', { name: 'Link' }))
    await within(linksPanel()).findByRole('alert')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Link as' }),
      'Potential duplicate',
    )

    expect(within(linksPanel()).queryByRole('alert')).toBeNull()
  })

  it('holds every link write, keeping each control in place, while one is pending', async () => {
    const removal = heldAnswer(ticketDetails({ links: [linkTo('RET-1031')], version: 4 }))
    renderAs(
      'SUPPORT',
      [ticketDetails({ links: [linkTo('RET-1030'), linkTo('RET-1031')] })],
      [
        [`${TICKET_URL}/links/RET-1030`, () => removal.response],
        ['/api/tickets?', SEARCH_RESULTS],
      ],
    )
    await openTicket()
    await typeSearch(await openLinkForm(), 'sso')
    await userEvent.click((await findSearchOptions())[0]!)
    const link = screen.getByRole('button', { name: 'Link' }) as HTMLButtonElement
    const other = screen.getByRole('button', {
      name: 'Remove link to RET-1031',
    }) as HTMLButtonElement
    expect(link.disabled).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Remove link to RET-1030' }))

    const removing = screen.getByRole('button', {
      name: 'Remove link to RET-1030',
    }) as HTMLButtonElement
    await waitFor(() => expect(removing.disabled).toBe(true))
    expect(other.disabled).toBe(true)
    expect(link.disabled).toBe(true)
    expect([removing.textContent, other.textContent, link.textContent]).toEqual([
      'Remove',
      'Remove',
      'Link',
    ])

    removal.release()

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove link to RET-1030' })).toBeNull(),
    )
    expect(other.disabled).toBe(false)
    expect(link.disabled).toBe(false)
  })

  it('moves focus after a removal to the next Remove, else the previous one, else its Undo', async () => {
    const answer =
      (...references: string[]) =>
      () =>
        jsonResponse(ticketDetails({ links: references.map(linkTo), version: 4 }))
    renderAs(
      'SUPPORT',
      [ticketDetails({ links: [linkTo('RET-1030'), linkTo('RET-1031'), linkTo('RET-1032')] })],
      [
        [`${TICKET_URL}/links/RET-1031`, answer('RET-1030', 'RET-1032')],
        [`${TICKET_URL}/links/RET-1032`, answer('RET-1030')],
        [`${TICKET_URL}/links/RET-1030`, answer()],
      ],
    )
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Remove link to RET-1031' }))
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Remove link to RET-1032' }),
      ),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove link to RET-1032' }))
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Remove link to RET-1030' }),
      ),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove link to RET-1030' }))
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Undo removing the link to RET-1030' }),
      ),
    )
  })

  it('searches after the debounce, never offers the current ticket and links the picked one', async () => {
    const { calls } = renderAs(
      'SUPPORT',
      [ticketDetails()],
      [
        [`${TICKET_URL}/links/RET-1003`, () => jsonResponse(ticketDetails({ version: 4 }))],
        ['/api/tickets?', SEARCH_RESULTS],
      ],
    )
    await openTicket()

    const search = await openLinkForm()
    await typeSearch(search, 'sso')

    const options = await findSearchOptions()
    expect(options.map((option) => option.textContent)).toEqual([
      'RET-1003SSO login loop on SafariAcme CorpClosed',
      'RET-1001Login fails on SSOAcme CorpNew',
    ])
    const searches = calls.filter((call) => call.url.startsWith('/api/tickets?'))
    expect(searches.map((call) => call.url)).toEqual(['/api/tickets?text=sso&size=11'])

    await userEvent.click(options[0]!)
    expect((search as HTMLInputElement).value).toBe('RET-1003 · SSO login loop on Safari')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Link as' }),
      'Potential duplicate',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Link' }))

    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Ticket' })).toBeNull())
    const link = calls.find((call) => call.url === `${TICKET_URL}/links/RET-1003`)
    expect(link?.method).toBe('PUT')
    expect(link?.body).toEqual({ type: 'POTENTIAL_DUPLICATE' })
  })

  it('folds the form after a link and returns focus to Link a ticket, and opens it empty again', async () => {
    renderAs(
      'SUPPORT',
      [ticketDetails()],
      [
        [`${TICKET_URL}/links/RET-1003`, () => jsonResponse(ticketDetails({ version: 4 }))],
        ['/api/tickets?', SEARCH_RESULTS],
      ],
    )
    await openTicket()
    await typeSearch(await openLinkForm(), 'sso')
    await userEvent.click((await findSearchOptions())[0]!)

    await userEvent.click(screen.getByRole('button', { name: 'Link' }))

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Link a ticket' })),
    )
    expect(screen.getByText('RET-1003 linked.')).toBeTruthy()
    const search = (await openLinkForm()) as HTMLInputElement
    expect(search.value).toBe('')
    expect((screen.getByRole('combobox', { name: 'Link as' }) as HTMLSelectElement).value).toBe(
      'RELATED',
    )
  })

  it('asks at the Ticket field for a ticket picked from the list, and offers nothing for empty text', async () => {
    const { calls } = renderAs(
      'SUPPORT',
      [ticketDetails()],
      [
        ['text=billing', searchAnswer(ticketSummary())],
        ['/api/tickets?', SEARCH_RESULTS],
      ],
    )
    await openTicket()
    const search = await openLinkForm()
    const link = screen.getByRole('button', { name: 'Link' }) as HTMLButtonElement
    expect(link.disabled).toBe(false)

    await userEvent.click(link)

    const error = screen.getByText('Pick a ticket from the list.')
    expect(search.getAttribute('aria-invalid')).toBe('true')
    expect(search.getAttribute('aria-describedby')).toBe(error.id)
    expect(document.activeElement).toBe(search)

    await typeSearch(search, 'billing')

    expect(screen.queryByText('Pick a ticket from the list.')).toBeNull()
    expect(search.getAttribute('aria-invalid')).toBeNull()
    expect(await screen.findByText('No tickets match "billing"')).toBeTruthy()
    expect(searchOptions()).toEqual([])

    await userEvent.clear(search)
    await userEvent.click(search)

    expect(screen.queryByText(/No tickets match/)).toBeNull()
    expect(searchOptions()).toEqual([])

    await typeSearch(search, 'sso')
    await userEvent.click((await findSearchOptions())[1]!)

    expect(screen.queryByText('Pick a ticket from the list.')).toBeNull()
    expect(calls.some((call) => call.url.includes('/links/'))).toBe(false)
  })

  it('links nothing from typed text alone, and asks for a ticket from the list', async () => {
    const { calls } = renderAs('SUPPORT', [ticketDetails()], [['/api/tickets?', SEARCH_RESULTS]])
    await openTicket()
    const search = await openLinkForm()

    await typeSearch(search, 'sso')
    await findSearchOptions()
    await userEvent.click(screen.getByRole('button', { name: 'Link' }))

    expect(screen.getByText('Pick a ticket from the list.')).toBeTruthy()
    expect(search.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(search)
    expect((search as HTMLInputElement).value).toBe('sso')
    expect(calls.some((call) => call.url.includes('/links/'))).toBe(false)
  })

  it('shows a refused link under the Ticket field, keeping the text', async () => {
    let attempts = 0
    renderAs(
      'SUPPORT',
      [ticketDetails()],
      [
        [
          `${TICKET_URL}/links/RET-9999`,
          () => {
            blurActive()
            return attempts++ === 0
              ? jsonResponse(
                  {
                    type: 'https://retrofit.app/problems/ticket/not-found',
                    title: 'Ticket not found',
                    status: 404,
                    detail: 'There is no ticket RET-9999.',
                  },
                  404,
                )
              : jsonResponse(
                  {
                    type: 'https://retrofit.app/problems/validation',
                    title: 'Invalid request',
                    status: 422,
                    errors: [
                      {
                        field: 'linkedReference',
                        code: 'linkedReference.self',
                        message: 'must not be the ticket itself',
                      },
                    ],
                  },
                  422,
                )
          },
        ],
        ['/api/tickets?', searchAnswer(ticketSummary({ reference: 'RET-9999', title: 'Gone' }))],
      ],
    )
    await openTicket()
    const search = (await openLinkForm()) as HTMLInputElement
    await typeSearch(search, '9999')
    await userEvent.click((await findSearchOptions())[0]!)

    await userEvent.click(screen.getByRole('button', { name: 'Link' }))

    expect((await within(linksPanel()).findByRole('alert')).textContent).toBe(
      'There is no ticket RET-9999 you can see.',
    )
    expect(search.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(search.getAttribute('aria-describedby')!)?.textContent).toBe(
      'There is no ticket RET-9999 you can see.',
    )
    expect(search.value).toBe('RET-9999 · Gone')
    expect(document.activeElement).toBe(search)

    await userEvent.click(screen.getByRole('button', { name: 'Link' }))

    expect(await screen.findByText('A ticket cannot be linked to itself.')).toBeTruthy()
    expect(screen.queryByText('There is no ticket RET-9999 you can see.')).toBeNull()
    expect(search.getAttribute('aria-invalid')).toBe('true')
  })

  it("reads link history entries from this ticket's side, and an unknown value raw", async () => {
    const link = (oldValue: string | null, newValue: string | null) => ({
      actor: { id: '00000000-0000-0000-0000-00000000a002', name: 'Sam Support' },
      changedAt: '2026-10-08T09:05:00Z',
      field: 'LINK' as const,
      oldValue,
      newValue,
    })
    renderAs('USER', [
      ticketDetails({
        history: [
          link(null, 'HAS_POTENTIAL_DUPLICATE RET-1001'),
          link(null, 'POTENTIAL_DUPLICATE RET-1030'),
          link('RELATED RET-1017', 'POTENTIAL_DUPLICATE_OF RET-1017'),
          link('MERGED RET-1005', null),
          link(null, 'RELATED RET-1031'),
          link('RELATED RET-1031', null),
        ],
      }),
    ])
    await openTicket()

    const lines = historyLines()
    expect(lines[0]).toContain('Marked RET-1001 as a potential duplicate of this ticket')
    expect(lines[1]).toContain('Marked as a potential duplicate of RET-1030')
    expect(lines[2]).toContain('Link: Related RET-1017 to May duplicate RET-1017')
    expect(lines[3]).toContain('Link cleared (was MERGED RET-1005)')
    expect(lines[4]).toContain('Linked RET-1031 as related')
    expect(lines[5]).toContain('Removed the link to RET-1031')
  })

  it('says a field set from nothing or cleared in words, and a change from one value to another with an arrow heard as "to"', async () => {
    const change = (
      field: 'CATEGORY' | 'ASSIGNEE',
      oldValue: string | null,
      newValue: string | null,
    ) => ({
      actor: { id: '00000000-0000-0000-0000-00000000a002', name: 'Sam Support' },
      changedAt: '2026-10-08T09:05:00Z',
      field,
      oldValue,
      newValue,
    })
    renderAs('USER', [
      ticketDetails({
        history: [
          change('CATEGORY', null, 'BUG'),
          change('CATEGORY', 'BUG', 'QUESTION'),
          change('ASSIGNEE', 'Sam Support', null),
        ],
      }),
    ])
    await openTicket()

    const lines = historyLines()
    expect(lines[0]).toContain('Category set to Bug')
    expect(lines[1]).toContain('Sam Support,Category: Bug to Question')
    expect(lines[2]).toContain('Assignee cleared (was Sam Support)')
    // The arrow is drawn but not read out as "right arrow".
    const history = screen.getByRole('heading', { name: 'History' }).parentElement!.parentElement!
    const arrow = within(history).getByText('→')
    expect(arrow.getAttribute('aria-hidden')).toBe('true')
    expect(arrow.closest('li')?.textContent).toContain('Category: Bug →to Question')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { jsonResponse, renderRoutes, stubFetch, type FetchCall } from '../../test/harness.tsx'
import { ticketDetails, ticketSummary } from './ticket-fixtures.ts'
import { TicketPage } from './ticket-page.tsx'
import type { TicketDetails } from './use-tickets.ts'

const TICKET_URL = '/api/tickets/RET-1042'
const TEAMS_URL = '/api/teams'
const PROJECTS = { id: '00000000-0000-0000-0000-0000000c0002', name: 'Projects' }
const BILLING = { id: '00000000-0000-0000-0000-0000000c0003', name: 'Billing' }
const SAM = { id: '00000000-0000-0000-0000-00000000a002', name: 'Sam Support' }
const PIOTR = { id: '00000000-0000-0000-0000-00000000a004', name: 'Piotr Nowak' }
const BEA = { id: '00000000-0000-0000-0000-00000000a005', name: 'Bea Billing' }

const JANE = { id: '00000000-0000-0000-0000-000000000001', name: 'Jane Doe' }

const TEAMS = [
  { ...BILLING, description: 'Invoices', member: false, members: [BEA] },
  { ...PROJECTS, description: 'Projects', member: true, members: [JANE, PIOTR, SAM] },
]

const session = (role: 'USER' | 'SUPPORT') => ({
  id: JANE.id,
  email: 'jane@example.com',
  displayName: JANE.name,
  roles: [role],
  language: 'en',
})

/** A JSON answer whose body arrives only when `release` is called, so its request stays pending. */
function heldAnswer(body: unknown) {
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
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
  return { response, release: () => release() }
}

const problem = (slug: string, status: number) =>
  jsonResponse({ type: `https://retrofit.app/problems/${slug}`, title: slug, status }, status)

const withSummary = (overrides: Parameters<typeof ticketSummary>[0], version = 3) => {
  const base = ticketDetails()
  return ticketDetails({ summary: { ...base.summary, ...overrides }, version })
}

/**
 * The ticket page as `role` sees it. Each GET of the ticket answers the next
 * entry of `tickets` (the last one repeats); a PATCH answers `patch`.
 */
function renderAs(
  role: 'USER' | 'SUPPORT',
  tickets: TicketDetails[],
  patch: () => Response = () => jsonResponse(tickets[0]),
) {
  let read = 0
  const calls: FetchCall[] = stubFetch([
    ['/api/auth/session', () => jsonResponse(session(role))],
    [TEAMS_URL, () => jsonResponse(TEAMS)],
    [
      TICKET_URL,
      () =>
        calls.at(-1)?.method === 'PATCH'
          ? patch()
          : jsonResponse(tickets[Math.min(read++, tickets.length - 1)]),
    ],
  ])
  renderRoutes(
    [
      { path: '/tickets/:reference', element: <TicketPage /> },
      { path: '/', element: <p>Ticket list</p> },
    ],
    '/tickets/RET-1042',
  )
  const reads = () => calls.filter((call) => call.url === TICKET_URL && call.method === 'GET')
  const teamReads = () => calls.filter((call) => call.url === TEAMS_URL)
  const patches = () => calls.filter((call) => call.method === 'PATCH')
  return { reads, teamReads, patches }
}

async function openTicket() {
  await screen.findByRole('heading', { level: 1, name: 'RET-1042 · Export does not work' })
}

const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('TicketFactsEditor', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is not shown to a customer', async () => {
    renderAs('USER', [ticketDetails()])
    await openTicket()

    expect(screen.queryByRole('combobox', { name: 'Status' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.getByText('Projects')).toBeTruthy()
  })

  it('saves only the changed fields with If-Match and keeps both buttons disabled until a change', async () => {
    const { patches } = renderAs('SUPPORT', [ticketDetails()], () =>
      jsonResponse(withSummary({ status: 'WAITING_FOR_CUSTOMER', category: null }, 4)),
    )
    await openTicket()

    const status = await screen.findByRole('combobox', { name: 'Status' })
    expect(Array.from((status as HTMLSelectElement).options).map((o) => o.value)).not.toContain(
      'CLOSED',
    )
    expect(button('Discard').disabled).toBe(true)
    expect(button('Save changes').disabled).toBe(true)

    await userEvent.selectOptions(status, 'WAITING_FOR_CUSTOMER')
    await userEvent.selectOptions(select('Category'), '')
    expect(button('Discard').disabled).toBe(false)
    await userEvent.click(button('Save changes'))

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].headers.get('If-Match')).toBe('"3"')
    expect(patches()[0].body).toEqual({ status: 'WAITING_FOR_CUSTOMER', category: null })
    await waitFor(() => expect(button('Save changes').disabled).toBe(true))
    expect(select('Status').value).toBe('WAITING_FOR_CUSTOMER')
    expect(screen.getByText('Details saved.')).toBeTruthy()
  })

  it('offers only the status moves the lifecycle allows', async () => {
    renderAs('SUPPORT', [ticketDetails()])
    await openTicket()
    const status = (await screen.findByRole('combobox', { name: 'Status' })) as HTMLSelectElement
    expect(Array.from(status.options).map((o) => o.value)).toEqual([
      'IN_PROGRESS',
      'WAITING_FOR_CUSTOMER',
      'RESOLVED',
    ])
    // Closed is never offered, but how to close is said only where Close ticket is on the page.
    expect(status.getAttribute('aria-describedby')).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    renderAs('SUPPORT', [
      ticketDetails({ ...withSummary({ status: 'RESOLVED' }), resolution: 'Fixed' }),
    ])
    await openTicket()
    const reopen = (await screen.findByRole('combobox', { name: 'Status' })) as HTMLSelectElement
    expect(Array.from(reopen.options).map((o) => o.value)).toEqual(['RESOLVED', 'IN_PROGRESS'])
    expect(screen.getByRole('button', { name: 'Close ticket' })).toBeTruthy()
    const hint = document.getElementById(reopen.getAttribute('aria-describedby')!)!
    expect(hint.textContent).toBe('To close it, use Close ticket at the top of the page.')

    // Moving it on keeps the hint's line, so nothing below moves, and leaves it unread.
    await userEvent.selectOptions(reopen, 'IN_PROGRESS')
    expect(reopen.getAttribute('aria-describedby')).not.toContain(hint.id)
    expect(document.getElementById(hint.id)).toBe(hint)
  })

  it('unfolds the resolution under the status only for a resolved status and sends it with the move', async () => {
    const { patches } = renderAs('SUPPORT', [ticketDetails()], () =>
      jsonResponse({ ...withSummary({ status: 'RESOLVED' }, 4), resolution: 'Fixed in 2.4.1.' }),
    )
    await openTicket()

    await screen.findByRole('combobox', { name: 'Status' })
    expect(screen.queryByRole('textbox', { name: 'Resolution' })).toBeNull()
    await userEvent.selectOptions(select('Status'), 'RESOLVED')
    const resolution = screen.getByRole('textbox', { name: 'Resolution' })
    // Directly under the select that brought it, so only what follows moves.
    const fields = Array.from(
      document.querySelectorAll('select[id^="ticket-facts-"], textarea[id^="ticket-facts-"]'),
    ).map((el) => el.id)
    expect(fields.slice(0, 3)).toEqual([
      'ticket-facts-status',
      'ticket-facts-resolution',
      'ticket-facts-priority',
    ])
    await userEvent.type(resolution, 'Fixed in 2.4.1.')
    await userEvent.click(button('Save changes'))

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body).toEqual({ status: 'RESOLVED', resolution: 'Fixed in 2.4.1.' })
    // A resolved ticket's resolution is edited in the field, not repeated in the facts below it.
    await waitFor(() => expect(button('Save changes').disabled).toBe(true))
    // Now on the ticket, the resolution stays when the field is left blank, so it is optional.
    expect(
      (screen.getByRole('textbox', { name: 'Resolution (optional)' }) as HTMLTextAreaElement).value,
    ).toBe('Fixed in 2.4.1.')
    expect(screen.queryByText('Fixed in 2.4.1.', { ignore: 'textarea' })).toBeNull()
  })

  it('marks each changed field and says the changes are unsaved until they are saved or discarded', async () => {
    renderAs('SUPPORT', [ticketDetails()], () => jsonResponse(withSummary({ priority: 'LOW' }, 4)))
    await openTicket()
    const described = (name: string) =>
      (select(name).getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent)
    await screen.findByRole('combobox', { name: 'Priority' })
    expect(screen.getByText(/^Updated /)).toBeTruthy()

    await userEvent.selectOptions(select('Priority'), 'LOW')

    expect(described('Priority')).toContain('Changed')
    expect(described('Status')).not.toContain('Changed')
    const unsaved = screen.getByText('Unsaved changes')
    expect(button('Save changes').getAttribute('aria-describedby')).toBe(unsaved.id)
    await userEvent.click(button('Discard'))
    expect(described('Priority')).not.toContain('Changed')
    expect(screen.queryByText('Unsaved changes')).toBeNull()

    await userEvent.selectOptions(select('Priority'), 'LOW')
    await userEvent.click(button('Save changes'))
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull())
    // Said where the reader looks, in the line under Save, until the next change.
    expect(screen.getByText('Changes saved').dataset.saved).toBe('true')
    await userEvent.selectOptions(select('Priority'), 'HIGH')
    expect(screen.queryByText('Changes saved')).toBeNull()
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
  })

  it('fills Save in blue only while there is something to save', async () => {
    renderAs('SUPPORT', [ticketDetails()])
    await openTicket()
    await screen.findByRole('combobox', { name: 'Priority' })
    expect(button('Save changes').dataset.tone).toBe('neutral')

    await userEvent.selectOptions(select('Priority'), 'LOW')
    expect(button('Save changes').dataset.tone).toBe('primary')

    await userEvent.click(button('Discard'))
    expect(button('Save changes').dataset.tone).toBe('neutral')
  })

  it('keeps Save in view at the bottom of the window only while there is something to save', async () => {
    renderAs('SUPPORT', [ticketDetails()])
    await openTicket()
    await screen.findByRole('combobox', { name: 'Priority' })
    const bar = () => button('Save changes').parentElement!.parentElement!
    expect(bar().dataset.sticky).toBeUndefined()

    await userEvent.selectOptions(select('Priority'), 'LOW')
    expect(bar().dataset.sticky).toBe('true')

    await userEvent.click(button('Discard'))
    expect(bar().dataset.sticky).toBeUndefined()
  })

  it('warns, without holding Save, when Resolved is picked on a ticket with no first response', async () => {
    const warning =
      'This ticket has no first response yet. Send the customer a public comment before you resolve it.'
    renderAs('SUPPORT', [withSummary({ firstResponseAt: null })])
    await openTicket()
    await screen.findByRole('combobox', { name: 'Status' })
    expect(screen.queryByText(warning)).toBeNull()

    await userEvent.selectOptions(select('Status'), 'RESOLVED')
    expect(screen.getByRole('status').textContent).toBe(warning)
    await userEvent.type(screen.getByRole('textbox', { name: 'Resolution' }), 'Duplicate.')
    expect(button('Save changes').disabled).toBe(false)

    await userEvent.selectOptions(select('Status'), 'WAITING_FOR_CUSTOMER')
    expect(screen.queryByText(warning)).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    renderAs('SUPPORT', [ticketDetails()])
    await openTicket()
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Status' }),
      'RESOLVED',
    )
    expect(screen.queryByText(warning)).toBeNull()
  })

  it('lists every support staff member by team while no team is chosen, and picking one sets their team', async () => {
    const { patches } = renderAs('SUPPORT', [withSummary({ team: null, assignee: null })])
    await openTicket()

    const assignee = await screen.findByRole('combobox', { name: 'Assignee' })
    await waitFor(() => expect(assignee.querySelectorAll('optgroup')).toHaveLength(2))
    expect(
      Array.from(assignee.querySelectorAll('optgroup')).map((group) => [
        group.label,
        Array.from(group.querySelectorAll('option')).map((option) => option.textContent),
      ]),
    ).toEqual([
      ['Billing', ['Bea Billing']],
      ['Projects', ['Jane Doe', 'Piotr Nowak', 'Sam Support']],
    ])

    await userEvent.selectOptions(assignee, PIOTR.id)

    expect(select('Team').value).toBe(PROJECTS.id)
    expect(select('Assignee').value).toBe(PIOTR.id)
    await userEvent.click(button('Save changes'))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body).toEqual({ teamId: PROJECTS.id, assigneeId: PIOTR.id })
  })

  it('asks before leaving the ticket with unsaved changes, and keeps them on Keep editing', async () => {
    renderAs('SUPPORT', [ticketDetails()])
    await openTicket()
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Priority' }), 'LOW')
    await userEvent.selectOptions(select('Category'), '')

    await userEvent.click(screen.getByRole('link', { name: 'All tickets' }))

    const dialog = await screen.findByRole('dialog', { name: 'Leave without saving?' })
    expect(dialog.textContent).toContain(
      'Your changes to RET-1042 are not saved: priority and category.',
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(select('Priority').value).toBe('LOW')

    await userEvent.click(screen.getByRole('link', { name: 'All tickets' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(select('Priority').value).toBe('LOW')

    await userEvent.click(screen.getByRole('link', { name: 'All tickets' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Discard and leave' }))
    expect(await screen.findByText('Ticket list')).toBeTruthy()
  })

  it('leaves without asking once the changes are saved', async () => {
    renderAs('SUPPORT', [ticketDetails()], () => jsonResponse(withSummary({ priority: 'LOW' }, 4)))
    await openTicket()
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Priority' }), 'LOW')
    await userEvent.click(button('Save changes'))
    await waitFor(() => expect(button('Save changes').disabled).toBe(true))

    await userEvent.click(screen.getByRole('link', { name: 'All tickets' }))

    expect(await screen.findByText('Ticket list')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('tells a refused resolution at the field and keeps the draft', async () => {
    const { patches } = renderAs('SUPPORT', [ticketDetails()], () =>
      jsonResponse(
        {
          type: 'https://retrofit.app/problems/validation',
          title: 'validation',
          status: 422,
          errors: [{ field: 'resolution', code: 'field.required', message: 'Required.' }],
        },
        422,
      ),
    )
    await openTicket()

    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Status' }),
      'RESOLVED',
    )
    await userEvent.click(button('Save changes'))

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(await screen.findByText('This field is required.')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Resolution' }).getAttribute('aria-invalid')).toBe(
      'true',
    )
    expect(select('Status').value).toBe('RESOLVED')
  })

  it('resets the assignee to Unassigned when the new team does not include them', async () => {
    const { patches } = renderAs('SUPPORT', [withSummary({ team: PROJECTS, assignee: SAM })])
    await openTicket()

    await waitFor(() =>
      expect(Array.from(select('Team').options).map((o) => o.textContent)).toContain('Billing'),
    )
    expect(select('Assignee').value).toBe(SAM.id)
    await userEvent.selectOptions(select('Team'), BILLING.id)

    expect(select('Assignee').value).toBe('')
    expect(Array.from(select('Assignee').options).map((o) => o.textContent)).toEqual([
      'Unassigned',
      'Bea Billing',
    ])
    await userEvent.click(button('Save changes'))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body).toEqual({ teamId: BILLING.id, assigneeId: null })
  })

  it('shows a disabled current assignee without counting it as a change', async () => {
    const dora = { id: '00000000-0000-0000-0000-00000000a009', name: 'Dora Disabled' }
    const { patches } = renderAs('SUPPORT', [withSummary({ team: PROJECTS, assignee: dora })])
    await openTicket()

    await waitFor(() =>
      expect(Array.from(select('Assignee').options).map((o) => o.textContent)).toEqual([
        'Unassigned',
        'Jane Doe',
        'Piotr Nowak',
        'Sam Support',
        'Dora Disabled',
      ]),
    )
    expect(select('Assignee').value).toBe(dora.id)
    expect(button('Save changes').disabled).toBe(true)

    await userEvent.selectOptions(select('Priority'), 'HIGH')
    expect(button('Save changes').disabled).toBe(false)
    await userEvent.click(button('Save changes'))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body).toEqual({ priority: 'HIGH' })
  })

  it('shows the generic error on a 422 and refetches the teams and the ticket', async () => {
    const { reads, teamReads } = renderAs('SUPPORT', [ticketDetails()], () =>
      problem('validation', 422),
    )
    await openTicket()
    await screen.findByRole('option', { name: 'Piotr Nowak' })

    await userEvent.selectOptions(select('Assignee'), PIOTR.id)
    await userEvent.click(button('Save changes'))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Something went wrong. Please try again.',
    )
    await waitFor(() => expect(teamReads()).toHaveLength(2))
    await waitFor(() => expect(reads()).toHaveLength(2))
  })

  it('tells why a 403 refused the save and keeps the draft', async () => {
    const { reads } = renderAs('SUPPORT', [ticketDetails()], () => problem('ticket/forbidden', 403))
    await openTicket()

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Priority' }), 'LOW')
    await userEvent.click(button('Save changes'))

    expect((await screen.findByRole('alert')).textContent).toBe('You are not allowed to do this.')
    expect(select('Priority').value).toBe('LOW')
    expect(reads()).toHaveLength(1)
  })

  it('drops a refusal once the reader changes the resolution of the draft', async () => {
    renderAs('SUPPORT', [ticketDetails()], () => problem('ticket/forbidden', 403))
    await openTicket()

    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Status' }),
      'RESOLVED',
    )
    await userEvent.click(button('Save changes'))
    await screen.findByRole('alert')
    await userEvent.type(screen.getByRole('textbox', { name: 'Resolution' }), 'Fixed.')

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the conflict alert on a 412 and resets the editor on Reload', async () => {
    const { reads } = renderAs(
      'SUPPORT',
      [ticketDetails(), withSummary({ priority: 'HIGH' }, 4)],
      () => problem('ticket/modified', 412),
    )
    await openTicket()

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Priority' }), 'LOW')
    await userEvent.click(button('Save changes'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'Someone changed this ticket after you opened it. Your changes were not saved.',
    )
    const details = screen.getByRole('heading', { level: 2, name: 'Details' }).parentElement!
    expect(details.parentElement!.contains(alert)).toBe(true)
    expect(select('Priority').value).toBe('LOW')
    await userEvent.click(button('Reload the ticket'))

    await waitFor(() => expect(reads()).toHaveLength(2))
    await waitFor(() => expect(select('Priority').value).toBe('HIGH'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(select('Status'))
    expect(button('Save changes').disabled).toBe(true)
  })

  it('says a ticket closed meanwhile can no longer be changed and refetches it', async () => {
    const { reads } = renderAs(
      'SUPPORT',
      [ticketDetails(), withSummary({ status: 'CLOSED', closedAt: '2026-10-09T11:20:00Z' }, 4)],
      () => problem('ticket/closed', 409),
    )
    await openTicket()

    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Status' }),
      'RESOLVED',
    )
    await userEvent.click(button('Save changes'))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'This ticket is closed and can no longer be changed.',
    )
    await waitFor(() => expect(reads()).toHaveLength(2))
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Status' })).toBeNull())
  })

  it('shows support a read-only panel on a closed ticket', async () => {
    renderAs('SUPPORT', [withSummary({ status: 'CLOSED', closedAt: '2026-10-09T11:20:00Z' }, 4)])
    await openTicket()

    expect(screen.getByRole('heading', { name: 'Details' })).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.getByText('Projects')).toBeTruthy()
  })
})

describe('Assign to me', () => {
  afterEach(() => vi.unstubAllGlobals())

  const assignToMe = () => screen.getByRole('button', { name: 'Assign to me' }) as HTMLButtonElement
  // Enabled once the reader's own team is known.
  const ready = () => waitFor(() => expect(assignToMe().disabled).toBe(false))

  it('sets the reader’s own team and the reader in one write, announces it and moves focus to the new assignee', async () => {
    const { patches } = renderAs('SUPPORT', [withSummary({ team: null, assignee: null })], () =>
      jsonResponse(withSummary({ team: PROJECTS, assignee: JANE }, 4)),
    )
    await openTicket()
    const statusLine = within(screen.getByTestId('status-line'))
    expect(statusLine.getByText('Unassigned')).toBeTruthy()
    await ready()

    await userEvent.click(assignToMe())

    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].headers.get('If-Match')).toBe('"3"')
    expect(patches()[0].body).toEqual({ teamId: PROJECTS.id, assigneeId: JANE.id })
    expect(await screen.findByText('Assigned to you.')).toBeTruthy()
    const assignee = statusLine.getByText('Assigned to Jane Doe')
    expect(document.activeElement).toBe(assignee)
    expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull()
  })

  it('is offered on a ticket assigned to someone else, never on the reader’s own, a closed one or to a customer', async () => {
    renderAs('SUPPORT', [withSummary({ team: PROJECTS, assignee: SAM })])
    await openTicket()
    expect(await screen.findByRole('button', { name: 'Assign to me' })).toBeTruthy()

    cleanup()
    vi.unstubAllGlobals()
    renderAs('SUPPORT', [withSummary({ team: PROJECTS, assignee: JANE })])
    await openTicket()
    await screen.findByRole('combobox', { name: 'Status' })
    expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    renderAs('SUPPORT', [withSummary({ status: 'CLOSED', closedAt: '2026-10-09T11:20:00Z' }, 4)])
    await openTicket()
    expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    renderAs('USER', [ticketDetails()])
    await openTicket()
    expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull()
  })

  it('keeps its label while the write is pending', async () => {
    const answer = heldAnswer(withSummary({ team: PROJECTS, assignee: JANE }, 4))
    renderAs('SUPPORT', [ticketDetails()], () => answer.response)
    await openTicket()
    await ready()

    await userEvent.click(assignToMe())

    await waitFor(() => expect(assignToMe().disabled).toBe(true))
    expect(assignToMe().textContent).toBe('Assign to me')
    answer.release()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull())
  })

  it('tells a conflict at the top of the side column and returns focus to it on Reload', async () => {
    const { reads } = renderAs(
      'SUPPORT',
      [ticketDetails(), withSummary({ priority: 'HIGH' }, 4)],
      () => problem('ticket/modified', 412),
    )
    await openTicket()
    await ready()

    await userEvent.click(assignToMe())

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'Someone changed this ticket after you opened it. Your changes were not saved.',
    )
    const details = screen.getByRole('heading', { level: 2, name: 'Details' }).parentElement!
    expect(details.parentElement!.contains(alert)).toBe(false)
    await userEvent.click(button('Reload the ticket'))
    await waitFor(() => expect(reads()).toHaveLength(2))
    expect(document.activeElement).toBe(assignToMe())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { focusManager } from '@tanstack/react-query'
import { jsonResponse, renderRoutes, stubFetch, type FetchCall } from '../../test/harness.tsx'
import { ticketDetails, ticketSummary } from './ticket-fixtures.ts'
import { TicketPage } from './ticket-page.tsx'
import type { TicketDetails, TicketStatus } from './use-tickets.ts'

const TICKET_URL = '/api/tickets/RET-1042'
const AUTHOR_ID = ticketSummary().author.id

const session = (role: 'USER' | 'SUPPORT', id = AUTHOR_ID) => ({
  id: role === 'USER' ? id : '00000000-0000-0000-0000-000000000001',
  email: 'jane@example.com',
  displayName: 'Jane Doe',
  roles: [role],
  language: 'en',
})

const problem = (
  slug: string,
  status: number,
  errors: Array<{ field: string; code: string }> = [],
) =>
  jsonResponse(
    {
      type: `https://retrofit.app/problems/${slug}`,
      title: slug,
      status,
      errors: errors.map((error) => ({ ...error, message: '' })),
    },
    status,
  )

const withStatus = (status: TicketStatus, overrides: Partial<TicketDetails> = {}) => {
  const base = ticketDetails()
  return ticketDetails({ summary: { ...base.summary, status }, ...overrides })
}

/**
 * The ticket page as `role` sees it. Each GET of the ticket answers the next
 * entry of `tickets` (the last one repeats); a PATCH answers `patch`.
 */
function renderAs(
  role: 'USER' | 'SUPPORT',
  tickets: TicketDetails[],
  patch: () => Response = () => jsonResponse(tickets[0]),
  userId = AUTHOR_ID,
) {
  let read = 0
  const calls: FetchCall[] = stubFetch([
    ['/api/auth/session', () => jsonResponse(session(role, userId))],
    ['/api/teams', () => jsonResponse([])],
    [
      TICKET_URL,
      () =>
        calls.at(-1)?.method === 'PATCH'
          ? patch()
          : jsonResponse(tickets[Math.min(read++, tickets.length - 1)]),
    ],
  ])
  renderRoutes([{ path: '/tickets/:reference', element: <TicketPage /> }], '/tickets/RET-1042')
  const reads = () => calls.filter((call) => call.url === TICKET_URL && call.method === 'GET')
  const patches = () => calls.filter((call) => call.method === 'PATCH')
  return { calls, reads, patches }
}

async function openTicket(title = 'Export does not work') {
  await screen.findByRole('heading', { level: 1, name: `RET-1042 · ${title}` })
}

/** Waits until the session is in the cache, so an absent Edit means "not allowed", not "not loaded yet". */
async function sessionLoaded(calls: FetchCall[]) {
  await waitFor(() => expect(calls.some((call) => call.url === '/api/auth/session')).toBe(true))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The panel a heading opens: the heading sits in `PanelHead`, a direct child of `Panel`. */
const panelOf = (heading: string) =>
  screen.getByRole('heading', { level: 2, name: heading }).parentElement!.parentElement!
const editButton = () => screen.queryByRole('button', { name: 'Edit title and description' })
const titleBox = () => screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement
const descriptionBox = () =>
  screen.getByRole('textbox', { name: 'Description (optional)' }) as HTMLTextAreaElement
// Support also sees the details editor's Save changes, so this one is found inside the edit form.
const saveButton = () =>
  within(titleBox().closest('form')!).getByRole('button', {
    name: 'Save changes',
  }) as HTMLButtonElement

describe('TicketContentPanel', () => {
  afterEach(() => {
    focusManager.setFocused(undefined)
    cleanup()
    vi.unstubAllGlobals()
  })

  it('offers Edit to the author while the ticket is new and to support until it is closed', async () => {
    let page = renderAs('USER', [withStatus('NEW')])
    await openTicket()
    expect(await screen.findByRole('button', { name: 'Edit title and description' })).toBeTruthy()

    cleanup()
    vi.unstubAllGlobals()
    page = renderAs('USER', [withStatus('IN_PROGRESS')])
    await openTicket()
    await sessionLoaded(page.calls)
    expect(editButton()).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    page = renderAs('USER', [withStatus('NEW')], undefined, '00000000-0000-0000-0000-00000000a009')
    await openTicket()
    await sessionLoaded(page.calls)
    expect(editButton()).toBeNull()

    cleanup()
    vi.unstubAllGlobals()
    renderAs('SUPPORT', [withStatus('WAITING_FOR_CUSTOMER')])
    await openTicket()
    expect(await screen.findByRole('button', { name: 'Edit title and description' })).toBeTruthy()

    cleanup()
    vi.unstubAllGlobals()
    page = renderAs('SUPPORT', [withStatus('CLOSED')])
    await openTicket()
    await sessionLoaded(page.calls)
    expect(editButton()).toBeNull()
  })

  it('saves only the changed fields with If-Match and returns focus to Edit', async () => {
    const saved = ticketDetails({
      summary: { ...withStatus('NEW').summary, title: 'Export to CSV does not work' },
      version: 4,
    })
    const { patches } = renderAs('USER', [withStatus('NEW')], () => jsonResponse(saved))
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit title and description' }))
    expect(document.activeElement).toBe(titleBox())
    expect(descriptionBox().value).toBe('Clicking Export does nothing.')
    expect(saveButton().disabled).toBe(true)
    expect(
      screen.getByText(
        'You can edit this until support starts working on the ticket. After that, add a comment instead.',
      ),
    ).toBeTruthy()

    await userEvent.clear(titleBox())
    await userEvent.type(titleBox(), '  Export to CSV does not work ')
    await userEvent.click(saveButton())

    await openTicket('Export to CSV does not work')
    expect(patches()).toHaveLength(1)
    expect(patches()[0].headers.get('If-Match')).toBe('"3"')
    expect(patches()[0].body).toEqual({ title: 'Export to CSV does not work' })
    await waitFor(() => expect(document.activeElement).toBe(editButton()))
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull()
  })

  it('keeps the stored text on Cancel and tells support nothing about the author rule', async () => {
    const { patches } = renderAs('SUPPORT', [withStatus('IN_PROGRESS')])
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit title and description' }))
    expect(screen.queryByText(/until support starts working/)).toBeNull()
    await userEvent.clear(descriptionBox())
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Clicking Export does nothing.')).toBeTruthy()
    expect(document.activeElement).toBe(editButton())
    expect(patches()).toHaveLength(0)
  })

  it('refuses a blank title before sending and shows a refused description at its field', async () => {
    const { patches } = renderAs('SUPPORT', [withStatus('IN_PROGRESS')], () =>
      problem('validation', 422, [{ field: 'description', code: 'field.too-long' }]),
    )
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit title and description' }))
    await userEvent.clear(titleBox())
    await userEvent.click(saveButton())
    expect((await screen.findByRole('alert')).textContent).toBe('Give the ticket a title.')
    expect(titleBox().getAttribute('aria-invalid')).toBe('true')
    expect(patches()).toHaveLength(0)

    await userEvent.type(titleBox(), 'Export does not work')
    await userEvent.type(descriptionBox(), ' More.')
    await userEvent.click(saveButton())

    expect((await screen.findByRole('alert')).textContent).toBe('This text is too long.')
    expect(descriptionBox().getAttribute('aria-invalid')).toBe('true')
    expect(patches()[0].body).toEqual({ description: 'Clicking Export does nothing. More.' })
  })

  it('says in the description panel why an author can no longer edit, over the refetched ticket', async () => {
    const { reads } = renderAs('USER', [withStatus('NEW'), withStatus('IN_PROGRESS')], () =>
      problem('ticket/not-editable', 409),
    )
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit title and description' }))
    await userEvent.type(descriptionBox(), ' Also on Firefox.')
    await userEvent.click(saveButton())

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Support is already working on this ticket, so it can no longer be edited. Add a comment instead.',
    )
    await waitFor(() => expect(reads()).toHaveLength(2))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull())
    expect(editButton()).toBeNull()
    expect(within(panelOf('Description')).getByRole('alert')).toBeTruthy()
  })

  it('drops a refusal once the reader changes the draft', async () => {
    renderAs('SUPPORT', [withStatus('IN_PROGRESS')], () => problem('ticket/forbidden', 403))
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit title and description' }))
    await userEvent.type(descriptionBox(), ' Also on Firefox.')
    await userEvent.click(saveButton())
    await screen.findByRole('alert')
    await userEvent.type(titleBox(), '!')

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the draft on a 412 until the ticket is reloaded, then returns focus to Edit', async () => {
    const { reads } = renderAs(
      'SUPPORT',
      [withStatus('IN_PROGRESS'), withStatus('IN_PROGRESS', { version: 4 })],
      () => problem('ticket/modified', 412),
    )
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit title and description' }))
    await userEvent.type(descriptionBox(), ' Also on Firefox.')
    await userEvent.click(saveButton())

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Someone changed this ticket after you opened it. Your changes were not saved.',
    )
    expect(descriptionBox().value).toBe('Clicking Export does nothing. Also on Firefox.')
    await userEvent.click(screen.getByRole('button', { name: 'Reload the ticket' }))

    await waitFor(() => expect(reads()).toHaveLength(2))
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull()
    expect(document.activeElement).toBe(editButton())
  })

  it('keeps the conflict and the draft when the author opens Close and cancels it', async () => {
    renderAs('USER', [withStatus('NEW')], () => problem('ticket/modified', 412))
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit title and description' }))
    await userEvent.type(descriptionBox(), ' Also on Firefox.')
    await userEvent.click(saveButton())
    await screen.findByRole('button', { name: 'Reload the ticket' })
    await userEvent.click(screen.getByRole('button', { name: 'Close ticket' }))
    const dialog = await screen.findByRole('dialog', { name: 'Close RET-1042?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      within(panelOf('Title and description')).getByRole('button', {
        name: 'Reload the ticket',
      }),
    ).toBeTruthy()
    expect(descriptionBox().value).toBe('Clicking Export does nothing. Also on Firefox.')
  })

  it('sends the opened version when a refetch brings someone else’s edit under the draft', async () => {
    const renamed = withStatus('IN_PROGRESS', {
      summary: { ...withStatus('IN_PROGRESS').summary, title: 'Export to CSV fails' },
      version: 4,
    })
    const { reads, patches } = renderAs('SUPPORT', [withStatus('IN_PROGRESS'), renamed], () =>
      problem('ticket/modified', 412),
    )
    await openTicket()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit title and description' }))
    await userEvent.type(descriptionBox(), ' Also on Firefox.')
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    await openTicket('Export to CSV fails')
    expect(reads()).toHaveLength(2)
    await userEvent.click(saveButton())

    await screen.findByRole('button', { name: 'Reload the ticket' })
    expect(patches()[0].headers.get('If-Match')).toBe('"3"')
  })

  it('says when a ticket has no description', async () => {
    renderAs('USER', [withStatus('NEW', { description: '' })])
    await openTicket()

    expect(await screen.findByText('No description.')).toBeTruthy()
  })
})

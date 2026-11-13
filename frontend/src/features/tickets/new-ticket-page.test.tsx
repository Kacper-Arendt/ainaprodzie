import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionGate } from '../auth/session-gate.tsx'
import { jsonResponse, renderRoutes, stubFetch } from '../../test/harness.tsx'
import { ticketDetails, ticketSummary } from './ticket-fixtures.ts'
import { NewTicketPage } from './new-ticket-page.tsx'

function session(role: 'USER' | 'SUPPORT') {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'anna@example.com',
    displayName: 'Anna Kowalska',
    roles: [role],
    language: 'en',
  }
}

function renderNewTicket() {
  renderRoutes(
    [
      {
        path: '/tickets/new',
        element: (
          <SessionGate>
            <NewTicketPage />
          </SessionGate>
        ),
      },
      { path: '/tickets/:reference', element: <p>ticket page</p> },
      { path: '/', element: <p>home page</p> },
    ],
    '/tickets/new',
  )
}

function postsTo(calls: ReturnType<typeof stubFetch>) {
  return calls.filter((call) => call.method === 'POST' && call.url === '/api/tickets')
}

async function fillAndSubmit() {
  fireEvent.change(await screen.findByLabelText('Title'), {
    target: { value: '  CSV export stops at 1,000 rows  ' },
  })
  fireEvent.change(screen.getByLabelText('Description (optional)'), {
    target: { value: 'Only the first 1,000 rows come back.' },
  })
  fireEvent.change(screen.getByLabelText('Category (optional)'), { target: { value: 'BUG' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))
}

describe('NewTicketPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the trimmed payload with an Idempotency-Key and reuses it on a resubmit after a failure', async () => {
    let attempts = 0
    const calls = stubFetch([
      ['/api/auth/session', () => jsonResponse(session('USER'))],
      [
        '/api/tickets',
        () => {
          attempts += 1
          return attempts === 1
            ? jsonResponse({ title: 'Internal Server Error', status: 500 }, 500)
            : jsonResponse(ticketDetails({ summary: ticketSummary({ reference: 'RET-7' }) }), 201)
        },
      ],
    ])
    renderNewTicket()

    await fillAndSubmit()
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))
    expect(await screen.findByText('ticket page')).toBeTruthy()

    const posts = postsTo(calls)
    expect(posts).toHaveLength(2)
    expect(posts[0].body).toEqual({
      title: 'CSV export stops at 1,000 rows',
      description: 'Only the first 1,000 rows come back.',
      category: 'BUG',
    })
    const key = posts[0].headers.get('Idempotency-Key')
    expect(key).toBeTruthy()
    expect(posts[1].headers.get('Idempotency-Key')).toBe(key)
  })

  it('leaves the category out when the customer is not sure of it and goes to the created ticket', async () => {
    const calls = stubFetch([
      ['/api/auth/session', () => jsonResponse(session('USER'))],
      [
        '/api/tickets',
        () =>
          jsonResponse(ticketDetails({ summary: ticketSummary({ reference: 'RET-1051' }) }), 201),
      ],
    ])
    renderNewTicket()

    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Export' } })
    const category = screen.getByLabelText('Category (optional)') as HTMLSelectElement
    expect(category.selectedOptions[0]?.textContent).toBe('Not sure')
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))

    expect(await screen.findByText('ticket page')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(postsTo(calls)[0].body).toEqual({ title: 'Export', description: '' })
  })

  it('shows 422 field errors under their fields', async () => {
    stubFetch([
      ['/api/auth/session', () => jsonResponse(session('USER'))],
      [
        '/api/tickets',
        () =>
          jsonResponse(
            {
              type: 'https://retrofit.app/problems/validation',
              title: 'Validation failed',
              status: 422,
              errors: [
                { field: 'title', code: 'field.required', message: 'must not be blank' },
                { field: 'description', code: 'field.too-long', message: 'too long' },
              ],
            },
            422,
          ),
      ],
    ])
    renderNewTicket()

    await userEvent.type(await screen.findByLabelText('Title'), 'Export')
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }))

    const title = screen.getByLabelText('Title')
    await waitFor(() => expect(title.getAttribute('aria-invalid')).toBe('true'))
    expect(document.activeElement).toBe(title)
    expect(screen.getByText('Give the ticket a title.').id).toBe(
      title.getAttribute('aria-describedby'),
    )
    const description = screen.getByLabelText('Description (optional)')
    expect(description.getAttribute('aria-invalid')).toBe('true')
    expect(description.getAttribute('aria-describedby')).toBe(
      `${screen.getByText('This text is too long.').id} new-ticket-description-hint`,
    )
    expect(screen.getByLabelText('Category (optional)').getAttribute('aria-invalid')).toBeNull()
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'Give the ticket a title.',
      'This text is too long.',
    ])
  })

  it("tells the customer their organization's first response time", async () => {
    stubFetch([
      ['/api/auth/session', () => jsonResponse(session('USER'))],
      [
        '/api/organizations',
        () => jsonResponse([{ id: 'org-1', name: 'Acme Corp', firstResponseSlaMinutes: 240 }]),
      ],
    ])
    renderNewTicket()

    expect(
      await screen.findByText('Support staff give Acme Corp a first response within 4 hours.'),
    ).toBeTruthy()
  })

  it('keeps the notice sized but hidden from assistive technology until the organization is known', async () => {
    stubFetch([['/api/auth/session', () => jsonResponse(session('USER'))]])
    renderNewTicket()

    await screen.findByLabelText('Title')
    const standIn = screen.getByText(/a first response within/)
    expect(standIn.getAttribute('aria-hidden')).toBe('true')
    expect(standIn.textContent).not.toContain('Acme Corp')
  })

  it('tells what makes a useful description, read with the field', async () => {
    stubFetch([['/api/auth/session', () => jsonResponse(session('USER'))]])
    renderNewTicket()

    const description = await screen.findByLabelText('Description (optional)')
    const hint = screen.getByText(
      'Say what you did, what you expected, what happened instead and in which project.',
    )
    expect(description.getAttribute('aria-describedby')).toBe(hint.id)
  })

  it('asks before leaving a typed ticket, naming what would be lost, and keeps it on Keep editing', async () => {
    stubFetch([['/api/auth/session', () => jsonResponse(session('USER'))]])
    renderNewTicket()

    await userEvent.type(await screen.findByLabelText('Title'), 'Export')
    await userEvent.type(screen.getByLabelText('Description (optional)'), 'It fails.')
    await userEvent.click(screen.getByRole('link', { name: 'Cancel' }))

    const dialog = await screen.findByRole('dialog', {
      name: 'Leave without creating the ticket?',
    })
    expect(dialog.textContent).toContain(
      'Your ticket is not created yet. Leaving now discards what you entered: title and description.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Export')
    expect((screen.getByLabelText('Description (optional)') as HTMLTextAreaElement).value).toBe(
      'It fails.',
    )

    await userEvent.click(screen.getByRole('link', { name: 'Cancel' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Discard and leave' }))
    expect(await screen.findByText('home page')).toBeTruthy()
  })

  it('leaves an untouched form without asking', async () => {
    stubFetch([['/api/auth/session', () => jsonResponse(session('USER'))]])
    renderNewTicket()

    await userEvent.type(await screen.findByLabelText('Title'), '   ')
    await userEvent.click(screen.getByRole('link', { name: 'Cancel' }))

    expect(await screen.findByText('home page')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('refuses a blank title at the field, with the focus there, before sending anything', async () => {
    const calls = stubFetch([['/api/auth/session', () => jsonResponse(session('USER'))]])
    renderNewTicket()

    const title = await screen.findByLabelText('Title')
    await userEvent.type(screen.getByLabelText('Description (optional)'), 'It fails.')
    await userEvent.click(screen.getByRole('button', { name: 'Create ticket' }))

    expect(title.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('Give the ticket a title.')
    expect(document.activeElement).toBe(title)
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
  })

  it('sends support staff home', async () => {
    stubFetch([['/api/auth/session', () => jsonResponse(session('SUPPORT'))]])
    renderNewTicket()

    expect(await screen.findByText('home page')).toBeTruthy()
  })
})

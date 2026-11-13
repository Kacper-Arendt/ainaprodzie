import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { jsonResponse, renderElement, stubFetch, type FetchCall } from '../../test/harness.tsx'
import { ticketDetails } from './ticket-fixtures.ts'
import { useTicketWrites, type TicketWrites } from './use-ticket-writes.tsx'
import { useTicket } from './use-tickets.ts'

const TICKET_URL = '/api/tickets/RET-1042'
const PLACES = ['header', 'assign', 'content', 'facts', 'comment', 'links'] as const
const FOCUS = {
  header: 'header-control',
  assign: 'assign-control',
  content: 'content-control',
  facts: 'facts-control',
}

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

let writes: TicketWrites

/**
 * Each place's slots in a section of its own, with the controls a Reload returns
 * focus to. It reads the ticket as the page does, so a refetch is a GET.
 */
function Host() {
  useTicket('RET-1042')
  const current = useTicketWrites(ticketDetails(), FOCUS)
  useEffect(() => {
    writes = current
  })
  return (
    <>
      {PLACES.map((place) => {
        const write = current[place]
        return (
          <section key={place} aria-label={place}>
            {'top' in write && write.top}
            {write.below}
          </section>
        )
      })}
      {Object.values(FOCUS).map((id) => (
        <button key={id} id={id} />
      ))}
    </>
  )
}

/** Answers each write by its method and URL; a GET of the ticket answers the ticket. */
function renderHost(writeAnswers: Record<string, () => Response>) {
  const calls: FetchCall[] = stubFetch([
    [
      '/api/tickets/',
      (url) => {
        const call = calls.at(-1)!
        const answer = writeAnswers[`${call.method} ${url}`]
        return answer ? answer() : jsonResponse(ticketDetails())
      },
    ],
  ])
  renderElement(<Host />)
  const reads = () => calls.filter((call) => call.url === TICKET_URL && call.method === 'GET')
  return { calls, reads }
}

const place = (name: (typeof PLACES)[number]) => screen.getByRole('region', { name })

describe('useTicketWrites', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps a conflict per place until its own Reload, which refetches, resets that draft and focuses its control', async () => {
    const { reads } = renderHost({
      [`PATCH ${TICKET_URL}`]: () => problem('ticket/modified', 412),
      [`POST ${TICKET_URL}/close`]: () => problem('ticket/modified', 412),
      [`POST ${TICKET_URL}/comments`]: () => jsonResponse(ticketDetails({ version: 4 }), 201),
    })

    act(() => writes.facts.save({ priority: 'LOW' }))
    await within(place('facts')).findByRole('button', { name: 'Reload the ticket' })
    act(() => writes.header.close({}))
    await within(place('header')).findByRole('button', { name: 'Reload the ticket' })
    act(() => writes.header.edited())
    act(() => writes.comment.add({ body: 'Any news?' }))
    await waitFor(() => expect(writes.comment.pending).toBe(false))

    expect(within(place('facts')).getByRole('button', { name: 'Reload the ticket' })).toBeTruthy()
    expect(within(place('header')).getByRole('button', { name: 'Reload the ticket' })).toBeTruthy()
    const readsBefore = reads().length
    await userEvent.click(within(place('facts')).getByRole('button', { name: 'Reload the ticket' }))

    await waitFor(() => expect(reads().length).toBe(readsBefore + 1))
    expect(within(place('facts')).queryByRole('alert')).toBeNull()
    expect(writes.facts.key).toBe(1)
    expect(writes.header.key).toBe(0)
    expect(document.activeElement).toBe(document.getElementById('facts-control'))
    expect(within(place('header')).getByRole('button', { name: 'Reload the ticket' })).toBeTruthy()
  })

  it('drops a place’s conflict once a write from it is taken', async () => {
    let answer = () => problem('ticket/modified', 412)
    renderHost({ [`POST ${TICKET_URL}/close`]: () => answer() })

    act(() => writes.header.close({}))
    await within(place('header')).findByRole('button', { name: 'Reload the ticket' })
    answer = () => jsonResponse(ticketDetails({ version: 4 }))
    act(() => writes.header.close({}))

    await waitFor(() => expect(within(place('header')).queryByRole('alert')).toBeNull())
    expect(writes.header.key).toBe(0)
  })

  it('keeps one refusal message on the page, dropped when any ticket write starts or its own draft changes', async () => {
    renderHost({
      [`POST ${TICKET_URL}/comments`]: () => problem('ticket/forbidden', 403),
      [`DELETE ${TICKET_URL}/links/RET-1030`]: () => problem('ticket/forbidden', 403),
    })
    const alerts = () => screen.queryAllByRole('alert').map((alert) => alert.textContent)

    act(() => writes.comment.add({ body: 'Any news?' }))
    expect(await within(place('comment')).findByRole('alert')).toBeTruthy()
    act(() => writes.facts.save({ priority: 'LOW' }))
    await waitFor(() => expect(alerts()).toEqual([]))

    act(() => writes.links.unlink('RET-1030'))
    expect(await within(place('links')).findByRole('alert')).toBeTruthy()
    act(() => writes.comment.add({ body: 'Any news?' }))
    await within(place('comment')).findByRole('alert')
    expect(alerts()).toEqual(['You are not allowed to do this.'])

    act(() => writes.facts.edited())
    expect(within(place('comment')).getByRole('alert')).toBeTruthy()
    act(() => writes.comment.edited())
    expect(alerts()).toEqual([])
  })

  it('explains a 409 at the top of a versioned place and below anywhere else, refetching the ticket either way', async () => {
    const { reads } = renderHost({
      [`PATCH ${TICKET_URL}`]: () => problem('ticket/closed', 409),
      [`POST ${TICKET_URL}/comments`]: () => problem('ticket/closed', 409),
    })
    await waitFor(() => expect(reads()).toHaveLength(1))
    const closedMessage = 'This ticket is closed and can no longer be changed.'

    act(() => writes.facts.save({ priority: 'LOW' }))
    expect((await within(place('facts')).findByRole('alert')).textContent).toBe(closedMessage)
    await waitFor(() => expect(reads()).toHaveLength(2))
    act(() => writes.comment.add({ body: 'Any news?' }))

    expect((await within(place('comment')).findByRole('alert')).textContent).toBe(closedMessage)
    await waitFor(() => expect(reads()).toHaveLength(3))
    expect(writes.facts.top).toBeUndefined()
  })

  it('tells every refusal of Assign to me at its top, as it has no buttons to tell it below', async () => {
    renderHost({ [`PATCH ${TICKET_URL}`]: () => problem('ticket/forbidden', 403) })

    act(() => writes.assign.save({ teamId: 'team', assigneeId: 'me' }))

    await waitFor(() => expect(writes.assign.top).toBeDefined())
    expect(within(place('assign')).getByRole('alert').textContent).toBe(
      'You are not allowed to do this.',
    )
  })

  it('tells a refused field only at the editor’s own field, and lets the editor explain what it knows better', async () => {
    renderHost({
      [`PATCH ${TICKET_URL}`]: () =>
        problem('validation', 422, [{ field: 'title', code: 'field.too-long' }]),
      [`PUT ${TICKET_URL}/links/RET-1003`]: () => problem('ticket/not-found', 404),
    })
    const titleError = vi.fn()
    const ticketError = vi.fn()

    act(() => writes.content.save({ title: 'x' }, { version: 3, fields: { title: titleError } }))
    await waitFor(() => expect(titleError).toHaveBeenCalledWith('This text is too long.'))
    act(() =>
      writes.links.link(
        'RET-1003',
        { type: 'RELATED' },
        { fields: { linkedReference: ticketError } },
      ),
    )
    await waitFor(() =>
      expect(ticketError).toHaveBeenCalledWith('There is no ticket RET-1003 you can see.'),
    )
    expect(screen.queryByRole('alert')).toBeNull()

    act(() => writes.facts.save({ status: 'RESOLVED' }, { explain: () => 'The status moved on.' }))

    expect((await within(place('facts')).findByRole('alert')).textContent).toBe(
      'The status moved on.',
    )
  })

  it('sends a comment again under its key after a failure, and under a new one once the server refuses that key', async () => {
    let answer = () => problem('idempotency/key-reused', 422)
    const { calls } = renderHost({ [`POST ${TICKET_URL}/comments`]: () => answer() })
    const keys = () =>
      calls
        .filter((call) => call.method === 'POST')
        .map((call) => call.headers.get('Idempotency-Key'))

    act(() => writes.comment.add({ body: 'Any news?' }))
    await within(place('comment')).findByRole('alert')
    answer = () => problem('server', 500)
    act(() => writes.comment.add({ body: 'Any news?' }))
    await waitFor(() => expect(keys()).toHaveLength(2))
    await within(place('comment')).findByRole('alert')
    act(() => writes.comment.add({ body: 'Any news?' }))

    await waitFor(() => expect(keys()).toHaveLength(3))
    expect(keys()[1]).not.toBe(keys()[0])
    expect(keys()[2]).toBe(keys()[1])
  })
})

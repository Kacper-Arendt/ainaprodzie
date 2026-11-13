import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, stubFetch } from '../../test/harness.tsx'
import { ticketDetails, ticketSummary } from './ticket-fixtures.ts'
import {
  ticketKeys,
  useAddComment,
  useCloseTicket,
  useLinkTicket,
  useTicket,
  useUnlinkTicket,
} from './use-tickets.ts'

function renderWithClient<T>(hook: () => T) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, ...renderHook(hook, { wrapper }) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ticket mutations', () => {
  it('store the answer as the ticket and invalidate every ticket list and the counts', async () => {
    const answer = ticketDetails({ version: 5, resolution: 'Fixed in 2.4.1' })
    stubFetch([['/api/tickets/RET-1042/close', () => jsonResponse(answer)]])
    const { result, queryClient } = renderWithClient(() => useCloseTicket())
    queryClient.setQueryData(ticketKeys.detail('RET-1042'), ticketDetails({ version: 4 }))
    queryClient.setQueryData(ticketKeys.list({ page: 0 }), { items: [ticketSummary()] })
    queryClient.setQueryData(ticketKeys.list({ status: ['NEW'] }), { items: [] })
    queryClient.setQueryData(ticketKeys.counts(), { all: 1 })
    queryClient.setQueryData(ticketKeys.customerCounts(), { all: 1 })

    result.current.mutate({ reference: 'RET-1042', version: 4, request: {} })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryData(ticketKeys.detail('RET-1042'))).toEqual(answer)
    expect(queryClient.getQueryState(ticketKeys.list({ page: 0 }))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(ticketKeys.list({ status: ['NEW'] }))?.isInvalidated).toBe(
      true,
    )
    expect(queryClient.getQueryState(ticketKeys.counts())?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(ticketKeys.customerCounts())?.isInvalidated).toBe(true)
  })

  it('cancel a refetch in flight so its older ticket cannot replace the answer', async () => {
    const answer = ticketDetails({ version: 5 })
    let answerRefetch: (response: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).endsWith('/close')
          ? Promise.resolve(jsonResponse(answer))
          : new Promise<Response>((resolve) => {
              answerRefetch = resolve
            }),
      ),
    )
    const { result, queryClient } = renderWithClient(() => ({
      ticket: useTicket('RET-1042'),
      close: useCloseTicket(),
    }))
    await waitFor(() => expect(result.current.ticket.fetchStatus).toBe('fetching'))

    result.current.close.mutate({ reference: 'RET-1042', version: 4, request: {} })
    await waitFor(() => expect(result.current.close.isSuccess).toBe(true))
    answerRefetch(jsonResponse(ticketDetails({ version: 4 })))

    await waitFor(() => expect(result.current.ticket.fetchStatus).toBe('idle'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(queryClient.getQueryData(ticketKeys.detail('RET-1042'))).toEqual(answer)
  })

  it('send If-Match from the version and Idempotency-Key as request headers', async () => {
    const calls = stubFetch([
      ['/api/tickets/RET-1042/close', () => jsonResponse(ticketDetails({ version: 8 }))],
      ['/api/tickets/RET-1042/comments', () => jsonResponse(ticketDetails({ version: 8 }), 201)],
    ])
    const close = renderWithClient(() => useCloseTicket())
    const comment = renderWithClient(() => useAddComment())

    close.result.current.mutate({ reference: 'RET-1042', version: 7, request: {} })
    comment.result.current.mutate({
      reference: 'RET-1042',
      request: { body: 'Thanks', internal: false },
      idempotencyKey: 'key-1',
    })

    await waitFor(() => expect(calls).toHaveLength(2))
    const closeCall = calls.find((call) => call.url.endsWith('/close'))
    const commentCall = calls.find((call) => call.url.endsWith('/comments'))
    expect(closeCall?.method).toBe('POST')
    expect(closeCall?.headers.get('If-Match')).toBe('"7"')
    expect(commentCall?.headers.get('Idempotency-Key')).toBe('key-1')
    expect(commentCall?.body).toEqual({ body: 'Thanks', internal: false })
  })
})

describe('link mutations', () => {
  function seed(queryClient: QueryClient) {
    queryClient.setQueryData(ticketKeys.detail('RET-1042'), ticketDetails({ version: 4 }))
    queryClient.setQueryData(ticketKeys.detail('RET-1030'), ticketDetails({ version: 2 }))
    queryClient.setQueryData(ticketKeys.list({ page: 0 }), { items: [ticketSummary()] })
    queryClient.setQueryData(ticketKeys.list({ status: ['NEW'] }), { items: [] })
  }

  function expectStoredAndInvalidated(queryClient: QueryClient, answer: unknown) {
    expect(queryClient.getQueryData(ticketKeys.detail('RET-1042'))).toEqual(answer)
    expect(queryClient.getQueryState(ticketKeys.detail('RET-1030'))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(ticketKeys.list({ page: 0 }))?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(ticketKeys.list({ status: ['NEW'] }))?.isInvalidated).toBe(
      true,
    )
  }

  it('link PUTs the type, stores the answer and invalidates the linked ticket and lists', async () => {
    const answer = ticketDetails({ version: 5 })
    const calls = stubFetch([['/api/tickets/RET-1042/links/RET-1030', () => jsonResponse(answer)]])
    const { result, queryClient } = renderWithClient(() => useLinkTicket())
    seed(queryClient)

    result.current.mutate({
      reference: 'RET-1042',
      linkedReference: 'RET-1030',
      request: { type: 'POTENTIAL_DUPLICATE' },
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.url).toBe('/api/tickets/RET-1042/links/RET-1030')
    expect(calls[0]?.body).toEqual({ type: 'POTENTIAL_DUPLICATE' })
    expectStoredAndInvalidated(queryClient, answer)
  })

  it('unlink sends DELETE with no body and does the same', async () => {
    const answer = ticketDetails({ version: 6 })
    const calls = stubFetch([['/api/tickets/RET-1042/links/RET-1030', () => jsonResponse(answer)]])
    const { result, queryClient } = renderWithClient(() => useUnlinkTicket())
    seed(queryClient)

    result.current.mutate({ reference: 'RET-1042', linkedReference: 'RET-1030' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url).toBe('/api/tickets/RET-1042/links/RET-1030')
    expect(calls[0]?.body).toBeUndefined()
    expectStoredAndInvalidated(queryClient, answer)
  })
})

import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router'
import { Provider } from '../components/ui/provider.tsx'
import '../i18n/index.ts'

/**
 * Every screen sits behind the session gate and the router, so every case
 * needs the same three providers and the same fetch stub. Test-only.
 */
export function jsonResponse(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export interface FetchCall {
  url: string
  method: string
  body: unknown
  headers: Headers
}

/** Routes the stub by URL fragment; the first matching entry wins and is given the URL. */
export function stubFetch(routes: Array<[string, (url: string) => Response]>): FetchCall[] {
  const calls: FetchCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
      calls.push({ url, method: init?.method ?? 'GET', body, headers: new Headers(init?.headers) })
      const match = routes.find(([fragment]) => url.includes(fragment))
      if (!match) return Promise.resolve(jsonResponse({ title: 'unstubbed', status: 404 }, 404))
      return Promise.resolve(match[1](url))
    }),
  )
  return calls
}

export function renderRoutes(
  routes: Array<{ path: string; element: ReactElement | null }>,
  initialEntry: InitialEntry,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [initialEntry] })
  render(
    <Provider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </Provider>,
  )
  return router
}

export function renderElement(element: ReactElement) {
  renderRoutes([{ path: '/', element }], '/')
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Provider } from './components/ui/provider.tsx'
import { jsonResponse, stubFetch } from './test/harness.tsx'
import { routes } from './router.tsx'

const SESSION = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'jane@example.com',
  displayName: 'Jane Doe',
  roles: ['USER'],
  language: 'en',
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Provider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
      </QueryClientProvider>
    </Provider>,
  )
}

describe('router', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders an unknown path signed in as the not-found panel inside the shell', async () => {
    stubFetch([['/api/auth/session', () => jsonResponse(SESSION)]])

    renderAt('/nope')

    expect(await screen.findByText('Page not found')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to home' })).toBeTruthy()
  })

  it('renders /tickets/new as the new-ticket page, not as a ticket', async () => {
    const calls = stubFetch([['/api/auth/session', () => jsonResponse(SESSION)]])

    renderAt('/tickets/new')

    expect(await screen.findByRole('heading', { level: 1, name: 'New ticket' })).toBeTruthy()
    expect(calls.some((call) => call.url.startsWith('/api/tickets/'))).toBe(false)
  })

  it('shows a customer not found at /settings and sends no settings request', async () => {
    const calls = stubFetch([['/api/auth/session', () => jsonResponse(SESSION)]])

    renderAt('/settings')

    expect(await screen.findByText('Page not found')).toBeTruthy()
    expect(calls.some((call) => call.url.includes('/api/chat/settings'))).toBe(false)
  })
})

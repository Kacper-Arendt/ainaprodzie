import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { SessionGate } from '../../features/auth/session-gate.tsx'
import i18n from '../../i18n/index.ts'
import { jsonResponse, renderRoutes, stubFetch } from '../../test/harness.tsx'
import { AppShell } from './app-shell.tsx'
import { Provider } from './provider.tsx'

const SESSION = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'jane@example.com',
  displayName: 'Jane Doe',
  roles: ['SUPPORT'],
  language: 'en',
}

const UNAUTHENTICATED = () =>
  jsonResponse({ type: 'https://retrofit.app/problems/auth/unauthenticated', status: 401 }, 401)

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

const ROUTES = [
  {
    path: '/',
    element: (
      <SessionGate>
        <AppShell />
      </SessionGate>
    ),
  },
  { path: '/login', element: <LocationProbe /> },
]

describe('AppShell', () => {
  afterEach(async () => {
    vi.unstubAllGlobals()
    await i18n.changeLanguage('en')
  })

  it('shows the user and logs out to /login', async () => {
    let signedIn = true
    const calls = stubFetch([
      [
        '/api/auth/logout',
        () => {
          signedIn = false
          return new Response(null, { status: 204 })
        },
      ],
      ['/api/auth/session', () => (signedIn ? jsonResponse(SESSION) : UNAUTHENTICATED())],
    ])

    renderRoutes(ROUTES, '/')

    expect(await screen.findByText('Jane Doe')).toBeTruthy()
    expect(screen.getByText('Support')).toBeTruthy()
    expect(screen.getByText('jane@example.com')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect((await screen.findByTestId('location')).textContent).toBe('/login')
    expect(
      calls.some((call) => call.method === 'POST' && call.url.endsWith('/api/auth/logout')),
    ).toBe(true)
  })

  it('skips past the header to the page from the first Tab stop', async () => {
    stubFetch([['/api/auth/session', () => jsonResponse(SESSION)]])

    renderRoutes(ROUTES, '/')
    await screen.findByText('Jane Doe')

    await userEvent.tab()
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(document.activeElement).toBe(skip)
    await userEvent.keyboard('{Enter}')
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('switches to Polish, tells the server and stays Polish through the session refetch', async () => {
    let language = 'en'
    const calls = stubFetch([
      [
        '/api/auth/language',
        () => {
          language = 'pl'
          return new Response(null, { status: 204 })
        },
      ],
      ['/api/auth/session', () => jsonResponse({ ...SESSION, language })],
    ])

    renderRoutes(ROUTES, '/')

    await userEvent.click(await screen.findByRole('button', { name: 'Polski' }))

    expect(screen.getByRole('button', { name: 'Wyloguj się' })).toBeTruthy()
    const put = () => calls.findIndex((call) => call.url.endsWith('/api/auth/language'))
    await waitFor(() => expect(put()).toBeGreaterThanOrEqual(0))
    expect(calls[put()]).toMatchObject({ method: 'PUT', body: { language: 'pl' } })
    await waitFor(() =>
      expect(calls.slice(put() + 1).some((call) => call.url.endsWith('/api/auth/session'))).toBe(
        true,
      ),
    )
    // The refetch has landed; give any language sync a turn to run.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('button', { name: 'Wyloguj się' })).toBeTruthy()
    expect(i18n.resolvedLanguage).toBe('pl')
    expect(document.documentElement.lang).toBe('pl')
  })

  it('shows the support user their team under the email line', async () => {
    stubFetch([
      ['/api/auth/session', () => jsonResponse(SESSION)],
      [
        '/api/teams',
        () =>
          jsonResponse([
            {
              id: '00000000-0000-0000-0000-00000000c001',
              name: 'Billing',
              description: 'Invoices',
              member: true,
            },
            {
              id: '00000000-0000-0000-0000-00000000c002',
              name: 'Identity',
              description: 'Logins',
              member: false,
            },
          ]),
      ],
    ])

    renderRoutes(ROUTES, '/')

    expect(await screen.findByText('Team: Billing')).toBeTruthy()
    expect(screen.getByText('jane@example.com')).toBeTruthy()
  })

  it('links the product name home and names the service and API version under the page', async () => {
    stubFetch([
      ['/api/auth/session', () => jsonResponse(SESSION)],
      ['/api/meta', () => jsonResponse({ service: 'retrofit', apiVersion: '0.0.1-SNAPSHOT' })],
    ])

    renderRoutes(ROUTES, '/')

    const home = await screen.findByRole('link', { name: 'Retrofit' })
    expect(home.getAttribute('href')).toBe('/')
    expect(await screen.findByText('retrofit · API 0.0.1-SNAPSHOT')).toBeTruthy()
  })

  it('drops every cached query on logout so the next account starts from nothing', async () => {
    let signedIn = true
    stubFetch([
      [
        '/api/auth/logout',
        () => {
          signedIn = false
          return new Response(null, { status: 204 })
        },
      ],
      ['/api/auth/session', () => (signedIn ? jsonResponse(SESSION) : UNAUTHENTICATED())],
    ])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['meta'], { service: 'retrofit', apiVersion: '0.0.1-SNAPSHOT' })
    render(
      <Provider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={createMemoryRouter(ROUTES, { initialEntries: ['/'] })} />
        </QueryClientProvider>
      </Provider>,
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect((await screen.findByTestId('location')).textContent).toBe('/login')
    await waitFor(() => expect(queryClient.getQueryCache().getAll()).toEqual([]))
  })
})

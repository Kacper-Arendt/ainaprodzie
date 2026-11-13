import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router'
import { api } from '../../api/client.ts'
import i18n from '../../i18n/index.ts'
import { jsonResponse, renderRoutes, stubFetch } from '../../test/harness.tsx'
import { SessionGate } from './session-gate.tsx'

const SESSION = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'jane@example.com',
  displayName: 'Jane Doe',
  roles: ['USER'],
  language: 'en',
}

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

const UNAUTHENTICATED = () =>
  jsonResponse({ type: 'https://retrofit.app/problems/auth/unauthenticated', status: 401 }, 401)

/** Asks for the tickets of the current URL, so moving to another page sends a new request. */
function TicketsProbe() {
  const { search } = useLocation()
  const tickets = useQuery({
    queryKey: ['tickets', search],
    queryFn: () => api(`/api/tickets${search}`),
  })
  return <p>{tickets.isError ? 'tickets-failed' : 'tickets-screen'}</p>
}

const ROUTES = [
  {
    path: '/tickets',
    element: (
      <SessionGate>
        <p>tickets-screen</p>
      </SessionGate>
    ),
  },
  { path: '/login', element: <LocationProbe /> },
]

describe('SessionGate', () => {
  afterEach(async () => {
    vi.unstubAllGlobals()
    await i18n.changeLanguage('en')
  })

  it('sends an anonymous visitor to /login carrying the requested path as next', async () => {
    stubFetch([
      [
        '/api/auth/session',
        () =>
          jsonResponse(
            { type: 'https://retrofit.app/problems/auth/unauthenticated', status: 401 },
            401,
          ),
      ],
    ])

    renderRoutes(ROUTES, '/tickets?x=1')

    expect((await screen.findByTestId('location')).textContent).toBe(
      '/login?next=%2Ftickets%3Fx%3D1',
    )
    expect(screen.queryByText('tickets-screen')).toBeNull()
  })

  it('renders the children for a signed-in user and adopts the account language', async () => {
    stubFetch([['/api/auth/session', () => jsonResponse({ ...SESSION, language: 'pl' })]])

    renderRoutes(ROUTES, '/tickets')

    expect(await screen.findByText('tickets-screen')).toBeTruthy()
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('pl'))
  })

  it('sends the reader to /login when the session ends while the page is open', async () => {
    let signedIn = true
    stubFetch([
      ['/api/auth/session', () => (signedIn ? jsonResponse(SESSION) : UNAUTHENTICATED())],
      ['/api/tickets', () => (signedIn ? jsonResponse([]) : UNAUTHENTICATED())],
    ])
    const router = renderRoutes(
      [
        {
          path: '/tickets',
          element: (
            <SessionGate>
              <TicketsProbe />
            </SessionGate>
          ),
        },
        { path: '/login', element: <LocationProbe /> },
      ],
      '/tickets',
    )
    expect(await screen.findByText('tickets-screen')).toBeTruthy()

    signedIn = false
    await router.navigate('/tickets?page=2')

    expect((await screen.findByTestId('location')).textContent).toBe(
      '/login?next=%2Ftickets%3Fpage%3D2',
    )
  })
})

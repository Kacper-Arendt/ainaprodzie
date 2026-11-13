import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router'
import { api } from '../../api/client.ts'
import i18n from '../../i18n/index.ts'
import { jsonResponse, renderRoutes, stubFetch } from '../../test/harness.tsx'
import { LoginPage } from './login-page.tsx'
import { SessionGate } from './session-gate.tsx'

const SESSION = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'jane@example.com',
  displayName: 'Jane Doe',
  roles: ['USER'],
  language: 'pl',
}

const UNAUTHENTICATED = () =>
  jsonResponse({ type: 'https://retrofit.app/problems/auth/unauthenticated', status: 401 }, 401)

const ROUTES = [
  { path: '/login', element: <LoginPage /> },
  { path: '/tickets', element: <p>tickets-screen</p> },
]

async function submit(email: string, password: string) {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('LoginPage', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=csrf-123'
  })

  afterEach(async () => {
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    vi.unstubAllGlobals()
    await i18n.changeLanguage('en')
  })

  it('signs in with the CSRF header, adopts the account language and lands on next', async () => {
    const calls = stubFetch([
      ['/api/auth/session', UNAUTHENTICATED],
      ['/api/auth/login', () => jsonResponse(SESSION)],
    ])
    renderRoutes(ROUTES, '/login?next=%2Ftickets')

    await submit('jane@example.com', 'secret')

    expect(await screen.findByText('tickets-screen')).toBeTruthy()
    const login = calls.find((call) => call.url === '/api/auth/login')
    expect(login).toMatchObject({
      method: 'POST',
      body: { email: 'jane@example.com', password: 'secret' },
    })
    const loginInit = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url) === '/api/auth/login')?.[1]
    expect(new Headers(loginInit?.headers).get('X-XSRF-TOKEN')).toBe('csrf-123')
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('pl'))
  })

  it('names a blank field under it and sends nothing', async () => {
    const calls = stubFetch([['/api/auth/session', UNAUTHENTICATED]])
    renderRoutes(ROUTES, '/login')
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Email'), 'jane@example.com')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBeNull()
    const password = screen.getByLabelText('Password')
    expect(password.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('This field is required.')
    expect(calls.some((call) => call.url === '/api/auth/login')).toBe(false)
  })

  it('shows the invalid-credentials alert and marks both fields invalid on a 401', async () => {
    stubFetch([
      ['/api/auth/session', UNAUTHENTICATED],
      [
        '/api/auth/login',
        () =>
          jsonResponse(
            {
              type: 'https://retrofit.app/problems/auth/invalid-credentials',
              status: 401,
              detail: 'Invalid email or password.',
            },
            401,
          ),
      ],
    ])
    renderRoutes(ROUTES, '/login')

    await submit('jane@example.com', 'wrong')

    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password.')
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('true')
  })

  it('shows the loading status while the session probe is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )

    renderRoutes(ROUTES, '/login')

    expect((await screen.findByRole('status')).getAttribute('aria-label')).toBe('Loading…')
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('sends a signed-in visitor straight to next without showing the form', async () => {
    stubFetch([['/api/auth/session', () => jsonResponse(SESSION)]])

    renderRoutes(ROUTES, '/login?next=%2Ftickets')

    expect(await screen.findByText('tickets-screen')).toBeTruthy()
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('says the session ended and signs the reader back in where they were', async () => {
    const english = { ...SESSION, language: 'en' }
    let signedIn = true
    stubFetch([
      ['/api/auth/session', () => (signedIn ? jsonResponse(english) : UNAUTHENTICATED())],
      ['/api/auth/login', () => ((signedIn = true), jsonResponse(english))],
      ['/api/tickets', () => (signedIn ? jsonResponse([]) : UNAUTHENTICATED())],
    ])
    const router = renderRoutes(
      [
        { path: '/login', element: <LoginPage /> },
        {
          path: '/tickets',
          element: (
            <SessionGate>
              <TicketsProbe />
            </SessionGate>
          ),
        },
      ],
      '/tickets',
    )
    expect(await screen.findByText('tickets-screen')).toBeTruthy()

    signedIn = false
    await router.navigate('/tickets?page=2')

    // The probe's stale session must not count as signed in, or /login and the gate bounce forever.
    expect(await screen.findByText(/Your session has ended/)).toBeTruthy()
    expect(router.state.location.pathname).toBe('/login')
    await submit('jane@example.com', 'secret')

    expect(await screen.findByText('tickets-screen')).toBeTruthy()
    expect(router.state.location.search).toBe('?page=2')
  })
})

/** Asks for the tickets of the current URL, so moving to another page sends a new request. */
function TicketsProbe() {
  const { search } = useLocation()
  const tickets = useQuery({
    queryKey: ['tickets', search],
    queryFn: () => api(`/api/tickets${search}`),
  })
  return <p>{tickets.isError ? 'tickets-failed' : 'tickets-screen'}</p>
}

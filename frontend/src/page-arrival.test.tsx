import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Provider } from './components/ui/provider.tsx'
import { ticketDetails, ticketSummary } from './features/tickets/ticket-fixtures.ts'
import i18n from './i18n/index.ts'
import { jsonResponse, stubFetch } from './test/harness.tsx'
import { routes } from './router.tsx'

const session = (role: 'USER' | 'SUPPORT', language: 'en' | 'pl') => ({
  id: '00000000-0000-0000-0000-000000000001',
  email: 'jane@example.com',
  displayName: 'Jane Doe',
  roles: [role],
  language,
})

function renderApp(
  path: string,
  role: 'USER' | 'SUPPORT' = 'SUPPORT',
  language: 'en' | 'pl' = 'en',
) {
  stubFetch([
    ['/api/auth/session', () => jsonResponse(session(role, language))],
    ['/api/tickets/RET-1042', () => jsonResponse(ticketDetails())],
    ['/api/tickets/ret-1042', () => jsonResponse(ticketDetails())],
    ['/api/tickets/RET-9999', () => jsonResponse({ title: 'Not Found', status: 404 }, 404)],
    ['/api/tickets/counts', () => jsonResponse({ title: 'Not Found', status: 404 }, 404)],
    ['/api/tickets', () => jsonResponse({ items: [ticketSummary()], total: 45 })],
    ['/api/teams', () => jsonResponse([])],
    ['/api/organizations', () => jsonResponse([])],
  ])
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <Provider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </Provider>,
  )
  return router
}

const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name })

// WCAG 2.4.2 and the route-change focus PRODUCT.md promises: every page names
// the tab, and arriving on a page puts the reader on its h1.
describe('arriving on a page', () => {
  afterEach(async () => {
    vi.unstubAllGlobals()
    await i18n.changeLanguage('en')
  })

  it('names the tab after each page', async () => {
    renderApp('/')
    await heading('Tickets')
    await waitFor(() => expect(document.title).toBe('Tickets – Retrofit'))

    await userEvent.click(await screen.findByRole('link', { name: 'RET-1042' }))
    await heading('RET-1042 · Export does not work')
    await waitFor(() => expect(document.title).toBe('RET-1042 · Export does not work – Retrofit'))
  })

  it('names the tab in Polish too', async () => {
    renderApp('/', 'SUPPORT', 'pl')

    await heading('Zgłoszenia')
    await waitFor(() => expect(document.title).toBe('Zgłoszenia – Retrofit'))
  })

  it('names the tab of the new-ticket and not-found pages', async () => {
    const router = renderApp('/tickets/new', 'USER')
    await heading('New ticket')
    await waitFor(() => expect(document.title).toBe('New ticket – Retrofit'))

    await act(() => router.navigate('/nope'))
    await screen.findByText('Page not found')
    await waitFor(() => expect(document.title).toBe('Page not found – Retrofit'))
  })

  it('leaves the focus alone on the first page of the document', async () => {
    renderApp('/')

    await heading('Tickets')
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves the focus alone on a first page the app redirects', async () => {
    renderApp('/tickets/ret-1042')

    await heading('RET-1042 · Export does not work')
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves the focus alone when signing in is skipped for a live session', async () => {
    renderApp('/login?next=%2F')

    await heading('Tickets')
    expect(document.activeElement).toBe(document.body)
  })

  it('moves the focus to the h1 of a page reached through a redirect', async () => {
    const router = renderApp('/')
    await heading('Tickets')

    await act(() => router.navigate('/tickets/ret-1042'))

    const ticket = await heading('RET-1042 · Export does not work')
    await waitFor(() => expect(document.activeElement).toBe(ticket))
  })

  it('moves the focus to the h1 from the list to a ticket and back', async () => {
    renderApp('/')
    await userEvent.click(await screen.findByRole('link', { name: 'RET-1042' }))

    const ticket = await heading('RET-1042 · Export does not work')
    await waitFor(() => expect(document.activeElement).toBe(ticket))

    await userEvent.click(screen.getByRole('link', { name: 'All tickets' }))
    const list = await heading('Tickets')
    await waitFor(() => expect(document.activeElement).toBe(list))
  })

  it('moves the focus to the h1 of the not-found page', async () => {
    const router = renderApp('/')
    await heading('Tickets')

    await act(() => router.navigate('/nope'))

    const notFound = await heading('Page not found')
    await waitFor(() => expect(document.activeElement).toBe(notFound))
  })

  it('names the tab after a ticket that does not exist and moves the focus to its h1', async () => {
    const router = renderApp('/')
    await heading('Tickets')

    await act(() => router.navigate('/tickets/RET-9999'))

    const notFound = await heading('Ticket not found')
    await waitFor(() => expect(document.activeElement).toBe(notFound))
    expect(document.title).toBe('Ticket not found – Retrofit')
  })

  it('keeps the focus on the pager when only the list’s page changes', async () => {
    renderApp('/')
    const next = await screen.findByRole('button', { name: 'Next' })

    await userEvent.click(next)

    await screen.findByText('21–40 of 45')
    expect(document.activeElement).toBe(next)
  })

  it('keeps the focus a page places in its own content', async () => {
    const router = renderApp('/', 'USER')
    await heading('Tickets')

    await act(() => router.navigate('/tickets/new'))

    await heading('New ticket')
    expect(document.activeElement).toBe(screen.getByLabelText('Title'))
  })
})

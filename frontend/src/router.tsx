import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppShell } from './components/ui/app-shell.tsx'
import { RouteArrival } from './components/ui/route-arrival.tsx'
import { RouteError } from './components/ui/route-error.tsx'
import { HomePage } from './features/home/home-page.tsx'
import { LoginPage } from './features/auth/login-page.tsx'
import { SessionGate } from './features/auth/session-gate.tsx'
import { SettingsRoute } from './features/chat/settings-page.tsx'
import { NewTicketPage } from './features/tickets/new-ticket-page.tsx'
import { TicketPage } from './features/tickets/ticket-page.tsx'

export const routes: RouteObject[] = [
  {
    // Persists across every page, so a page can tell arriving from a first load.
    element: <RouteArrival />,
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: (
          <SessionGate>
            <AppShell />
          </SessionGate>
        ),
        children: [
          {
            // Errors below the gate render inside the shell, not over it.
            errorElement: <RouteError />,
            children: [
              { index: true, element: <HomePage /> },
              { path: '/tickets/new', element: <NewTicketPage /> },
              { path: '/tickets/:reference', element: <TicketPage /> },
              {
                path: '/settings',
                element: <SettingsRoute />,
              },
              { path: '*', element: <RouteError notFound /> },
            ],
          },
        ],
      },
    ],
  },
]

export const router = createBrowserRouter(routes)

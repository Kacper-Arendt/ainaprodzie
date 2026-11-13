import './fonts.ts'
import './i18n/index.ts'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import type { DataRouter } from 'react-router'
import { createQueryClient } from './api/query-client.ts'
import { OfflineNotice } from './components/ui/offline-notice.tsx'
import { Provider } from './components/ui/provider.tsx'

/** The one place the app is mounted: i18n, Chakra, the query client, the router and the offline notice. */
export function renderApp(router: DataRouter): void {
  const queryClient = createQueryClient()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Provider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <OfflineNotice />
        </QueryClientProvider>
      </Provider>
    </StrictMode>,
  )
}

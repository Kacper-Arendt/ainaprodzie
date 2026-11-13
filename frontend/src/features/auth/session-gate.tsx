import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { hashKey, useQueryClient, type QueryCacheNotifyEvent } from '@tanstack/react-query'
import { useLocation } from 'react-router'
import { ProblemError } from '../../api/errors.ts'
import { LoadingScreen } from '../../components/ui/loading-screen.tsx'
import { Redirect } from '../../components/ui/route-arrival.tsx'
import i18n, { activeLanguage } from '../../i18n/index.ts'
import { authKeys, useSession } from './use-auth.ts'

const isUnauthenticated = (error: unknown) => error instanceof ProblemError && error.status === 401

/**
 * Renders its children only for a signed-in user. A 401 sends the visitor to
 * `/login` with the requested path as `next`; any other failure goes to the
 * route's errorElement.
 *
 * A session can end while the page is open (it expires, or the account is
 * disabled), and the first sign is a 401 on some other request. That request
 * only says "not signed in", so the gate asks the session probe again, and
 * the probe's 401 takes the reader to `/login` like any other.
 */
export function SessionGate(props: { children: ReactNode }) {
  const location = useLocation()
  const queryClient = useQueryClient()
  const session = useSession()
  const language = session.data?.language

  // Keyed on the account language only: a selector click changes i18n first
  // and the cached session right after, so this never fights the user.
  useEffect(() => {
    if (language && language !== activeLanguage()) void i18n.changeLanguage(language)
  }, [language])

  useEffect(() => {
    const sessionHash = hashKey(authKeys.session())
    // A probe already in flight answers for every 401 that arrives meanwhile.
    const probe = () =>
      void queryClient.invalidateQueries({ queryKey: authKeys.session() }, { cancelRefetch: false })
    const onQuery = (event: QueryCacheNotifyEvent) => {
      if (event.type !== 'updated' || event.action.type !== 'error') return
      // The probe's own 401 is the redirect below, never a reason to probe again.
      if (event.query.queryHash !== sessionHash && isUnauthenticated(event.action.error)) probe()
    }
    const stopQueries = queryClient.getQueryCache().subscribe(onQuery)
    const stopMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') {
        if (isUnauthenticated(event.action.error)) probe()
      }
    })
    return () => {
      stopQueries()
      stopMutations()
    }
  }, [queryClient])

  if (session.error) {
    if (isUnauthenticated(session.error)) {
      const next = encodeURIComponent(location.pathname + location.search)
      return <Redirect to={`/login?next=${next}`} />
    }
    throw session.error
  }
  if (session.isPending) return <LoadingScreen />
  return props.children
}

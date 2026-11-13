import { useContext, useLayoutEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { ArrivedContext, RedirectContext } from './use-arrived.ts'

/**
 * The root route's element: tells the page below whether the reader navigated to
 * it from another page of this document, rather than loading the document on it.
 * Only the path counts, so a list's filters, paging and sort in the query string
 * never count as arriving, and a `Redirect` hands on the answer of the page it
 * replaces, so a document opened on a URL the app redirects is still on its
 * first page. Pages read it with `useArrived`.
 */
export function RouteArrival() {
  const { key, pathname } = useLocation()
  const [redirectedFrom, setRedirectedFrom] = useState<string>()
  const [seen, setSeen] = useState({ key, pathname, arrived: false })
  // Adjusted during render, so the new page reads the answer on its first render.
  if (seen.key !== key) {
    const kept = seen.pathname === pathname || redirectedFrom === seen.key
    setSeen({ key, pathname, arrived: kept ? seen.arrived : true })
  }
  return (
    <RedirectContext value={setRedirectedFrom}>
      <ArrivedContext value={seen.arrived}>
        <Outlet />
      </ArrivedContext>
    </RedirectContext>
  )
}

/**
 * A `<Navigate replace>` the app decides on its own, such as a canonical URL or
 * skipping sign-in for a live session, so the reader does not arrive anywhere new.
 * Not for a navigation the reader caused, such as opening a ticket just created.
 */
export function Redirect(props: { to: string; state?: unknown }) {
  const { key } = useLocation()
  const reportRedirect = useContext(RedirectContext)
  // A layout effect runs before Navigate's own effect navigates.
  useLayoutEffect(() => reportRedirect(key), [reportRedirect, key])
  return <Navigate replace to={props.to} state={props.state} />
}

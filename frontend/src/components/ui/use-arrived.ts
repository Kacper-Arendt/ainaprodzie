import { createContext, useContext, useEffect, type RefObject } from 'react'

/** Provided by `RouteArrival`; false outside it, so a page rendered on its own never takes the focus. */
export const ArrivedContext = createContext(false)

/** Provided by `RouteArrival`: a `Redirect` reports the key of the location it replaces. */
export const RedirectContext = createContext<(fromKey: string) => void>(() => {})

/** Whether this page was reached by navigating within the app; false on the document's first page. */
export function useArrived(): boolean {
  return useContext(ArrivedContext)
}

/**
 * Moves the focus to a page's h1 (`tabIndex={-1}`) once the reader arrives
 * from another page, so keyboard and screen reader users start reading the new
 * page instead of being left on the body. Not on the document's first page,
 * where the browser's own start stays, and not when the page has already
 * placed the focus in its content (a field's `autoFocus`).
 */
export function useArrivalFocus(heading: RefObject<HTMLElement | null>) {
  const arrived = useArrived()
  useEffect(() => {
    const element = heading.current
    if (!arrived || element === null) return
    const active = document.activeElement
    const content = element.closest('main') ?? document.body
    if (active !== null && active !== document.body && content.contains(active)) return
    element.focus()
    // Not keyed on the heading's text: a header stays while the list's query
    // string changes, and the reader keeps their place there.
  }, [arrived, heading])
}

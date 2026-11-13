import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Names the browser tab after the page ("Tickets – Retrofit"), so a reader with
 * several tabs, or a screen reader announcing the window, knows which page this
 * is (WCAG 2.4.2). `PageHeader` and a `headline` `EmptyState` (not found) call
 * it with their h1; a page state with neither (sign in, loading) calls it itself.
 */
export function usePageTitle(page: string) {
  const { t } = useTranslation('common')
  const title = t('app.documentTitle', { page })
  useEffect(() => {
    document.title = title
  }, [title])
}

/** `usePageTitle` for a branch that returns early, where a hook cannot be called. */
export function PageTitle(props: { page: string }) {
  usePageTitle(props.page)
  return null
}

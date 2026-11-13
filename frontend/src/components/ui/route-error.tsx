import { Box, Button } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { isRouteErrorResponse, Link as RouterLink, useRouteError } from 'react-router'
import { EmptyState, NotFoundMark } from './empty-state.tsx'
import { Panel } from './panel.tsx'

/**
 * The SPA's route error boundary and its catch-all. `notFound` (or a 404
 * route error response) draws the not-found panel with a way home; anything
 * else a loader or a render threw draws the generic panel, whose one remedy
 * is a reload.
 */
export function RouteError(props: { notFound?: boolean }) {
  const { t } = useTranslation('common')
  const error = useRouteError()
  const notFound = props.notFound === true || (isRouteErrorResponse(error) && error.status === 404)

  if (notFound) {
    return (
      <Panel data-route-error="not-found">
        <EmptyState
          icon={<NotFoundMark />}
          title={t('routeError.notFoundTitle')}
          headline
          action={
            <Button asChild variant="outline">
              <RouterLink to="/">{t('routeError.backHome')}</RouterLink>
            </Button>
          }
        >
          {t('routeError.notFoundBody')}
        </EmptyState>
      </Panel>
    )
  }

  return (
    <Box maxW="440px" mx="auto" mt="16">
      <Panel role="alert" data-route-error="generic">
        <EmptyState
          title={t('routeError.title')}
          headline
          action={
            <Button type="button" colorPalette="accent" onClick={() => window.location.reload()}>
              {t('routeError.reload')}
            </Button>
          }
        >
          {t('routeError.body')}
        </EmptyState>
      </Panel>
    </Box>
  )
}

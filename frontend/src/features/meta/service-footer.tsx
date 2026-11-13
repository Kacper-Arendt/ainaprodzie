import { Box, Text } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { fallbackErrorKey } from '../../api/errors.ts'
import { ProblemText } from '../../components/ui/problem-text.tsx'
import { useMeta } from './use-meta.ts'

/**
 * The service and API version under every page, out of the way of the work:
 * a quiet line once loaded, a problem banner with Try again if the meta failed.
 * It keeps one line's height while loading, so the end of the page never jumps.
 */
export function ServiceFooter() {
  const { t } = useTranslation('common')
  const meta = useMeta()

  return (
    <Box
      as="footer"
      mt="20px"
      minH="18px"
      color="fg.muted"
      fontFamily="mono"
      fontSize="12px"
      lineHeight="18px"
    >
      {meta.data && (
        <Text>
          {t('shell.service', { service: meta.data.service, version: meta.data.apiVersion })}
        </Text>
      )}
      <ProblemText
        flush
        error={meta.isLoadingError ? t(fallbackErrorKey(meta.error)) : undefined}
        onRetry={() => void meta.refetch()}
        retrying={meta.isFetching}
      />
    </Box>
  )
}

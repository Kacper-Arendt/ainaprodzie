import { useSyncExternalStore } from 'react'
import { Box, Text } from '@chakra-ui/react'
import { onlineManager } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

const subscribe = (onChange: () => void) => onlineManager.subscribe(onChange)
const isOnline = () => onlineManager.isOnline()

/**
 * Says so while the browser is offline. TanStack Query pauses every request
 * then, so a list stays on Loading and a Send button stays disabled until the
 * connection returns; this explains the wait instead of leaving it a mystery.
 * It sits after the page and sticks to the bottom of the viewport: going
 * offline moves no control, and the end of the page scrolls clear of it
 * instead of hiding under it. The live region stays mounted so the change is
 * announced.
 */
export function OfflineNotice() {
  const { t } = useTranslation('common')
  const online = useSyncExternalStore(subscribe, isOnline)
  return (
    // flow-root keeps the card's bottom margin inside the sticky box, so the card
    // floats clear of the viewport edge instead of touching it.
    <Box
      role="status"
      display="flow-root"
      position="sticky"
      bottom="0"
      zIndex="toast"
      pointerEvents="none"
    >
      {!online && (
        <Box
          pointerEvents="auto"
          mx={{ base: '12px', sm: '16px' }}
          mb={{ base: '12px', sm: '16px' }}
          maxW={{ sm: '420px' }}
          bg="bg.panel"
          borderWidth="ink"
          borderColor="border.control"
          borderRadius="panel"
          boxShadow="raised"
          px="16px"
          py="12px"
          fontSize="14px"
        >
          <Text fontWeight="semibold">{t('offline.title')}</Text>
          <Text color="fg.muted">{t('offline.body')}</Text>
        </Box>
      )}
    </Box>
  )
}

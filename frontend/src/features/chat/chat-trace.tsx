import { Flex, Spinner, Text } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { riseIn, settleIn } from './chat-motion.ts'
import type { Turn } from './use-chat-stream.ts'

/**
 * The work behind an answer, as it happens: until the first words of the
 * answer arrive, a single "preparing" step with a spinner holds the place, so
 * the reader sees that something is happening (chat ADR 0004).
 */
export function ChatTrace(props: { turn: Turn }) {
  const { t } = useTranslation('chat')
  if (props.turn.status !== 'streaming' || props.turn.answer !== '') return null

  return (
    // 12px from the answer with the turn's 8px gap, so the step reads as its own block above it.
    <Flex data-step="active" gap="8px" pb="4px" fontSize="13px" {...riseIn()}>
      <Flex aria-hidden="true" w="12px" h="20px" flexShrink="0" align="center" justify="center">
        <Spinner size="xs" color="accent.solid" borderWidth="1.5px" {...settleIn} />
      </Flex>
      <Text lineHeight="20px" color="fg" fontWeight="semibold">
        {t('pending')}
      </Text>
    </Flex>
  )
}

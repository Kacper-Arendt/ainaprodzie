import { useLayoutEffect, useState } from 'react'
import { Box, Flex, Text, VisuallyHidden } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { ProblemText } from '../../components/ui/problem-text.tsx'
import { ChatAnswer } from './chat-answer.tsx'
import { fadeIn, riseIn } from './chat-motion.ts'
import { ChatTrace } from './chat-trace.tsx'
import type { Turn, TurnError } from './use-chat-stream.ts'
import { useSmoothText } from './use-smooth-text.ts'

const ERROR_KEYS: Record<TurnError, string> = {
  'rate-limited': 'errors.rate-limited',
  unavailable: 'errors.unavailable',
  timeout: 'errors.timeout',
  'personal-data-blocked': 'errors.personal-data-blocked',
  failed: 'errors.failed',
  request: 'errors.request',
}

/**
 * The conversation so far. It is a polite live region, busy while an answer
 * streams and until it is fully on screen, so a screen reader reads the answer
 * once it is complete rather than word by word.
 */
export function ChatMessageList(props: { turns: Turn[]; onRetry: () => void }) {
  const [revealing, setRevealing] = useState(false)
  const busy = props.turns.at(-1)?.status === 'streaming' || revealing
  return (
    <Flex role="log" aria-live="polite" aria-busy={busy} direction="column" gap="16px">
      {props.turns.map((turn, index) => {
        const last = index === props.turns.length - 1
        return (
          <ChatTurn
            key={turn.id}
            turn={turn}
            onRetry={last ? props.onRetry : undefined}
            onRevealing={last ? setRevealing : undefined}
          />
        )
      })}
    </Flex>
  )
}

function ChatTurn(props: {
  turn: Turn
  onRetry?: () => void
  onRevealing?: (revealing: boolean) => void
}) {
  const { t } = useTranslation('chat')
  const { t: tCommon } = useTranslation('common')
  const { turn, onRevealing } = props
  const streaming = turn.status === 'streaming'
  const answer = useSmoothText(turn.answer, streaming || turn.status === 'answered')
  const writing = streaming || answer.revealing

  // Before paint, so the log never shows as settled between the stream's end and the reveal's start.
  useLayoutEffect(() => {
    onRevealing?.(answer.revealing)
    return () => onRevealing?.(false)
  }, [onRevealing, answer.revealing])

  // An error code newer than this bundle reads as the generic failure, not as another code's message.
  const errorKey =
    turn.status === 'error'
      ? (ERROR_KEYS as Record<string, string | undefined>)[turn.error]
      : undefined
  // The guardrail would refuse the same question again, so only a changed one is worth asking.
  const retryable = turn.status === 'error' && turn.error !== 'personal-data-blocked'

  return (
    <Flex direction="column" gap="8px">
      <Box
        alignSelf="flex-end"
        maxW="85%"
        bg="bg.subtle"
        borderWidth="ink"
        borderColor="border.control"
        borderRadius="control"
        px="12px"
        py="8px"
        fontSize="14px"
        whiteSpace="pre-wrap"
        overflowWrap="anywhere"
        transformOrigin="bottom right"
        {...riseIn()}
      >
        <VisuallyHidden>{t('speaker.you')}: </VisuallyHidden>
        {turn.question}
      </Box>
      <ChatTrace turn={turn} />
      {answer.text !== '' && (
        <Box {...fadeIn}>
          <VisuallyHidden>{t('speaker.chat')}: </VisuallyHidden>
          <ChatAnswer text={answer.text} writing={writing} />
        </Box>
      )}
      {turn.status === 'stopped' && (
        <Text fontSize="13px" color="fg.muted" {...riseIn()}>
          {t('stopped')}
        </Text>
      )}
      {turn.status === 'error' && (
        <Box {...riseIn()}>
          <ProblemText
            error={errorKey ? t(errorKey) : tCommon('errors.generic')}
            onRetry={retryable ? props.onRetry : undefined}
          />
        </Box>
      )}
    </Flex>
  )
}

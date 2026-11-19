import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Box, Button, CloseButton, Flex, Heading } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { TOUCH_FLOOR } from '../../components/ui/control-style.ts'
import { Lamp } from '../../components/ui/lamp.tsx'
import { ChatComposer } from './chat-composer.tsx'
import { panelIn } from './chat-motion.ts'
import { ChatMessageList } from './chat-message-list.tsx'
import { ChatEmpty } from './chat-empty.tsx'
import { useChatStream } from './use-chat-stream.ts'

export const CHAT_PANEL_ID = 'chat-panel'
const TITLE_ID = 'chat-panel-title'

/**
 * The chat docked in the shell (chat ADR 0006): beside the main column on `lg`
 * and wider, a full-width layer under the header below that. The shell keeps it
 * mounted while closed, so the conversation survives navigation, and it sends
 * nothing before the first question. `data-state` is the conversation's state:
 * `empty`, or the last turn's `streaming`, `answered`, `stopped` or `error`.
 */
export function ChatPanel(props: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('chat')
  const chat = useChatStream()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)

  useEffect(() => {
    if (props.open) inputRef.current?.focus()
  }, [props.open])

  // The conversation follows its growing end (a new question, the answer
  // flowing in) while the reader is at the end; scrolled up, they are left there.
  useEffect(() => {
    const scroller = scrollRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    const observer = new ResizeObserver(() => {
      if (following.current) scroller.scrollTop = scroller.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const onScroll = () => {
    const scroller = scrollRef.current
    if (scroller) {
      following.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48
    }
  }

  // A suggested question unmounts the button that asked it, so focus moves to
  // the box the next question goes into instead of falling to the body.
  const ask = (question: string) => {
    following.current = true
    chat.send(question)
    inputRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
      props.onClose()
    }
  }

  const onNewConversation = () => {
    chat.reset()
    inputRef.current?.focus()
  }

  return (
    <Flex
      as="aside"
      id={CHAT_PANEL_ID}
      aria-labelledby={TITLE_ID}
      data-state={chat.turns.at(-1)?.status ?? 'empty'}
      display={props.open ? 'flex' : 'none'}
      direction="column"
      // The shell renders the panel before the page, so Tab reaches it straight
      // from its toggle; `order` still draws it after the page on `lg`.
      order={{ lg: 1 }}
      position={{ base: 'absolute', lg: 'static' }}
      inset="0"
      zIndex={{ base: '1', lg: 'auto' }}
      w={{ base: 'full', lg: '400px' }}
      flexShrink="0"
      bg="bg.panel"
      borderStartWidth={{ base: '0', lg: 'ink' }}
      borderColor="border.control"
      onKeyDown={onKeyDown}
      {...panelIn}
    >
      {/* The course's window bar: three dark lamps, as no clock is the chat's to light. */}
      <Flex
        align="center"
        gap="12px"
        flexShrink="0"
        bg="bg.subtle"
        borderBottomWidth="ink"
        borderColor="border.control"
        ps="16px"
        pe="8px"
        py="8px"
      >
        <Flex as="span" gap="4px" aria-hidden="true">
          <Lamp tone="off" size="10px" />
          <Lamp tone="off" size="10px" />
          <Lamp tone="off" size="10px" />
        </Flex>
        <Heading
          as="h2"
          id={TITLE_ID}
          flex="1"
          fontSize="26px"
          lineHeight="1"
          fontWeight="normal"
          textTransform="uppercase"
          letterSpacing="0.01em"
        >
          {t('title')}
        </Heading>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={chat.turns.length === 0}
          onClick={onNewConversation}
        >
          {t('newConversation')}
        </Button>
        <CloseButton size="sm" css={TOUCH_FLOOR} aria-label={t('close')} onClick={props.onClose} />
      </Flex>
      {/* Positioned, so a visually hidden speaker label scrolls with it rather than stretching the page. */}
      <Box
        ref={scrollRef}
        flex="1"
        minH="0"
        overflowY="auto"
        position="relative"
        px="16px"
        py="14px"
        onScroll={onScroll}
      >
        <Box ref={contentRef}>
          {chat.turns.length === 0 && <ChatEmpty />}
          <ChatMessageList turns={chat.turns} onRetry={chat.retry} />
        </Box>
      </Box>
      <ChatComposer
        streaming={chat.streaming}
        onSend={ask}
        onStop={chat.stop}
        inputRef={inputRef}
      />
    </Flex>
  )
}

import { useEffect, useRef, useState } from 'react'
import { api, requestHeaders } from '../../api/client.ts'
import type { components, paths } from '../../api/types.gen.ts'
import { activeLanguage } from '../../i18n/index.ts'
import { createChatEventParser, type ChatEvent } from './sse-parser.ts'

type ChatMessageRequest = components['schemas']['ChatMessageRequest']

const MESSAGES_PATH = '/api/chat/conversations/{conversationId}/messages' satisfies keyof paths
const CONVERSATION_PATH = '/api/chat/conversations/{conversationId}' satisfies keyof paths

/** An `error` event's code, or `request` when the question never got a complete answer stream. */
export type TurnError = components['schemas']['ChatErrorEvent']['code'] | 'request'

interface TurnContent {
  id: number
  question: string
  answer: string
}

/** A question and its answer so far. Only a turn that ended in an error has an `error`. */
export type Turn = TurnContent &
  ({ status: 'streaming' | 'answered' | 'stopped' } | { status: 'error'; error: TurnError })

function apply(turn: Turn, event: ChatEvent): Turn {
  if (turn.status !== 'streaming') return turn
  switch (event.type) {
    case 'token':
      return { ...turn, answer: turn.answer + event.text }
    case 'done':
      return { ...turn, status: 'answered' }
    case 'error':
      return { ...turn, status: 'error', error: event.code }
  }
}

/** Posts one question and hands each event of the answer to `onEvent` until the stream ends. */
async function streamAnswer(
  conversationId: string,
  request: ChatMessageRequest,
  signal: AbortSignal,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const response = await fetch(MESSAGES_PATH.replace('{conversationId}', conversationId), {
    method: 'POST',
    headers: requestHeaders('POST', {
      json: true,
      headers: { Accept: 'text/event-stream', 'Accept-Language': activeLanguage() },
    }),
    credentials: 'same-origin',
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok || !response.body) throw new Error(`Chat answered ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parse = createChatEventParser()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    for (const event of parse(decoder.decode(value, { stream: true }))) onEvent(event)
  }
}

/**
 * One conversation with the chat: its turns, and the actions on it. Nothing is
 * sent before the first question. The conversation id is a fresh UUID per
 * mount and per "new conversation", so a reload starts over (chat ADR 0005).
 * One answer streams at a time; `send` while it streams does nothing.
 */
export function useChatStream() {
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID())
  const [turns, setTurns] = useState<Turn[]>([])
  const controller = useRef<AbortController | undefined>(undefined)
  const nextId = useRef(0)

  useEffect(() => () => controller.current?.abort(), [])

  const streaming = turns.at(-1)?.status === 'streaming'

  const update = (id: number, change: (turn: Turn) => Turn) =>
    setTurns((current) => current.map((turn) => (turn.id === id ? change(turn) : turn)))

  const ask = (question: string, previous: Turn[]) => {
    const id = nextId.current++
    const abort = new AbortController()
    controller.current = abort
    setTurns([...previous, { id, question, answer: '', status: 'streaming' }])
    const onEvent = (event: ChatEvent) => {
      if (!abort.signal.aborted) update(id, (turn) => apply(turn, event))
    }
    streamAnswer(conversationId, { text: question }, abort.signal, onEvent)
      .catch(() => undefined)
      .finally(() => {
        // A stream that ends without `done` or `error` lost its answer.
        if (!abort.signal.aborted) {
          update(id, (turn) =>
            turn.status === 'streaming' ? { ...turn, status: 'error', error: 'request' } : turn,
          )
        }
      })
  }

  const send = (question: string) => {
    if (!streaming) ask(question, turns)
  }

  const stop = () => {
    const last = turns.at(-1)
    if (!last || last.status !== 'streaming') return
    controller.current?.abort()
    update(last.id, (turn) => (turn.status === 'streaming' ? { ...turn, status: 'stopped' } : turn))
  }

  /** The failed turn left the server's memory as it was, so the question goes again as it was. */
  const retry = () => {
    const last = turns.at(-1)
    if (last?.status === 'error') ask(last.question, turns.slice(0, -1))
  }

  const reset = () => {
    controller.current?.abort()
    // Forgetting is best effort: a conversation the server kept is never asked under this id again.
    api<void>(CONVERSATION_PATH.replace('{conversationId}', conversationId), {
      method: 'DELETE',
    }).catch(() => undefined)
    setConversationId(crypto.randomUUID())
    setTurns([])
  }

  return { turns, streaming, send, stop, retry, reset }
}

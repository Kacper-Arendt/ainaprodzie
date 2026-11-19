import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation } from 'react-router'
import { AppShell } from '../../components/ui/app-shell.tsx'
import i18n from '../../i18n/index.ts'
import { jsonResponse, renderRoutes } from '../../test/harness.tsx'
import { SessionGate } from '../auth/session-gate.tsx'

const SUPPORT = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'support@example.com',
  displayName: 'Sam Support',
  roles: ['SUPPORT'],
  language: 'en',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

interface ChatCall {
  method: string
  conversationId: string
  headers: Headers
  body: unknown
  signal: AbortSignal | undefined
}

/** An answer stream the test writes into, event by event; aborting the request errors it, as `fetch` does. */
class AnswerStream {
  private controller!: ReadableStreamDefaultController<Uint8Array>
  private readonly encoder = new TextEncoder()
  readonly body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      this.controller = controller
    },
  })

  watch(signal: AbortSignal | undefined) {
    signal?.addEventListener('abort', () =>
      this.controller.error(new DOMException('aborted', 'AbortError')),
    )
  }

  send(data: { type: string } & Record<string, unknown>) {
    this.controller.enqueue(
      this.encoder.encode(`event:${data.type}\ndata:${JSON.stringify(data)}\n\n`),
    )
  }

  finish(data: { type: 'done' } | { type: 'error'; code: string }) {
    this.send(data)
    this.close()
  }

  close() {
    this.controller.close()
  }
}

function stubChat(session: typeof SUPPORT, answers: Array<AnswerStream | Response>) {
  const calls: ChatCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const chat = /\/api\/chat\/conversations\/([^/]+)/.exec(url)
      if (!chat) {
        if (url.endsWith('/api/auth/session')) return Promise.resolve(jsonResponse(session))
        return Promise.resolve(jsonResponse({ title: 'unstubbed', status: 404 }, 404))
      }
      calls.push({
        method: init?.method ?? 'GET',
        conversationId: chat[1],
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
        signal: init?.signal ?? undefined,
      })
      if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
      const answer = answers.shift()
      if (!answer) throw new Error('no answer scripted')
      if (answer instanceof Response) return Promise.resolve(answer)
      answer.watch(init?.signal ?? undefined)
      return Promise.resolve(
        new Response(answer.body, { headers: { 'Content-Type': 'text/event-stream' } }),
      )
    }),
  )
  return calls
}

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{location.pathname + location.search}</p>
}

const ROUTES = [
  {
    path: '/',
    element: (
      <SessionGate>
        <AppShell />
      </SessionGate>
    ),
    children: [
      { index: true, element: <LocationProbe /> },
      { path: '/tickets/:reference', element: <LocationProbe /> },
    ],
  },
]

async function openChat() {
  await userEvent.click(await screen.findByRole('button', { name: 'Chat' }))
  return screen.getByRole('complementary', { name: 'Chat' })
}

const panelState = () => screen.getByRole('complementary', { name: 'Chat' }).dataset.state

describe('ChatPanel', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=csrf-chat'
  })

  afterEach(async () => {
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    vi.unstubAllGlobals()
    await i18n.changeLanguage('en')
  })

  it('opens from the header with focus in the input, offering no suggested questions, and sends nothing', async () => {
    const calls = stubChat(SUPPORT, [])
    renderRoutes(ROUTES, '/')

    const toggle = await screen.findByRole('button', { name: 'Chat' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const panel = await openChat()

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(panel.dataset.state).toBe('empty')
    expect(document.activeElement).toBe(
      within(panel).getByRole('textbox', { name: 'Your question' }),
    )
    expect(
      within(panel).queryByRole('button', { name: 'Hi! What can you help me with?' }),
    ).toBeNull()
    expect(within(panel).getByText('The chat cannot see your tickets.')).toBeTruthy()
    expect(within(panel).getByRole('heading', { level: 3, name: 'Ask the chat' })).toBeTruthy()
    expect(calls).toEqual([])
  })

  it('closes on Escape from inside the panel and returns focus to the toggle', async () => {
    stubChat(SUPPORT, [])
    renderRoutes(ROUTES, '/')
    const panel = await openChat()

    await userEvent.keyboard('{Escape}')

    const toggle = screen.getByRole('button', { name: 'Chat' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(panel.dataset.state).toBe('empty')
    expect(document.activeElement).toBe(toggle)
  })

  it('takes the page out of reach while the panel covers it', async () => {
    stubChat(SUPPORT, [])
    renderRoutes(ROUTES, '/')
    const main = await screen.findByRole('main')
    expect(main.hasAttribute('inert')).toBe(false)

    await openChat()
    expect(main.hasAttribute('inert')).toBe(true)

    await userEvent.keyboard('{Escape}')
    expect(main.hasAttribute('inert')).toBe(false)
  })

  it('keeps focus in the question box after a question is asked', async () => {
    const answer = new AnswerStream()
    stubChat(SUPPORT, [answer])
    renderRoutes(ROUTES, '/')
    const panel = await openChat()

    await ask(panel, 'Hi! What can you help me with?')

    expect(document.activeElement).toBe(
      within(panel).getByRole('textbox', { name: 'Your question' }),
    )
  })

  it('shows that it prepares the answer, then the answer as it streams in', async () => {
    const answer = new AnswerStream()
    const calls = stubChat(SUPPORT, [answer])
    renderRoutes(ROUTES, '/')
    const panel = await openChat()

    await ask(panel, 'Hi! What can you help me with?')

    const log = within(panel).getByRole('log')
    await waitFor(() => expect(panelState()).toBe('streaming'))
    expect(log.getAttribute('aria-live')).toBe('polite')
    expect(log.getAttribute('aria-busy')).toBe('true')
    expect(within(panel).getByRole('button', { name: 'Stop' })).toBeTruthy()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: { text: 'Hi! What can you help me with?' },
    })
    expect(calls[0].conversationId).toMatch(UUID)
    expect(calls[0].headers.get('X-XSRF-TOKEN')).toBe('csrf-chat')
    expect(calls[0].headers.get('Accept-Language')).toBe('en')
    expect(within(log).getByText('Preparing the answer…')).toBeTruthy()

    answer.send({ type: 'token', text: 'I can explain' })
    answer.send({ type: 'token', text: ' how a help desk works.' })
    answer.finish({ type: 'done' })

    await waitFor(() => expect(panelState()).toBe('answered'))
    // The answer keeps flowing in after the stream's end, and the log stays busy until it is all there.
    await waitFor(() => expect(log.getAttribute('aria-busy')).toBe('false'))
    expect(within(log).getByText('I can explain how a help desk works.')).toBeTruthy()
    expect(within(log).queryByText('Preparing the answer…')).toBeNull()
    expect(within(panel).getByRole('button', { name: 'Send' })).toBeTruthy()
  })

  it('asks in the UI language', async () => {
    const answer = new AnswerStream()
    const calls = stubChat(SUPPORT, [answer])
    renderRoutes(ROUTES, '/')
    await userEvent.click(await screen.findByRole('button', { name: 'Polski' }))
    const toggle = await screen.findByRole('button', { name: 'Czat' })
    await userEvent.click(toggle)
    const panel = screen.getByRole('complementary', { name: 'Czat' })

    await userEvent.type(
      within(panel).getByRole('textbox', { name: 'Twoje pytanie' }),
      'Cześć! W czym możesz mi pomóc?',
    )
    await userEvent.click(within(panel).getByRole('button', { name: 'Wyślij' }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].headers.get('Accept-Language')).toBe('pl')
  })

  it('shows an error event as its message, and Try again asks the same question again', async () => {
    const failed = new AnswerStream()
    const retried = new AnswerStream()
    const calls = stubChat(SUPPORT, [failed, retried])
    renderRoutes(ROUTES, '/')
    const panel = await openChat()
    await ask(panel, 'What is an SLA?')

    failed.send({ type: 'token', text: 'You have' })
    failed.finish({ type: 'error', code: 'rate-limited' })

    await waitFor(() => expect(panelState()).toBe('error'))
    expect(within(panel).getByRole('alert').textContent).toBe(
      'Too many questions at once. Wait a moment and try again.',
    )

    await userEvent.click(within(panel).getByRole('button', { name: 'Try again' }))
    retried.finish({ type: 'done' })

    await waitFor(() => expect(panelState()).toBe('answered'))
    expect(calls.map((call) => [call.method, call.conversationId, call.body])).toEqual([
      ['POST', calls[0].conversationId, { text: 'What is an SLA?' }],
      ['POST', calls[0].conversationId, { text: 'What is an SLA?' }],
    ])
    expect(within(panel).getAllByText('What is an SLA?')).toHaveLength(1)
    expect(within(panel).queryByRole('alert')).toBeNull()
  })

  it('says that a question holding personal data was not sent, and offers no Try again', async () => {
    const refused = new AnswerStream()
    stubChat(SUPPORT, [refused])
    renderRoutes(ROUTES, '/')
    const panel = await openChat()
    await ask(panel, 'My card is 4111 1111 1111 1111')

    refused.finish({ type: 'error', code: 'personal-data-blocked' })

    await waitFor(() => expect(panelState()).toBe('error'))
    expect(within(panel).getByRole('alert').textContent).toBe(
      'The chat did not send this question: the conversation holds personal data that must not reach the model, such as a card number. Remove it from the question and ask again, or start a new conversation if an earlier answer holds it.',
    )
    expect(within(panel).queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('treats a refused request and a stream cut short as errors', async () => {
    const cut = new AnswerStream()
    stubChat(SUPPORT, [jsonResponse({ status: 500 }, 500), cut])
    renderRoutes(ROUTES, '/')
    const panel = await openChat()

    await ask(panel, 'What is an SLA?')
    await waitFor(() => expect(panelState()).toBe('error'))
    expect(within(panel).getByRole('alert').textContent).toBe('The question could not be sent.')

    await userEvent.click(within(panel).getByRole('button', { name: 'Try again' }))
    cut.send({ type: 'token', text: 'Half an' })
    cut.close()

    await waitFor(() => expect(within(panel).getByRole('alert')).toBeTruthy())
    expect(panelState()).toBe('error')
  })

  it('stops the answer, keeps what arrived, and sends nothing while an answer streams', async () => {
    const answer = new AnswerStream()
    const calls = stubChat(SUPPORT, [answer])
    renderRoutes(ROUTES, '/')
    const panel = await openChat()
    await ask(panel, 'What is an SLA?')
    answer.send({ type: 'token', text: 'You have three' })
    await within(panel).findByText('You have three')

    const input = within(panel).getByRole('textbox', { name: 'Your question' })
    await userEvent.type(input, 'And a response deadline?{Enter}')
    expect(calls).toHaveLength(1)
    expect((input as HTMLTextAreaElement).value).toBe('And a response deadline?')

    await userEvent.click(within(panel).getByRole('button', { name: 'Stop' }))

    expect(calls[0].signal?.aborted).toBe(true)
    await waitFor(() => expect(panelState()).toBe('stopped'))
    expect(within(panel).getByText('You have three')).toBeTruthy()
    expect(within(panel).getByText('Stopped before the answer was complete.')).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Send' })).toBeTruthy()
  })

  it('shows the preparing step until the first words, and drops it when stopped before them', async () => {
    const first = new AnswerStream()
    const second = new AnswerStream()
    stubChat(SUPPORT, [first, second])
    renderRoutes(ROUTES, '/')
    const panel = await openChat()
    const steps = () =>
      [...panel.querySelectorAll<HTMLElement>('[data-step]')].map((step) => [
        step.dataset.step,
        step.textContent,
      ])

    await ask(panel, 'What is an SLA?')
    await waitFor(() => expect(steps()).toEqual([['active', 'Preparing the answer…']]))
    first.send({ type: 'token', text: 'A promise' })
    await within(panel).findByText('A promise')
    expect(steps()).toEqual([])
    first.finish({ type: 'done' })
    await waitFor(() => expect(panelState()).toBe('answered'))

    await ask(panel, 'And a response deadline?')
    await waitFor(() => expect(steps()).toEqual([['active', 'Preparing the answer…']]))
    await userEvent.click(within(panel).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(panelState()).toBe('stopped'))
    expect(steps()).toEqual([])
  })

  it('starts a new conversation: forgets the old one on the server and asks under a new id', async () => {
    const first = new AnswerStream()
    const second = new AnswerStream()
    const calls = stubChat(SUPPORT, [first, second])
    renderRoutes(ROUTES, '/')
    const panel = await openChat()
    await ask(panel, 'What is an SLA?')
    first.finish({ type: 'done' })
    await waitFor(() => expect(panelState()).toBe('answered'))

    await userEvent.click(within(panel).getByRole('button', { name: 'New conversation' }))

    expect(panelState()).toBe('empty')
    expect(document.activeElement).toBe(
      within(panel).getByRole('textbox', { name: 'Your question' }),
    )
    await ask(panel, 'Hi! What can you help me with?')
    await waitFor(() => expect(calls).toHaveLength(3))
    const [question, forget, next] = calls
    expect([forget.method, forget.conversationId]).toEqual(['DELETE', question.conversationId])
    expect(forget.headers.get('X-XSRF-TOKEN')).toBe('csrf-chat')
    expect(next.conversationId).toMatch(UUID)
    expect(next.conversationId).not.toBe(question.conversationId)
  })

  it('keeps the conversation while the user moves to another page and comes back', async () => {
    const answer = new AnswerStream()
    stubChat(SUPPORT, [answer])
    const router = renderRoutes(ROUTES, '/')
    const panel = await openChat()
    await ask(panel, 'What is an SLA?')
    answer.send({ type: 'token', text: 'A promise about response times.' })
    answer.finish({ type: 'done' })
    await waitFor(() => expect(panelState()).toBe('answered'))
    await userEvent.keyboard('{Escape}')

    await act(() => router.navigate('/tickets/RET-1046'))
    expect(screen.getByTestId('location').textContent).toBe('/tickets/RET-1046')

    await openChat()
    expect(within(panel).getByText('What is an SLA?')).toBeTruthy()
    expect(panelState()).toBe('answered')
  })
})

async function ask(panel: HTMLElement, question: string) {
  const input = within(panel).getByRole('textbox', { name: 'Your question' })
  await userEvent.type(input, question)
  await userEvent.click(within(panel).getByRole('button', { name: 'Send' }))
}

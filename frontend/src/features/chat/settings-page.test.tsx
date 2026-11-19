import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { jsonResponse, renderElement, stubFetch } from '../../test/harness.tsx'
import { SettingsPage, SettingsRoute } from './settings-page.tsx'

const OFF_SENTENCE =
  "Off: only LiteLLM sends traces, one per model call, with the provider model and its cost but without the app's spans."
const ON_SENTENCE =
  "On: the app also sends its own spans, and each question shows as one trace with the app's spans and LiteLLM's model calls."

const SERVER_ERROR = () =>
  jsonResponse({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, 500)

const TRACES = 'App traces to Phoenix'
const JOIN = 'Group LiteLLM calls per chat message'

const JOIN_ON_SENTENCE =
  "On: LiteLLM's calls for one chat message share one trace even while app traces are off. The app's spans never arrive then, so Phoenix lists each call as a row of its own within that trace."
const JOIN_OFF_SENTENCE = 'Off: while app traces are off, each LiteLLM call is a trace of its own.'
const JOIN_LOCKED_SENTENCE =
  'App traces already group each question into one trace, so this applies again only while they are off.'

const LLM_SPANS = 'App LLM traces to Phoenix'
const LLM_SPANS_ON_SENTENCE =
  "On: the app's span of a model call is an LLM span with the call's tokens, so a question's trace counts each call's tokens twice, beside LiteLLM's span."
const LLM_SPANS_OFF_SENTENCE =
  "Off: the app's span of a model call is a plain step, so each call's tokens and cost are counted once, on LiteLLM's span."
const LLM_SPANS_LOCKED_SENTENCE =
  'The app sends no spans while app traces are off, so this applies only while they are on.'

const MODEL = 'Model'
const MODELS = ['chat-gemini', 'chat-anthropic']

const stored = (
  appTracesExported: boolean,
  gatewayTracesJoined = false,
  model = 'chat-gemini',
  appLlmSpansExported = true,
) => jsonResponse({ appTracesExported, gatewayTracesJoined, appLlmSpansExported, model })

/** Stubs fetch with the configured models after the given routes, which can answer the models first. */
const stub = (routes: Parameters<typeof stubFetch>[0]) =>
  stubFetch([...routes, ['/api/chat/models', () => jsonResponse({ models: MODELS })]])

/** Every sentence of a switch is in the page, stacked; only the shown one is exposed to a reader. */
const isShown = (text: string) => screen.getByText(text).getAttribute('aria-hidden') === null

const toggle = (group = TRACES) => within(screen.getByRole('group', { name: group }))
const half = async (name: string, group = TRACES) => {
  await screen.findByRole('group', { name: group })
  return toggle(group).findByRole('button', { name, pressed: true })
}
const other = (name: string, group = TRACES) =>
  toggle(group).getByRole('button', { name, pressed: false })
const button = (name: string, group = TRACES) => toggle(group).getByRole('button', { name })

describe('SettingsPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the stored half pressed with its sentence', async () => {
    stub([['/api/chat/settings', () => stored(false)]])

    renderElement(<SettingsPage />)

    await half('Off')
    expect(other('On')).toBeTruthy()
    expect(isShown(OFF_SENTENCE)).toBe(true)
  })

  it('names the tracing group holding the three switches, after the model panel', async () => {
    stub([['/api/chat/settings', () => stored(false)]])

    renderElement(<SettingsPage />)

    await half('Off')
    const tracing = screen
      .getAllByRole('group')
      .filter((it) => it.getAttribute('aria-labelledby') !== null)
    expect(tracing.map((it) => it.textContent?.slice(0, 18))).toEqual(['Tracing in Phoenix'])
    for (const name of [TRACES, JOIN, LLM_SPANS])
      expect(within(tracing[0]!).getByRole('group', { name })).toBeTruthy()
    expect(within(tracing[0]!).queryByRole('group', { name: MODEL })).toBeNull()
    const model = screen.getByRole('region', { name: MODEL })
    expect(
      model.compareDocumentPosition(tracing[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('puts the data-flow window after the switches in reading order', async () => {
    stub([['/api/chat/settings', () => stored(false)]])

    renderElement(<SettingsPage />)

    const window = await screen.findByRole('region', { name: "Where the chat's data goes" })
    const last = screen.getByRole('region', { name: LLM_SPANS })
    expect(last.compareDocumentPosition(window) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('presses the other half only once the save succeeded and shows its sentence', async () => {
    let exported = false
    stub([['/api/chat/settings', () => stored(exported)]])
    renderElement(<SettingsPage />)
    await half('Off')
    stub([
      [
        '/api/chat/settings',
        () => {
          exported = true
          return stored(exported)
        },
      ],
    ])

    await userEvent.click(other('On'))

    await half('On')
    expect(isShown(ON_SENTENCE)).toBe(true)
  })

  it('keeps the saved half pressed when a refetch started before the save answers late', async () => {
    stub([['/api/chat/settings', () => stored(false)]])
    renderElement(<SettingsPage />)
    await half('Off')
    let releaseStaleGet = () => {}
    const staleBody = new ReadableStream<Uint8Array>({
      start(controller) {
        releaseStaleGet = () => {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                appTracesExported: false,
                gatewayTracesJoined: false,
                appLlmSpansExported: true,
                model: 'chat-gemini',
              }),
            ),
          )
          controller.close()
        }
      },
    })
    const calls = stub([
      [
        '/api/chat/settings',
        () =>
          calls.at(-1)?.method === 'PATCH'
            ? stored(true)
            : new Response(staleBody, { headers: { 'Content-Type': 'application/json' } }),
      ],
    ])
    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    for (const state of ['hidden', 'visible'] as const) {
      visibility.mockReturnValue(state)
      act(() => {
        window.dispatchEvent(new Event('visibilitychange'))
      })
    }
    await waitFor(() => expect(calls.some((call) => call.method === 'GET')).toBe(true))

    await userEvent.click(other('On'))
    await half('On')
    act(() => releaseStaleGet())

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(button('On').getAttribute('aria-pressed')).toBe('true')
  })

  it('sends only the changed setting in a PATCH', async () => {
    const calls = stub([['/api/chat/settings', () => stored(false)]])
    renderElement(<SettingsPage />)

    await half('Off')
    await userEvent.click(other('On'))

    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ appTracesExported: true })
  })

  it('sends the joining switch alone and shows its sentence', async () => {
    const calls = stub([
      [
        '/api/chat/settings',
        () => (calls.at(-1)?.method === 'PATCH' ? stored(false, true) : stored(false)),
      ],
    ])
    renderElement(<SettingsPage />)
    await half('Off', JOIN)

    await userEvent.click(other('On', JOIN))

    await half('On', JOIN)
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      gatewayTracesJoined: true,
    })
    expect(isShown(JOIN_ON_SENTENCE)).toBe(true)
    expect(button('Off').getAttribute('aria-pressed')).toBe('true')
  })

  it('disables the grouping switch with the reason while app traces are on, keeping its stored half pressed', async () => {
    const calls = stub([['/api/chat/settings', () => stored(true, true)]])
    renderElement(<SettingsPage />)

    await half('On', JOIN)

    expect(button('On', JOIN).hasAttribute('disabled')).toBe(true)
    expect(button('Off', JOIN).hasAttribute('disabled')).toBe(true)
    expect(isShown(JOIN_LOCKED_SENTENCE)).toBe(true)
    expect(isShown(JOIN_ON_SENTENCE)).toBe(false)
    await userEvent.click(button('Off', JOIN))
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
    expect(button('On', JOIN).getAttribute('aria-pressed')).toBe('true')
  })

  it('enables the grouping switch with its own sentence while app traces are off', async () => {
    stub([['/api/chat/settings', () => stored(false, false)]])
    renderElement(<SettingsPage />)

    await half('Off', JOIN)

    expect(button('On', JOIN).hasAttribute('disabled')).toBe(false)
    expect(button('Off', JOIN).hasAttribute('disabled')).toBe(false)
    expect(isShown(JOIN_LOCKED_SENTENCE)).toBe(false)
    expect(isShown(JOIN_OFF_SENTENCE)).toBe(true)
  })

  it('unlocks the grouping switch once app traces are switched off', async () => {
    let exported = true
    const calls = stub([
      [
        '/api/chat/settings',
        () => {
          if (calls.at(-1)?.method === 'PATCH') exported = false
          return stored(exported)
        },
      ],
    ])
    renderElement(<SettingsPage />)
    await half('On')
    expect(button('Off', JOIN).hasAttribute('disabled')).toBe(true)

    await userEvent.click(button('Off'))

    await half('Off')
    await waitFor(() => expect(button('On', JOIN).hasAttribute('disabled')).toBe(false))
  })

  it('disables the app LLM traces switch with the reason while app traces are off', async () => {
    const calls = stub([['/api/chat/settings', () => stored(false)]])
    renderElement(<SettingsPage />)

    await half('On', LLM_SPANS)

    expect(button('Off', LLM_SPANS).hasAttribute('disabled')).toBe(true)
    expect(isShown(LLM_SPANS_LOCKED_SENTENCE)).toBe(true)
    expect(isShown(LLM_SPANS_ON_SENTENCE)).toBe(false)
    await userEvent.click(button('Off', LLM_SPANS))
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
  })

  it('sends the app LLM traces switch alone and shows its sentence', async () => {
    const calls = stub([
      [
        '/api/chat/settings',
        () =>
          calls.at(-1)?.method === 'PATCH'
            ? stored(true, false, 'chat-gemini', false)
            : stored(true),
      ],
    ])
    renderElement(<SettingsPage />)
    await half('On', LLM_SPANS)
    expect(isShown(LLM_SPANS_ON_SENTENCE)).toBe(true)

    await userEvent.click(other('Off', LLM_SPANS))

    await half('Off', LLM_SPANS)
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      appLlmSpansExported: false,
    })
    expect(isShown(LLM_SPANS_OFF_SENTENCE)).toBe(true)
  })

  it('names a region per switch, each holding its own toggle', async () => {
    stub([['/api/chat/settings', () => stored(false)]])

    renderElement(<SettingsPage />)

    await half('Off')
    for (const name of [MODEL, TRACES, JOIN, LLM_SPANS]) {
      const region = screen.getByRole('region', { name })
      expect(within(region).getByRole('group', { name })).toBeTruthy()
    }
  })

  it('describes each toggle by the sentence it shows', async () => {
    stub([['/api/chat/settings', () => stored(true, true)]])

    renderElement(<SettingsPage />)

    await half('On', JOIN)
    const described = (group: string) =>
      document.getElementById(
        screen.getByRole('group', { name: group }).getAttribute('aria-describedby') ?? '',
      )?.textContent
    expect(described(TRACES)).toBe(ON_SENTENCE)
    expect(described(JOIN)).toBe(JOIN_LOCKED_SENTENCE)
  })

  it('keeps the old half pressed and shows the problem in the panel of the switch that failed', async () => {
    stub([['/api/chat/settings', () => stored(false)]])
    renderElement(<SettingsPage />)
    await half('Off')
    stub([['/api/chat/settings', SERVER_ERROR]])

    await userEvent.click(button('On'))

    const alert = await within(screen.getByRole('region', { name: TRACES })).findByRole('alert')
    expect(alert.textContent).toBe(
      'Not saved: "App traces to Phoenix" is still off. Something went wrong. Please try again.',
    )
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(button('Off').getAttribute('aria-pressed')).toBe('true')
    expect(button('On').getAttribute('aria-pressed')).toBe('false')
  })

  it('names the switch that failed and its stored state, on or off', async () => {
    stub([['/api/chat/settings', () => stored(false, true)]])
    renderElement(<SettingsPage />)
    await half('On', JOIN)
    stub([['/api/chat/settings', SERVER_ERROR]])

    await userEvent.click(button('Off', JOIN))

    const alert = await within(screen.getByRole('region', { name: JOIN })).findByRole('alert')
    expect(alert.textContent).toBe(
      'Not saved: "Group LiteLLM calls per chat message" is still on. Something went wrong. Please try again.',
    )
    expect(within(screen.getByRole('region', { name: TRACES })).queryByRole('alert')).toBeNull()
    expect(button('On', JOIN).getAttribute('aria-pressed')).toBe('true')
  })

  describe('while saving', () => {
    let release = () => {}
    const slowPatch = (exported: boolean) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          release = () => {
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({
                  appTracesExported: exported,
                  gatewayTracesJoined: false,
                  appLlmSpansExported: true,
                  model: 'chat-gemini',
                }),
              ),
            )
            controller.close()
          }
        },
      })
      return new Response(body, { headers: { 'Content-Type': 'application/json' } })
    }
    const line = (panel: string) =>
      within(screen.getByRole('region', { name: panel })).queryByText(/^(Saving…|Saved)$/)

    it('marks the touched group busy and says Saving in its panel only, ignoring a second press', async () => {
      const calls = stub([
        [
          '/api/chat/settings',
          () => (calls.at(-1)?.method === 'PATCH' ? slowPatch(true) : stored(false)),
        ],
      ])
      renderElement(<SettingsPage />)
      await half('Off')

      await userEvent.click(other('On'))

      await waitFor(() => expect(line(TRACES)?.textContent).toBe('Saving…'))
      expect(line(TRACES)?.dataset.state).toBe('saving')
      expect(screen.getByRole('group', { name: TRACES }).getAttribute('aria-busy')).toBe('true')
      expect(screen.getByRole('group', { name: JOIN }).getAttribute('aria-busy')).not.toBe('true')
      expect(line(JOIN)).toBeNull()
      await userEvent.click(other('On', JOIN))
      expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
      act(() => release())
      await half('On')
    })

    it('keeps the data-flow window on the stored settings while a save is pending, then follows them', async () => {
      const calls = stub([
        [
          '/api/chat/settings',
          () => (calls.at(-1)?.method === 'PATCH' ? slowPatch(true) : stored(false)),
        ],
      ])
      renderElement(<SettingsPage />)
      await half('Off')
      const appToPhoenix = () =>
        [
          ...document.querySelectorAll(
            'li[data-hop="appToPhoenix"] p, li[data-hop="appToPhoenix"] span',
          ),
        ]
          .filter((it) => !it.closest('[aria-hidden="true"]'))
          .map((it) => it.textContent)
      expect(appToPhoenix()).toEqual(['App → Phoenix', 'Not sent', 'The app sends no spans.'])

      await userEvent.click(other('On'))
      await waitFor(() => expect(line(TRACES)?.textContent).toBe('Saving…'))

      expect(button('On').getAttribute('aria-pressed')).toBe('false')
      expect(appToPhoenix()).toEqual(['App → Phoenix', 'Not sent', 'The app sends no spans.'])
      act(() => release())
      await half('On')
      expect(appToPhoenix()).toEqual([
        'App → Phoenix',
        'As written',
        "The app's spans, personal data included.",
      ])
    })

    it('says Saved in the touched panel once and announces the new sentence in one live region', async () => {
      const calls = stub([
        [
          '/api/chat/settings',
          () => (calls.at(-1)?.method === 'PATCH' ? slowPatch(true) : stored(false)),
        ],
      ])
      renderElement(<SettingsPage />)
      await half('Off')
      expect(screen.getByRole('status').textContent).toBe('')

      await userEvent.click(other('On'))
      act(() => release())

      await waitFor(() => expect(line(TRACES)?.dataset.state).toBe('saved'))
      expect(line(TRACES)?.textContent).toBe('Saved')
      expect(screen.getAllByRole('status')).toHaveLength(1)
      expect(screen.getByRole('status').textContent).toBe(
        `Saved: App traces to Phoenix. ${ON_SENTENCE}`,
      )
      expect(screen.getByRole('group', { name: TRACES }).getAttribute('aria-busy')).not.toBe('true')
      expect(line(JOIN)).toBeNull()
    })
  })

  describe('model', () => {
    it('shows the stored model pressed among the configured aliases, in their order, with its sentence', async () => {
      stub([['/api/chat/settings', () => stored(false, false, 'chat-anthropic')]])

      renderElement(<SettingsPage />)

      await half('chat-anthropic', MODEL)
      expect(
        toggle(MODEL)
          .getAllByRole('button')
          .map((option) => option.textContent),
      ).toEqual(MODELS)
      expect(
        document.getElementById(
          screen.getByRole('group', { name: MODEL }).getAttribute('aria-describedby') ?? '',
        )?.textContent,
      ).toBe(
        'Every chat question goes to this LiteLLM alias; litellm/config.yaml maps it to a provider model.',
      )
    })

    it('still offers a stored model that is no longer configured, pressed after the others', async () => {
      stub([['/api/chat/settings', () => stored(false, false, 'chat-retired')]])

      renderElement(<SettingsPage />)

      await half('chat-retired', MODEL)
      expect(
        toggle(MODEL)
          .getAllByRole('button')
          .map((option) => option.textContent),
      ).toEqual([...MODELS, 'chat-retired'])
    })

    it('saves the chosen model alone and presses it only once the save succeeded', async () => {
      let release = () => {}
      const calls = stub([
        [
          '/api/chat/settings',
          () => {
            if (calls.at(-1)?.method !== 'PATCH') return stored(true, true)
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                release = () => {
                  controller.enqueue(
                    new TextEncoder().encode(
                      JSON.stringify({
                        appTracesExported: true,
                        gatewayTracesJoined: true,
                        appLlmSpansExported: true,
                        model: 'chat-anthropic',
                      }),
                    ),
                  )
                  controller.close()
                }
              },
            })
            return new Response(body, { headers: { 'Content-Type': 'application/json' } })
          },
        ],
      ])
      renderElement(<SettingsPage />)
      await half('chat-gemini', MODEL)

      await userEvent.click(other('chat-anthropic', MODEL))

      await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        model: 'chat-anthropic',
      })
      expect(screen.getByRole('group', { name: MODEL }).getAttribute('aria-busy')).toBe('true')
      expect(button('chat-gemini', MODEL).getAttribute('aria-pressed')).toBe('true')
      expect(button('chat-anthropic', MODEL).getAttribute('aria-pressed')).toBe('false')
      act(() => release())

      await half('chat-anthropic', MODEL)
      await waitFor(() =>
        expect(screen.getByRole('status').textContent).toBe(
          'Saved: Model. Chat questions now go to chat-anthropic.',
        ),
      )
      expect(within(screen.getByRole('region', { name: MODEL })).getByText('Saved')).toBeTruthy()
    })

    it('keeps the stored model pressed and names it when the save fails', async () => {
      stub([['/api/chat/settings', () => stored(false)]])
      renderElement(<SettingsPage />)
      await half('chat-gemini', MODEL)
      stub([['/api/chat/settings', SERVER_ERROR]])

      await userEvent.click(button('chat-anthropic', MODEL))

      const alert = await within(screen.getByRole('region', { name: MODEL })).findByRole('alert')
      expect(alert.textContent).toBe(
        'Not saved: "Model" is still chat-gemini. Something went wrong. Please try again.',
      )
      expect(button('chat-gemini', MODEL).getAttribute('aria-pressed')).toBe('true')
    })

    it('shows the models failure with Try again in its own panel and keeps the switches usable', async () => {
      const calls = stub([
        ['/api/chat/models', SERVER_ERROR],
        [
          '/api/chat/settings',
          () => (calls.at(-1)?.method === 'PATCH' ? stored(true) : stored(false)),
        ],
      ])
      renderElement(<SettingsPage />)

      const region = await screen.findByRole('region', { name: MODEL })
      const alert = await within(region).findByRole('alert')
      expect(alert.textContent).toBe(
        'The models could not be loaded. Something went wrong. Please try again.',
      )
      expect(within(region).getByRole('button', { name: 'Try again' })).toBeTruthy()
      await half('chat-gemini', MODEL)

      await userEvent.click(other('On'))

      await half('On')
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        appTracesExported: true,
      })
      expect(within(screen.getByRole('region', { name: TRACES })).queryByRole('alert')).toBeNull()
    })
  })

  it('shows the failure with Try again when the settings cannot be loaded', async () => {
    stub([['/api/chat/settings', SERVER_ERROR]])

    renderElement(<SettingsPage />)

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'On' })).toBeNull()
  })

  it('keeps the loaded view when a refetch fails', async () => {
    stub([['/api/chat/settings', () => stored(true)]])
    renderElement(<SettingsPage />)
    await half('On')
    const calls = stub([['/api/chat/settings', SERVER_ERROR]])

    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    for (const state of ['hidden', 'visible'] as const) {
      visibility.mockReturnValue(state)
      act(() => {
        window.dispatchEvent(new Event('visibilitychange'))
      })
    }

    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(button('On').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })
  it('lets the Saved line go quiet after a few seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const calls = stub([
        [
          '/api/chat/settings',
          () => (calls.at(-1)?.method === 'PATCH' ? stored(true) : stored(false)),
        ],
      ])
      renderElement(<SettingsPage />)
      await half('Off')
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(other('On'))
      await screen.findByText('Saved')

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(screen.queryByText('Saved')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('SettingsRoute', () => {
  afterEach(() => vi.unstubAllGlobals())

  const session = (roles: string[]) =>
    jsonResponse({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'someone@example.com',
      displayName: 'Someone',
      roles,
      language: 'en',
    })

  it('shows support staff the settings', async () => {
    stub([
      ['/api/auth/session', () => session(['SUPPORT'])],
      ['/api/chat/settings', () => stored(false)],
    ])

    renderElement(<SettingsRoute />)

    expect(await screen.findByRole('region', { name: TRACES })).toBeTruthy()
  })

  it('gives a customer the not-found page without asking for the settings', async () => {
    const calls = stub([
      ['/api/auth/session', () => session(['USER'])],
      ['/api/chat/settings', () => stored(false)],
    ])

    renderElement(<SettingsRoute />)

    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith('/api/auth/session'))).toBe(true),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('region', { name: TRACES })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull()
    expect(calls.some((call) => call.url.includes('/api/chat/settings'))).toBe(false)
    expect(calls.some((call) => call.url.includes('/api/chat/models'))).toBe(false)
  })
})

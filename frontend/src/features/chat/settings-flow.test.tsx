import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderElement } from '../../test/harness.tsx'
import { DataFlowWindow, type FlowSettings } from './settings-flow.tsx'

const settings = (appTracesExported: boolean, gatewayTracesJoined = false): FlowSettings => ({
  appTracesExported,
  gatewayTracesJoined,
})

const row = (hop: string) => document.querySelector<HTMLElement>(`[data-hop="${hop}"]`)!

/** Every value of a fact is in the list, stacked; a reader gets the shown ones only. */
const shown = (hop: string) =>
  [...row(hop).querySelectorAll('span, p')]
    .filter((it) => !it.closest('[aria-hidden="true"]'))
    .map((it) => it.textContent)

const TERMS = {
  appToLitellm: 'App → LiteLLM',
  appToPhoenix: 'App → Phoenix',
  litellmToPresidio: 'LiteLLM → Presidio',
  litellmToProvider: 'LiteLLM → Model provider',
  litellmToPhoenix: 'LiteLLM → Phoenix',
}

/** What the hops say whatever the switches: the app masks nothing, the guardrail masks pattern data. */
const ALWAYS = {
  appToLitellm: [
    'As written',
    'Questions as the users wrote them, names and other personal data included.',
  ],
  litellmToPresidio: [
    'Sent',
    "Every request, before it goes to the provider: LiteLLM's guardrail.",
  ],
  litellmToProvider: [
    'Names as written',
    'Names as written. The guardrail masks e-mail addresses, phone numbers, IBANs and PESELs, and a card number refuses the request.',
  ],
  litellmToPhoenix: ['Names as written', 'Each model call, as the provider received it.'],
}

const APP_SPANS = {
  off: ['Not sent', 'The app sends no spans.'],
  on: ['As written', "The app's spans, personal data included."],
}

const SHAPES = {
  withSteps: "One trace per question: the app's spans with LiteLLM's model calls.",
  modelCallsOnly: "One trace per question, holding LiteLLM's model calls only.",
  perCall: 'One trace per model call, from LiteLLM only.',
}

describe('DataFlowWindow', () => {
  const COMBINATIONS: Array<[string, FlowSettings, string[], string]> = [
    ['traces and grouping off', settings(false, false), APP_SPANS.off, SHAPES.perCall],
    ['grouping only', settings(false, true), APP_SPANS.off, SHAPES.modelCallsOnly],
    ['app traces only', settings(true, false), APP_SPANS.on, SHAPES.withSteps],
    ['app traces and grouping', settings(true, true), APP_SPANS.on, SHAPES.withSteps],
  ]

  it.each(COMBINATIONS)(
    'says every hop and how Phoenix groups with %s',
    (_name, stored, appSpans, shape) => {
      renderElement(<DataFlowWindow settings={stored} />)

      for (const hop of Object.keys(ALWAYS) as Array<keyof typeof ALWAYS>)
        expect(shown(hop)).toEqual([TERMS[hop], ...ALWAYS[hop]])
      expect(shown('appToPhoenix')).toEqual([TERMS.appToPhoenix, ...appSpans])
      expect(shown('phoenix')).toEqual(['In Phoenix', shape])
    },
  )

  it('draws an edge solid with an arrowhead only where the hop is sent', () => {
    renderElement(<DataFlowWindow settings={settings(false)} />)

    const sent = (edge: string) =>
      [...document.querySelectorAll(`[data-edge="${edge}"]`)].map((it) =>
        it.getAttribute('data-sent'),
      )
    expect(sent('appToPhoenix')).toEqual(['false', 'false', 'false', 'false'])
    for (const edge of [
      'appToLitellm',
      'litellmToPresidio',
      'litellmToProvider',
      'litellmToPhoenix',
    ])
      expect(new Set(sent(edge))).toEqual(new Set(['true']))
  })

  it('draws every edge sent once app traces are on', () => {
    renderElement(<DataFlowWindow settings={settings(true)} />)

    const states = [...document.querySelectorAll('[data-edge]')].map((it) =>
      it.getAttribute('data-sent'),
    )
    expect(new Set(states)).toEqual(new Set(['true']))
  })

  it("leaves the stamps and sentences empty and the app's edges undecided while the settings load", () => {
    renderElement(<DataFlowWindow settings={undefined} />)

    for (const hop of [...Object.keys(TERMS), 'phoenix'])
      expect(shown(hop)).toEqual([
        hop === 'phoenix' ? 'In Phoenix' : TERMS[hop as keyof typeof TERMS],
      ])
    const undecided = [...document.querySelectorAll('[data-edge]')]
      .filter((it) => it.getAttribute('data-sent') === null)
      .map((it) => it.getAttribute('data-edge'))
    // LiteLLM's guardrail, the provider and its copy to Phoenix are sent whatever the switches say.
    expect(new Set(undecided)).toEqual(new Set(['appToLitellm', 'appToPhoenix']))
  })

  it('names its section and gives a screen reader the list while the picture is hidden', () => {
    renderElement(<DataFlowWindow settings={settings(true)} />)

    const section = screen.getByRole('region', { name: "Where the chat's data goes" })
    expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe(
      "Where the chat's data goes",
    )
    expect(within(section).getAllByRole('listitem')).toHaveLength(5)
    const picture = document.querySelector('[data-edge]')!.closest('[aria-hidden="true"]')!
    expect(picture.textContent).toContain('Runs on this machine')
    expect(within(section).queryByRole('img')).toBeNull()
  })

  it('says how Phoenix groups under the picture, before the hops and outside their list', () => {
    renderElement(<DataFlowWindow settings={settings(false, true)} />)

    const phoenix = row('phoenix')
    const hops = screen.getByRole('list')
    expect(hops.contains(phoenix)).toBe(false)
    const picture = document.querySelector('[data-edge]')!.closest('[aria-hidden="true"]')!
    expect(picture.compareDocumentPosition(phoenix) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(phoenix.compareDocumentPosition(hops) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

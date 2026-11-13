import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import i18n from '../../i18n/index.ts'
import { jsonResponse, renderElement, stubFetch } from '../../test/harness.tsx'
import { CallerAffiliation } from './caller-affiliation.tsx'

const USER_ID = '00000000-0000-0000-0000-00000000a001'

const ACME = {
  id: '00000000-0000-0000-0000-00000000b001',
  name: 'Acme Corp',
  firstResponseSlaMinutes: 60,
}

const TEAMS = [
  {
    id: '00000000-0000-0000-0000-00000000c001',
    name: 'Billing',
    description: 'Invoices',
    member: true,
  },
  {
    id: '00000000-0000-0000-0000-00000000c002',
    name: 'Identity',
    description: 'Logins',
    member: false,
  },
]

const SERVER_ERROR = () =>
  jsonResponse({ type: 'about:blank', title: 'Internal Server Error', status: 500 }, 500)

const line = () => screen.getByTestId('caller-affiliation')

const called = (calls: Array<{ url: string }>, path: string) =>
  calls.some((call) => new URL(call.url, 'http://localhost').pathname === path)

describe('CallerAffiliation', () => {
  afterEach(async () => {
    vi.unstubAllGlobals()
    await i18n.changeLanguage('en')
  })

  it('shows a customer their organization and never asks for teams', async () => {
    const calls = stubFetch([['/api/organizations', () => jsonResponse([ACME])]])

    renderElement(<CallerAffiliation id={USER_ID} roles={['USER']} />)

    expect(await screen.findByText('Organization: Acme Corp')).toBeTruthy()
    expect(line().getAttribute('data-state')).toBe('shown')
    expect(line().getAttribute('title')).toBe('Organization: Acme Corp')
    expect(called(calls, '/api/teams')).toBe(false)
  })

  it('shows a support user their own team and never asks for organizations', async () => {
    const calls = stubFetch([['/api/teams', () => jsonResponse(TEAMS)]])

    renderElement(<CallerAffiliation id={USER_ID} roles={['SUPPORT']} />)

    expect(await screen.findByText('Team: Billing')).toBeTruthy()
    expect(line().getAttribute('data-state')).toBe('shown')
    expect(called(calls, '/api/organizations')).toBe(false)
  })

  it.each([
    ['an empty organization list', ['USER'], '/api/organizations', () => jsonResponse([])],
    [
      'no team marked as their own',
      ['SUPPORT'],
      '/api/teams',
      () => jsonResponse(TEAMS.map((team) => ({ ...team, member: false }))),
    ],
    ['a server error', ['USER'], '/api/organizations', SERVER_ERROR],
  ] as const)('renders an empty line for %s', async (_case, roles, path, respond) => {
    const calls = stubFetch([[path, respond]])

    renderElement(<CallerAffiliation id={USER_ID} roles={[...roles]} />)

    await waitFor(() => expect(called(calls, path)).toBe(true))
    await waitFor(() => expect(line().getAttribute('data-state')).toBe('empty'))
    expect(line().textContent).toBe('')
    expect(line().getAttribute('title')).toBeNull()
  })

  it('keeps one height and one width through loading, empty and shown', async () => {
    let organizations: unknown[] = []
    stubFetch([['/api/organizations', () => jsonResponse(organizations)]])

    renderElement(<CallerAffiliation id={USER_ID} roles={['USER']} />)
    const box = () => {
      const style = getComputedStyle(line())
      return { minHeight: style.minHeight, width: style.width, maxWidth: style.maxWidth }
    }

    expect(line().getAttribute('data-state')).toBe('loading')
    const loading = box()
    await waitFor(() => expect(line().getAttribute('data-state')).toBe('empty'))
    const empty = box()

    vi.unstubAllGlobals()
    organizations = [ACME]
    stubFetch([['/api/organizations', () => jsonResponse(organizations)]])
    renderElement(<CallerAffiliation id={USER_ID} roles={['USER']} />)
    const lines = () => screen.getAllByTestId('caller-affiliation')
    await waitFor(() => expect(lines()[1].getAttribute('data-state')).toBe('shown'))
    const shownStyle = getComputedStyle(lines()[1])
    const shown = {
      minHeight: shownStyle.minHeight,
      width: shownStyle.width,
      maxWidth: shownStyle.maxWidth,
    }

    expect(parseFloat(loading.minHeight)).toBeGreaterThan(0)
    // jsdom applies no media query, so this is the phone width; the 240px slot
    // from `sm` up is checked in a real browser (standards/frontend/css.md).
    expect(loading.maxWidth).toBe('100%')
    expect(empty).toEqual(loading)
    expect(shown).toEqual(loading)
  })

  it('reads the organization label in Polish', async () => {
    await i18n.changeLanguage('pl')
    stubFetch([['/api/organizations', () => jsonResponse([ACME])]])

    renderElement(<CallerAffiliation id={USER_ID} roles={['USER']} />)

    expect(await screen.findByText('Organizacja: Acme Corp')).toBeTruthy()
  })
})

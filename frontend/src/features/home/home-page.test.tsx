import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { SessionGate } from '../auth/session-gate.tsx'
import { jsonResponse, renderElement, stubFetch } from '../../test/harness.tsx'
import { HomePage } from './home-page.tsx'

function session(role: 'USER' | 'SUPPORT') {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'jane@example.com',
    displayName: 'Jane Doe',
    roles: [role],
    language: 'en',
  }
}

function renderHome(role: 'USER' | 'SUPPORT') {
  stubFetch([
    ['/api/auth/session', () => jsonResponse(session(role))],
    // Before the list's prefix, so the desk counts are not answered with a ticket page.
    ['/api/tickets/counts', () => jsonResponse({ title: 'Not Found', status: 404 }, 404)],
    ['/api/tickets', () => jsonResponse({ items: [], total: 0 })],
  ])
  renderElement(
    <SessionGate>
      <HomePage />
    </SessionGate>,
  )
}

describe('HomePage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('opens on the ticket list under a Tickets headline', async () => {
    renderHome('SUPPORT')

    expect(await screen.findByRole('heading', { level: 1, name: 'Tickets' })).toBeTruthy()
    expect(screen.getByText('Tickets of every organization.')).toBeTruthy()
    expect(await screen.findByText('No tickets')).toBeTruthy()
  })

  it('offers customers a New ticket link to /tickets/new', async () => {
    renderHome('USER')

    const link = await screen.findByRole('link', { name: 'New ticket' })
    expect(link.getAttribute('href')).toBe('/tickets/new')
  })

  it('offers support staff no New ticket link', async () => {
    renderHome('SUPPORT')

    expect(await screen.findByText('No tickets')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'New ticket' })).toBeNull()
  })
})

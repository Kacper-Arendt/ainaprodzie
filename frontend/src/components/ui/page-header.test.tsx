import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '../../i18n/index.ts'
import { Provider } from './provider.tsx'
import { PageHeader } from './page-header.tsx'

const TITLE_MAX = 200

function renderHeader(title: string, reference?: string) {
  render(
    <Provider>
      <PageHeader title={title} reference={reference} />
    </Provider>,
  )
  return screen.getByRole('heading', { level: 1 })
}

describe('PageHeader', () => {
  it.each([
    ['Tickets', 'large'],
    ['x'.repeat(40), 'large'],
    ['x'.repeat(41), 'medium'],
    ['x'.repeat(90), 'medium'],
    ['x'.repeat(91), 'long'],
    ['x'.repeat(TITLE_MAX), 'long'],
  ])('sets a title of %j in the %s display step', (title, step) => {
    expect(renderHeader(title).dataset.step).toBe(step)
  })

  it('names the heading after the reference and the title, with the reference its own line', () => {
    const heading = renderHeader('Board view blank for all users', 'RET-1036')

    expect(
      screen.getByRole('heading', { level: 1, name: 'RET-1036 · Board view blank for all users' }),
    ).toBe(heading)
    expect(heading.querySelector('[data-reference]')?.textContent).toMatch(/^RET-1036/)
  })

  it('steps by the title alone, not by the reference before it', () => {
    expect(renderHeader('x'.repeat(40), 'RET-1036').dataset.step).toBe('large')
  })

  it('names the tab after the reference and the title', async () => {
    renderHeader('Board view blank', 'RET-1036')

    await waitFor(() => expect(document.title).toBe('RET-1036 · Board view blank – Retrofit'))
  })

  it('draws no reference line on a page that has none', () => {
    expect(renderHeader('Tickets').querySelector('[data-reference]')).toBeNull()
  })
})

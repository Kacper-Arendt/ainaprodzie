import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderElement } from '../../test/harness.tsx'
import { ChatAnswer } from './chat-answer.tsx'

function links() {
  return screen
    .queryAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')] as const)
}

describe('ChatAnswer', () => {
  it('renders links written by the model as their text, and no images or HTML', async () => {
    const { container } = await renderAnswer(
      'See [the docs](https://evil.example) and [RET-1019](https://evil.example/x).\n\n' +
        '![tracker](https://evil.example/pixel.png)\n\n' +
        '<a href="https://evil.example">raw</a><img src="https://evil.example/raw.png"> <b>bold</b>',
    )

    expect(screen.getByText(/See the docs and RET-1019\./)).toBeTruthy()
    expect(links()).toEqual([])
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).not.toContain('evil.example')
  })

  it('renders a table, scrolling inside the answer', async () => {
    await renderAnswer(
      '| Ticket | Status |\n| --- | --- |\n| RET-1019 | Waiting for customer |\n| RET-1030 | New |',
    )

    const table = screen.getByRole('table')
    expect(table.parentElement?.dataset.scroll).toBe('x')
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Ticket',
      'Status',
    ])
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('renders bare addresses and footnote references as text, not links', async () => {
    const { container } = await renderAnswer(
      'Docs at https://evil.example/docs or www.evil.example, mail help@evil.example.[^1]\n\n[^1]: RET-1046',
    )

    expect(container.textContent).toContain('https://evil.example/docs')
    expect(container.textContent).toContain('www.evil.example')
    expect(container.textContent).not.toContain('Footnotes')
    expect(container.textContent).not.toContain('↩')
    expect(links()).toEqual([])
  })
})

async function renderAnswer(text: string) {
  renderElement(
    <div data-testid="answer">
      <ChatAnswer text={text} />
    </div>,
  )
  return { container: await screen.findByTestId('answer') }
}

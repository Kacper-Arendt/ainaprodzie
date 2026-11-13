import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from './provider.tsx'
import { FormField } from './form-field.tsx'
import { SearchCombobox } from './search-combobox.tsx'

interface Item {
  reference: string
  title: string
}

const ITEMS: Item[] = [
  { reference: 'RET-1003', title: 'SSO login loop on Safari' },
  { reference: 'RET-1001', title: 'Login fails on SSO' },
]

function Harness(props: {
  items: Item[]
  emptyText?: string
  error?: string
  onText: (text: string) => void
  onSelect: (item: Item | null) => void
}) {
  const [text, setText] = useState('')
  return (
    <FormField id="ticket" label="Ticket" error={props.error}>
      {(aria) => (
        <SearchCombobox
          aria={aria}
          items={props.items}
          itemValue={(item) => item.reference}
          itemText={(item) => `${item.reference} · ${item.title}`}
          renderItem={(item) => (
            <>
              <b>{item.reference}</b> {item.title}
            </>
          )}
          inputValue={text}
          onInputValueChange={(next) => {
            setText(next)
            props.onText(next)
          }}
          onSelect={props.onSelect}
          placeholder="Search by reference or title"
          emptyText={props.emptyText}
        />
      )}
    </FormField>
  )
}

describe('SearchCombobox', () => {
  it('reports typed text, offers the items as options and picks one with ArrowDown and Enter', async () => {
    const onText = vi.fn()
    const onSelect = vi.fn()
    render(
      <Provider>
        <Harness items={ITEMS} onText={onText} onSelect={onSelect} />
      </Provider>,
    )

    const input = screen.getByRole('combobox', { name: 'Ticket' })
    await userEvent.type(input, 'sso')

    expect(onText).toHaveBeenLastCalledWith('sso')
    expect(onSelect).toHaveBeenLastCalledWith(null)
    expect(input.getAttribute('aria-expanded')).toBe('true')
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'RET-1003 SSO login loop on Safari',
      'RET-1001 Login fails on SSO',
    ])

    await userEvent.keyboard('{ArrowDown}')
    expect(options[0]!.hasAttribute('data-highlighted')).toBe(true)
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id)

    onSelect.mockClear()
    await userEvent.keyboard('{Enter}')

    expect(onSelect).toHaveBeenCalledWith(ITEMS[0])
    expect(onSelect).not.toHaveBeenCalledWith(null)
    expect((input as HTMLInputElement).value).toBe('RET-1003 · SSO login loop on Safari')
  })

  it('keeps every character of fast typing longer than three characters', async () => {
    const onText = vi.fn()
    render(
      <Provider>
        <Harness items={ITEMS} onText={onText} onSelect={() => {}} />
      </Provider>,
    )

    const input = screen.getByRole('combobox', { name: 'Ticket' })
    // Zero-delay typing drops characters in jsdom even on an uncontrolled Chakra
    // combobox, while a real browser keeps them; a short pause types like a person.
    await userEvent.type(input, 'login loop', { delay: 20 })

    expect((input as HTMLInputElement).value).toBe('login loop')
    expect(onText).toHaveBeenLastCalledWith('login loop')
  })

  it('shows the empty text with no items and carries the field wiring to the input', async () => {
    render(
      <Provider>
        <Harness
          items={[]}
          emptyText="No tickets match"
          error="There is no ticket RET-9999 you can see."
          onText={() => {}}
          onSelect={() => {}}
        />
      </Provider>,
    )

    const input = screen.getByRole('combobox', { name: 'Ticket' })
    expect(input.id).toBe('ticket')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(
      'There is no ticket RET-9999 you can see.',
    )

    await userEvent.type(input, 'billing')

    expect(screen.queryAllByRole('option')).toEqual([])
    expect(await screen.findByText('No tickets match')).toBeTruthy()
  })
})

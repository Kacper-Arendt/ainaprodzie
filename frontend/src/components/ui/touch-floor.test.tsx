import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button, Link } from '@chakra-ui/react'
import { coarsePointerStyle } from '../../test/coarse-pointer.ts'
import { Provider } from './provider.tsx'
import { FieldInput, FieldSelect, FieldTextarea } from './form-field.tsx'
import { FieldMultiSelect } from './multi-select.tsx'
import { SearchCombobox } from './search-combobox.tsx'
import { SegmentedToggle } from './segmented-toggle.tsx'

// The touch floor in DESIGN.md: on a coarse pointer control text is 16px (iOS
// Safari zooms the page on focus below it) and a control is at least 44px tall,
// even where a recipe or the call site sets its own size.
describe('touch floor', () => {
  it('sets 16px text on every control, whatever size the call site gives it', () => {
    render(
      <Provider>
        <FieldInput aria-label="Search" />
        <FieldSelect aria-label="Status" fontSize="14px">
          <option>New</option>
        </FieldSelect>
        <FieldTextarea aria-label="Description" fontSize="14px" css={{ fieldSizing: 'content' }} />
        <FieldMultiSelect
          aria={{ id: 'statuses' }}
          options={[{ value: 'NEW', label: 'New' }]}
          anyLabel="Any status"
          value={[]}
          onChange={() => {}}
        />
        <SearchCombobox
          aria={{ id: 'link' }}
          items={[]}
          itemValue={(item: string) => item}
          itemText={(item: string) => item}
          renderItem={(item: string) => item}
          inputValue=""
          onInputValueChange={() => {}}
          onSelect={() => {}}
          placeholder="RET-1001"
        />
      </Provider>,
    )

    const controls = [
      screen.getByLabelText('Search'),
      screen.getByLabelText('Status'),
      screen.getByLabelText('Description'),
      document.getElementById('statuses')!,
      document.getElementById('link')!,
    ]
    for (const control of controls) {
      expect(coarsePointerStyle(control)['font-size'], control.id || control.tagName).toBe('16px')
    }
    expect(coarsePointerStyle(screen.getByLabelText('Description'))['min-height']).toBeUndefined()
  })

  it('keeps the controls whose own min-height outranks the global floor at 44px', () => {
    render(
      <Provider>
        <SegmentedToggle
          label="Mode"
          size="sm"
          options={[
            { value: 'public', label: 'Public comment' },
            { value: 'note', label: 'Internal note' },
          ]}
          value="public"
          onChange={() => {}}
        />
        <FieldMultiSelect
          aria={{ id: 'statuses' }}
          options={[{ value: 'NEW', label: 'New' }]}
          anyLabel="Any status"
          value={[]}
          onChange={() => {}}
        />
        <SearchCombobox
          aria={{ id: 'link' }}
          items={[]}
          itemValue={(item: string) => item}
          itemText={(item: string) => item}
          renderItem={(item: string) => item}
          inputValue=""
          onInputValueChange={() => {}}
          onSelect={() => {}}
          placeholder="RET-1001"
        />
      </Provider>,
    )

    const controls = [
      screen.getByRole('button', { name: 'Public comment' }),
      screen.getByRole('button', { name: 'Internal note' }),
      document.getElementById('statuses')!,
      document.getElementById('link')!,
    ]
    for (const control of controls) {
      expect(coarsePointerStyle(control)['min-height'], control.id || control.textContent!).toBe(
        '44px',
      )
    }
  })

  it('gives a link drawn as a button the button floor, and leaves a text link inline', () => {
    render(
      <Provider>
        <Button asChild variant="outline">
          <a href="/">All tickets</a>
        </Button>
        <Link href="/tickets/RET-1042">RET-1042</Link>
      </Provider>,
    )

    const linkButton = coarsePointerStyle(screen.getByRole('link', { name: 'All tickets' }))
    expect(linkButton['min-height']).toBe('44px')
    expect(linkButton['min-width']).toBe('44px')
    expect(coarsePointerStyle(screen.getByRole('link', { name: 'RET-1042' }))).toEqual({})
  })
})

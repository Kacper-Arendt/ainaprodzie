import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Combobox, createListCollection } from '@chakra-ui/react'
import { CONTROL_STYLE, TOUCH_FLOOR } from './control-style.ts'

/**
 * A text input that offers the caller's items in a list under it, for use
 * inside a `FormField`. The caller owns the text, the items and their search;
 * the primitive only reports text changes and the pick. Typing clears the pick
 * (`onSelect(null)`); the text the combobox writes itself when an item is
 * picked does not. Leaving the field keeps the typed text, so a search
 * survives a press on the form's own button. The list floats in the
 * surrounding stacking context, so opening it moves nothing.
 */
export function SearchCombobox<T>(props: {
  aria: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }
  items: T[]
  itemValue: (item: T) => string
  itemText: (item: T) => string
  renderItem: (item: T) => ReactNode
  inputValue: string
  onInputValueChange: (text: string) => void
  onSelect: (item: T | null) => void
  placeholder: string
  emptyText?: string
}) {
  const { items, itemValue, itemText } = props
  const collection = useMemo(
    () => createListCollection({ items, itemToValue: itemValue, itemToString: itemText }),
    [items, itemValue, itemText],
  )

  return (
    <Combobox.Root
      gap="0"
      collection={collection}
      ids={{ input: props.aria.id }}
      inputValue={props.inputValue}
      onInputValueChange={(details) => {
        if (details.reason === 'interact-outside') return
        props.onInputValueChange(details.inputValue)
        if (details.reason === 'input-change') props.onSelect(null)
      }}
      onValueChange={(details) => {
        const picked = details.items[0] as T | undefined
        if (picked !== undefined) props.onSelect(picked)
      }}
      placeholder={props.placeholder}
      // The list may be wider than the field, so a title reads on one or two lines.
      positioning={{ sameWidth: false }}
    >
      <Combobox.Control>
        <Combobox.Input
          {...CONTROL_STYLE}
          css={[CONTROL_STYLE.css, TOUCH_FLOOR]}
          px="11px"
          {...props.aria}
        />
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content
          bg="bg.panel"
          borderWidth="ink"
          borderColor="border.control"
          borderRadius="control"
          boxShadow="raised"
          w="min(520px, calc(100vw - 32px))"
        >
          {props.emptyText !== undefined && (
            <Combobox.Empty color="fg.muted">{props.emptyText}</Combobox.Empty>
          )}
          {items.map((item) => (
            <Combobox.Item key={itemValue(item)} item={item} gap="8px">
              {props.renderItem(item)}
            </Combobox.Item>
          ))}
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  )
}

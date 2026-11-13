import { createListCollection, Select } from '@chakra-ui/react'
import { CONTROL_STYLE, TOUCH_FLOOR } from './control-style.ts'
import { fieldLabelId } from './field-ids.ts'

const ANY = ''

export interface SelectOption<V extends string> {
  value: V
  label: string
}

/**
 * A select that takes several values, for use inside a `FormField` in a row of
 * `FieldSelect`s, whose geometry it shares. Its first item, `anyLabel`, stands
 * for no value: it is checked while nothing else is, and picking it clears the
 * others, so it reads like the "any" choice of a single select. The values
 * come back in the order of `options`, whatever order they were picked in.
 * The trigger is named by the `FormField` label through its id.
 */
export function FieldMultiSelect<V extends string>(props: {
  aria: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }
  options: SelectOption<V>[]
  anyLabel: string
  value: V[]
  onChange: (value: V[]) => void
}) {
  const { options, anyLabel } = props
  const collection = createListCollection({ items: [{ value: ANY, label: anyLabel }, ...options] })
  const selected: string[] = props.value.length > 0 ? props.value : [ANY]

  const onValueChange = (picked: string[]) => {
    const anyPicked = picked.includes(ANY) && !selected.includes(ANY)
    props.onChange(
      anyPicked ? [] : options.flatMap((o) => (picked.includes(o.value) ? o.value : [])),
    )
  }

  return (
    <Select.Root
      multiple
      gap="0"
      collection={collection}
      value={selected}
      onValueChange={(details) => onValueChange(details.value)}
      ids={{ trigger: props.aria.id, label: fieldLabelId(props.aria.id) }}
      positioning={{ sameWidth: false }}
    >
      <Select.Control>
        <Select.Trigger
          {...CONTROL_STYLE}
          css={[CONTROL_STYLE.css, TOUCH_FLOOR]}
          ps="11px"
          aria-invalid={props.aria['aria-invalid']}
          aria-describedby={props.aria['aria-describedby']}
        >
          <Select.ValueText />
        </Select.Trigger>
        <Select.IndicatorGroup>
          <Select.Indicator />
        </Select.IndicatorGroup>
      </Select.Control>
      <Select.Positioner>
        <Select.Content
          bg="bg.panel"
          borderWidth="ink"
          borderColor="border.control"
          borderRadius="control"
          boxShadow="raised"
          minW="200px"
        >
          {collection.items.map((item) => (
            <Select.Item key={item.value} item={item}>
              {item.label}
              <Select.ItemIndicator />
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Positioner>
    </Select.Root>
  )
}

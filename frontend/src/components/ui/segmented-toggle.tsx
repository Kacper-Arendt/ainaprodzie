import { Box, Button, Flex } from '@chakra-ui/react'
import { TOUCH_FLOOR } from './control-style.ts'

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  /** How many items the choice holds, once known. */
  count?: number
  /** The count is work waiting for the reader: above zero it reads in semibold Ink. */
  attention?: boolean
}

/**
 * A row of mutually exclusive choices inside one ink outline: the pressed half
 * is filled with ink and exposes `aria-pressed`. `label`
 * names the group for a screen reader. `value` may match no option (a
 * combination none of them stands for), and then none is pressed. On a phone
 * the halves share the full width, a long label wraps inside its half and a
 * count sits under its label; from `sm` they sit in a row of their own width.
 * `size` follows the row it sits in: `md` beside 40px fields, `sm` above a field.
 * The outline is drawn over the halves rather than around them, so each half is
 * as tall as the control: 40px (36px at `sm`), and 44px on a touch screen.
 * With `countLabel` every half reserves a slot after its label for its count,
 * so a count arriving moves nothing; the half is then named "label, count" as
 * `countLabel` words the count, in one string, so no stray space falls before
 * the comma as it does when the name is joined from separate elements.
 * A count marked `attention` stands out above zero, as the desk summary's do.
 */
export function SegmentedToggle<V extends string>(props: {
  label: string
  options: SegmentedOption<V>[]
  value: V | undefined
  onChange: (value: V) => void
  size?: 'sm' | 'md'
  countLabel?: (count: number) => string
}) {
  return (
    <Flex
      role="group"
      aria-label={props.label}
      w={{ base: 'full', sm: 'fit-content' }}
      display={{ base: 'grid', sm: 'flex' }}
      gridTemplateColumns={{
        base: `repeat(${props.options.length}, minmax(0, 1fr))`,
        sm: 'none',
      }}
      position="relative"
      isolation="isolate"
      borderRadius="control"
      overflow="hidden"
      _after={{
        content: '""',
        position: 'absolute',
        inset: '0',
        zIndex: '1',
        borderWidth: 'ink',
        borderColor: 'border.control',
        borderRadius: 'inherit',
        pointerEvents: 'none',
      }}
    >
      {props.options.map((option) => {
        const pressed = option.value === props.value
        const attention = option.attention === true && (option.count ?? 0) > 0
        return (
          <Button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            aria-label={
              props.countLabel && option.count !== undefined
                ? `${option.label}, ${props.countLabel(option.count)}`
                : undefined
            }
            onClick={() => {
              if (!pressed) props.onChange(option.value)
            }}
            variant="ghost"
            size={props.size ?? 'md'}
            flex={{ base: '1', sm: 'none' }}
            h="auto"
            minH={props.size === 'sm' ? '36px' : '40px'}
            css={TOUCH_FLOOR}
            whiteSpace={{ base: 'normal', sm: 'nowrap' }}
            flexDirection={{ base: 'column', sm: 'row' }}
            px={{ base: '4px', sm: '3.5' }}
            borderRadius="0"
            borderWidth="0"
            gap={{ base: '0', sm: '6px' }}
            // Tighter on a phone, where a half is about 80px wide and its count sits under the label.
            fontSize={{ base: '11px', sm: '12px' }}
            letterSpacing={{ base: '0', sm: '0.04em' }}
            color={pressed ? 'bg.panel' : 'fg.muted'}
            bg={pressed ? 'fg' : 'bg.panel'}
            _hover={pressed ? { bg: 'fg' } : { bg: 'bg.subtle', color: 'fg' }}
            _focusVisible={{
              outline: '2px solid',
              outlineColor: pressed ? 'bg.panel' : 'accent.focusRing',
              // Inside the outline, which is drawn over the half's outer pixels.
              outlineOffset: '-4px',
            }}
          >
            {option.label}
            {props.countLabel && (
              // The slot is measured in the regular weight, so a count turning semibold keeps its width.
              <Box
                as="span"
                aria-hidden="true"
                minW="2ch"
                // A label that wraps on a phone never takes the count apart.
                flexShrink="0"
                whiteSpace="nowrap"
                textAlign={{ base: 'center', sm: 'start' }}
                color={pressed ? 'bg.panel' : 'fg.muted'}
                fontWeight="normal"
                fontVariantNumeric="tabular-nums"
              >
                <Box
                  as="span"
                  data-attention={attention || undefined}
                  color={attention && !pressed ? 'fg' : undefined}
                  fontWeight={attention ? 'semibold' : undefined}
                >
                  {option.count}
                </Box>
              </Box>
            )}
          </Button>
        )
      })}
    </Flex>
  )
}

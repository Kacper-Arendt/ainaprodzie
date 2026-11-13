import type { ReactElement } from 'react'
import { Box, Flex, Input, NativeSelect, Text, Textarea } from '@chakra-ui/react'
import type { InputProps, NativeSelectFieldProps, TextareaProps } from '@chakra-ui/react'
import { CONTROL_STYLE } from './control-style.ts'
import { FieldLabel } from './field-label.tsx'
import { fieldLabelId } from './field-ids.ts'

/**
 * The text input every form uses inside a `FormField`, so an email field and a
 * password field in one column can never drift apart.
 */
export function FieldInput(props: InputProps) {
  return <Input {...CONTROL_STYLE} px="11px" {...props} css={[CONTROL_STYLE.css, props.css]} />
}

/**
 * The select counterpart of `FieldInput`, so a select in the same form row
 * shares its geometry. Only the start padding is set: the end padding is the
 * recipe's, which leaves room for the indicator.
 */
export function FieldSelect(props: NativeSelectFieldProps) {
  return (
    <NativeSelect.Root>
      <NativeSelect.Field
        {...CONTROL_STYLE}
        ps="11px"
        {...props}
        css={[CONTROL_STYLE.css, props.css]}
      />
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  )
}

/**
 * The multi-line counterpart of `FieldInput`: the same border, radius, font and
 * invalid state, with the vertical padding a free-height control needs. It only
 * grows downwards, so a resize never widens the form column.
 */
export function FieldTextarea(props: TextareaProps) {
  return (
    <Textarea
      {...CONTROL_STYLE}
      px="11px"
      py="9px"
      minH="120px"
      resize="vertical"
      {...props}
      css={[CONTROL_STYLE.css, props.css]}
    />
  )
}

/**
 * Label, control and error wired together so assistive technology reads the
 * error with the field, and announces it when it appears
 * (standards/frontend/accessibility.md). The control is a
 * render prop that spreads the wiring. `invalid` marks the control without an
 * error line of its own, for a form whose one problem is shown elsewhere (the
 * sign-in alert names no field but both are wrong). A `hint` under the control
 * says what the field needs or why it is held; one that only some states need
 * is `hintHidden` in the others, which keeps its line so nothing below moves.
 * A `note` is a word about the field's state (a draft's "Changed") on the
 * trailing edge of the label row, read with the field, never moving the control.
 */
export function FormField(props: {
  id: string
  label: string
  error?: string
  invalid?: boolean
  hint?: string
  hintHidden?: boolean
  note?: string
  children: (aria: {
    id: string
    'aria-invalid'?: boolean
    'aria-describedby'?: string
  }) => ReactElement
}) {
  const errorId = `${props.id}-error`
  const hintId = `${props.id}-hint`
  const noteId = `${props.id}-note`
  const hasError = props.error !== undefined && props.error !== ''
  const hasHint = props.hint !== undefined && props.hintHidden !== true
  const hasNote = props.note !== undefined
  const describedBy = [hasNote && noteId, hasError && errorId, hasHint && hintId]
    .filter(Boolean)
    .join(' ')
  const label = (
    <FieldLabel id={fieldLabelId(props.id)} htmlFor={props.id} mb={hasNote ? undefined : '6px'}>
      {props.label}
    </FieldLabel>
  )
  return (
    <Box>
      {hasNote ? (
        <Flex align="baseline" justify="space-between" gap="8px" mb="6px">
          {label}
          <Text id={noteId} fontSize="12px" lineHeight="1" color="fg.muted" whiteSpace="nowrap">
            {props.note}
          </Text>
        </Flex>
      ) : (
        label
      )}
      {props.children({
        id: props.id,
        'aria-invalid': hasError || props.invalid === true ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })}
      {props.hint !== undefined && (
        <Text
          id={hintId}
          fontSize="12px"
          color="fg.muted"
          mt="1"
          visibility={hasHint ? undefined : 'hidden'}
        >
          {props.hint}
        </Text>
      )}
      {hasError && (
        <Text id={errorId} role="alert" fontSize="12px" color="red.fg" mt="1">
          {props.error}
        </Text>
      )}
    </Box>
  )
}

import { FieldInput, FormField } from './form-field.tsx'

export function PasswordField(props: {
  id: string
  label: string
  value: string
  autoComplete: string
  onChange: (value: string) => void
  error?: string
  invalid?: boolean
}) {
  return (
    <FormField id={props.id} label={props.label} error={props.error} invalid={props.invalid}>
      {(aria) => (
        <FieldInput
          {...aria}
          type="password"
          autoComplete={props.autoComplete}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </FormField>
  )
}

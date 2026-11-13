import { Text } from '@chakra-ui/react'
import type { TextProps } from '@chakra-ui/react'

/** The label above a form control: mono capitals in Ink 2, as the course's forms set them. */
export function FieldLabel(props: TextProps & { htmlFor?: string }) {
  return (
    <Text
      as="label"
      display="block"
      fontFamily="mono"
      fontSize="11px"
      lineHeight="16px"
      fontWeight="600"
      letterSpacing="0.06em"
      textTransform="uppercase"
      color="fg.muted"
      {...props}
    />
  )
}

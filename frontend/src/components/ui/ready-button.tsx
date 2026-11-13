import { Button, type ButtonProps } from '@chakra-ui/react'

/**
 * A form's primary action that fills with ink only once it can act (a draft
 * with changes): until then it draws the outline face, disabled, so a Save
 * with nothing to save never reads as the page's one action. Both faces have
 * the same ink line and hard shadow, so the switch moves nothing. `data-tone` tells the face.
 */
export function ReadyButton({ ready, disabled, ...props }: ButtonProps & { ready: boolean }) {
  return (
    <Button
      variant={ready ? 'solid' : 'outline'}
      colorPalette={ready ? 'accent' : undefined}
      data-tone={ready ? 'primary' : 'neutral'}
      disabled={!ready || disabled}
      {...props}
    />
  )
}

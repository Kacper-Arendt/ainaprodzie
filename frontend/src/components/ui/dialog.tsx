import type { ReactNode } from 'react'
import { CloseButton, Dialog as ChakraDialog, Portal } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { TOUCH_FLOOR } from './control-style.ts'

/**
 * A controlled modal: the caller owns `open` and hears every close (Escape,
 * the backdrop, the close button) through `onOpenChange(false)`. Focus opens
 * on the first control unless `initialFocusEl` names the safe one, and returns
 * to the control that opened it unless `finalFocusEl` names another.
 * `onExitComplete` runs once the dialog has left the screen.
 */
export function Dialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  footer?: ReactNode
  initialFocusEl?: () => HTMLElement | null
  finalFocusEl?: () => HTMLElement | null
  onExitComplete?: () => void
}) {
  const { t } = useTranslation('common')
  return (
    <ChakraDialog.Root
      open={props.open}
      onOpenChange={(details) => props.onOpenChange(details.open)}
      initialFocusEl={props.initialFocusEl}
      finalFocusEl={props.finalFocusEl}
      onExitComplete={props.onExitComplete}
    >
      <Portal>
        <ChakraDialog.Backdrop />
        <ChakraDialog.Positioner>
          <ChakraDialog.Content
            bg="bg.panel"
            borderWidth="ink"
            borderColor="border.control"
            borderRadius="panel"
            boxShadow="raised"
          >
            <ChakraDialog.Header>
              <ChakraDialog.Title
                fontFamily="heading"
                fontSize="30px"
                lineHeight="1"
                fontWeight="normal"
                textTransform="uppercase"
                letterSpacing="0.01em"
                pe="32px"
              >
                {props.title}
              </ChakraDialog.Title>
            </ChakraDialog.Header>
            <ChakraDialog.Body>{props.children}</ChakraDialog.Body>
            {props.footer !== undefined && (
              <ChakraDialog.Footer>{props.footer}</ChakraDialog.Footer>
            )}
            <ChakraDialog.CloseTrigger asChild>
              <CloseButton size="sm" css={TOUCH_FLOOR} aria-label={t('dialog.close')} />
            </ChakraDialog.CloseTrigger>
          </ChakraDialog.Content>
        </ChakraDialog.Positioner>
      </Portal>
    </ChakraDialog.Root>
  )
}

import { useRef, useState } from 'react'
import { Button, Flex, Text } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../components/ui/dialog.tsx'
import { FieldTextarea, FormField } from '../../components/ui/form-field.tsx'
import { BODY_ID, focusComposer } from './composer-focus.ts'
import type { TicketWrites } from './use-ticket-writes.tsx'

const RESOLUTION_ID = 'close-resolution'

/**
 * Confirms closing with an optional resolution, which opens on the ticket's
 * own resolution when it has one; the confirm is the dialog's one filled ink
 * action, and the sentence above it carries the weight. A customer is asked in their own words how the
 * problem was solved, and is reminded first when support awaits their answer,
 * so an open question is never closed unawares; Answer instead then takes them
 * from the dialog to the comment composer. A 412 or 409 means the ticket
 * moved on while the dialog was open: the dialog closes, and the problem is
 * explained beside the details. Any other refusal stays in the dialog so the
 * resolution can be corrected.
 */
export function CloseTicketDialog(props: {
  reference: string
  /** The ticket's resolution, if it was resolved with one. */
  resolution: string | null
  isSupport: boolean
  /** Support staff await the customer's answer on this ticket. */
  awaitsAnswer: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  write: TicketWrites['header']
}) {
  const { t } = useTranslation('common')
  const stored = props.resolution ?? ''
  // Unset until the reader types, so the dialog opens on the ticket's resolution as it is now.
  const [draft, setDraft] = useState<string>()
  const [resolutionError, setResolutionError] = useState<string>()
  // Set by Answer instead, so the dialog hands focus to the composer rather than back to Close ticket.
  const answering = useRef(false)
  const resolution = draft ?? stored

  const onOpenChange = (open: boolean) => {
    if (!open) {
      setDraft(undefined)
      setResolutionError(undefined)
      props.write.edited()
    }
    props.onOpenChange(open)
  }

  const onClose = () => {
    setResolutionError(undefined)
    // A blank resolution, or the stored one unchanged, keeps what the ticket has.
    const unchanged = resolution.trim() === '' || resolution === stored
    props.write.close(unchanged ? {} : { resolution }, {
      fields: {
        resolution: (message) => {
          setResolutionError(message)
          document.getElementById(RESOLUTION_ID)?.focus()
        },
      },
      onSuccess: () => onOpenChange(false),
      onMovedOn: () => onOpenChange(false),
    })
  }

  const answer = () => {
    answering.current = true
    onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={onOpenChange}
      title={t('tickets.close.title', { reference: props.reference })}
      finalFocusEl={() => (answering.current ? document.getElementById(BODY_ID) : null)}
      onExitComplete={() => {
        if (!answering.current) return
        answering.current = false
        // Focus is already there; this brings the composer into view once the page scrolls again.
        focusComposer()
      }}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('tickets.close.cancel')}
          </Button>
          <Button colorPalette="accent" disabled={props.write.pending} onClick={onClose}>
            {t('tickets.close.submit')}
          </Button>
        </>
      }
    >
      {!props.isSupport && props.awaitsAnswer && (
        <Flex wrap="wrap" align="center" columnGap="12px" rowGap="6px" mb="10px">
          <Text color="fg" fontSize="14px" fontWeight="semibold" flex="1 1 220px">
            {t('tickets.close.awaitsAnswer')}
          </Text>
          <Button variant="outline" size="xs" onClick={answer}>
            {t('tickets.close.answerInstead')}
          </Button>
        </Flex>
      )}
      {/* Ink, not muted: the one consequence that cannot be undone. */}
      <Text color="fg" fontSize="14px" mb="14px">
        {t('tickets.close.body')}
      </Text>
      <FormField
        id={RESOLUTION_ID}
        label={`${t(props.isSupport ? 'tickets.close.resolution' : 'tickets.close.howSolved')} ${t('tickets.optional')}`}
        error={resolutionError}
      >
        {(aria) => (
          <FieldTextarea
            {...aria}
            minH="76px"
            value={resolution}
            onChange={(event) => {
              props.write.edited()
              setDraft(event.target.value)
            }}
          />
        )}
      </FormField>
      {props.write.below}
    </Dialog>
  )
}

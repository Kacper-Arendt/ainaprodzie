import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Box, Button, Flex, Heading, Stack, Text } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { FieldInput, FieldTextarea, FormField } from '../../components/ui/form-field.tsx'
import { Panel, PanelHead } from '../../components/ui/panel.tsx'
import { ReadyButton } from '../../components/ui/ready-button.tsx'
import { WindowPanel } from '../../components/ui/window-panel.tsx'
import { clockLamp, responseClock, useNow } from './ticket-labels.ts'
import type { TicketWrites } from './use-ticket-writes.tsx'
import type { TicketDetails, UpdateTicketRequest } from './use-tickets.ts'

const TITLE_ID = 'ticket-content-title'
const DESCRIPTION_ID = 'ticket-content-description'
export const EDIT_ID = 'ticket-content-edit'
const HEADING_ID = 'ticket-content-heading'

/**
 * The ticket's description, and for whoever may edit them (ADR 0004: its
 * author while it is new, support staff until it is closed) the way to change
 * the title and the description in place. The request carries only the
 * changed fields. A 412 or 409 is explained at the top of this panel while
 * the draft stays; a refused field is told at the field and anything else
 * below the buttons.
 */
export function TicketContentPanel(props: {
  ticket: TicketDetails
  mayEdit: boolean
  /** The author edits only while the ticket is new, so the form says until when. */
  authorEdits: boolean
  /** Support staff read the first-response clock: the card's lamp then says who owes one. */
  clock: boolean
  write: TicketWrites['content']
}) {
  const { t } = useTranslation('common')
  const now = useNow()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({})
  // Set when the form closes, so focus goes back to the Edit button that opened it.
  const returnFocus = useRef(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const { summary } = props.ticket
  // A textarea reads every line break as \n, so the stored text is compared in that form.
  const storedDescription = props.ticket.description.replace(/\r\n?/g, '\n')
  // The text the form opened on. A refetch can bring a newer version while the draft stays;
  // if the title or description moved on since, the save carries this version and the server
  // refuses the stale draft (412) instead of it overwriting the other edit.
  const [opened, setOpened] = useState({
    title: summary.title,
    description: storedDescription,
    version: props.ticket.version,
  })
  // A ticket that stops being editable under the form (closed, or past new for its author) shows its text again.
  const open = editing && props.mayEdit

  useEffect(() => {
    if (open || !returnFocus.current) return
    returnFocus.current = false
    editButton.current?.focus()
  }, [open])

  const request: UpdateTicketRequest = {}
  if (title.trim() !== summary.title) request.title = title.trim()
  if (description !== storedDescription) request.description = description
  const changed = Object.keys(request).length > 0
  const movedOn = opened.title !== summary.title || opened.description !== storedDescription
  const version = movedOn ? opened.version : props.ticket.version

  const start = () => {
    setOpened({
      title: summary.title,
      description: storedDescription,
      version: props.ticket.version,
    })
    setTitle(summary.title)
    setDescription(storedDescription)
    setErrors({})
    props.write.edited()
    setEditing(true)
  }

  const finish = () => {
    returnFocus.current = true
    setEditing(false)
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    props.write.edited()
    if (title.trim() === '') {
      setErrors({ title: t('tickets.titleRequired') })
      document.getElementById(TITLE_ID)?.focus()
      return
    }
    setErrors({})
    // The fields are told in form order, so focus lands on the first refused one.
    let focused = false
    const refusedAt = (id: string) => {
      if (focused) return
      focused = true
      document.getElementById(id)?.focus()
    }
    props.write.save(request, {
      version,
      fields: {
        title: (message) => {
          setErrors((shown) => ({ ...shown, title: message }))
          refusedAt(TITLE_ID)
        },
        description: (message) => {
          setErrors((shown) => ({ ...shown, description: message }))
          refusedAt(DESCRIPTION_ID)
        },
      },
      onSuccess: finish,
    })
  }

  if (!open) {
    const editAction = props.mayEdit && (
      <Button
        id={EDIT_ID}
        ref={editButton}
        variant="outline"
        size="xs"
        aria-label={t('tickets.content.editLabel')}
        onClick={start}
      >
        {t('tickets.content.edit')}
      </Button>
    )
    return (
      <WindowPanel
        raised
        as="section"
        aria-labelledby={HEADING_ID}
        name={`${summary.reference} · ${summary.organization.name}`}
        lamp={props.clock ? clockLamp(responseClock(summary, now)) : undefined}
      >
        <Box px={{ base: '16px', sm: '20px' }} py="18px">
          {props.write.top}
          <Flex
            align="center"
            columnGap="8px"
            rowGap="4px"
            wrap="wrap"
            mb="10px"
            fontFamily="mono"
            fontSize="11px"
            lineHeight="19px"
            fontWeight="600"
            letterSpacing="0.06em"
            textTransform="uppercase"
          >
            <Heading id={HEADING_ID} as="h2" font="inherit" color="fg.muted">
              {t('tickets.details.description')}
            </Heading>
            <Text as="span" aria-hidden="true" color="fg.muted">
              ·
            </Text>
            <Text as="span" flex="1" minW="0" overflowWrap="anywhere">
              {summary.author.name}
            </Text>
            {editAction}
          </Flex>
          {props.ticket.description === '' ? (
            <Text color="fg.muted">{t('tickets.content.noDescription')}</Text>
          ) : (
            <Text
              fontSize="16px"
              lineHeight="1.6"
              maxW="68ch"
              whiteSpace="pre-wrap"
              overflowWrap="anywhere"
            >
              {props.ticket.description}
            </Text>
          )}
        </Box>
      </WindowPanel>
    )
  }

  return (
    <Panel>
      {props.write.top}
      <PanelHead title={t('tickets.content.heading')} />
      <form onSubmit={onSubmit} noValidate>
        <Stack gap="14px">
          <FormField id={TITLE_ID} label={t('tickets.new.title')} error={errors.title}>
            {(aria) => (
              <FieldInput
                {...aria}
                autoFocus
                value={title}
                onChange={(event) => {
                  props.write.edited()
                  setErrors({ ...errors, title: undefined })
                  setTitle(event.target.value)
                }}
              />
            )}
          </FormField>
          <FormField
            id={DESCRIPTION_ID}
            label={`${t('tickets.new.description')} ${t('tickets.optional')}`}
            error={errors.description}
          >
            {(aria) => (
              <FieldTextarea
                {...aria}
                // The stored description opens whole rather than behind a scrollbar, up to a cap.
                css={{ fieldSizing: 'content' }}
                maxH="480px"
                value={description}
                onChange={(event) => {
                  props.write.edited()
                  setErrors({ ...errors, description: undefined })
                  setDescription(event.target.value)
                }}
              />
            )}
          </FormField>
        </Stack>
        {props.write.below}
        <Flex justify="flex-end" align="center" wrap="wrap" gap="10px" mt="20px">
          {props.authorEdits && (
            <Text color="fg.muted" fontSize="12px" me="auto" flex="1 1 240px">
              {t('tickets.content.authorHint')}
            </Text>
          )}
          <Button type="button" variant="ghost" disabled={props.write.pending} onClick={finish}>
            {t('tickets.content.cancel')}
          </Button>
          <ReadyButton type="submit" ready={changed} disabled={props.write.pending}>
            {t('tickets.editor.save')}
          </ReadyButton>
        </Flex>
      </form>
    </Panel>
  )
}

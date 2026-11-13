import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Box, Button, chakra, Flex, Text } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { fallbackErrorKey } from '../../api/errors.ts'
import { Chip } from '../../components/ui/chip.tsx'
import { FieldSelect, FormField } from '../../components/ui/form-field.tsx'
import { SearchCombobox } from '../../components/ui/search-combobox.tsx'
import { label, STATUS_KEYS } from './ticket-labels.ts'
import type { TicketWrites } from './use-ticket-writes.tsx'
import { useTickets, type TicketSummary } from './use-tickets.ts'

export const TICKET_ID = 'link-ticket'
/** Link a ticket, the button that unfolds the form. */
export const OPEN_ID = 'link-ticket-open'
const TYPE_ID = 'link-type'
const FORM_TITLE_ID = 'link-ticket-title'
const SEARCH_DELAY_MS = 250
const MAX_OPTIONS = 10

// The request field is an open string in the contract, so the vocabulary is spelled here.
const LINK_TYPES = ['RELATED', 'POTENTIAL_DUPLICATE'] as const
type LinkType = (typeof LINK_TYPES)[number]
const LINK_TYPE_KEYS: Record<LinkType, string> = {
  RELATED: 'tickets.links.types.RELATED',
  POTENTIAL_DUPLICATE: 'tickets.links.types.POTENTIAL_DUPLICATE',
}

// Module-level so the combobox's memoised collection is not rebuilt on every render.
const ticketValue = (ticket: TicketSummary) => ticket.reference
const ticketText = (ticket: TicketSummary) => `${ticket.reference} · ${ticket.title}`

/**
 * Link a ticket under the support view of the Linked tickets panel: an outline
 * button that unfolds the form in its place, so the panel's everyday reading
 * carries no second action beside the composer's Send. The form searches for
 * the other ticket, takes the link type, and Link folds it again, as Cancel
 * does, with focus back on Link a ticket. The search offers neither this
 * ticket nor one already linked, and names each ticket's organization, since
 * links may cross them. The fields share a top edge, so an error line under
 * one grows the row downward and moves no control. Link without a picked
 * ticket asks for one at the Ticket field. Link is held while any link or
 * unlink on this ticket is pending, and a refusal other than at the fields is
 * told below the panel.
 */
export function LinkTicketForm(props: {
  reference: string
  /** The references this ticket already links to. */
  linked: string[]
  write: TicketWrites['links']
  onOpen?: () => void
}) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  // Set when the form folds, so focus goes back to the button that unfolded it.
  const returnFocus = useRef(false)
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [picked, setPicked] = useState<TicketSummary | null>(null)
  const [type, setType] = useState<LinkType>('RELATED')
  const [ticketError, setTicketError] = useState<string>()
  const [typeError, setTypeError] = useState<string>()

  useEffect(() => {
    if (open) {
      document.getElementById(TICKET_ID)?.focus()
    } else if (returnFocus.current) {
      returnFocus.current = false
      document.getElementById(OPEN_ID)?.focus()
    }
  }, [open])

  // A picked ticket's text is the combobox's own, not a search.
  const query = picked === null ? text.trim() : ''
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query])
  const search = useTickets(
    { text: debounced, size: MAX_OPTIONS + 1 },
    { enabled: debounced !== '' },
  )
  const answered =
    query !== '' && debounced === query && search.isSuccess && !search.isPlaceholderData
  const answer = answered ? search.data.items : undefined
  // A search that failed says so instead of reading as still running.
  const failed = query !== '' && debounced === query && search.isError
  // Memoised so the combobox keeps its collection while the text changes.
  const { reference, linked } = props
  const found = useMemo(
    () =>
      (answer ?? []).filter(
        (ticket) => ticket.reference !== reference && !linked.includes(ticket.reference),
      ),
    [answer, reference, linked],
  )
  const items = useMemo(
    () => (picked === null ? found.slice(0, MAX_OPTIONS) : [picked]),
    [found, picked],
  )

  const fold = () => {
    setText('')
    setDebounced('')
    setPicked(null)
    setType('RELATED')
    setTicketError(undefined)
    setTypeError(undefined)
    returnFocus.current = true
    setOpen(false)
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (picked === null) {
      // Typed text alone names no ticket; the field says to pick one.
      setTicketError(t('tickets.links.pickTicket'))
      document.getElementById(TICKET_ID)?.focus()
      return
    }
    setTicketError(undefined)
    setTypeError(undefined)
    props.write.link(
      picked.reference,
      { type },
      {
        fields: { linkedReference: setTicketError, type: setTypeError },
        onSuccess: fold,
        // Link lost focus while it was disabled, so the refusal returns it to the Ticket field.
        onRefused: () => document.getElementById(TICKET_ID)?.focus(),
      },
    )
  }

  if (!open) {
    return (
      <Button
        id={OPEN_ID}
        variant="outline"
        size="xs"
        mt="12px"
        onClick={() => {
          props.write.edited()
          props.onOpen?.()
          setOpen(true)
        }}
      >
        {t('tickets.links.form')}
      </Button>
    )
  }

  return (
    <chakra.form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={FORM_TITLE_ID}
      borderTopWidth="1px"
      borderColor="border"
      mt="12px"
      pt="12px"
    >
      <Text id={FORM_TITLE_ID} fontSize="13px" fontWeight="semibold" mb="6px">
        {t('tickets.links.form')}
      </Text>
      <Flex gap="10px" align="flex-start" wrap="wrap">
        <Box flex="1" minW="220px">
          <FormField id={TICKET_ID} label={t('tickets.links.ticket')} error={ticketError}>
            {(aria) => (
              <SearchCombobox
                aria={aria}
                items={items}
                itemValue={ticketValue}
                itemText={ticketText}
                renderItem={(ticket) => (
                  <>
                    <Text as="span" fontWeight="semibold" w="76px" flexShrink="0">
                      {ticket.reference}
                    </Text>
                    <Text as="span" flex="1" minW="0">
                      {ticket.title}
                      <Text as="span" display="block" color="fg.muted" fontSize="13px">
                        {ticket.organization.name}
                      </Text>
                    </Text>
                    <Chip>{label(t, STATUS_KEYS, ticket.status)}</Chip>
                  </>
                )}
                inputValue={text}
                onInputValueChange={(next) => {
                  if (next !== text) {
                    props.write.edited()
                    setTicketError(undefined)
                  }
                  setText(next)
                }}
                onSelect={(ticket) => {
                  if (ticket !== null) setTicketError(undefined)
                  setPicked(ticket)
                }}
                placeholder={t('tickets.search.placeholder')}
                // While the search runs the list says so, rather than opening empty.
                emptyText={
                  query === ''
                    ? undefined
                    : failed
                      ? t(fallbackErrorKey(search.error))
                      : !answered
                        ? t('tickets.links.searching')
                        : found.length === 0
                          ? t('tickets.links.noResults', { text: query })
                          : undefined
                }
              />
            )}
          </FormField>
        </Box>
        <Box w="220px">
          <FormField id={TYPE_ID} label={t('tickets.links.type')} error={typeError}>
            {(aria) => (
              <FieldSelect
                {...aria}
                value={type}
                onChange={(event) => {
                  props.write.edited()
                  setType(event.target.value as LinkType)
                }}
              >
                {LINK_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {label(t, LINK_TYPE_KEYS, value)}
                  </option>
                ))}
              </FieldSelect>
            )}
          </FormField>
        </Box>
      </Flex>
      <Flex justify="flex-end" gap="10px" mt="12px">
        <Button
          type="button"
          variant="ghost"
          disabled={props.write.pending}
          onClick={() => {
            props.write.edited()
            fold()
          }}
        >
          {t('tickets.links.cancel')}
        </Button>
        {/* Outline, not filled: the composer's Send stays the page's one filled action. */}
        <Button type="submit" variant="outline" disabled={props.write.pending}>
          {t('tickets.links.submit')}
        </Button>
      </Flex>
    </chakra.form>
  )
}

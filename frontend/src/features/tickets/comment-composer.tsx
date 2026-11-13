import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Box, Button, chakra, Flex, Link, Text } from '@chakra-ui/react'
import { Trans, useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router'
import { TOUCH_FLOOR } from '../../components/ui/control-style.ts'
import { FieldTextarea, FormField } from '../../components/ui/form-field.tsx'
import { SegmentedToggle } from '../../components/ui/segmented-toggle.tsx'
import { useSession } from '../auth/use-auth.ts'
import { BODY_ID } from './composer-focus.ts'
import { useCommentDraft } from './use-comment-draft.ts'
import type { TicketWrites } from './use-ticket-writes.tsx'

type Mode = 'public' | 'note'

const SEND_KEYS = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘ Enter' : 'Ctrl+Enter'

/**
 * The comment box under the conversation. Support writes public comments or
 * internal notes, also on a closed ticket; a customer writes public comments
 * only, and on a closed ticket sees why it cannot write instead, with a link
 * to raise a new ticket to follow up. Every part of the box names who will
 * read it: the mode, the label, the placeholder and the send button, and a
 * note is drawn dashed in amber, like a note in the conversation. The draft survives leaving the ticket, and Ctrl+Enter (⌘
 * Enter) sends it. It stays mounted when the ticket closes under it, so the
 * reason a send failed stays on screen beside that notice.
 */
export function CommentComposer(props: {
  reference: string
  organization: string
  closed: boolean
  isSupport: boolean
  write: TicketWrites['comment']
}) {
  const { t } = useTranslation('common')
  const userId = useSession().data?.id ?? ''
  const [draft, setDraft] = useCommentDraft(userId, props.reference, props.write.pending)
  const [bodyError, setBodyError] = useState<string>()
  const form = useRef<HTMLFormElement>(null)
  const { body } = draft

  const internal = props.isSupport && draft.note

  const focusBody = () => document.getElementById(BODY_ID)?.focus()

  const showBodyError = (message: string) => {
    setBodyError(message)
    focusBody()
  }

  // Send is disabled while the write is pending, which drops a browser's focus to the page. Once
  // the answer arrives focus returns to the field, unless the reader has moved on meanwhile.
  const keepFocus = () => {
    const active = document.activeElement
    if (active === null || active === document.body || form.current?.contains(active)) focusBody()
  }

  const changeMode = (mode: Mode) => {
    props.write.edited()
    setDraft({ ...draft, note: mode === 'note' })
  }

  const submit = () => {
    props.write.edited()
    if (body.trim() === '') {
      showBodyError(t('errors.field.required'))
      return
    }
    setBodyError(undefined)
    props.write.add(
      { body, internal },
      {
        fields: { body: showBodyError },
        onSuccess: () => {
          setDraft((shown) => ({ ...shown, body: '' }))
          keepFocus()
        },
        onRefused: keepFocus,
      },
    )
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  if (props.closed && !props.isSupport) {
    return (
      <Box borderTopWidth="1px" borderTopStyle="dashed" borderColor="border" mt="18px" pt="18px">
        <Text
          bg="bg.muted"
          color="fg.muted"
          borderRadius="control"
          px="12px"
          py="10px"
          fontSize="14px"
        >
          <Trans
            t={t}
            i18nKey="tickets.details.closedNotice"
            components={{ newTicket: <NewTicketLink /> }}
          />
        </Text>
        {props.write.below}
      </Box>
    )
  }

  const audience = { organization: props.organization }
  const copy = !props.isSupport
    ? {
        label: t('tickets.composer.label', audience),
        placeholder: t('tickets.composer.placeholder'),
        send: t('tickets.composer.send', audience),
      }
    : internal
      ? {
          label: t('tickets.composer.noteLabel'),
          placeholder: t('tickets.composer.notePlaceholder'),
          send: t('tickets.composer.addNote'),
        }
      : {
          label: t('tickets.composer.publicLabel', audience),
          placeholder: t('tickets.composer.publicPlaceholder'),
          send: t('tickets.composer.sendTo', audience),
        }

  return (
    <chakra.form
      ref={form}
      onSubmit={onSubmit}
      noValidate
      borderTopWidth="1px"
      borderTopStyle="dashed"
      borderColor="border"
      mt="18px"
      pt="18px"
    >
      {props.isSupport && (
        <Box mb="10px">
          <SegmentedToggle
            label={t('tickets.composer.mode')}
            size="sm"
            options={[
              { value: 'public', label: t('tickets.composer.publicComment') },
              { value: 'note', label: t('tickets.composer.internalNote') },
            ]}
            value={internal ? 'note' : 'public'}
            onChange={changeMode}
          />
        </Box>
      )}
      <FormField id={BODY_ID} label={copy.label} error={bodyError}>
        {(aria) => (
          <FieldTextarea
            {...aria}
            minH="76px"
            placeholder={copy.placeholder}
            value={body}
            onChange={(event) => {
              props.write.edited()
              setDraft({ ...draft, body: event.target.value })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                if (!props.write.pending) submit()
              }
            }}
            data-note={internal ? 'true' : undefined}
            bg={internal ? 'amber.subtle' : 'bg.panel'}
            borderStyle={internal ? 'dashed' : 'solid'}
            borderColor={internal ? 'amber.border' : undefined}
          />
        )}
      </FormField>
      {props.write.below}
      <Flex justify="flex-end" align="center" gap="12px" mt="10px">
        <Text
          color="fg.muted"
          fontFamily="mono"
          fontSize="11px"
          fontWeight="600"
          letterSpacing="0.06em"
          textTransform="uppercase"
          hideBelow="md"
        >
          {t('tickets.composer.shortcut', { keys: SEND_KEYS })}
        </Text>
        <Button
          type="submit"
          colorPalette="accent"
          maxW="full"
          // The label names who will read the comment, so a long one wraps rather than losing the name.
          h="auto"
          minH="40px"
          css={TOUCH_FLOOR}
          py="8px"
          whiteSpace="normal"
          textWrap="balance"
          disabled={props.write.pending}
        >
          {copy.send}
        </Button>
      </Flex>
    </chakra.form>
  )
}

/** The closed-ticket notice's way on: the one next step a customer has there. */
function NewTicketLink(props: { children?: ReactNode }) {
  return (
    <Link
      asChild
      color="accent.fg"
      fontWeight="semibold"
      textDecoration="underline"
      textUnderlineOffset="2px"
      borderRadius="control"
      _focusVisible={{ outline: '2px solid', outlineColor: 'accent.focusRing' }}
    >
      <RouterLink to="/tickets/new">{props.children}</RouterLink>
    </Link>
  )
}

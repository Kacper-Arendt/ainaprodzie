import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Box, Button, VisuallyHidden } from '@chakra-ui/react'
import { matchMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ProblemError } from '../../api/errors.ts'
import { ProblemText } from '../../components/ui/problem-text.tsx'
import { fieldCode, fieldMessage, problemMessage } from './ticket-problems.ts'
import { useIdempotencyKey } from './use-idempotency-key.ts'
import {
  ticketKeys,
  useAddComment,
  useCloseTicket,
  useLinkTicket,
  useUnlinkTicket,
  useUpdateTicket,
  type AddCommentRequest,
  type CloseTicketRequest,
  type LinkTicketRequest,
  type TicketDetails,
  type UpdateTicketRequest,
} from './use-tickets.ts'

/** The places on the ticket page that write with the ticket's version, so a write can meet a conflict. */
type VersionedPlace = 'header' | 'assign' | 'content' | 'facts'
type WritePlace = VersionedPlace | 'comment' | 'links'

const isVersioned = (place: WritePlace): place is VersionedPlace =>
  place === 'header' || place === 'assign' || place === 'content' || place === 'facts'

/** Assign to me is one button with no form of its own, so every refusal of it is told at its top. */
const refusalAt = (place: WritePlace): RefusalMessage['at'] =>
  place === 'assign' ? 'top' : 'below'

/**
 * Why the last refused write was refused, other than a conflict: told at the
 * top of a versioned place's panel for a 409, while the ticket is refetched,
 * and below the place's buttons otherwise. There is one on the page at most,
 * and it lasts until the next ticket write starts or its place's draft changes.
 */
interface RefusalMessage {
  place: WritePlace
  at: 'top' | 'below'
  text: string
}

export interface WriteOptions<Field extends string> {
  /**
   * The fields the editor tells a refusal at, each with how to show its sentence
   * there. A refusal that names one of them is the editor's alone.
   */
  fields?: { [Name in Field]?: (message: string) => void }
  onSuccess?: () => void
  /** Any refusal, before it is explained. */
  onRefused?: () => void
}

export interface VersionedWriteOptions<Field extends string> extends WriteOptions<Field> {
  /** The ticket moved on under the write (a 412 or 409), so its explanation is at the top of the panel. */
  onMovedOn?: () => void
}

type RefusalOptions = VersionedWriteOptions<string> & {
  explain?: (error: Error) => string | undefined
}

interface PlaceWrites {
  pending: boolean
  /** Any other refusal, for below the place's buttons. */
  below: ReactNode
  /** The reader changed this place's draft, so its refusal message no longer applies; a conflict stays. */
  edited: () => void
}

interface VersionedWrites extends PlaceWrites {
  /** The place's conflict, with its Reload, or a 409's message: for the top of the place's panel. */
  top: ReactNode
  /** Changes on the place's Reload, so keying its editor on it drops the refused draft. */
  key: number
}

export interface TicketWrites {
  /**
   * A polite live region that announces each write the server took, for a
   * reader who cannot see the change land. Rendered once, anywhere on the page.
   */
  status: ReactNode
  header: VersionedWrites & {
    close: (request: CloseTicketRequest, options?: VersionedWriteOptions<'resolution'>) => void
  }
  /** Assign to me: the reader's own team and the reader in one write. */
  assign: VersionedWrites & {
    save: (
      request: { teamId: string; assigneeId: string },
      options?: VersionedWriteOptions<never>,
    ) => void
  }
  content: VersionedWrites & {
    /** `version` is the one the draft was opened on, if the text moved on under it since. */
    save: (
      request: UpdateTicketRequest,
      options: VersionedWriteOptions<'title' | 'description'> & { version: number },
    ) => void
  }
  facts: VersionedWrites & {
    save: (
      request: UpdateTicketRequest,
      options?: VersionedWriteOptions<'resolution'> & {
        /** Explains a refusal the editor knows better, as the sentence below its buttons. */
        explain?: (error: Error) => string | undefined
      },
    ) => void
  }
  comment: PlaceWrites & {
    add: (request: AddCommentRequest, options?: WriteOptions<'body'>) => void
  }
  links: PlaceWrites & {
    /** A linked ticket that does not exist is told at `linkedReference`. */
    link: (
      linkedReference: string,
      request: LinkTicketRequest,
      options?: WriteOptions<'linkedReference' | 'type'>,
    ) => void
    unlink: (linkedReference: string, options?: WriteOptions<never>) => void
  }
}

/**
 * Every write the ticket page makes, and why one was refused, shown where it
 * was made. The module sends the version, the `Idempotency-Key` of a comment
 * and the reference; it tells a conflict at the top of a versioned place's
 * panel until its Reload, a 409 there while the ticket is refetched, a refused
 * field at the editor's own field and anything else below the place's buttons
 * (at the top of Assign to me, which has none).
 * `reloadFocus` names, per versioned place, the control focus returns to once
 * Reload has taken its own button away. Each write the server took is
 * announced in `status`.
 */
export function useTicketWrites(
  ticket: TicketDetails,
  reloadFocus: Record<VersionedPlace, string>,
): TicketWrites {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
  const closeTicket = useCloseTicket()
  const assignTicket = useUpdateTicket()
  const updateContent = useUpdateTicket()
  const updateFacts = useUpdateTicket()
  const addComment = useAddComment()
  const idempotencyKey = useIdempotencyKey()
  const linkTicket = useLinkTicket()
  const unlinkTicket = useUnlinkTicket()
  // A stale `If-Match` (412) per place: it offers a reload and lasts until that is used, since
  // the refused draft stays until then, whatever else is written meanwhile.
  const [conflicts, setConflicts] = useState<Record<VersionedPlace, boolean>>({
    header: false,
    assign: false,
    content: false,
    facts: false,
  })
  const [message, setMessage] = useState<RefusalMessage>()
  // Bumped by Reload, so the editor whose draft the server refused drops it; the others keep theirs.
  const [keys, setKeys] = useState<Record<VersionedPlace, number>>({
    header: 0,
    assign: 0,
    content: 0,
    facts: 0,
  })
  // The place whose Reload was just used, until focus has moved there.
  const refocus = useRef<VersionedPlace>(undefined)
  // Keyed per write, so the same sentence twice in a row is announced twice.
  const [announcement, setAnnouncement] = useState<{ text: string; id: number }>()
  const announce = (text: string) =>
    setAnnouncement((shown) => ({ text, id: (shown?.id ?? 0) + 1 }))
  const { reference } = ticket.summary

  // A ticket write that starts makes an earlier refusal's message stale. The mutation cache
  // tells the moment one is sent, from whichever place sends it.
  const showsMessage = message !== undefined
  useEffect(() => {
    if (!showsMessage) return
    return queryClient.getMutationCache().subscribe((event) => {
      if (
        event.type === 'added' &&
        matchMutation({ mutationKey: ticketKeys.writes() }, event.mutation)
      ) {
        setMessage(undefined)
      }
    })
  }, [queryClient, showsMessage])

  useEffect(() => {
    const place = refocus.current
    if (place === undefined) return
    refocus.current = undefined
    document.getElementById(reloadFocus[place])?.focus()
  }, [keys, reloadFocus])

  const refetch = () =>
    void queryClient.invalidateQueries({ queryKey: ticketKeys.detail(reference) })

  const edited = (place: WritePlace) => {
    setMessage((shown) => (shown?.place === place ? undefined : shown))
  }

  // A write the server took was made on the current version, so its place has no conflict left.
  const succeeded = (place: VersionedPlace, done: string, onSuccess?: () => void) => () => {
    setConflicts((shown) => (shown[place] ? { ...shown, [place]: false } : shown))
    announce(done)
    onSuccess?.()
  }

  const reload = (place: VersionedPlace) => {
    refetch()
    refocus.current = place
    setConflicts((shown) => ({ ...shown, [place]: false }))
    edited(place)
    setKeys((current) => ({ ...current, [place]: current[place] + 1 }))
  }

  // The caller's callbacks run before the refusal is recorded, so one that resets its draft
  // (and so calls `edited`) keeps the explanation that follows.
  const refused = (place: WritePlace, error: Error, options: RefusalOptions) => {
    options.onRefused?.()
    const status = error instanceof ProblemError ? error.status : undefined
    if (isVersioned(place) && (status === 412 || status === 409)) {
      options.onMovedOn?.()
      if (status === 412) {
        setConflicts((shown) => ({ ...shown, [place]: true }))
        return
      }
      setMessage({ place, at: 'top', text: problemMessage(t, error) })
      refetch()
      return
    }
    if (toldAtFields(error, options.fields)) return
    setMessage({
      place,
      at: refusalAt(place),
      text: options.explain?.(error) ?? problemMessage(t, error),
    })
    if (status === 409) refetch()
  }

  /** Hands each refused field the editor shows to its own field; true when there was one. */
  const toldAtFields = (error: Error, fields: RefusalOptions['fields']) => {
    let told = false
    for (const [field, show] of Object.entries(fields ?? {})) {
      const code = fieldCode(error, field)
      if (code === undefined || show === undefined) continue
      show(fieldMessage(t, code))
      told = true
    }
    return told
  }

  const textAt = (place: WritePlace, at: RefusalMessage['at']) =>
    message?.place === place && message.at === at ? message.text : undefined

  const topOf = (place: VersionedPlace): ReactNode => {
    const text = textAt(place, 'top')
    if (!conflicts[place] && text === undefined) return undefined
    return (
      <Box mb="16px">
        {conflicts[place] && (
          <>
            <ProblemText flush error={t('tickets.conflict.message')} />
            <Button
              w="full"
              mt="10px"
              mb={text === undefined ? undefined : '10px'}
              variant="outline"
              onClick={() => reload(place)}
            >
              {t('tickets.conflict.reload')}
            </Button>
          </>
        )}
        <ProblemText flush error={text} />
      </Box>
    )
  }

  const placeWrites = (place: WritePlace, pending: boolean): PlaceWrites => ({
    pending,
    below: <ProblemText error={textAt(place, 'below')} />,
    edited: () => edited(place),
  })

  const versionedWrites = (place: VersionedPlace, pending: boolean): VersionedWrites => ({
    ...placeWrites(place, pending),
    top: topOf(place),
    key: keys[place],
  })

  return {
    status: (
      <VisuallyHidden aria-live="polite" aria-atomic="true">
        {announcement && <span key={announcement.id}>{announcement.text}</span>}
      </VisuallyHidden>
    ),
    header: {
      ...versionedWrites('header', closeTicket.isPending),
      close: (request, options = {}) => {
        closeTicket.mutate(
          { reference, version: ticket.version, request },
          {
            onSuccess: succeeded('header', t('tickets.announce.closed'), options.onSuccess),
            onError: (error) => refused('header', error, options),
          },
        )
      },
    },
    assign: {
      ...versionedWrites('assign', assignTicket.isPending),
      save: (request, options = {}) => {
        assignTicket.mutate(
          { reference, version: ticket.version, request },
          {
            onSuccess: succeeded('assign', t('tickets.announce.assigned'), options.onSuccess),
            onError: (error) => refused('assign', error, options),
          },
        )
      },
    },
    content: {
      ...versionedWrites('content', updateContent.isPending),
      save: (request, options) => {
        updateContent.mutate(
          { reference, version: options.version, request },
          {
            onSuccess: succeeded('content', t('tickets.announce.contentSaved'), options.onSuccess),
            onError: (error) => refused('content', error, options),
          },
        )
      },
    },
    facts: {
      ...versionedWrites('facts', updateFacts.isPending),
      save: (request, options = {}) => {
        updateFacts.mutate(
          { reference, version: ticket.version, request },
          {
            onSuccess: succeeded('facts', t('tickets.announce.factsSaved'), options.onSuccess),
            onError: (error) => refused('facts', error, options),
          },
        )
      },
    },
    comment: {
      ...placeWrites('comment', addComment.isPending),
      add: (request, options = {}) => {
        addComment.mutate(
          { reference, request, idempotencyKey: idempotencyKey.keyFor(request) },
          {
            onSuccess: () => {
              idempotencyKey.clear()
              announce(
                t(request.internal ? 'tickets.announce.noteAdded' : 'tickets.announce.commentSent'),
              )
              options.onSuccess?.()
            },
            onError: (error) => {
              if (error instanceof ProblemError && error.slug === 'idempotency/key-reused') {
                idempotencyKey.clear()
              }
              refused('comment', error, options)
            },
          },
        )
      },
    },
    links: {
      ...placeWrites('links', linkTicket.isPending || unlinkTicket.isPending),
      link: (linkedReference, request, options = {}) => {
        linkTicket.mutate(
          { reference, linkedReference, request },
          {
            onSuccess: () => {
              announce(t('tickets.announce.linked', { reference: linkedReference }))
              options.onSuccess?.()
            },
            onError: (error) => {
              if (error instanceof ProblemError && error.status === 404) {
                options.onRefused?.()
                options.fields?.linkedReference?.(
                  t('tickets.details.notFoundBody', { reference: linkedReference }),
                )
                return
              }
              refused('links', error, options)
            },
          },
        )
      },
      unlink: (linkedReference, options = {}) => {
        unlinkTicket.mutate(
          { reference, linkedReference },
          {
            onSuccess: () => {
              announce(t('tickets.announce.unlinked', { reference: linkedReference }))
              options.onSuccess?.()
            },
            onError: (error) => refused('links', error, options),
          },
        )
      },
    },
  }
}

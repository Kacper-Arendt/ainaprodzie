import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Box,
  Button,
  chakra,
  Flex,
  Grid,
  HStack,
  Link,
  Stack,
  Text,
  VisuallyHidden,
} from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink, useLocation, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { fallbackErrorKey, ProblemError } from '../../api/errors.ts'
import { Chip } from '../../components/ui/chip.tsx'
import { Lamp } from '../../components/ui/lamp.tsx'
import { EmptyState, NotFoundMark } from '../../components/ui/empty-state.tsx'
import { PageHeader } from '../../components/ui/page-header.tsx'
import { PageTitle } from '../../components/ui/page-title.ts'
import { Panel, PanelHead } from '../../components/ui/panel.tsx'
import { ProblemText } from '../../components/ui/problem-text.tsx'
import { Redirect } from '../../components/ui/route-arrival.tsx'
import { activeLanguage } from '../../i18n/index.ts'
import { useSession } from '../auth/use-auth.ts'
import { useTeams } from '../organization/use-organization.ts'
import { CloseTicketDialog } from './close-ticket-dialog.tsx'
import { CommentComposer } from './comment-composer.tsx'
import { focusComposer } from './composer-focus.ts'
import { LinkTicketForm, OPEN_ID, TICKET_ID } from './link-ticket-form.tsx'
import { REFERENCE_LINK_STYLE } from './reference-style.ts'
import {
  CATEGORY_KEYS,
  clockEmphasis,
  clockLamp,
  clockText,
  customerClockEmphasis,
  customerClockText,
  customerCommentText,
  FIELD_KEYS,
  formatDateTime,
  formatDuration,
  label,
  priorityEmphasis,
  PRIORITY_KEYS,
  RELATION_KEYS,
  responseClock,
  STATUS_KEYS,
  useNow,
} from './ticket-labels.ts'
import { EDIT_ID, TicketContentPanel } from './ticket-content-panel.tsx'
import { listSearch } from './ticket-list-filters.ts'
import { STATUS_ID, TicketFactsEditor } from './ticket-facts-editor.tsx'
import { useTicketWrites, type TicketWrites } from './use-ticket-writes.tsx'
import {
  ticketKeys,
  useTicket,
  type AuditedField,
  type LinkRelation,
  type TicketAuditEntry,
  type TicketCategory,
  type TicketDetails,
  type TicketPriority,
  type TicketStatus,
  type TicketSummary,
} from './use-tickets.ts'

/**
 * The condition under which the facts take a 300px column beside the ticket,
 * leaving the main column about 400px. It is a container query on the page's
 * own width, not a breakpoint, because the docked chat narrows the page without
 * changing the window.
 */
const FACTS_BESIDE = '@container ticket-page (min-width: 720px)'

export function TicketPage() {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
  const reference = useParams().reference ?? ''
  const ticket = useTicket(reference)
  // The list this ticket was opened from travels on to a linked ticket and
  // through the canonical redirect, so All tickets still returns to it.
  const origin = useLocation().state as unknown
  const search = listSearch(origin)

  const back = (
    <Button asChild variant="outline">
      <RouterLink to={search ? `/?${search}` : '/'}>{t('tickets.details.back')}</RouterLink>
    </Button>
  )

  if (ticket.isPending) {
    return (
      <Text role="status" color="fg.muted" textAlign="center" py="36px">
        {t('loading')}
        <PageTitle page={reference} />
      </Text>
    )
  }
  // Only a ticket that never loaded gives way to the failure. A failed
  // refetch keeps the loaded ticket on screen, and with it any draft.
  if (ticket.isLoadingError) {
    if (ticket.error instanceof ProblemError && ticket.error.status === 404) {
      return (
        <Panel>
          <EmptyState
            icon={<NotFoundMark />}
            title={t('tickets.details.notFoundTitle')}
            headline
            action={back}
          >
            {t('tickets.details.notFoundBody', { reference })}
          </EmptyState>
        </Panel>
      )
    }
    return (
      <>
        <PageHeader title={reference} actions={back} />
        <ProblemText
          error={t(fallbackErrorKey(ticket.error))}
          onRetry={() => void ticket.refetch()}
          retrying={ticket.isFetching}
        />
      </>
    )
  }
  const canonical = ticket.data.summary.reference
  // Writes store and invalidate the ticket under its canonical reference, so the page reads it there too.
  if (canonical !== reference) {
    // Seeded so the canonical URL opens on the ticket already loaded instead of a loading state.
    if (queryClient.getQueryData(ticketKeys.detail(canonical)) === undefined) {
      queryClient.setQueryData(ticketKeys.detail(canonical), ticket.data)
    }
    return <Redirect to={`/tickets/${canonical}`} state={origin} />
  }
  // A new view per ticket, so no draft, comment or write problem carries over from the previous one.
  return <TicketView key={canonical} ticket={ticket.data} back={back} />
}

const CLOSE_ID = 'ticket-close'
const FACTS_HEADING_ID = 'ticket-facts-heading'
const ASSIGN_ID = 'ticket-assign-to-me'
const ASSIGNEE_ID = 'ticket-status-assignee'

/**
 * Where focus goes once Reload has taken its own button away: back to the control
 * the refused write started from (the dropped draft's editor, Assign to me, or Close).
 */
const RELOAD_FOCUS = { header: CLOSE_ID, assign: ASSIGN_ID, content: EDIT_ID, facts: STATUS_ID }

function TicketView(props: { ticket: TicketDetails; back: ReactNode }) {
  const { t } = useTranslation('common')
  const session = useSession().data
  const isSupport = session?.roles.includes('SUPPORT') === true
  const [closing, setClosing] = useState(false)
  const writes = useTicketWrites(props.ticket, RELOAD_FOCUS)
  const { summary } = props.ticket
  const closed = summary.status === 'CLOSED'
  // Support staff close a resolved ticket; its author closes it from any status (ADR 0004).
  const isAuthor = summary.author.id === session?.id
  const mayClose = !closed && (isSupport ? summary.status === 'RESOLVED' : isAuthor)
  // Support staff edit the title and description until the ticket is closed; its author while it is new.
  const mayEdit = !closed && (isSupport || (isAuthor && summary.status === 'NEW'))
  // Support await this customer's answer: the status line offers Reply, and the close dialog asks first.
  const awaitsAnswer = !isSupport && summary.status === 'WAITING_FOR_CUSTOMER'
  const teams = useTeams(session?.id ?? '', isSupport)
  const ownTeam = teams.data?.find((team) => team.member)

  // Close and Assign to me act from the page header, so their refusals are explained at the top of
  // the side column (the top of the page on a phone, where the columns stack).
  const headerAlert = (writes.header.top || writes.assign.top) && (
    <>
      {writes.header.top}
      {writes.assign.top}
    </>
  )

  // In the header's row with the status line that names the assignee, so taking a ticket is one
  // press at the top of the page. It leads the trailing actions, so its going moves none of them.
  // It waits for the reader's own team, which the write sets with them.
  const assignAction = isSupport && !closed && session && summary.assignee?.id !== session.id && (
    <Button
      id={ASSIGN_ID}
      variant="outline"
      disabled={ownTeam === undefined || writes.assign.pending}
      onClick={() => {
        if (ownTeam === undefined) return
        writes.assign.save(
          { teamId: ownTeam.id, assigneeId: session.id },
          {
            // The button goes with the write; focus moves to the assignee it named.
            onSuccess: () => document.getElementById(ASSIGNEE_ID)?.focus(),
            // The reader's team may have changed under the write.
            onRefused: () => void teams.refetch(),
          },
        )
      }}
    >
      {t('tickets.assign.action')}
    </Button>
  )

  const closeAction = mayClose && (
    <Button
      id={CLOSE_ID}
      variant="outline"
      onClick={() => {
        writes.header.edited()
        setClosing(true)
      }}
    >
      {t('tickets.close.action')}
    </Button>
  )

  return (
    <>
      {writes.status}
      {/* The way back on the leading edge, the ticket's own actions on the trailing one: Assign to me
          leads them, so its going moves nothing else. */}
      <Flex justify="space-between" align="center" gap="12px" wrap="wrap" mb="24px">
        {props.back}
        <HStack gap="12px" wrap="wrap" justify="flex-end">
          {assignAction}
          {closeAction}
        </HStack>
      </Flex>
      <PageHeader
        title={summary.title}
        reference={summary.reference}
        subtitle={
          <StatusLine summary={summary} isSupport={isSupport} awaitsAnswer={awaitsAnswer} />
        }
      />
      {/* Source order is reading order on a phone and for the keyboard: the ticket and its
          conversation, then the details (whose editor is support's everyday control), then its links
          and history. With the facts beside the ticket the details move into a side column. */}
      <Box containerType="inline-size" containerName="ticket-page">
        <Grid
          templateColumns="minmax(0, 1fr)"
          columnGap="16px"
          alignItems="start"
          // Rows: the header alert, the rest of the conversation beside the details, then the links and
          // history. The details and the last row span a flexible row, so they add height only there
          // and each column stacks without gaps whichever is taller.
          css={{
            [FACTS_BESIDE]: {
              gridTemplateColumns: 'minmax(0, 1fr) 300px',
              gridTemplateRows: 'auto auto 1fr',
            },
          }}
        >
          {headerAlert && (
            <Box minW="0" css={{ [FACTS_BESIDE]: { gridColumn: '2', gridRow: '1' } }}>
              {headerAlert}
            </Box>
          )}
          <Box minW="0" css={{ [FACTS_BESIDE]: { gridColumn: '1', gridRow: '1 / span 2' } }}>
            <TicketContentPanel
              key={writes.content.key}
              ticket={props.ticket}
              clock={isSupport}
              mayEdit={mayEdit}
              authorEdits={!isSupport}
              write={writes.content}
            />
            {/* Support staff edit a resolved ticket's resolution in the details editor instead. */}
            {(closed || (!isSupport && summary.status === 'RESOLVED')) && (
              <Resolution ticket={props.ticket} />
            )}
            <Panel>
              <PanelHead title={t('tickets.details.conversation')} />
              <Conversation ticket={props.ticket} />
              <CommentComposer
                reference={summary.reference}
                organization={summary.organization.name}
                closed={closed}
                isSupport={isSupport}
                write={writes.comment}
              />
            </Panel>
          </Box>
          {/* Under the header alert when there is one, else from the top. */}
          <Box
            minW="0"
            css={{
              [FACTS_BESIDE]: {
                gridColumn: '2',
                gridRow: headerAlert ? '2 / span 2' : '1 / span 3',
              },
            }}
          >
            <TicketFacts
              ticket={props.ticket}
              isSupport={isSupport}
              alert={writes.facts.top}
              editor={
                isSupport &&
                !closed && (
                  <TicketFactsEditor
                    key={writes.facts.key}
                    ticket={props.ticket}
                    write={writes.facts}
                  />
                )
              }
            />
          </Box>
          <Box minW="0" css={{ [FACTS_BESIDE]: { gridColumn: '1', gridRow: '3' } }}>
            <Links ticket={props.ticket} isSupport={isSupport} write={writes.links} />
            <History ticket={props.ticket} />
          </Box>
        </Grid>
      </Box>
      <CloseTicketDialog
        reference={summary.reference}
        resolution={props.ticket.resolution}
        isSupport={isSupport}
        awaitsAnswer={awaitsAnswer}
        open={closing}
        onOpenChange={setClosing}
        write={writes.header}
      />
    </>
  )
}

/**
 * What the reader needs before anything else, under the title: the status,
 * priority, who has the ticket and where it stands against its response
 * deadline, with the clock counting; support staff also read when a customer
 * comment still awaits their answer. A customer whose answer support awaits
 * (`awaitsAnswer`) is told so in plain words in place of the status chip,
 * with an outline Reply beside it that takes them to the composer, and reads
 * the clock as how long the ticket has waited for support, without the SLA.
 */
function StatusLine(props: { summary: TicketSummary; isSupport: boolean; awaitsAnswer: boolean }) {
  const { t } = useTranslation('common')
  const now = useNow()
  const { summary } = props
  const clock = responseClock(summary, now)
  const customerClock = props.isSupport ? null : customerClockText(t, summary, now)
  // Support's next piece of work once the first-response clock has settled: as in the list,
  // semibold Ink, never red, since it is no SLA breach.
  const customerComment = props.isSupport ? customerCommentText(t, summary, now) : null
  // A customer's open ticket keeps Reply's height whether or not Reply is there, so answering,
  // which takes Reply away, moves nothing under the header (the touch floor on a coarse pointer).
  const replyRoom = !props.isSupport && summary.status !== 'CLOSED'

  return (
    <Flex
      as="span"
      wrap="wrap"
      align="center"
      columnGap="16px"
      rowGap="4px"
      mt="2px"
      fontSize="14px"
      minH={replyRoom ? '36px' : undefined}
      css={replyRoom ? { '@media (pointer: coarse)': { minHeight: '44px' } } : undefined}
      data-testid="status-line"
    >
      {props.awaitsAnswer ? (
        <HStack as="span" gap="12px" wrap="wrap">
          <Text as="span" color="fg" fontWeight="semibold">
            {t('tickets.statusLine.awaitsYou')}
          </Text>
          {/* Outline: the composer's Send is the one filled action this takes the reader to. */}
          <Button size="sm" variant="outline" onClick={focusComposer}>
            {t('tickets.statusLine.reply')}
          </Button>
        </HStack>
      ) : (
        <Chip>{label(t, STATUS_KEYS, summary.status)}</Chip>
      )}
      <Text as="span" {...priorityEmphasis(summary.priority)}>
        {t('tickets.statusLine.priority', { priority: label(t, PRIORITY_KEYS, summary.priority) })}
      </Text>
      {/* Focusable from script only: Assign to me hands focus here once the ticket is taken. */}
      <Text
        as="span"
        id={ASSIGNEE_ID}
        tabIndex={-1}
        borderRadius="control"
        color={summary.assignee ? 'fg' : 'fg.muted'}
        _focusVisible={{
          outline: '2px solid',
          outlineColor: 'accent.focusRing',
          outlineOffset: '2px',
        }}
      >
        {summary.assignee
          ? t('tickets.statusLine.assignee', { name: summary.assignee.name })
          : t('tickets.unassigned')}
      </Text>
      {props.isSupport && (
        <HStack as="span" gap="8px">
          {clock.kind === 'over' ? (
            <Chip tone="danger">{t('tickets.slaBreached')}</Chip>
          ) : (
            <Lamp tone={clockLamp(clock)} />
          )}
          <Text as="span" data-clock={clock.kind} {...clockEmphasis(clock)}>
            {clockText(t, clock, 'long')}
          </Text>
        </HStack>
      )}
      {customerComment !== null && (
        <HStack as="span" gap="8px">
          <Lamp tone="amber" />
          <Text as="span" data-clock="customerComment" color="fg" fontWeight="semibold">
            {customerComment}
          </Text>
        </HStack>
      )}
      {customerClock !== null && (
        <Text as="span" {...customerClockEmphasis(summary)}>
          {customerClock}
        </Text>
      )}
    </Flex>
  )
}

const RESOLUTION_HEADING_ID = 'ticket-resolution-heading'

/**
 * The answer of a resolved or closed ticket, between the problem and the
 * conversation that led to it, so a customer coming back finds it first. It
 * names who wrote it and when, from the latest resolution in the history; a
 * ticket withdrawn without one shows nothing.
 */
function Resolution(props: { ticket: TicketDetails }) {
  const { t } = useTranslation('common')
  const now = useNow(60_000)
  const { resolution, history } = props.ticket
  if (resolution === null || resolution.trim() === '') return null
  const written = history.findLast((entry) => entry.field === 'RESOLUTION')
  return (
    <Panel as="section" aria-labelledby={RESOLUTION_HEADING_ID}>
      <PanelHead
        id={RESOLUTION_HEADING_ID}
        title={t('tickets.details.resolution')}
        action={
          written && (
            <Flex gap="8px" align="center" wrap="wrap" fontSize="13px">
              <Text fontWeight="semibold" overflowWrap="anywhere">
                {written.actor.name}
                <VisuallyHidden>,</VisuallyHidden>
              </Text>
              <CommentTime iso={written.changedAt} now={now} />
            </Flex>
          )
        }
      />
      <Text whiteSpace="pre-wrap" overflowWrap="anywhere">
        {resolution}
      </Text>
    </Panel>
  )
}

/**
 * The details of the side column, with a refused write of its editor at its top.
 * An `editor` replaces the read-only category, team and assignee. A resolved or
 * closed ticket's resolution has a panel of its own in the main column (or
 * support's editor), so the list holds it only once a ticket has been reopened
 * with it. The status and priority are read in the status line, so the
 * read-only list leaves them out.
 * Only support staff read the response deadline and the waiting time: a
 * customer reads the wait in their own words in the status line, and the SLA
 * breach is marked there alone.
 */
function TicketFacts(props: {
  ticket: TicketDetails
  isSupport: boolean
  alert: ReactNode
  editor?: ReactNode
}) {
  const { t } = useTranslation('common')
  const language = activeLanguage()
  const { summary } = props.ticket
  const empty = t('tickets.details.empty')
  const dateTime = (iso: string | null) => (iso === null ? empty : formatDateTime(language, iso))

  const editable: Array<[string, ReactNode]> = props.editor
    ? []
    : [
        [
          t('tickets.details.category'),
          summary.category === null ? empty : label(t, CATEGORY_KEYS, summary.category),
        ],
        [t('tickets.details.team'), summary.team?.name ?? empty],
        [t('tickets.details.assignee'), summary.assignee?.name ?? t('tickets.unassigned')],
      ]
  const sla: Array<[string, ReactNode]> = props.isSupport
    ? [
        [t('tickets.details.responseDeadline'), dateTime(summary.sla.responseDeadline)],
        [t('tickets.details.waitingTime'), formatDuration(t, summary.sla.waitingSeconds)],
      ]
    : []
  const facts: Array<[string, ReactNode]> = [
    [t('tickets.details.organization'), summary.organization.name],
    [t('tickets.details.author'), summary.author.name],
    ...editable,
    [t('tickets.details.createdAt'), dateTime(summary.createdAt)],
    [t('tickets.details.firstResponseAt'), dateTime(summary.firstResponseAt)],
    ...sla,
    ...(props.ticket.resolution === null ||
    summary.status === 'RESOLVED' ||
    summary.status === 'CLOSED'
      ? []
      : [
          [
            t('tickets.details.resolution'),
            <Text as="span" whiteSpace="pre-wrap" key="resolution">
              {props.ticket.resolution}
            </Text>,
          ] as [string, ReactNode],
        ]),
    ...(summary.closedAt === null
      ? []
      : [[t('tickets.details.closedAt'), dateTime(summary.closedAt)] as [string, ReactNode]]),
  ]

  return (
    <Panel as="aside" aria-labelledby={FACTS_HEADING_ID}>
      {props.alert}
      <PanelHead id={FACTS_HEADING_ID} title={t('tickets.details.facts')} />
      {props.editor}
      <Grid
        as="dl"
        mt={props.editor ? '18px' : undefined}
        // The terms take the width of the longest one, up to 140px, so "Response deadline"
        // and "Pierwsza odpowiedź" stay on one line and a date beside them does too.
        templateColumns="fit-content(140px) minmax(0, 1fr)"
        columnGap="14px"
        fontSize="14px"
        lineHeight="20px"
        // The course's waybill: each row on a dashed hairline, the last one open.
        css={{
          '& dt, & dd': { py: '8px', borderBottom: '1px dashed', borderColor: 'border' },
          '& > div:last-of-type > *': { borderBottomWidth: '0' },
        }}
      >
        {facts.map(([name, value]) => (
          <Box key={name} display="contents">
            <chakra.dt
              color="fg.muted"
              fontFamily="mono"
              fontSize="11px"
              fontWeight="600"
              letterSpacing="0.06em"
              textTransform="uppercase"
            >
              {name}
            </chakra.dt>
            <chakra.dd overflowWrap="anywhere">{value}</chakra.dd>
          </Box>
        ))}
      </Grid>
    </Panel>
  )
}

/** A comment newer than this says how long ago it was written; an older one, when. */
const RECENT_MS = 24 * 3600_000

/**
 * When a comment was written: relative while it is recent ("20 minutes ago"),
 * as a date and time after that, with the exact time in `dateTime` and a tooltip.
 */
function CommentTime(props: { iso: string; now: number }) {
  const language = activeLanguage()
  const absolute = formatDateTime(language, props.iso)
  // A clock a little behind the server's reads a comment just written as now, not in the future.
  const ago = Math.max(0, props.now - new Date(props.iso).getTime())
  let text = absolute
  if (ago < RECENT_MS) {
    const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
    const minutes = Math.floor(ago / 60_000)
    text =
      minutes === 0
        ? relative.format(0, 'second')
        : minutes < 60
          ? relative.format(-minutes, 'minute')
          : relative.format(-Math.floor(minutes / 60), 'hour')
  }
  return (
    <chakra.time
      dateTime={props.iso}
      title={absolute}
      color="fg.muted"
      fontWeight="normal"
      textTransform="none"
      letterSpacing="0.02em"
      ms="auto"
    >
      {text}
    </chakra.time>
  )
}

function Conversation(props: { ticket: TicketDetails }) {
  const { t } = useTranslation('common')
  // Once a minute is enough for a clock that counts in minutes.
  const now = useNow(60_000)
  if (props.ticket.comments.length === 0) {
    return <Text color="fg.muted">{t('tickets.details.noComments')}</Text>
  }
  return (
    <Stack as="ol" gap="12px" listStyleType="none">
      {props.ticket.comments.map((comment) => (
        <Box
          as="li"
          key={comment.id}
          data-internal={comment.internal}
          borderWidth="ink"
          // Dashed amber: a note is set apart as not public, never as trouble.
          borderStyle={comment.internal ? 'dashed' : 'solid'}
          // Support staff write on a sheet under an ink edge, the customer on a card under a hairline.
          borderColor={
            comment.internal ? 'amber.border' : comment.fromSupport ? 'border.control' : 'border'
          }
          borderRadius="control"
          bg={comment.internal ? 'amber.subtle' : comment.fromSupport ? 'bg.panel' : 'bg.subtle'}
          px="16px"
          py="12px"
        >
          <Flex
            gap="8px"
            align="center"
            wrap="wrap"
            mb="6px"
            fontFamily="mono"
            fontSize="11px"
            lineHeight="19px"
            letterSpacing="0.06em"
            textTransform="uppercase"
            color={comment.internal ? 'amber.fg' : 'fg'}
          >
            <Text fontWeight="600" minW="0" overflowWrap="anywhere">
              {comment.author.name}
              {/* A pause before the role, so it is not heard as part of the name. */}
              {comment.fromSupport && <VisuallyHidden>,</VisuallyHidden>}
            </Text>
            {comment.fromSupport && <Chip>{t('tickets.details.support')}</Chip>}
            {comment.internal && <Chip>{t('tickets.details.internalNote')}</Chip>}
            <CommentTime iso={comment.createdAt} now={now} />
          </Flex>
          <Text whiteSpace="pre-wrap" overflowWrap="anywhere">
            {comment.body}
          </Text>
        </Box>
      ))}
    </Stack>
  )
}

/**
 * A link write in flight and where focus goes once the page shows its answer: a
 * removal moves it to the neighbouring Remove button by its link's reference, or
 * null for the last link's Undo, which follows the emptied list; an undone
 * removal to the restored link's Remove. `outcome` is set once the answer
 * arrives, which can be a render before the page shows the ticket it stored.
 */
interface LinkFocus {
  reference: string
  kind: 'remove' | 'restore'
  next: string | null
  outcome?: 'done' | 'refused'
}

/** A removed link as the request that puts it back; a potential duplicate keeps its direction. */
interface Removed {
  reference: string
  type: 'RELATED' | 'POTENTIAL_DUPLICATE'
}

/**
 * The ticket's links. A customer reads them, and sees no panel when there are
 * none; support always sees the panel, removes a link in one click, with an
 * Undo until the next removal or Link a ticket, and links another ticket below
 * the list.
 */
function Links(props: { ticket: TicketDetails; isSupport: boolean; write: TicketWrites['links'] }) {
  const { t } = useTranslation('common')
  const origin = useLocation().state as unknown
  const refocus = useRef<LinkFocus>(undefined)
  const removeButtons = useRef(new Map<string, HTMLButtonElement>())
  const undoButton = useRef<HTMLButtonElement>(null)
  const [removed, setRemoved] = useState<Removed>()
  const { reference } = props.ticket.summary
  const links = props.ticket.links
  // Memoised, so the link search keeps its list between renders.
  const linked = useMemo(() => links.map((link) => link.reference), [links])
  // One link write at a time, so an older answer cannot be stored over a newer one.
  const writing = props.write.pending

  useEffect(() => {
    const target = refocus.current
    if (target?.outcome === undefined || writing) return
    const shown = links.some((link) => link.reference === target.reference)
    if (target.outcome === 'done' && shown !== (target.kind === 'restore')) return
    refocus.current = undefined
    // A refused removal keeps its row, and its Remove lost focus while it was disabled; a
    // restored link's Remove is in its row again.
    if (target.outcome === 'refused' ? target.kind === 'remove' : target.kind === 'restore') {
      removeButtons.current.get(target.reference)?.focus()
      return
    }
    const button =
      target.next === null ? undoButton.current : removeButtons.current.get(target.next)
    const linkForm = document.getElementById(TICKET_ID) ?? document.getElementById(OPEN_ID)
    ;(button ?? linkForm)?.focus()
  }, [writing, links])

  if (!props.isSupport && links.length === 0) return null

  const track = (target: LinkFocus) => {
    refocus.current = target
    return {
      onSuccess: () => {
        target.outcome = 'done'
      },
      onRefused: () => {
        target.outcome = 'refused'
      },
    }
  }

  const remove = (link: TicketDetails['links'][number]) => {
    setRemoved(undefined)
    const index = links.indexOf(link)
    const neighbour = links[index + 1] ?? links[index - 1]
    const target = track({
      reference: link.reference,
      kind: 'remove',
      next: neighbour?.reference ?? null,
    })
    props.write.unlink(link.reference, {
      ...target,
      onSuccess: () => {
        target.onSuccess()
        setRemoved({
          reference: link.reference,
          type: link.relation === 'RELATED' ? 'RELATED' : 'POTENTIAL_DUPLICATE',
        })
      },
    })
  }

  // Linking is idempotent by its shape (ADR 0003), and the backend stores a potential duplicate from
  // the later ticket whichever end asks, so the same request restores the link as it was.
  const restore = (link: Removed) => {
    setRemoved(undefined)
    props.write.link(
      link.reference,
      { type: link.type },
      track({ reference: link.reference, kind: 'restore', next: null }),
    )
  }

  return (
    <Panel>
      <PanelHead title={t('tickets.details.links')} />
      {links.length === 0 ? (
        <Text color="fg.muted" fontSize="14px">
          {t('tickets.links.empty')}
        </Text>
      ) : (
        <Stack as="ul" gap="6px" listStyleType="none" fontSize="14px">
          {links.map((link) => (
            <Flex as="li" key={link.reference} gap="8px" align="center" wrap="wrap">
              <Text color="fg.muted">{label(t, RELATION_KEYS, link.relation)}</Text>
              <Link asChild {...REFERENCE_LINK_STYLE}>
                <RouterLink to={`/tickets/${link.reference}`} state={origin}>
                  {link.reference}
                </RouterLink>
              </Link>
              <Text
                flex={props.isSupport ? '1' : undefined}
                minW={props.isSupport ? '120px' : '0'}
                overflowWrap="anywhere"
              >
                {link.title}
              </Text>
              <Chip>{label(t, STATUS_KEYS, link.status)}</Chip>
              {props.isSupport && (
                <Button
                  variant="ghost"
                  size="xs"
                  color="fg.muted"
                  aria-label={t('tickets.links.removeLabel', { reference: link.reference })}
                  ref={(button) => {
                    if (button) removeButtons.current.set(link.reference, button)
                    else removeButtons.current.delete(link.reference)
                  }}
                  disabled={writing}
                  onClick={() => remove(link)}
                >
                  {t('tickets.links.remove')}
                </Button>
              )}
            </Flex>
          ))}
        </Stack>
      )}
      {removed && (
        <Flex
          align="center"
          justify="space-between"
          wrap="wrap"
          gap="8px"
          mt="10px"
          bg="bg.muted"
          borderRadius="control"
          px="12px"
          py="6px"
          fontSize="14px"
        >
          <Text overflowWrap="anywhere">
            {t('tickets.links.removed', { reference: removed.reference })}
          </Text>
          <Button
            variant="outline"
            size="xs"
            bg="bg.panel"
            aria-label={t('tickets.links.undoLabel', { reference: removed.reference })}
            ref={undoButton}
            onClick={() => restore(removed)}
          >
            {t('tickets.links.undo')}
          </Button>
        </Flex>
      )}
      {props.isSupport && (
        <LinkTicketForm
          reference={reference}
          linked={linked}
          write={props.write}
          // Moving on to link another ticket makes the Undo stale, as another removal does.
          onOpen={() => setRemoved(undefined)}
        />
      )}
      {props.write.below}
    </Panel>
  )
}

const isRelation = (name: string): name is LinkRelation => Object.hasOwn(RELATION_KEYS, name)

/** A new link said as a sentence from this ticket's side, e.g. "Linked RET-1025 as related". */
const LINKED_KEYS: Record<LinkRelation, string> = {
  RELATED: 'tickets.details.linked.RELATED',
  POTENTIAL_DUPLICATE_OF: 'tickets.details.linked.POTENTIAL_DUPLICATE_OF',
  HAS_POTENTIAL_DUPLICATE: 'tickets.details.linked.HAS_POTENTIAL_DUPLICATE',
}

/**
 * A link entry's value, "<relation> <reference>" from this ticket's side; entries seeded before
 * links were side-aware read "POTENTIAL_DUPLICATE <reference>" on the later ticket. A relation
 * this bundle does not know parses to nothing, so its entry shows the raw value.
 */
function parseLink(value: string | null): { relation: LinkRelation; reference: string } | null {
  const [name, reference] = value?.split(' ') ?? []
  const relation = name === 'POTENTIAL_DUPLICATE' ? 'POTENTIAL_DUPLICATE_OF' : name
  return relation !== undefined && isRelation(relation) && reference
    ? { relation, reference }
    : null
}

/** Fields whose values are text people wrote, so the history quotes them rather than inlining them. */
const FREE_TEXT_FIELDS: ReadonlySet<AuditedField> = new Set(['TITLE', 'RESOLUTION'])
const PREVIEW_CHARS = 80

/**
 * A free-text value as the history line quotes it: up to its first line break
 * and about 80 characters, cut between words with an ellipsis. `cut` tells that
 * the full value is only behind Show the change.
 */
function textPreview(value: string): { text: string; cut: boolean } {
  const whole = value.trim()
  const firstLine = whole.split('\n', 1)[0].trimEnd()
  const space = firstLine.lastIndexOf(' ', PREVIEW_CHARS)
  const head =
    firstLine.length <= PREVIEW_CHARS
      ? firstLine
      : firstLine.slice(0, space > 0 ? space : PREVIEW_CHARS).replace(/[\s,;:.]+$/, '')
  const cut = head !== whole
  return { text: cut ? `${head}…` : head, cut }
}

function History(props: { ticket: TicketDetails }) {
  const { t } = useTranslation('common')
  const language = activeLanguage()
  const empty = t('tickets.details.empty')
  const auditValue = (field: AuditedField, value: string | null) => {
    if (value === null) return null
    if (FREE_TEXT_FIELDS.has(field)) {
      return value.trim() === ''
        ? null
        : t('tickets.details.quoted', { text: textPreview(value).text })
    }
    switch (field) {
      case 'STATUS':
        return label(t, STATUS_KEYS, value as TicketStatus)
      case 'PRIORITY':
        return label(t, PRIORITY_KEYS, value as TicketPriority)
      case 'CATEGORY':
        return label(t, CATEGORY_KEYS, value as TicketCategory)
      case 'LINK': {
        const link = parseLink(value)
        return link ? `${label(t, RELATION_KEYS, link.relation)} ${link.reference}` : value
      }
      default:
        return value
    }
  }
  // A link added or removed, or a field set from nothing, reads as a sentence; a value that
  // changed into another reads "from → to", the arrow heard as a word rather than as "right arrow".
  const changeText = (entry: TicketAuditEntry): ReactNode => {
    const field = label(t, FIELD_KEYS, entry.field)
    const from = auditValue(entry.field, entry.oldValue)
    const to = auditValue(entry.field, entry.newValue)
    if (entry.field === 'LINK') {
      const added = entry.oldValue === null ? parseLink(entry.newValue) : null
      if (added) return t(LINKED_KEYS[added.relation], { reference: added.reference })
      const removed = entry.newValue === null ? parseLink(entry.oldValue) : null
      if (removed) return t('tickets.details.unlinked', { reference: removed.reference })
    }
    if (from === null && to !== null) return t('tickets.details.set', { field, to })
    if (from !== null && to === null) return t('tickets.details.cleared', { field, from })
    return (
      <>
        {t('tickets.details.changeFrom', { field, from: from ?? empty })}{' '}
        <span aria-hidden="true">→</span>
        <VisuallyHidden>{t('tickets.details.changeTo')}</VisuallyHidden> {to ?? empty}
      </>
    )
  }

  return (
    <Panel>
      <PanelHead title={t('tickets.details.history')} />
      {props.ticket.history.length === 0 ? (
        <Text color="fg.muted">{t('tickets.details.noHistory')}</Text>
      ) : (
        // A fixed time column keeps a long change (a resolution) under its own
        // text; on a phone the time heads each entry instead.
        <Stack as="ol" gap={{ base: '10px', sm: '6px' }} listStyleType="none" fontSize="14px">
          {props.ticket.history.map((entry, index) => (
            <Grid
              as="li"
              key={index}
              templateColumns={{ base: 'minmax(0, 1fr)', sm: '150px minmax(0, 1fr)' }}
              columnGap="12px"
            >
              <Text
                color="fg.muted"
                fontFamily="mono"
                fontSize="12px"
                lineHeight="21px"
                fontVariantNumeric="tabular-nums"
              >
                {formatDateTime(language, entry.changedAt)}
              </Text>
              {entry.field === 'CREATED' ? (
                <Text>
                  <Actor name={entry.actor.name} />
                  {t('tickets.details.created')}
                </Text>
              ) : entry.field === 'DESCRIPTION' ? (
                <DescriptionChange entry={entry} />
              ) : (
                <Box minW="0">
                  <Text overflowWrap="anywhere">
                    <Actor name={entry.actor.name} />
                    {changeText(entry)}
                  </Text>
                  {FREE_TEXT_FIELDS.has(entry.field) &&
                    [entry.oldValue, entry.newValue].some(
                      (value) => value !== null && textPreview(value).cut,
                    ) && <ChangeDisclosure entry={entry} />}
                </Box>
              )}
            </Grid>
          ))}
        </Stack>
      )}
    </Panel>
  )
}

/** Who made a change, set apart from it in weight and, for a screen reader, by a pause. */
function Actor(props: { name: string }) {
  return (
    <Text as="span" fontWeight="semibold" me="8px">
      {props.name}
      <VisuallyHidden>,</VisuallyHidden>
    </Text>
  )
}

/**
 * A description is too long to read as "from → to" in one line, so the entry
 * says it was edited and keeps both versions behind a disclosure.
 */
function DescriptionChange(props: { entry: TicketAuditEntry }) {
  const { t } = useTranslation('common')
  return (
    <Box minW="0">
      <Text overflowWrap="anywhere">
        <Actor name={props.entry.actor.name} />
        {t('tickets.details.edited', { field: label(t, FIELD_KEYS, 'DESCRIPTION') })}
      </Text>
      <ChangeDisclosure entry={props.entry} />
    </Box>
  )
}

/** Both versions of a long text change in full, folded under Show the change. */
function ChangeDisclosure(props: { entry: TicketAuditEntry }) {
  const { t } = useTranslation('common')
  const empty = t('tickets.details.empty')
  const versions: Array<[string, string | null]> = [
    [t('tickets.details.before'), props.entry.oldValue],
    [t('tickets.details.after'), props.entry.newValue],
  ]
  return (
    <chakra.details mt="2px">
      <chakra.summary
        w="fit-content"
        cursor="pointer"
        color="accent.fg"
        fontWeight="semibold"
        borderRadius="control"
        _focusVisible={{ outline: '2px solid', outlineColor: 'accent.focusRing' }}
      >
        {t('tickets.details.showChange')}
      </chakra.summary>
      <Grid
        as="dl"
        templateColumns="minmax(0, 1fr)"
        rowGap="4px"
        mt="8px"
        ps="12px"
        borderStartWidth="1px"
        borderColor="border"
      >
        {versions.map(([name, value]) => (
          <Box key={name} display="contents">
            <chakra.dt color="fg.muted">{name}</chakra.dt>
            <chakra.dd whiteSpace="pre-wrap" overflowWrap="anywhere" mb="4px">
              {value === null || value === '' ? empty : value}
            </chakra.dd>
          </Box>
        ))}
      </Grid>
    </chakra.details>
  )
}

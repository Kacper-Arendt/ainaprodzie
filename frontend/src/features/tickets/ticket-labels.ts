import { useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import type { LampTone } from '../../components/ui/lamp.tsx'
import type {
  Attention,
  AuditedField,
  LinkRelation,
  TicketCategory,
  TicketPriority,
  TicketSort,
  TicketStatus,
  TicketSummary,
} from './use-tickets.ts'

export const STATUS_KEYS: Record<TicketStatus, string> = {
  NEW: 'tickets.status.NEW',
  IN_PROGRESS: 'tickets.status.IN_PROGRESS',
  WAITING_FOR_CUSTOMER: 'tickets.status.WAITING_FOR_CUSTOMER',
  RESOLVED: 'tickets.status.RESOLVED',
  CLOSED: 'tickets.status.CLOSED',
}

export const STATUSES = Object.keys(STATUS_KEYS) as TicketStatus[]

/**
 * The statuses support staff may set from each status (ADR 0004): nothing
 * returns to new, a resolved ticket only reopens, and closing is its own action.
 * The server decides; this only keeps impossible moves out of the select.
 */
const NEXT_STATUSES: Record<TicketStatus, TicketStatus[]> = {
  NEW: ['IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED'],
  IN_PROGRESS: ['WAITING_FOR_CUSTOMER', 'RESOLVED'],
  WAITING_FOR_CUSTOMER: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS'],
  CLOSED: [],
}

/** A status newer than this bundle offers no moves rather than throwing. */
export function nextStatuses(status: TicketStatus): TicketStatus[] {
  return (NEXT_STATUSES as Record<string, TicketStatus[] | undefined>)[status] ?? []
}

export const PRIORITY_KEYS: Record<TicketPriority, string> = {
  LOW: 'tickets.priority.LOW',
  NORMAL: 'tickets.priority.NORMAL',
  HIGH: 'tickets.priority.HIGH',
  CRITICAL: 'tickets.priority.CRITICAL',
}

export const PRIORITIES = Object.keys(PRIORITY_KEYS) as TicketPriority[]

export const SORT_KEYS: Record<TicketSort, string> = {
  RESPONSE_DEADLINE: 'tickets.sort.RESPONSE_DEADLINE',
  RECENTLY_UPDATED: 'tickets.sort.RECENTLY_UPDATED',
  LONGEST_WAITING: 'tickets.sort.LONGEST_WAITING',
}

export const SORTS = Object.keys(SORT_KEYS) as TicketSort[]

/** In the desk summary's order: the live breaches lead, as they do in the queue. */
export const ATTENTION_KEYS: Record<Attention, string> = {
  PAST_DEADLINE: 'tickets.filters.attentionValue.PAST_DEADLINE',
  DUE_WITHIN_HOUR: 'tickets.filters.attentionValue.DUE_WITHIN_HOUR',
  UNANSWERED_CUSTOMER_COMMENT: 'tickets.filters.attentionValue.UNANSWERED_CUSTOMER_COMMENT',
  UNASSIGNED: 'tickets.filters.attentionValue.UNASSIGNED',
}

export const ATTENTIONS = Object.keys(ATTENTION_KEYS) as Attention[]

export const CATEGORY_KEYS: Record<TicketCategory, string> = {
  BUG: 'tickets.category.BUG',
  QUESTION: 'tickets.category.QUESTION',
  FEATURE_REQUEST: 'tickets.category.FEATURE_REQUEST',
}

export const CATEGORIES = Object.keys(CATEGORY_KEYS) as TicketCategory[]

export const RELATION_KEYS: Record<LinkRelation, string> = {
  RELATED: 'tickets.relation.RELATED',
  POTENTIAL_DUPLICATE_OF: 'tickets.relation.POTENTIAL_DUPLICATE_OF',
  HAS_POTENTIAL_DUPLICATE: 'tickets.relation.HAS_POTENTIAL_DUPLICATE',
}

export const FIELD_KEYS: Record<AuditedField, string> = {
  CREATED: 'tickets.field.CREATED',
  TITLE: 'tickets.field.TITLE',
  DESCRIPTION: 'tickets.field.DESCRIPTION',
  CATEGORY: 'tickets.field.CATEGORY',
  PRIORITY: 'tickets.field.PRIORITY',
  STATUS: 'tickets.field.STATUS',
  TEAM: 'tickets.field.TEAM',
  ASSIGNEE: 'tickets.field.ASSIGNEE',
  RESOLUTION: 'tickets.field.RESOLUTION',
  LINK: 'tickets.field.LINK',
}

/** A value newer than this bundle shows its raw code instead of throwing or borrowing another label. */
export function label<V extends string>(t: TFunction, keys: Record<V, string>, value: V): string {
  const key = (keys as Record<string, string | undefined>)[value]
  return key ? t(key) : value
}

/** The two largest units, e.g. "2 d 4 h" or "35 min". The abbreviations do not inflect, so no plural keys. */
export function formatDuration(t: TFunction, totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(t('tickets.duration.days', { count: days }))
  if (hours > 0) parts.push(t('tickets.duration.hours', { count: hours }))
  // Whole hours read as "4 h", not "4 h 0 min".
  if (days === 0 && (hours === 0 || minutes % 60 > 0)) {
    parts.push(t('tickets.duration.minutes', { count: minutes % 60 }))
  }
  return parts.slice(0, 2).join(' ')
}

/** A date and time, with the year only when it is not the current one, so it fits a 150px column. */
export function formatDateTime(language: string, iso: string): string {
  const date = new Date(iso)
  const thisYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat(language, {
    year: thisYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

/** A deadline closer than this reads as soon: still within the SLA, but next in line. */
const SOON_SECONDS = 60 * 60

/**
 * Where a ticket stands against its response deadline, as the desk reads it:
 * still due (soon or not), past the deadline, answered, or closed without a
 * first response. A settled clock that breached the SLA (answered, or closed
 * unanswered, after the deadline) is a kind of its own: that breach is history,
 * not work, so `over` alone is a live breach. The server's `breached` decides
 * the breach; the time left or over is counted from `now`, so a clock that
 * ticks keeps it current between refetches. A deadline that passed since the
 * last fetch reads as due now until the server reports the breach.
 */
export type ResponseClock =
  | { kind: 'due'; seconds: number; soon: boolean }
  | { kind: 'over'; seconds: number }
  | { kind: 'answered'; seconds: number }
  | { kind: 'answeredLate'; seconds: number }
  | { kind: 'closedUnanswered' }
  | { kind: 'closedLate' }

export function responseClock(summary: TicketSummary, now: number): ResponseClock {
  const deadline = Date.parse(summary.sla.responseDeadline)
  if (summary.firstResponseAt !== null) {
    if (!summary.sla.breached) return { kind: 'answered', seconds: summary.sla.waitingSeconds }
    // How long after the deadline the first response came.
    const late = Math.round((Date.parse(summary.firstResponseAt) - deadline) / 1000)
    return { kind: 'answeredLate', seconds: Math.max(0, late) }
  }
  if (summary.closedAt !== null) {
    return { kind: summary.sla.breached ? 'closedLate' : 'closedUnanswered' }
  }
  const fromDeadline = Math.round((deadline - now) / 1000)
  if (summary.sla.breached) return { kind: 'over', seconds: Math.max(0, -fromDeadline) }
  const left = Math.max(0, fromDeadline)
  return { kind: 'due', seconds: left, soon: left <= SOON_SECONDS }
}

/**
 * How loud a clock reads: what still needs a first response leads (in bold when
 * due soon, in bold red once past the deadline), the settled ones recede, a past breach too.
 */
export function clockEmphasis(clock: ResponseClock): { color: string; fontWeight: string } {
  switch (clock.kind) {
    case 'due':
      return { color: 'fg', fontWeight: clock.soon ? 'semibold' : 'normal' }
    case 'over':
      return { color: 'red.fg', fontWeight: 'semibold' }
    case 'answered':
    case 'answeredLate':
    case 'closedUnanswered':
    case 'closedLate':
      return { color: 'fg.muted', fontWeight: 'normal' }
  }
}

/**
 * The clock as words. `form` picks the list's short cell or the ticket page's
 * sentence; each kind has one key per form.
 */
export function clockText(t: TFunction, clock: ResponseClock, form: 'short' | 'long'): string {
  const prefix = `tickets.clock.${form}`
  switch (clock.kind) {
    case 'due':
      return clock.seconds < 60
        ? t(`${prefix}.dueNow`)
        : t(`${prefix}.due`, { duration: formatDuration(t, clock.seconds) })
    case 'over':
      return t(`${prefix}.over`, { duration: formatDuration(t, clock.seconds) })
    case 'answered':
      return t(`${prefix}.answered`, { duration: formatDuration(t, clock.seconds) })
    case 'answeredLate':
      return t(`${prefix}.answeredLate`, { duration: formatDuration(t, clock.seconds) })
    case 'closedUnanswered':
      return t(`${prefix}.closedUnanswered`)
    case 'closedLate':
      return t(`${prefix}.closedLate`)
  }
}

/**
 * How long ago a customer wrote the ticket's unanswered customer comment (their
 * public comment after the first response that support staff have not yet
 * answered with one), or `null` when there is none. It is support's next piece
 * of work on a ticket whose first-response clock has already settled, so it
 * takes that clock's place in the support list, ticking with `now`.
 */
export function customerCommentText(
  t: TFunction,
  summary: TicketSummary,
  now: number,
): string | null {
  if (summary.unansweredCustomerCommentAt === null) return null
  const seconds = Math.max(0, (now - Date.parse(summary.unansweredCustomerCommentAt)) / 1000)
  if (seconds < 60) return t('tickets.customerComment.justNow')
  // A time ago needs only its largest unit, which keeps the line short enough for the column.
  const unit = seconds >= 86400 ? 86400 : seconds >= 3600 ? 3600 : 60
  return t('tickets.customerComment.ago', {
    duration: formatDuration(t, Math.floor(seconds / unit) * unit),
  })
}

/**
 * Whether a customer reads the ticket as waiting for support: no first
 * response yet, and support has not set it aside as waiting for the customer,
 * resolved or closed. Support staff may set those statuses without a public
 * comment, so a missing first response alone does not make the ticket wait.
 */
function awaitsSupport(summary: TicketSummary): boolean {
  return (
    summary.firstResponseAt === null &&
    summary.closedAt === null &&
    summary.status !== 'WAITING_FOR_CUSTOMER' &&
    summary.status !== 'RESOLVED'
  )
}

/**
 * The clock in a customer's words: how long the ticket has waited for support,
 * how long support took to answer, or that it was resolved or closed before an
 * answer, with no deadline or SLA chip. A wait that has run past the
 * organization's first-response SLA says so plainly, naming the time support
 * aim for (the time the new-ticket form promised), rather than staying silent
 * or turning red. An unanswered ticket waiting for the customer has no clock
 * (`null`): its status already asks for their answer, and saying support has
 * not answered beside it reads as a contradiction. The wait runs from the
 * ticket's creation to `now`, so the same tick keeps it counting.
 */
export function customerClockText(
  t: TFunction,
  summary: TicketSummary,
  now: number,
): string | null {
  if (awaitsSupport(summary)) {
    const created = Date.parse(summary.createdAt)
    const waited = (now - created) / 1000
    const wait = inWords(t, 'tickets.customerClock.waiting', waited)
    const aimMinutes = Math.round((Date.parse(summary.sla.responseDeadline) - created) / 60_000)
    if (waited <= aimMinutes * 60) return wait
    return aimMinutes % 60 === 0
      ? t('tickets.customerClock.pastAim.hours', { wait, count: aimMinutes / 60 })
      : t('tickets.customerClock.pastAim.minutes', { wait, count: aimMinutes })
  }
  if (summary.firstResponseAt !== null) {
    return inWords(t, 'tickets.customerClock.answered', summary.sla.waitingSeconds)
  }
  if (summary.closedAt !== null) return t('tickets.customerClock.closedUnanswered')
  return summary.status === 'RESOLVED' ? t('tickets.customerClock.resolvedUnanswered') : null
}

/**
 * How loud a customer's clock reads: a wait for support leads, the rest
 * recedes. The weight never follows the SLA, which a customer does not see.
 */
export function customerClockEmphasis(summary: TicketSummary): { color: string } {
  return { color: awaitsSupport(summary) ? 'fg' : 'fg.muted' }
}

/**
 * A duration by its largest whole unit in a sentence that spells the unit out,
 * e.g. "for 2 days" for 2 d 4 h. The sentence inflects with the count, so each
 * unit is a plural key of its own.
 */
function inWords(t: TFunction, prefix: string, totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes >= 1440) return t(`${prefix}.days`, { count: Math.floor(minutes / 1440) })
  if (minutes >= 60) return t(`${prefix}.hours`, { count: Math.floor(minutes / 60) })
  if (minutes >= 1) return t(`${prefix}.minutes`, { count: minutes })
  return t(`${prefix}.underMinute`)
}

/** The current time, read again every `intervalMs`, so a clock on screen keeps counting. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * How much a priority stands out in a list: the routine ones recede, high
 * reads as plain text and critical in bold. The word always carries the meaning.
 */
const PRIORITY_EMPHASIS: Record<TicketPriority, { color: string; fontWeight: string }> = {
  LOW: { color: 'fg.muted', fontWeight: 'normal' },
  NORMAL: { color: 'fg.muted', fontWeight: 'normal' },
  HIGH: { color: 'fg', fontWeight: 'normal' },
  CRITICAL: { color: 'fg', fontWeight: 'semibold' },
}

/**
 * The lamp beside a clock, saying who owes a first response: red once the
 * deadline has passed (beside the SLA chip), amber within the last hour, green
 * while there is time, off once the clock has settled.
 */
export function clockLamp(clock: ResponseClock): LampTone {
  switch (clock.kind) {
    case 'due':
      return clock.soon ? 'amber' : 'green'
    case 'over':
      return 'red'
    case 'answered':
    case 'answeredLate':
    case 'closedUnanswered':
    case 'closedLate':
      return 'off'
  }
}

/** A priority newer than this bundle reads as plain text, like its raw code beside it. */
export function priorityEmphasis(priority: TicketPriority) {
  const emphasis = (
    PRIORITY_EMPHASIS as Record<string, (typeof PRIORITY_EMPHASIS)['LOW'] | undefined>
  )[priority]
  return emphasis ?? { color: 'fg', fontWeight: 'normal' }
}

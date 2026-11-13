import { describe, expect, it } from 'vitest'
import i18n from '../../i18n/index.ts'
import { ticketSummary } from './ticket-fixtures.ts'
import {
  clockEmphasis,
  clockLamp,
  clockText,
  customerClockText,
  customerCommentText,
  FIELD_KEYS,
  formatDuration,
  label,
  responseClock,
  STATUS_KEYS,
} from './ticket-labels.ts'
import type { TicketStatus } from './use-tickets.ts'

const t = i18n.getFixedT('en', 'common')
const tPl = i18n.getFixedT('pl', 'common')

describe('formatDuration', () => {
  it('shows the two largest units', () => {
    expect(formatDuration(t, 0)).toBe('0 min')
    expect(formatDuration(t, 35 * 60 + 59)).toBe('35 min')
    expect(formatDuration(t, 5 * 3600 + 3 * 60)).toBe('5 h 3 min')
    expect(formatDuration(t, 4 * 3600 + 59)).toBe('4 h')
    expect(formatDuration(t, 2 * 86400 + 4 * 3600 + 30 * 60)).toBe('2 d 4 h')
    expect(formatDuration(t, 3 * 86400 + 10 * 60)).toBe('3 d')
    expect(formatDuration(tPl, 5 * 3600 + 3 * 60)).toBe('5 h 3 min')
    // Unit symbols in Polish too, so a clock with its SLA chip fits its column on one line.
    expect(formatDuration(tPl, 20 * 86400 + 19 * 3600)).toBe('20 d 19 h')
  })
})

describe('label', () => {
  it('shows the raw code of a value newer than this bundle', () => {
    expect(label(t, STATUS_KEYS, 'NEW')).toBe('New')
    expect(label(t, STATUS_KEYS, 'ESCALATED' as TicketStatus)).toBe('ESCALATED')
  })
})

describe('FIELD_KEYS', () => {
  it('labels the CREATED history entry in both languages', () => {
    expect(label(t, FIELD_KEYS, 'CREATED')).toBe('Created')
    expect(label(tPl, FIELD_KEYS, 'CREATED')).toBe('Utworzenie')
  })
})

describe('responseClock', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  const breach = {
    responseDeadline: '2026-10-08T12:00:00Z',
    waitingSeconds: 10 * 3600,
    breached: true,
  }

  it('reads a breach still awaiting a first response as the live one, in bold red with a red lamp', () => {
    const clock = responseClock(ticketSummary(), now)
    expect(clock).toEqual({ kind: 'over', seconds: 86400 })
    expect(clockEmphasis(clock)).toEqual({ color: 'red.fg', fontWeight: 'semibold' })
    expect(clockLamp(clock)).toBe('red')
  })

  it('settles a breach answered after the deadline into how late the first response came', () => {
    const late = ticketSummary({ firstResponseAt: '2026-10-08T18:00:00Z', sla: breach })
    const clock = responseClock(late, now)
    expect(clock).toEqual({ kind: 'answeredLate', seconds: 6 * 3600 })
    expect(clockEmphasis(clock)).toEqual({ color: 'fg.muted', fontWeight: 'normal' })
    expect(clockText(t, clock, 'short')).toBe('Answered 6 h late')
    expect(clockText(t, clock, 'long')).toBe('First response 6 h after the response deadline')
    expect(clockText(tPl, clock, 'short')).toBe('Odpowiedź 6 h po terminie')
    expect(clockText(tPl, clock, 'long')).toBe('Pierwsza odpowiedź udzielona 6 h po terminie')
  })

  it('says in Polish how long ago the deadline passed without repeating a word', () => {
    const clock = responseClock(ticketSummary(), Date.parse('2026-10-11T12:00:00Z'))
    expect(clockText(tPl, clock, 'long')).toBe('Termin pierwszej odpowiedzi minął 3 d temu')
  })

  it('settles a ticket closed unanswered after the deadline as a late close', () => {
    const late = ticketSummary({ status: 'CLOSED', closedAt: '2026-10-08T18:00:00Z', sla: breach })
    const clock = responseClock(late, now)
    expect(clock).toEqual({ kind: 'closedLate' })
    expect(clockEmphasis(clock)).toEqual({ color: 'fg.muted', fontWeight: 'normal' })
    expect(clockText(t, clock, 'short')).toBe('Closed unanswered, late')
    expect(clockText(t, clock, 'long')).toBe(
      'Closed without a first response, after the response deadline',
    )
    expect(clockText(tPl, clock, 'short')).toBe('Bez odpowiedzi, po terminie')
  })

  it('keeps the settled clocks within the deadline as they were', () => {
    const inTime = { ...breach, waitingSeconds: 2 * 3600, breached: false }
    const answered = ticketSummary({ firstResponseAt: '2026-10-08T10:00:00Z', sla: inTime })
    expect(clockText(t, responseClock(answered, now), 'short')).toBe('Answered in 2 h')
    const closed = ticketSummary({ closedAt: '2026-10-08T10:00:00Z', sla: inTime })
    expect(clockText(t, responseClock(closed, now), 'short')).toBe('Closed unanswered')
  })

  it('lights amber within the last hour, green while there is time and none once settled', () => {
    expect(clockLamp({ kind: 'due', seconds: 40 * 60, soon: true })).toBe('amber')
    expect(clockLamp({ kind: 'due', seconds: 3 * 3600, soon: false })).toBe('green')
    expect(clockLamp({ kind: 'answered', seconds: 3600 })).toBe('off')
    expect(clockLamp({ kind: 'answeredLate', seconds: 3600 })).toBe('off')
    expect(clockLamp({ kind: 'closedUnanswered' })).toBe('off')
    expect(clockLamp({ kind: 'closedLate' })).toBe('off')
  })
})

describe('customerClockText', () => {
  const raised = Date.parse('2026-10-08T08:00:00Z')
  const after = (seconds: number) => raised + seconds * 1000
  const pending = ticketSummary()
  const answered = (seconds: number) =>
    ticketSummary({
      firstResponseAt: '2026-10-08T09:00:00Z',
      sla: { responseDeadline: '2026-10-08T12:00:00Z', waitingSeconds: seconds, breached: false },
    })

  it('counts the wait for support from the creation by its largest unit, with no deadline', () => {
    expect(customerClockText(t, pending, after(30))).toBe(
      'Waiting for support for less than a minute',
    )
    expect(customerClockText(t, pending, after(60))).toBe('Waiting for support for 1 minute')
    expect(customerClockText(t, pending, after(3 * 3600 + 20 * 60))).toBe(
      'Waiting for support for 3 hours',
    )
    expect(customerClockText(t, pending, after(4 * 3600))).toBe('Waiting for support for 4 hours')
  })

  it('says calmly, past the SLA, that the wait is longer than support aim for', () => {
    expect(customerClockText(t, pending, after(17 * 86400 + 5 * 3600))).toBe(
      'Waiting for support for 17 days, longer than the 4 hours we aim for',
    )
    const withinAnHour = ticketSummary({
      sla: { ...pending.sla, responseDeadline: '2026-10-08T09:00:00Z' },
    })
    expect(customerClockText(t, withinAnHour, after(2 * 3600))).toBe(
      'Waiting for support for 2 hours, longer than the 1 hour we aim for',
    )
    const ninetyMinutes = ticketSummary({
      sla: { ...pending.sla, responseDeadline: '2026-10-08T09:30:00Z' },
    })
    expect(customerClockText(tPl, ninetyMinutes, after(2 * 3600))).toBe(
      'Czeka na zespół wsparcia od 2 godzin, dłużej niż zakładane 90 minut',
    )
    expect(customerClockText(tPl, withinAnHour, after(2 * 3600))).toBe(
      'Czeka na zespół wsparcia od 2 godzin, dłużej niż zakładana 1 godzina',
    )
  })

  it('says how soon support answered, or that the ticket closed before an answer', () => {
    expect(customerClockText(t, answered(3600), after(86400))).toBe('Answered after 1 hour')
    expect(customerClockText(t, answered(40), after(86400))).toBe('Answered within a minute')
    const closed = ticketSummary({ closedAt: '2026-10-08T09:00:00Z' })
    expect(customerClockText(t, closed, after(86400))).toBe('Closed before support answered')
  })

  it('stops counting the wait once support set the unanswered ticket aside', () => {
    const awaitsCustomer = ticketSummary({ status: 'WAITING_FOR_CUSTOMER' })
    expect(customerClockText(t, awaitsCustomer, after(86400))).toBeNull()
    const resolved = ticketSummary({ status: 'RESOLVED' })
    expect(customerClockText(t, resolved, after(86400))).toBe('Resolved before support answered')
    expect(customerClockText(tPl, resolved, after(86400))).toBe('Rozwiązane przed odpowiedzią')
  })

  it('inflects the Polish count in each of its forms', () => {
    const days = (count: number) => customerClockText(tPl, pending, after(count * 86400))
    expect(days(1)).toBe('Czeka na zespół wsparcia od 1 dnia, dłużej niż zakładane 4 godziny')
    expect(days(3)).toBe('Czeka na zespół wsparcia od 3 dni, dłużej niż zakładane 4 godziny')
    expect(days(17)).toBe('Czeka na zespół wsparcia od 17 dni, dłużej niż zakładane 4 godziny')
    expect(customerClockText(tPl, answered(2 * 3600), after(86400))).toBe(
      'Odpowiedź po 2 godzinach',
    )
    expect(customerClockText(tPl, answered(5 * 60), after(86400))).toBe('Odpowiedź po 5 minutach')
    expect(customerClockText(tPl, answered(22 * 3600), after(86400))).toBe(
      'Odpowiedź po 22 godzinach',
    )
  })
})

describe('customerCommentText', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')

  it('says how long ago the unanswered customer comment was written, and nothing without one', () => {
    expect(customerCommentText(t, ticketSummary(), now)).toBeNull()
    const commented = (at: string) => ticketSummary({ unansweredCustomerCommentAt: at })
    expect(customerCommentText(t, commented('2026-10-09T11:40:00Z'), now)).toBe(
      'Customer wrote 20 min ago',
    )
    expect(customerCommentText(t, commented('2026-10-09T11:59:30Z'), now)).toBe(
      'Customer wrote just now',
    )
    expect(customerCommentText(tPl, commented('2026-10-07T08:00:00Z'), now)).toBe(
      'Klient napisał 2 d temu',
    )
  })
})

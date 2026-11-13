import { describe, expect, it } from 'vitest'
import { NetworkError, ProblemError } from '../../api/errors.ts'
import i18n from '../../i18n/index.ts'
import { fieldCode, fieldMessage, problemMessage } from './ticket-problems.ts'

const t = i18n.getFixedT('en', 'common')
const tPl = i18n.getFixedT('pl', 'common')

const problem = (
  slug: string,
  status: number,
  errors: Array<{ field: string; code: string }> = [],
) =>
  new ProblemError({
    type: `https://retrofit.app/problems/${slug}`,
    status,
    errors: errors.map((error) => ({ ...error, message: '' })),
  })

describe('fieldMessage', () => {
  it('explains each known code and never calls an unknown one required', () => {
    expect(fieldMessage(t, 'field.required')).toBe('This field is required.')
    expect(fieldMessage(t, 'field.too-long')).toBe('This text is too long.')
    expect(fieldMessage(t, 'field.invalid')).toBe(
      'This text contains a character that is not allowed.',
    )
    expect(fieldMessage(tPl, 'field.invalid')).toBe('Ten tekst zawiera niedozwolony znak.')
    expect(fieldMessage(t, 'field.newer-than-this-bundle')).toBe(
      'Something went wrong. Please try again.',
    )
  })

  it('explains a link to the ticket itself', () => {
    expect(fieldMessage(t, 'linkedReference.self')).toBe('A ticket cannot be linked to itself.')
    expect(fieldMessage(tPl, 'linkedReference.self')).toBe(
      'Zgłoszenia nie można powiązać z nim samym.',
    )
  })
})

describe('problemMessage', () => {
  it('explains known slugs and falls back to the generic error', () => {
    expect(problemMessage(t, problem('ticket/already-closed', 409))).toBe(
      t('tickets.problems.alreadyClosed'),
    )
    expect(problemMessage(t, problem('idempotency/key-reused', 422))).toBe(
      t('tickets.problems.keyReused'),
    )
    expect(problemMessage(t, problem('something/new', 400))).toBe(t('errors.generic'))
    expect(problemMessage(t, new Error('unexpected'))).toBe(t('errors.generic'))
  })

  it('tells an unreachable server apart from a refusal', () => {
    expect(problemMessage(t, new NetworkError(new TypeError('Failed to fetch')))).toBe(
      'Retrofit cannot be reached. Check your connection and try again.',
    )
  })
})

describe('fieldCode', () => {
  it('reads the code of a validation error on the field', () => {
    const error = problem('validation', 422, [{ field: 'body', code: 'field.invalid' }])
    expect(fieldCode(error, 'body')).toBe('field.invalid')
    expect(fieldCode(error, 'title')).toBeUndefined()
  })
})

import type { TFunction } from 'i18next'
import { fallbackErrorKey, ProblemError } from '../../api/errors.ts'

// Problem type slugs and field codes are open strings in the contract, so these
// maps cannot be exhaustive: anything they do not name reads as the generic error.
const PROBLEM_KEYS: Record<string, string | undefined> = {
  'ticket/closed': 'tickets.problems.closed',
  'ticket/already-closed': 'tickets.problems.alreadyClosed',
  'ticket/not-resolved': 'tickets.problems.notResolved',
  'ticket/forbidden': 'tickets.problems.forbidden',
  'ticket/not-editable': 'tickets.problems.notEditable',
  'idempotency/key-reused': 'tickets.problems.keyReused',
}

const FIELD_CODE_KEYS: Record<string, string | undefined> = {
  'field.required': 'errors.field.required',
  'field.too-long': 'errors.field.too-long',
  'field.invalid': 'errors.field.invalid',
  'linkedReference.self': 'tickets.links.self',
  'status.not-allowed': 'tickets.editor.statusNotAllowed',
  'resolution.not-resolved': 'tickets.editor.resolutionNotResolved',
}

/** Why a ticket write was refused, as a sentence for the reader. */
export function problemMessage(t: TFunction, error: Error): string {
  const key = error instanceof ProblemError ? PROBLEM_KEYS[error.slug] : undefined
  return t(key ?? fallbackErrorKey(error))
}

/** What is wrong with one field, from its `errors[].code`. */
export function fieldMessage(t: TFunction, code: string): string {
  return t(FIELD_CODE_KEYS[code] ?? 'errors.generic')
}

/** The code of the first validation error on `field`, if the refusal names one. */
export function fieldCode(error: Error, field: string): string | undefined {
  if (!(error instanceof ProblemError) || error.status !== 422) return undefined
  return error.fieldErrors.find((fieldError) => fieldError.field === field)?.code
}

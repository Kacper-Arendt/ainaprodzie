import type { components } from './types.gen.ts'

export type ProblemDetail = components['schemas']['ProblemDetail']

export interface FieldError {
  field: string
  // Stable machine-readable violation code (e.g. 'language.unknown'): the only
  // thing the UI is allowed to branch on. `message` is English developer-facing
  // text that may be reworded at any time.
  code: string
  message: string
}

// RFC-7807 body as the backend serializes it: ProblemDetail plus the `errors[]`
// extension member that ProblemDetailAdvice emits for validation failures.
export type ProblemBody = ProblemDetail & { errors?: FieldError[] }

const TYPE_PREFIX = '/problems/'

export class ProblemError extends Error {
  readonly problem: ProblemBody
  readonly status: number
  readonly slug: string
  readonly fieldErrors: FieldError[]

  constructor(problem: ProblemBody) {
    super(problem.detail ?? problem.title ?? `Request failed (${problem.status})`)
    this.name = 'ProblemError'
    this.problem = problem
    this.status = problem.status ?? 0
    this.fieldErrors = problem.errors ?? []
    const type = problem.type ?? ''
    const at = type.indexOf(TYPE_PREFIX)
    this.slug = at >= 0 ? type.slice(at + TYPE_PREFIX.length) : type
  }
}

/**
 * The request got no answer at all: the server is down or out of reach, or the
 * connection dropped on the way. Distinct from a `ProblemError`, which is an
 * answer, so the reader is told to check the connection rather than retry blind.
 */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('The server could not be reached', { cause })
    this.name = 'NetworkError'
  }
}

/** The message key for a failure no feature explains: an unreachable server, or anything else. */
export function fallbackErrorKey(error: unknown): 'errors.network' | 'errors.generic' {
  return error instanceof NetworkError ? 'errors.network' : 'errors.generic'
}

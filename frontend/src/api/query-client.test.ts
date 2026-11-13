import { describe, expect, it } from 'vitest'
import { ProblemError } from './errors.ts'
import { createQueryClient } from './query-client.ts'

describe('createQueryClient', () => {
  it('never retries an answered 4xx or a mutation, and retries a 5xx or network failure twice', () => {
    const defaults = createQueryClient().getDefaultOptions()
    const retry = defaults.queries?.retry
    if (typeof retry !== 'function') throw new Error('query retry must be a function')

    const unauthenticated = new ProblemError({ status: 401 })
    const notFound = new ProblemError({ status: 404 })
    const serverError = new ProblemError({ status: 503 })
    const offline = new TypeError('Failed to fetch')

    expect(retry(0, unauthenticated)).toBe(false)
    expect(retry(0, notFound)).toBe(false)
    expect([0, 1, 2].map((count) => retry(count, serverError))).toEqual([true, true, false])
    expect([0, 1, 2].map((count) => retry(count, offline))).toEqual([true, true, false])
    expect(defaults.mutations?.retry).toBe(false)
  })
})

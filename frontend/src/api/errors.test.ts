import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './client.ts'
import { ProblemError } from './errors.ts'

describe('ProblemError', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes the field errors of a validation problem', () => {
    const error = new ProblemError({
      type: 'https://retrofit.app/problems/validation',
      title: 'Validation failed',
      status: 422,
      errors: [{ field: 'language', code: 'language.unknown', message: 'unknown language' }],
    })

    expect(error.slug).toBe('validation')
    expect(error.status).toBe(422)
    expect(error.fieldErrors).toEqual([
      { field: 'language', code: 'language.unknown', message: 'unknown language' },
    ])
  })

  it('falls back to a generic ProblemError with the status for a non-JSON error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>Bad gateway</html>', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    )

    const error: unknown = await api('/api/meta').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProblemError)
    const problem = error as ProblemError
    expect(problem.status).toBe(502)
    expect(problem.problem.type).toBe('about:blank')
    expect(problem.fieldErrors).toEqual([])
  })
})

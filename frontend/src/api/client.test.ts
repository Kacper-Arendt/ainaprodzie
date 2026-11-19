import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, requestHeaders } from './client.ts'
import { NetworkError, ProblemError } from './errors.ts'
import { jsonResponse as harnessResponse, stubFetch } from '../test/harness.tsx'

function jsonResponse(status: number, body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } })
}

describe('api client', () => {
  beforeEach(() => {
    document.cookie = 'XSRF-TOKEN=csrf-123'
  })

  afterEach(() => {
    document.cookie = 'XSRF-TOKEN=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    vi.unstubAllGlobals()
  })

  it('sends same-origin credentials and the CSRF header on mutating requests only', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, {})))
    vi.stubGlobal('fetch', fetchMock)

    await api('/api/auth/session')
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      await api('/api/auth/language', { method, body: { language: 'pl' } })
    }

    const inits = fetchMock.mock.calls.map(([, init]) => init as RequestInit)
    expect(inits.every((init) => init.credentials === 'same-origin')).toBe(true)
    expect(new Headers(inits[0].headers).has('X-XSRF-TOKEN')).toBe(false)
    for (const init of inits.slice(1)) {
      expect(new Headers(init.headers).get('X-XSRF-TOKEN')).toBe('csrf-123')
    }
  })

  it('sends custom headers next to the CSRF and Content-Type headers', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, {})))
    vi.stubGlobal('fetch', fetchMock)

    await api('/api/tickets', {
      method: 'POST',
      body: { title: 'Export fails' },
      headers: { 'Idempotency-Key': 'key-1', 'If-Match': '"3"' },
    })
    await api('/api/tickets/RET-1')

    const [post, get] = fetchMock.mock.calls.map(
      ([, init]) => new Headers((init as RequestInit).headers),
    )
    expect(post.get('Idempotency-Key')).toBe('key-1')
    expect(post.get('If-Match')).toBe('"3"')
    expect(post.get('X-XSRF-TOKEN')).toBe('csrf-123')
    expect(post.get('Content-Type')).toBe('application/json')
    expect(get.has('Content-Type')).toBe(false)
    expect(get.has('X-XSRF-TOKEN')).toBe(false)
  })

  it('builds the same headers for a caller that runs its own fetch', () => {
    const post = requestHeaders('POST', { json: true, headers: { Accept: 'text/event-stream' } })
    const del = requestHeaders('DELETE')
    const get = requestHeaders('GET', { json: true })

    expect(post.get('Content-Type')).toBe('application/json')
    expect(post.get('X-XSRF-TOKEN')).toBe('csrf-123')
    expect(post.get('Accept')).toBe('text/event-stream')
    expect(del.get('X-XSRF-TOKEN')).toBe('csrf-123')
    expect(del.has('Content-Type')).toBe(false)
    expect(get.has('X-XSRF-TOKEN')).toBe(false)
  })

  it("lets the test harness record each request's headers", async () => {
    const calls = stubFetch([['/api/tickets', () => harnessResponse({})]])

    await api('/api/tickets', { method: 'POST', body: {}, headers: { 'Idempotency-Key': 'key-2' } })
    await api('/api/tickets')

    expect(calls[0].headers.get('Idempotency-Key')).toBe('key-2')
    expect(calls[0].headers.get('X-XSRF-TOKEN')).toBe('csrf-123')
    expect(calls[1].headers.has('Idempotency-Key')).toBe(false)
  })

  it('turns a problem+json error into a ProblemError carrying status and body', async () => {
    const body = {
      type: 'https://retrofit.app/problems/auth/invalid-credentials',
      title: 'Invalid credentials',
      status: 401,
      detail: 'Invalid email or password.',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, body, 'application/problem+json')),
    )

    const error: unknown = await api('/api/auth/login', {
      method: 'POST',
      body: { email: '', password: '' },
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProblemError)
    const problem = error as ProblemError
    expect(problem.status).toBe(401)
    expect(problem.slug).toBe('auth/invalid-credentials')
    expect(problem.problem).toEqual(body)
  })

  it('falls back to a synthetic problem when the JSON error body is not an object', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(502, null)))

    const error: unknown = await api('/api/meta').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProblemError)
    expect((error as ProblemError).status).toBe(502)
  })

  it('rejects a non-JSON success body with a ProblemError rather than a SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>captive portal</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    )

    const error: unknown = await api('/api/meta').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ProblemError)
  })

  it('sends no CSRF header when the cookie value cannot be decoded', async () => {
    document.cookie = 'XSRF-TOKEN=%E0%A4%A'
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await api('/api/auth/logout', { method: 'POST' })

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).has('X-XSRF-TOKEN')).toBe(false)
  })

  it('resolves a 204 with no body to undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    const result = await api('/api/auth/logout', { method: 'POST' })

    expect(result).toBeUndefined()
  })

  it('rejects with a NetworkError when no answer arrives', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(api('/api/tickets')).rejects.toBeInstanceOf(NetworkError)
  })
})

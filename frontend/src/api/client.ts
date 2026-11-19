import { NetworkError, ProblemError } from './errors.ts'
import type { ProblemBody } from './errors.ts'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const CSRF_COOKIE = 'XSRF-TOKEN'
const CSRF_HEADER = 'X-XSRF-TOKEN'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiOptions {
  method?: HttpMethod
  body?: unknown
  headers?: Record<string, string>
}

function readCookie(name: string): string | undefined {
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(`${name}=`))
  if (!entry) return undefined
  try {
    return decodeURIComponent(entry.slice(name.length + 1))
  } catch {
    // A mangled cookie is no token: the request goes out without the header
    // and the server answers its usual 403.
    return undefined
  }
}

function syntheticProblem(response: Response): ProblemError {
  return new ProblemError({
    type: 'about:blank',
    title: response.statusText,
    status: response.status,
  })
}

async function toProblemError(response: Response): Promise<ProblemError> {
  if (!response.headers.get('Content-Type')?.includes('json')) {
    return syntheticProblem(response)
  }
  try {
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null
      ? new ProblemError(body as ProblemBody)
      : syntheticProblem(response)
  } catch {
    return syntheticProblem(response)
  }
}

/**
 * The headers every API request carries: `Content-Type` for a JSON body and,
 * on a mutating method, the CSRF header from its cookie. `api()` calls it, and
 * so does a caller that has to run `fetch` itself, such as the chat's stream.
 */
export function requestHeaders(
  method: HttpMethod,
  options: { json?: boolean; headers?: Record<string, string> } = {},
): Headers {
  const headers = new Headers(options.headers)
  if (options.json) {
    headers.set('Content-Type', 'application/json')
  }
  if (MUTATING_METHODS.has(method)) {
    const token = readCookie(CSRF_COOKIE)
    if (token) {
      headers.set(CSRF_HEADER, token)
    }
  }
  return headers
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers = requestHeaders(method, {
    json: options.body !== undefined,
    headers: options.headers,
  })
  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch (error) {
    // fetch rejects only when no answer arrived at all.
    throw new NetworkError(error)
  }
  if (!response.ok) {
    throw await toProblemError(response)
  }
  // A success may carry no body (204 on a logout), and an empty body is not
  // parseable JSON, so the text is read first. A body that is not JSON at all
  // (a proxy or captive-portal page answering 200) is not what the API sends.
  const text = await response.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw syntheticProblem(response)
  }
}

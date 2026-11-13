import { QueryClient } from '@tanstack/react-query'

import { ProblemError } from './errors.ts'

/**
 * Retry rules stated by what the answer was:
 *
 *  - an answered 4xx is never retried. A 401 is what `SessionGate` reads to
 *    redirect, a 403 and a 404 are verdicts, and asking again changes none of
 *    them; retrying would only delay the redirect by the backoff;
 *  - a 5xx or an unreachable network is retried twice, which covers a restart
 *    and a lost packet without turning an outage into a long spinner;
 *  - mutations are never retried, because not all of them are idempotent.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          !(error instanceof ProblemError && error.status < 500) && failureCount < 2,
      },
      mutations: { retry: false },
    },
  })
}

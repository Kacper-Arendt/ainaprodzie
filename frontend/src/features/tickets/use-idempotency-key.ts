import { useCallback, useRef } from 'react'

/**
 * One `Idempotency-Key` per submitted payload. Submitting the same payload
 * again after a failure (a timeout, a lost answer) reuses the key, so the
 * server replays the first outcome instead of writing twice. A changed payload
 * is a new request and draws a new key, because the server refuses a reused
 * key with a different body. `clear` after a success starts over.
 */
export function useIdempotencyKey() {
  const last = useRef<{ payload: string; key: string } | null>(null)

  const keyFor = useCallback((payload: unknown): string => {
    const serialized = JSON.stringify(payload)
    if (last.current?.payload !== serialized) {
      last.current = { payload: serialized, key: crypto.randomUUID() }
    }
    return last.current.key
  }, [])

  const clear = useCallback(() => {
    last.current = null
  }, [])

  return { keyFor, clear }
}

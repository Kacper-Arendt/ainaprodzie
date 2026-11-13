import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useIdempotencyKey } from './use-idempotency-key.ts'

describe('useIdempotencyKey', () => {
  it('reuses the key for the same payload and draws a fresh one for a changed payload', () => {
    const { result } = renderHook(() => useIdempotencyKey())

    const first = result.current.keyFor({ title: 'Export broken' })
    expect(result.current.keyFor({ title: 'Export broken' })).toBe(first)

    const changed = result.current.keyFor({ title: 'Export is broken' })
    expect(changed).not.toBe(first)
    expect(result.current.keyFor({ title: 'Export broken' })).not.toBe(first)
  })

  it('draws a fresh key for the same payload once the last one succeeded', () => {
    const { result } = renderHook(() => useIdempotencyKey())

    const first = result.current.keyFor({ body: 'Thanks' })
    result.current.clear()

    expect(result.current.keyFor({ body: 'Thanks' })).not.toBe(first)
  })
})

import { describe, expect, it } from 'vitest'
import { safeNextPath } from './next-path.ts'

describe('safeNextPath', () => {
  it('keeps a same-origin relative path and sends anything else home', () => {
    expect(safeNextPath('/tickets?x=1')).toBe('/tickets?x=1')
    for (const raw of [
      '//evil.test',
      '//evil.test:99999999',
      '/\\evil',
      'https://evil.test',
      'evil',
      '',
      null,
    ]) {
      expect(safeNextPath(raw)).toBe('/')
    }
  })

  it('sends home a path that a control character turns protocol-relative', () => {
    // `?next=/%09/evil.com` arrives decoded; the URL parser strips the tab or
    // newline and reads `//evil.com`.
    for (const raw of ['/\t/evil.com', '/\n/evil.com', decodeURIComponent('/%09/evil.com')]) {
      expect(safeNextPath(raw)).toBe('/')
    }
  })

  it('keeps the hash and normalises the path of a same-origin target', () => {
    expect(safeNextPath('/tickets/../home?a=1#top')).toBe('/home?a=1#top')
  })
})

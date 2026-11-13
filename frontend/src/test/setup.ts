// Before `i18n/index.ts`, whose language detector probes `localStorage` on the
// very first import and memoizes the answer for the process.
import './local-storage.ts'
import { afterEach, expect } from 'vitest'
import { cleanup } from '@testing-library/react'

import i18n from '../i18n/index.ts'

// `i18n-keys.test.ts` proves the bundles agree, but a key built at runtime (a
// role label, for one) is invisible to any static scan. A missing one renders
// as its own raw key and ships. This turns any such miss, in any test that
// renders the offending screen, into a failure of that test. A call that names
// its own `defaultValue` has already said what to render when the key is
// absent, so it is not a raw-key render and is not reported.
const missingKeys: string[] = []
void i18n.init({
  saveMissing: true,
  missingKeyHandler: (_languages, namespace, key, _fallback, _updateMissing, options) => {
    if (options?.defaultValue === undefined) missingKeys.push(`${namespace}:${key}`)
  },
})

// Pinned rather than detected, so the suite reads English whatever the runner's
// navigator reports. Polish rendering is proven by the specs that ask for it.
// `changeLanguage`, not a second `init({ lng })`: a live detector overrides
// `lng` and would carry this pin off with it.
await i18n.changeLanguage('en')

// jsdom does not implement the media/layout APIs Chakra UI v3 touches on render.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

if (!('ResizeObserver' in window)) {
  // Plain assignment, not vi.stubGlobal: tests calling vi.unstubAllGlobals()
  // must not strip the polyfill while popper RAF callbacks are still queued.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(window as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
}

// A select scrolls its list back to the top when its value changes. On a slow
// runner that lands while the test still runs, and the missing method throws an
// unhandled `TypeError` that fails the run with every test green.
if (typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = () => {}
}

// jsdom does no layout, so it has no `scrollIntoView` either.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}

afterEach(async () => {
  cleanup()
  // A comment draft outlives its page in session storage, so one test's draft
  // would open in the next test's composer.
  sessionStorage.clear()
  // Unmounting a dialog deactivates its focus trap, which returns focus from a
  // `setTimeout(fn, 0)` rather than inline. On the last test of a file that
  // timer would otherwise fire after vitest has torn the jsdom environment
  // down, and the callback's `document` lookup throws an unhandled
  // `ReferenceError` that fails the whole run with every test green. One
  // macrotask here lets it run while there is still a document to run against.
  await new Promise((resolve) => setTimeout(resolve, 0))
  const seen = [...new Set(missingKeys)]
  missingKeys.length = 0
  expect(seen, 'translation keys that rendered as raw keys').toEqual([])
})

import { afterEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { onlineManager } from '@tanstack/react-query'
import '../../i18n/index.ts'
import { OfflineNotice } from './offline-notice.tsx'
import { Provider } from './provider.tsx'

describe('OfflineNotice', () => {
  afterEach(() => onlineManager.setOnline(true))

  it('explains the wait while offline, inside a live region that is always there', () => {
    render(
      <Provider>
        <OfflineNotice />
      </Provider>,
    )
    const region = screen.getByRole('status')
    expect(region.textContent).toBe('')

    act(() => onlineManager.setOnline(false))
    expect(region.textContent).toContain('You are offline.')

    act(() => onlineManager.setOnline(true))
    expect(region.textContent).toBe('')
  })
})

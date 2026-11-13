import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '../../i18n/index.ts'
import { Provider } from './provider.tsx'
import { LanguageSelector } from './language-selector.tsx'

describe('LanguageSelector', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('presses the active language segment and only that one', () => {
    render(
      <Provider>
        <LanguageSelector />
      </Provider>,
    )

    expect(screen.getByRole('group', { name: 'Language' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByRole('button', { name: 'Polski' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('switches the UI to Polish and reports the change once', async () => {
    const onLanguageChange = vi.fn()
    render(
      <Provider>
        <LanguageSelector onLanguageChange={onLanguageChange} />
      </Provider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Polski' }))

    expect(i18n.resolvedLanguage).toBe('pl')
    expect(onLanguageChange).toHaveBeenCalledTimes(1)
    expect(onLanguageChange).toHaveBeenCalledWith('pl')
    expect(screen.getByRole('group', { name: 'Język' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Polski' }).getAttribute('aria-pressed')).toBe('true')
  })
})

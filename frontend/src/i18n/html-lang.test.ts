import { afterEach, expect, test } from 'vitest'
import i18n from './index.ts'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

test('the document language follows a language change', async () => {
  await i18n.changeLanguage('pl')
  expect(document.documentElement.lang).toBe('pl')

  await i18n.changeLanguage('en')
  expect(document.documentElement.lang).toBe('en')
})

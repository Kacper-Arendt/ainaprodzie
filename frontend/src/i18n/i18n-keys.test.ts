import { describe, expect, it } from 'vitest'
import en from './en/common.json'
import pl from './pl/common.json'

const flatten = (node: unknown, prefix = ''): Array<[string, unknown]> => {
  if (typeof node !== 'object' || node === null) return [[prefix, node]]
  return Object.entries(node).flatMap(([key, value]) =>
    flatten(value, prefix ? `${prefix}.${key}` : key),
  )
}

// i18next's plural suffixes; each language has its own set (en one/other, pl one/few/many/other).
const PLURAL = /_(zero|one|two|few|many|other)$/

describe('common translation bundles', () => {
  it('have identical key sets in en and pl, a plural family counting as its base key', () => {
    const keys = (bundle: unknown) =>
      [...new Set(flatten(bundle).map(([key]) => key.replace(PLURAL, '')))].sort()

    expect(keys(pl)).toEqual(keys(en))
  })

  it.each([
    ['en', en],
    ['pl', pl],
  ])('give every plural key in %s each form its language needs', (language, bundle) => {
    const forms = new Intl.PluralRules(language).resolvedOptions().pluralCategories
    const keys = flatten(bundle).map(([key]) => key)
    const bases = new Set(
      keys.filter((key) => PLURAL.test(key)).map((key) => key.replace(PLURAL, '')),
    )
    const missing = [...bases].flatMap((base) =>
      forms.filter((form) => !keys.includes(`${base}_${form}`)).map((form) => `${base}_${form}`),
    )

    expect(missing).toEqual([])
  })

  it('have no empty values', () => {
    const empty = [
      ...flatten(en).map(([k, v]) => [`en:${k}`, v]),
      ...flatten(pl).map(([k, v]) => [`pl:${k}`, v]),
    ]
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([key]) => key)

    expect(empty).toEqual([])
  })
})

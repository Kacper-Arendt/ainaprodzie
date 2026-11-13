import { chakra, Flex } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { activeLanguage, LANGUAGES, type AppLanguage } from '../../i18n/index.ts'

// Endonyms, never translated: a reader who cannot read the language the UI
// currently speaks still has to find their own. A `Record` over the supported
// set, so a new language is a compile error here rather than one the selector
// silently cannot offer (standards/frontend/spa-architecture.md).
const LANGUAGE_NAMES: Record<AppLanguage, string> = { en: 'English', pl: 'Polski' }

/**
 * The EN/PL switch. Its value is the active i18n language rather than local
 * state, so every mount agrees. A signed-in mount passes `onLanguageChange`
 * to also tell the server; the UI has already switched when it runs.
 */
export function LanguageSelector(props: { onLanguageChange?: (language: AppLanguage) => void }) {
  const { t, i18n } = useTranslation('common')
  const active = activeLanguage(i18n)

  const select = async (language: AppLanguage) => {
    await i18n.changeLanguage(language)
    props.onLanguageChange?.(language)
  }

  return (
    <Flex
      role="group"
      aria-label={t('language.label')}
      display="inline-flex"
      borderWidth="ink"
      borderColor="border.control"
      borderRadius="control"
      overflow="hidden"
      bg="bg.panel"
      fontFamily="mono"
      fontSize="12px"
      fontWeight="600"
      letterSpacing="0.05em"
    >
      {LANGUAGES.map((language) => {
        const pressed = language === active
        return (
          <chakra.button
            key={language}
            type="button"
            lang={language}
            aria-label={LANGUAGE_NAMES[language]}
            aria-pressed={pressed}
            px="10px"
            py="5px"
            cursor="pointer"
            color={pressed ? 'bg.panel' : 'fg.muted'}
            bg={pressed ? 'fg' : 'transparent'}
            _hover={pressed ? undefined : { bg: 'bg.subtle', color: 'fg' }}
            _focusVisible={{
              outline: '2px solid',
              outlineColor: 'accent.focusRing',
              outlineOffset: '-2px',
            }}
            onClick={() => void select(language)}
          >
            {language.toUpperCase()}
          </chakra.button>
        )
      })}
    </Flex>
  )
}

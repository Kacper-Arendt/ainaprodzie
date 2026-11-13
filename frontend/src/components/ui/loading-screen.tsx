import { Center, Spinner } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'

/** Full-screen placeholder while the session probe decides what to render. */
export function LoadingScreen() {
  const { t } = useTranslation('common')
  return (
    <Center minH="100vh" role="status" aria-label={t('loading')}>
      <Spinner color="accent.solid" />
    </Center>
  )
}

import { Text } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '../../components/ui/empty-state.tsx'

/** The empty conversation: what the chat is for. */
export function ChatEmpty() {
  const { t } = useTranslation('chat')
  return (
    <EmptyState title={t('empty.title')} titleAs="h3">
      <Text fontSize="14px">{t('empty.hint')}</Text>
    </EmptyState>
  )
}

import { Button } from '@chakra-ui/react'
import { Link as RouterLink } from 'react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../../components/ui/page-header.tsx'
import { useSession } from '../auth/use-auth.ts'
import { TicketList } from '../tickets/ticket-list.tsx'

/** The queue: the page opens on the ticket list, the work of every visit after the first. */
export function HomePage() {
  const { t } = useTranslation('common')
  const session = useSession()
  const isSupport = session.data?.roles.includes('SUPPORT') === true

  return (
    <>
      <PageHeader
        title={t('tickets.title')}
        subtitle={t(isSupport ? 'home.introSupport' : 'home.introCustomer')}
        actions={
          isSupport ? undefined : (
            <Button asChild colorPalette="accent">
              <RouterLink to="/tickets/new">{t('tickets.new.heading')}</RouterLink>
            </Button>
          )
        }
      />
      <TicketList />
    </>
  )
}

import { Text } from '@chakra-ui/react'
import { useTranslation } from 'react-i18next'
import type { SessionUser } from '../auth/use-auth.ts'
import { useOrganizations, useTeams } from './use-organization.ts'

interface CallerAffiliationProps {
  id: SessionUser['id']
  roles: SessionUser['roles']
}

/**
 * One header line naming the customer's organization or the support user's
 * team. Only the endpoint the caller may use is requested, so a customer
 * never triggers a 403 on `/api/teams`. From `sm` up the line keeps one slot
 * (up to 240px) in every state (loading, empty, shown) so the header never
 * shifts. On a phone it sits at the trailing end of its own line, so it takes
 * only the width of its text and leaves the room to the name.
 */
export function CallerAffiliation({ id, roles }: CallerAffiliationProps) {
  const { t } = useTranslation('common')
  const support = roles.includes('SUPPORT')
  const organizations = useOrganizations(id, !support)
  const teams = useTeams(id, support)

  const query = support ? teams : organizations
  let text = ''
  if (support) {
    const team = teams.data?.find((candidate) => candidate.member)
    if (team) text = t('shell.team', { name: team.name })
  } else {
    const organization = organizations.data?.[0]
    if (organization) text = t('shell.organization', { name: organization.name })
  }
  const state = query.isPending ? 'loading' : text ? 'shown' : 'empty'

  return (
    <Text
      as="small"
      display="block"
      data-testid="caller-affiliation"
      data-state={state}
      title={text || undefined}
      color="fg.muted"
      fontSize="12px"
      lineHeight="18px"
      minH="18px"
      w={{ base: 'auto', sm: '240px' }}
      maxW="100%"
      ms="auto"
      truncate
    >
      {text}
    </Text>
  )
}

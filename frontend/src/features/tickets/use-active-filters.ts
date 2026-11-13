import { useTranslation } from 'react-i18next'
import { useOrganizations, useTeams } from '../organization/use-organization.ts'
import {
  ATTENTION_KEYS,
  CATEGORY_KEYS,
  label,
  PRIORITY_KEYS,
  STATUS_KEYS,
} from './ticket-labels.ts'
import type { TicketListFilters } from './ticket-list-filters.ts'

/** One filter narrowing the list, named as the reader picked it, and the patch that lifts it. */
export interface ActiveFilter {
  key: string
  label: string
  remove: Partial<TicketListFilters>
}

/**
 * The filters that narrow the list, in the order of the filter fields, each
 * status on its own so it can be lifted alone. A team, organization or person
 * the reader cannot name reads as loading while the options load, and as
 * unknown after, as in the filter's own select.
 */
export function useActiveFilters(
  filters: TicketListFilters,
  userId: string,
  isSupport: boolean,
): ActiveFilter[] {
  const { t } = useTranslation('common')
  const organizations = useOrganizations(userId, isSupport)
  const teams = useTeams(userId, isSupport)
  const unnamed = (pending: boolean) => (pending ? t('loading') : t('tickets.filters.unknown'))

  const teamName = (id: string) => {
    const team = teams.data?.find((candidate) => candidate.id === id)
    if (team?.member) return t('tickets.filters.myTeam')
    return team?.name ?? unnamed(teams.isPending)
  }
  const personName = (id: string) =>
    id === userId
      ? t('tickets.filters.me')
      : ((teams.data ?? []).flatMap((team) => team.members).find((person) => person.id === id)
          ?.name ?? unnamed(teams.isPending))
  const organizationName = (id: string) =>
    organizations.data?.find((organization) => organization.id === id)?.name ??
    unnamed(organizations.isPending)

  const active: ActiveFilter[] = []
  const add = (key: string, name: string, value: string, remove: Partial<TicketListFilters>) =>
    active.push({ key, label: t('tickets.filters.active.chip', { name, value }), remove })

  const { status, category, priority, organizationId, teamId, assigneeId, slaBreached } = filters
  for (const value of status) {
    add(`status-${value}`, t('tickets.filters.status'), label(t, STATUS_KEYS, value), {
      status: status.filter((other) => other !== value),
    })
  }
  if (category !== undefined) {
    add('category', t('tickets.filters.category'), label(t, CATEGORY_KEYS, category), {
      category: undefined,
    })
  }
  if (priority !== undefined) {
    add('priority', t('tickets.filters.priority'), label(t, PRIORITY_KEYS, priority), {
      priority: undefined,
    })
  }
  if (organizationId !== undefined) {
    add('organization', t('tickets.filters.organization'), organizationName(organizationId), {
      organizationId: undefined,
    })
  }
  if (teamId !== undefined) {
    add('team', t('tickets.filters.team'), teamName(teamId), { teamId: undefined })
  }
  if (assigneeId !== undefined) {
    add('assignee', t('tickets.filters.assignee'), personName(assigneeId), {
      assigneeId: undefined,
    })
  }
  if (slaBreached !== undefined) {
    const value = t(slaBreached ? 'tickets.filters.breached' : 'tickets.filters.withinSla')
    add('sla', t('tickets.filters.sla'), value, { slaBreached: undefined })
  }
  if (filters.attention !== undefined) {
    add('attention', t('tickets.filters.attention'), label(t, ATTENTION_KEYS, filters.attention), {
      attention: undefined,
    })
  }
  // The author has no field of its own, only the customer's view of that name.
  if (filters.authorId !== undefined) {
    active.push({
      key: 'author',
      label: t('tickets.views.raisedByMe'),
      remove: { authorId: undefined },
    })
  }
  return active
}

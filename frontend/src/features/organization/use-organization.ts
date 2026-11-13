import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client.ts'
import type { components, paths } from '../../api/types.gen.ts'

type Organization = components['schemas']['Organization']
export type Team = components['schemas']['Team']
export type TeamMember = components['schemas']['TeamMember']

const ORGANIZATIONS_PATH = '/api/organizations' satisfies keyof paths
const TEAMS_PATH = '/api/teams' satisfies keyof paths

// Keyed by the session user, so another account in the same tab never reads
// this one's cached affiliation.
const organizationKeys = {
  list: (userId: string) => ['organizations', userId] as const,
  teams: (userId: string) => ['teams', userId] as const,
}

export function useOrganizations(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: organizationKeys.list(userId),
    queryFn: () => api<Organization[]>(ORGANIZATIONS_PATH),
    enabled,
  })
}

export function useTeams(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: organizationKeys.teams(userId),
    queryFn: () => api<Team[]>(TEAMS_PATH),
    enabled,
  })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client.ts'
import type { components, paths } from '../../api/types.gen.ts'
import type { AppLanguage } from '../../i18n/index.ts'

export type SessionUser = components['schemas']['SessionUser']
type LoginRequest = components['schemas']['LoginRequest']
type LanguageRequest = components['schemas']['LanguageRequest']

// `satisfies keyof paths`: a path the contract does not have fails typecheck.
const LOGIN_PATH = '/api/auth/login' satisfies keyof paths
const LOGOUT_PATH = '/api/auth/logout' satisfies keyof paths
const SESSION_PATH = '/api/auth/session' satisfies keyof paths
const LANGUAGE_PATH = '/api/auth/language' satisfies keyof paths

export const authKeys = {
  session: () => ['auth', 'session'] as const,
}

export function useSession() {
  return useQuery({
    queryKey: authKeys.session(),
    queryFn: () => api<SessionUser>(SESSION_PATH),
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: LoginRequest) =>
      api<SessionUser>(LOGIN_PATH, { method: 'POST', body: request }),
    // After a session ended mid-visit the cache still holds what the previous
    // account could see, and the next account must never be shown it.
    onSuccess: (user) => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== authKeys.session()[0],
      })
      queryClient.setQueryData(authKeys.session(), user)
    },
  })
}

export function useLogout() {
  return useMutation({
    mutationFn: () => api<void>(LOGOUT_PATH, { method: 'POST' }),
  })
}

/**
 * The cached session takes the new language at once, so the gate's language
 * sync never pulls the UI back to the old value while the PUT is in flight.
 * Settling refetches the session, so a refused PUT restores the server value.
 */
export function useChangeLanguage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (language: AppLanguage) =>
      api<void>(LANGUAGE_PATH, { method: 'PUT', body: { language } satisfies LanguageRequest }),
    onMutate: (language) => {
      queryClient.setQueryData<SessionUser>(authKeys.session(), (user) =>
        user ? { ...user, language } : user,
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: authKeys.session() }),
  })
}

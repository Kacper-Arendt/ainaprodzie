import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client.ts'
import type { components, paths } from '../../api/types.gen.ts'

export type ChatSettings = components['schemas']['ChatSettings']
type ChatSettingsChange = components['schemas']['ChatSettingsChange']
type ChatModels = components['schemas']['ChatModels']

const SETTINGS_PATH = '/api/chat/settings' satisfies keyof paths
const MODELS_PATH = '/api/chat/models' satisfies keyof paths

const SETTINGS_KEY = ['chat-settings'] as const

export function useChatSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api<ChatSettings>(SETTINGS_PATH),
  })
}

/** The LiteLLM aliases the chat may use, in the configured order. */
export function useChatModels() {
  return useQuery({
    queryKey: ['chat-models'],
    queryFn: () => api<ChatModels>(MODELS_PATH),
  })
}

/**
 * A change names only the settings it changes, and the answer is everything
 * stored then. A saved change writes that answer into the cache; nothing shows
 * before the save succeeds. A refetch still in flight (the page refetches on
 * focus) read the old value, so it is cancelled first rather than allowed to
 * land on top.
 */
export function useChangeChatSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (change: ChatSettingsChange) =>
      api<ChatSettings>(SETTINGS_PATH, { method: 'PATCH', body: change }),
    onSuccess: async (settings) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_KEY })
      queryClient.setQueryData(SETTINGS_KEY, settings)
    },
  })
}

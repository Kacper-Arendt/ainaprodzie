import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client.ts'
import type { components, paths } from '../../api/types.gen.ts'

type MetaResponse = components['schemas']['MetaResponse']

const META_PATH = '/api/meta' satisfies keyof paths

export const metaKeys = {
  meta: () => ['meta'] as const,
}

export function useMeta() {
  return useQuery({
    queryKey: metaKeys.meta(),
    queryFn: () => api<MetaResponse>(META_PATH),
  })
}

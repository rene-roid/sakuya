import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@sakuya/shared';
import { api } from '../lib/api';

export function useSettings(enabled = true): Settings | undefined {
  return useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000, enabled }).data;
}

/** PATCHes settings and writes the server's answer straight into the cache. */
export function usePatchSettings(onSuccess?: (data: Settings, body: Partial<Record<keyof Settings, string>>) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Record<keyof Settings, string>>) => api.patchSettings(body),
    onSuccess: (data, body) => {
      queryClient.setQueryData(['settings'], data);
      onSuccess?.(data, body);
    },
  });
}

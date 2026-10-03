import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthStatus } from '@sakuya/shared';
import { api, ApiError } from '../lib/api';

export function useAuth() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['auth-status'], queryFn: api.authStatus });

  return {
    loading: isLoading,
    enabled: data?.enabled ?? false,
    unlocked: data?.unlocked ?? false,
    login: async (secret: string): Promise<string | null> => {
      try {
        await api.login(secret);
        queryClient.setQueryData<AuthStatus>(['auth-status'], { enabled: true, unlocked: true });
        return null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) return 'Too many attempts, please try again later';
        return 'Invalid password';
      }
    },
  };
}

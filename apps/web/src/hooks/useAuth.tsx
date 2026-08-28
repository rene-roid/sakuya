import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthStatus } from '@sakuya/shared';
import { api, ApiError, setUnauthorizedHandler } from '../lib/api';

interface AuthContextValue {
  loading: boolean;
  enabled: boolean;
  unlocked: boolean;
  login: (secret: string) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['auth-status'], queryFn: api.authStatus });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.setQueryData<AuthStatus>(['auth-status'], (old) => (old ? { ...old, unlocked: false } : old));
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const value: AuthContextValue = {
    loading: isLoading,
    enabled: data?.enabled ?? false,
    unlocked: data ? data.unlocked : false,
    login: async (secret: string) => {
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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

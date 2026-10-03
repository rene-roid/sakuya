import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthStatus } from '@sakuya/shared';
import { App } from './App';
import { Toaster, toastError } from './components/Toast';
import { setUnauthorizedHandler } from './lib/api';
import { applyUiStyle, storedUiStyle } from './hooks/useUiStyle';
import './index.css';

applyUiStyle(storedUiStyle());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
  // Every failed mutation toasts its message, unless it brings its own onError.
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      if (!mutation.options.onError) toastError(err);
    },
  }),
});

setUnauthorizedHandler(() => {
  queryClient.setQueryData<AuthStatus>(['auth-status'], (old) => (old ? { ...old, unlocked: false } : old));
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

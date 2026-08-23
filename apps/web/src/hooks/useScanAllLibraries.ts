import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast } from '../components/Toast';
import type { LibraryWithStats } from '@sakuya/shared';

export function useScanAllLibraries(libraries: LibraryWithStats[] | undefined) {
  const showToast = useToast();
  return useMutation({
    mutationFn: async () => {
      for (const lib of libraries ?? []) {
        await api.scanLibrary(lib.id);
      }
    },
    onSuccess: () => showToast('Scan started for all libraries'),
    onError: (err: Error) => showToast(err.message),
  });
}

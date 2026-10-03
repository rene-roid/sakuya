import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { toast } from '../components/Toast';
import type { LibraryWithStats } from '@sakuya/shared';

export function useScanAllLibraries(libraries: LibraryWithStats[] | undefined) {
  return useMutation({
    mutationFn: async () => {
      for (const lib of libraries ?? []) {
        await api.scanLibrary(lib.id);
      }
    },
    onSuccess: () => toast('Scan started for all libraries'),
  });
}

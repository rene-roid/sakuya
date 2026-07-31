import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * Heart/like toggle. Outline when not liked; filled red when liked.
 * Stops propagation so it never triggers the parent card's open handler.
 */
export function HeartButton({
  mediaId,
  liked,
  className = '',
  size = 'md',
}: {
  mediaId: number;
  liked: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: boolean) => api.likeMedia(mediaId, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      queryClient.invalidateQueries({ queryKey: ['media-detail', mediaId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const dim = size === 'lg' ? 'h-9 w-9 text-[18px]' : size === 'sm' ? 'h-6 w-6 text-[13px]' : 'h-7 w-7 text-[15px]';

  return (
    <button
      title={liked ? 'Unlike' : 'Like'}
      onClick={(e) => {
        e.stopPropagation();
        mutation.mutate(!liked);
      }}
      className={`flex items-center justify-center rounded-full backdrop-blur transition-colors ${dim} ${
        liked ? 'bg-black/40 text-rose-500' : 'bg-black/40 text-white/85 hover:text-rose-400'
      } ${className} hover:cursor-pointer`}
    >
      <svg
          xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
      </svg>
    </button>
  );
}

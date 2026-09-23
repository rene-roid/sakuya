import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { api } from '../lib/api';
import { isLikedMediaList, patchCachedMedia } from '../lib/mediaCache';

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
    onSuccess: (detail) => {
      queryClient.setQueryData(['media-detail', mediaId], detail);
      patchCachedMedia(queryClient, mediaId, { liked: detail.liked, likedAt: detail.likedAt });
      queryClient.invalidateQueries({ predicate: (query) => isLikedMediaList(query.queryKey) });
      // Only the liked count and cover need the server; the rows were patched above.
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const dimSize = size === 'lg' ? 20 : size === 'sm' ? 13 : 16;

  return (
    <button
      title={liked ? 'Unlike' : 'Like'}
      onClick={(e) => {
        e.stopPropagation();
        mutation.mutate(!liked);
      }}
      className={`flex items-center justify-center rounded-full backdrop-blur transition-colors ${
        liked ? 'bg-black/40 text-rose-500' : 'bg-black/40 text-white/85 hover:text-rose-400'
      } ${className} hover:cursor-pointer`}
    >
      <Heart size={dimSize} fill={liked ? 'currentColor' : 'none'} />
    </button>
  );
}

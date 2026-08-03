import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { api } from '../lib/api';

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

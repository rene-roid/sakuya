import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tagLabel, tagLabelText, type TagCategory, type TagInfo } from '@sakuya/shared';
import { api } from '../lib/api';
import { toast, toastError } from './Toast';

interface TagLike {
  name: string;
  category?: TagCategory;
  displayName?: string | null;
}

// Every chip and card that knows a tag only by name asks for it in the same render, so the
// lookups are pooled into one request per tick rather than one per name.
let pending: { names: Set<string>; result: Promise<Map<string, TagInfo>> } | null = null;

function loadTagInfo(name: string): Promise<TagInfo | null> {
  if (!pending) {
    const names = new Set<string>();
    const result = new Promise<Map<string, TagInfo>>((resolve, reject) => {
      setTimeout(() => {
        pending = null;
        api.tagInfo([...names]).then((rows) => resolve(new Map(rows.map((row) => [row.name, row]))), reject);
      }, 0);
    });
    pending = { names, result };
  }
  pending.names.add(name);
  return pending.result.then((byName) => byName.get(name) ?? null);
}

/** Category and display name for a tag known only by its canonical name. */
export function useTagInfo(name: string | undefined): TagLike | undefined {
  const { data } = useQuery({
    queryKey: ['tags', 'info', name],
    queryFn: () => loadTagInfo(name!),
    enabled: !!name,
    staleTime: 60_000,
  });
  if (!name) return undefined;
  return data ?? { name };
}

/** A tag's on-screen name, with a booru qualifier like `(sao)` as a muted subtitle. */
export function TagName({ tag, className = '' }: { tag: TagLike | string; className?: string }) {
  const looked = useTagInfo(typeof tag === 'string' ? tag : undefined);
  const resolved = typeof tag === 'string' ? looked! : tag;
  const { label, qualifier } = tagLabel(resolved);
  return (
    <span className={`min-w-0 truncate ${className}`}>
      {label}
      {qualifier && <span className="ml-1 text-[0.92em] font-normal opacity-55">{qualifier}</span>}
    </span>
  );
}

/** useTagInfo + tagLabelText, for attributes and strings. */
export function useTagLabelText(name: string | undefined): string {
  const info = useTagInfo(name);
  return info ? tagLabelText(info) : '';
}

/**
 * Inline editor for a tag's display name. Saving an empty box clears the custom name, and the tag
 * goes back to its automatic label.
 */
export function TagRenameInput({
  tag,
  onDone,
  className = '',
}: {
  tag: TagLike;
  onDone: () => void;
  className?: string;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(tag.displayName ?? tagLabelText(tag));
  const rename = useMutation({
    mutationFn: (displayName: string) => api.renameTag(tag.name, displayName.trim() || null),
    onSuccess: (info) => {
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['tags-summary'] });
      qc.invalidateQueries({ queryKey: ['media-detail'] });
      toast(info.displayName ? `Shown as “${info.displayName}”` : `Name reset to “${tagLabelText(info)}”`);
      onDone();
    },
    onError: toastError,
  });
  const automatic = tagLabelText({ ...tag, displayName: null });
  return (
    <input
      autoFocus
      value={value}
      placeholder={automatic}
      aria-label={`Display name for ${tag.name}`}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // The viewer closes on a window-level Escape; this one only cancels the edit.
        e.stopPropagation();
        if (e.key === 'Enter') {
          const next = value.trim();
          const unchanged = next === (tag.displayName ?? '') || (!tag.displayName && next === automatic);
          if (unchanged) onDone();
          else rename.mutate(next === automatic ? '' : next);
        } else if (e.key === 'Escape') onDone();
      }}
      onBlur={() => {
        if (!rename.isPending) onDone();
      }}
      className={`min-w-0 rounded-md border border-line-hover bg-zinc-900 px-1.5 py-0.5 text-[12px] font-semibold text-zinc-100 outline-none ${className}`}
    />
  );
}

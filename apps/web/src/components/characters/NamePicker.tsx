import { useEffect, useMemo, useState } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { Plus, Tag, UserRound } from 'lucide-react';
import { api } from '../../lib/api';
import { customDisplayName, nameOptions, type NameOption } from '../../lib/characters';

export function useCharacterList(includeHidden = false) {
  return useQuery({
    queryKey: ['characters', includeHidden ? 'all' : 'visible'],
    queryFn: () => api.characters(includeHidden),
  });
}

/** Everything a character edit can change: the lists, one character's page, the viewer boxes, tags. */
export function invalidateCharacters(qc: QueryClient) {
  for (const key of [
    'characters',
    'character',
    'character-media',
    'character-faces',
    'media-detections',
    'character-status',
    'tags',
    'media',
    'media-detail',
  ]) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}

/** A new tag gets the capitals that were typed, when its automatic label would lose them. */
export async function keepTypedCase(option: NameOption, canonical: string | null) {
  if (option.kind !== 'new' || !canonical) return;
  const displayName = customDisplayName(option.name, canonical);
  if (displayName) await api.renameTag(canonical, displayName).catch(() => undefined);
}

/** A cropped character face. Person boxes run head to toe, so the crop is pinned to the top. */
export function Crop({ url, alt, className = '' }: { url: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`overflow-hidden rounded-media bg-zinc-900 ${className}`}>
      {url && !failed ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover object-top"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-zinc-600">
          <UserRound size={22} />
        </div>
      )}
    </div>
  );
}

/**
 * Name input with autocomplete over named characters and character tags, plus "create" for a
 * new name. `inline` renders the options in the flow, for use inside a menu.
 */
export function NamePicker({
  onPick,
  onCancel,
  busy,
  excludeId,
  placeholder = 'Name this character',
  inline = false,
  autoFocus = true,
}: {
  onPick: (option: NameOption) => void;
  onCancel: () => void;
  busy?: boolean;
  excludeId?: number;
  placeholder?: string;
  inline?: boolean;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState('');
  const [active, setActive] = useState(0);
  const { data } = useCharacterList(true);
  const options = useMemo(
    () =>
      nameOptions(
        value,
        (data?.named ?? []).filter((c) => c.id !== excludeId),
        data?.tagOnly ?? [],
        inline ? 5 : 7,
      ),
    [value, data, excludeId, inline],
  );
  useEffect(() => setActive(0), [value]);

  const list = (value.trim() || options.length > 0) && (
    <div
      role="listbox"
      className={
        inline
          ? 'mt-1 flex flex-col'
          : 'absolute left-0 right-0 top-[calc(100%+4px)] z-30 min-w-[200px] overflow-hidden rounded-lg border border-line-strong bg-zinc-900 py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]'
      }
    >
      {options.map((option, i) => (
        <button
          type="button"
          role="option"
          aria-selected={i === active}
          key={`${option.kind}:${option.label}`}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(option)}
          className={`flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] font-semibold ${
            i === active ? 'bg-white/[0.07] text-zinc-100' : 'text-zinc-300'
          } ${inline ? 'rounded-md' : ''}`}
        >
          {option.kind === 'character' ? (
            <Crop url={option.character.coverUrl} alt="" className="h-5 w-5 flex-none !rounded-[4px]" />
          ) : option.kind === 'tag' ? (
            <Tag size={13} className="mx-[3.5px] flex-none text-zinc-500" />
          ) : (
            <Plus size={13} className="mx-[3.5px] flex-none text-zinc-500" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {option.kind === 'new' ? `Create “${option.label}”` : option.label}
          </span>
          {option.kind !== 'new' && (
            <span className="flex-none text-[11px] font-medium text-zinc-500">
              {option.kind === 'character' ? option.character.mediaCount : option.tag.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );

  return (
    <div className="relative">
      <input
        autoFocus={autoFocus}
        value={value}
        disabled={busy}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => !inline && !busy && !value.trim() && onCancel()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && options[active]) {
            onPick(options[active]);
          } else if (e.key === 'Escape') onCancel();
        }}
        className="w-full min-w-0 rounded-md border border-line-hover bg-zinc-900 px-2 py-1 text-[12.5px] font-semibold text-zinc-100 outline-none placeholder:font-normal placeholder:text-zinc-500 focus:border-accent"
      />
      {list}
    </div>
  );
}

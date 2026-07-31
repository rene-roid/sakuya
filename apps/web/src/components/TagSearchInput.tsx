import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounce } from '../hooks/useDebounce';

interface TagSearchInputProps {
  tags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  libraryId?: number;
  /** Called when the user submits free text and autosearch is off (or no suggestions). */
  onFreeText?: (q: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Search box where selected tags render as chips inside the input. Typing filters an
 * autocomplete dropdown (arrow-key navigable); Enter converts text to a tag; Backspace
 * on an empty input removes the last chip.
 */
export function TagSearchInput({
  tags,
  onAddTag,
  onRemoveTag,
  libraryId,
  onFreeText,
  placeholder = 'Search tags…',
  autoFocus,
}: TagSearchInputProps) {
  const [text, setText] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounce(text.trim());

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings, staleTime: 60_000 });
  const autosearchFirst = settings?.autosearch_first_tag !== '0';

  const { data: suggestions } = useQuery({
    queryKey: ['tags', 'suggest', debounced, libraryId],
    queryFn: () => api.tags({ q: debounced, libraryId, limit: 8 }),
    enabled: debounced.length > 0,
    staleTime: 30_000,
  });
  const visible = (suggestions ?? []).filter((s) => !tags.includes(s.name));
  const showDropdown = focused && text.trim().length > 0 && visible.length > 0;

  const commit = (tag: string) => {
    onAddTag(tag);
    setText('');
    setHighlight(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === 'Enter') {
      if (highlight >= 0 && visible[highlight]) {
        commit(visible[highlight].name);
        return;
      }
      const raw = text.trim();
      if (!raw) return;
      if (autosearchFirst && visible.length > 0) {
        commit(visible[0].name);
      } else if (onFreeText) {
        onFreeText(raw);
        setText('');
        setHighlight(-1);
      } else {
        commit(raw);
      }
    } else if (e.key === 'Backspace' && text.length === 0 && tags.length > 0) {
      onRemoveTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className="relative w-full">
      <div
        className="flex w-full flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 focus-within:border-zinc-600"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/15 py-0.5 pl-2.5 pr-1.5 text-xs font-semibold text-violet-300"
          >
            {tag}
            <span
              className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-accent/25"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveTag(tag);
              }}
            >
              ×
            </span>
          </span>
        ))}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHighlight(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="min-w-[80px] flex-1 bg-transparent text-[13px] text-zinc-100 outline-none placeholder:text-zinc-500"
        />
      </div>
      {showDropdown && (
        <div className="absolute inset-x-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
          {visible.map((s, i) => (
            <div
              key={s.name}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(s.name);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex cursor-pointer items-center justify-between px-3 py-2 text-[12.5px] ${
                i === highlight ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-200'
              }`}
            >
              <span>{s.name}</span>
              <span className="text-[11px] text-zinc-500">{s.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

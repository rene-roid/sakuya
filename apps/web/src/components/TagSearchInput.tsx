import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useDebounce } from '../hooks/useDebounce';

interface TagSearchInputProps {
  tags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  libraryId?: number;
  /** Called when the user submits text that wasn't completed into a tag. */
  onFreeText?: (q: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/**
 * Search box where selected tags render as chips inside the input. Completing a tag is
 * always explicit — Tab, or arrow-select then Space — so Enter stays free-text search and
 * never hijacks what you typed. Suggestions apply only to the token after the last space
 * or comma, so free text and tags can be mixed in one query. Backspace on an empty input
 * removes the last chip.
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

  // Tags never contain a space or a comma, so either character closes off whatever was
  // typed before it as literal free text. Only the token after the last one is a tag
  // candidate, which lets a single query mix free text with completed tags.
  const segmentStart = Math.max(text.lastIndexOf(' '), text.lastIndexOf(',')) + 1;
  const prefix = text.slice(0, segmentStart);
  const segment = text.slice(segmentStart);
  const debounced = useDebounce(segment.trim());

  const { data: suggestions } = useQuery({
    queryKey: ['tags', 'suggest', debounced, libraryId],
    queryFn: () => api.tags({ q: debounced, libraryId, limit: 8 }),
    enabled: debounced.length > 0,
    staleTime: 30_000,
  });
  const visible = (suggestions ?? []).filter((s) => !tags.includes(s.name));
  const showDropdown = focused && segment.trim().length > 0 && visible.length > 0;

  // Keeps the free text typed before the completed token; only the token becomes a chip.
  const commit = (tag: string) => {
    onAddTag(tag);
    setText(prefix);
    setHighlight(-1);
  };

  const submitFreeText = () => {
    // Drop the trailing separator left behind when the last token was completed into a chip.
    const raw = text.replace(/[\s,]+$/, '').trim();
    if (!raw) return;
    if (onFreeText) onFreeText(raw);
    else onAddTag(raw);
    setText('');
    setHighlight(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showDropdown && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setHighlight((h) => (e.key === 'ArrowDown' ? Math.min(h + 1, visible.length - 1) : Math.max(h - 1, -1)));
    } else if (e.key === 'Tab' && showDropdown) {
      e.preventDefault();
      commit(visible[highlight >= 0 ? highlight : 0].name);
    } else if (e.key === ' ' && showDropdown && highlight >= 0) {
      e.preventDefault();
      commit(visible[highlight].name);
    } else if (e.key === 'Enter') {
      if (showDropdown && highlight >= 0) commit(visible[highlight].name);
      else submitFreeText();
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

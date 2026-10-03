import type { ReactNode } from 'react';

export const TYPE_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Videos' },
] as const;

/** Pill-group picker: one option active at a time. `children` render after the options, inside the group. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  className = '',
  children,
}: {
  options: readonly { key: K; label: ReactNode }[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`flex rounded-lg border border-line bg-zinc-900 p-0.5 glass:rounded-full glass:bg-white/[0.04] ${className}`}
    >
      {options.map((option) => (
        <div
          key={option.key}
          onClick={() => onChange(option.key)}
          className={`cursor-pointer rounded-md px-[13px] py-1.5 text-[12.5px] font-semibold glass:rounded-full ${
            value === option.key ? 'bg-accent text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {option.label}
        </div>
      ))}
      {children}
    </div>
  );
}

import type { UiStyle } from '@sakuya/shared';

/** The interface styles, default first. Shared by Settings → Appearance and the first-run picker. */
export const UI_STYLES: { key: UiStyle; label: string; desc: string }[] = [
  { key: 'classic', label: 'Original', desc: 'The flat, compact look Sakuya shipped with.' },
  { key: 'glass', label: 'Liquid Glass', desc: 'Frosted bars, pill navigation and a welcome banner.' },
];

/** Tiny static mock of each style, drawn in plain markup so it doesn't depend on the active one. */
export function UiStylePreview({ style }: { style: UiStyle }) {
  const glass = style === 'glass';
  return (
    <div
      className="h-[92px] overflow-hidden p-2"
      style={{
        borderRadius: glass ? 10 : 6,
        background: glass
          ? 'radial-gradient(circle at 85% 0%, color-mix(in srgb, var(--accent) 35%, transparent), transparent 70%), #0c0c10'
          : '#09090b',
        border: '1px solid ' + (glass ? 'rgb(255 255 255 / 0.08)' : '#27272a'),
      }}
    >
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-2.5 w-7"
            style={{
              borderRadius: glass ? 999 : 2,
              background: i === 0 ? (glass ? 'color-mix(in srgb, var(--accent) 45%, transparent)' : '#27272a') : glass ? 'rgb(255 255 255 / 0.06)' : 'transparent',
            }}
          />
        ))}
        <div className="ml-auto h-2.5 w-12" style={{ borderRadius: glass ? 999 : 2, background: glass ? 'rgb(255 255 255 / 0.08)' : '#18181b' }} />
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[52px]"
            style={{
              borderRadius: glass ? 5 : 3,
              background: glass ? 'rgb(255 255 255 / 0.05)' : '#18181b',
              border: '1px solid ' + (glass ? 'rgb(255 255 255 / 0.1)' : '#27272a'),
            }}
          />
        ))}
      </div>
    </div>
  );
}

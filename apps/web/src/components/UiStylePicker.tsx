import { useState } from 'react';
import { Check, Palette } from 'lucide-react';
import type { UiStyle } from '@sakuya/shared';
import { applyUiStyle } from '../hooks/useUiStyle';
import { usePatchSettings } from '../hooks/useSettings';
import { UI_STYLES, UiStylePreview } from './UiStylePreview';

/**
 * One-time "pick your look" prompt. App shows it until `ui_style_chosen` is set, which saving
 * here does, so it appears once per install. There's no way to dismiss it without answering:
 * Continue on the preselected style is that, and it keeps the prompt from coming back.
 */
export function UiStylePicker({ current }: { current: UiStyle }) {
  const [choice, setChoice] = useState<UiStyle>(current);

  // Applied here as well as in App: when the choice equals the saved style, ui_style doesn't
  // change and App's effect wouldn't run.
  const saveMutation = usePatchSettings((data) => applyUiStyle(data.ui_style));

  return (
    <div className="fade-in fixed inset-0 z-[95] flex items-center justify-center bg-zinc-950/80 p-4 backdrop-blur sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ui-style-picker-title"
        className="flex max-h-[90dvh] w-full max-w-[580px] flex-col overflow-y-auto rounded-2xl border border-line bg-surface shadow-[0_24px_64px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center gap-3.5 border-b border-line bg-gradient-to-b from-accent/10 to-transparent px-5 py-5 sm:px-6">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-accent/15">
            <Palette size={22} className="text-accent" />
          </div>
          <div className="min-w-0">
            <div id="ui-style-picker-title" className="text-[18px] font-extrabold">
              Pick your look
            </div>
            <div className="text-[12.5px] text-zinc-500">
              You can change it any time in <span className="whitespace-nowrap">Settings → Appearance</span>.
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2.5 px-5 py-5 sm:grid-cols-2 sm:px-6">
          {UI_STYLES.map((option) => {
            const selected = choice === option.key;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setChoice(option.key)}
                className={`cursor-pointer rounded-panel border-2 p-2.5 text-left transition-colors ${
                  selected ? 'border-accent' : 'border-line hover:border-line-hover'
                }`}
              >
                <UiStylePreview style={option.key} />
                <div className="mt-2.5 flex items-center justify-between px-0.5">
                  <div className="text-[13px] font-semibold">{option.label}</div>
                  <span
                    className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border ${
                      selected ? 'border-accent bg-accent text-white' : 'border-line-strong'
                    }`}
                  >
                    {selected && <Check size={12} strokeWidth={3} />}
                  </span>
                </div>
                <div className="mt-0.5 px-0.5 text-[11.5px] text-zinc-500">{option.desc}</div>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end border-t border-line px-5 py-4 sm:px-6">
          <button
            type="button"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate({ ui_style: choice, ui_style_chosen: '1' })}
            className="cursor-pointer rounded-btn bg-accent px-5 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            Continue with {UI_STYLES.find((option) => option.key === choice)?.label}
          </button>
        </div>
      </div>
    </div>
  );
}

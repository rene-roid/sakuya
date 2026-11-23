export function ToggleSwitch({
  checked,
  onChange,
  pending,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  pending?: boolean;
  disabled?: boolean;
  /** Accessible name, usually the setting's label. */
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 flex-none cursor-pointer rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-accent' : 'bg-zinc-700'
      } ${pending ? 'opacity-60' : ''}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

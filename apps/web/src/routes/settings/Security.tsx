import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthSettings, AuthStatus } from '@sakuya/shared';
import { api, ApiError } from '../../lib/api';
import { toast } from '../../components/Toast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SettingsPanel } from './SettingRow';
import { buttonClass } from './controls';

const inputClass =
  'w-full rounded-field border border-line bg-zinc-900 px-2.5 py-[7px] text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40';

function useAuthSettings() {
  return useQuery({ queryKey: ['auth-settings'], queryFn: api.authSettings }).data;
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  disabled: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-semibold text-zinc-400">{label}</span>
      <input
        type="password"
        value={value}
        disabled={disabled}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </label>
  );
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');

/**
 * Set, change or turn off the login password. With login on, every change asks for the current
 * password first; the server checks it again, this only saves a round trip for typos.
 */
export function LoginPasswordPanel() {
  const queryClient = useQueryClient();
  const settings = useAuthSettings();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const applied = (res: AuthSettings) => {
    queryClient.setQueryData(['auth-settings'], res);
    queryClient.setQueryData<AuthStatus>(['auth-status'], { enabled: res.enabled, unlocked: true });
    setCurrent('');
    setNext('');
    setRepeat('');
    setError(null);
  };
  const onError = (err: unknown) => {
    setError(err instanceof ApiError && err.status === 429 ? 'Too many attempts, please try again later' : errorText(err));
  };

  const change = useMutation({
    mutationFn: () => api.changePassword({ current: settings?.enabled ? current : undefined, next }),
    onSuccess: (res) => {
      toast(settings?.enabled ? 'Password changed. Other devices were signed out.' : 'Login turned on');
      applied(res);
    },
    onError,
  });
  const disable = useMutation({
    mutationFn: () => api.disableLogin(current),
    onSuccess: (res) => {
      toast('Login turned off');
      applied(res);
    },
    onError,
  });

  if (!settings) {
    return (
      <SettingsPanel>
        <div className="px-3.5 py-3 text-[12px] text-zinc-500">Loading…</div>
      </SettingsPanel>
    );
  }

  const { enabled, lockedReason } = settings;
  const busy = change.isPending || disable.isPending;
  const disabled = !!lockedReason || busy;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (enabled && !current) return setError('Enter your current password');
    if (!next.trim()) return setError('Enter a new password');
    if (next !== repeat) return setError("The new passwords don't match");
    change.mutate();
  };

  return (
    <SettingsPanel>
      <div className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-3">
        <div className="text-[12.5px] text-zinc-400">
          {enabled
            ? 'On. Opening Sakuya asks for the password.'
            : 'Off. Anyone who can reach this server can use Sakuya.'}
        </div>
        <span
          className={`flex-none rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.4px] ${
            enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {enabled ? 'On' : 'Off'}
        </span>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3 px-3.5 py-3.5">
        {lockedReason && <div className="text-[12px] leading-snug text-amber-500">{lockedReason}</div>}
        <div className="grid gap-3 sm:grid-cols-3">
          {enabled && (
            <PasswordField
              label="Current password"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              disabled={disabled}
            />
          )}
          <PasswordField
            label={enabled ? 'New password' : 'Password'}
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            disabled={disabled}
          />
          <PasswordField
            label={enabled ? 'Repeat new password' : 'Repeat password'}
            value={repeat}
            onChange={setRepeat}
            autoComplete="new-password"
            disabled={disabled}
          />
        </div>
        {error && <div className="text-[12px] text-rose-400">{error}</div>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={disabled} className={buttonClass('primary')}>
            {change.isPending ? 'Saving…' : enabled ? 'Change password' : 'Turn on login'}
          </button>
          {enabled && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => (current ? setConfirmOff(true) : setError('Enter your current password to turn login off'))}
              className={buttonClass('danger')}
            >
              {disable.isPending ? 'Turning off…' : 'Turn off login'}
            </button>
          )}
        </div>
      </form>
      {confirmOff && (
        <ConfirmDialog
          title="Turn off login?"
          danger
          confirmLabel="Turn off"
          body="Anyone who can reach this server will be able to browse, edit and delete your libraries without a password. The password is removed from the config file."
          onCancel={() => setConfirmOff(false)}
          onConfirm={() => {
            setConfirmOff(false);
            disable.mutate();
          }}
        />
      )}
    </SettingsPanel>
  );
}

export function PasswordFileMeta() {
  const settings = useAuthSettings();
  if (!settings) return null;
  if (settings.docker) {
    return (
      <>
        In Docker, edit <code>sakuya.config.json</code> next to <code>docker-compose.yml</code> on the host, then
        restart the server container.
      </>
    );
  }
  return (
    <>
      <span className="break-all text-zinc-300">{settings.configFile}</span>
      <div className="mt-0.5">Saved changes apply within a few seconds, no restart needed.</div>
    </>
  );
}

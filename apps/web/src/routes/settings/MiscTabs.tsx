import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { TabHeader } from './index';

const ACCENTS = ['#8b5cf6', '#14b8a6', '#f43f5e'];

export function AppearanceTab() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const current = settings?.accent_color ?? '#8b5cf6';

  const patchMutation = useMutation({
    mutationFn: (accent: string) => api.patchSettings({ accent_color: accent }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      document.documentElement.style.setProperty('--accent', data.accent_color);
      showToast('Accent updated');
    },
    onError: (err: Error) => showToast(err.message),
  });

  return (
    <div>
      <TabHeader title="Appearance" subtitle="Visual preferences for the board." />
      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
        <div className="mb-2.5 text-[13.5px] font-bold">Accent color</div>
        <div className="flex gap-2.5">
          {ACCENTS.map((color) => (
            <div
              key={color}
              onClick={() => patchMutation.mutate(color)}
              className="h-[34px] w-[34px] cursor-pointer rounded-lg border-2"
              style={{ background: color, borderColor: current === color ? '#f4f4f5' : 'transparent' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SystemTab() {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const { data: info } = useQuery({ queryKey: ['system'], queryFn: api.system });

  const clearMutation = useMutation({
    mutationFn: api.clearThumbnails,
    onSuccess: (res) => {
      showToast(`Cleared ${res.removed} thumbnails`);
      queryClient.invalidateQueries({ queryKey: ['system'] });
    },
    onError: (err: Error) => showToast(err.message),
  });

  return (
    <div>
      <TabHeader title="System" subtitle="Storage and maintenance." />
      <div className="flex flex-col gap-2.5 rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
        <Row label="Version" value={info?.version ?? '—'} />
        <Row label="Media stored" value={info ? `${info.mediaCount} files · ${formatBytes(info.mediaBytes)}` : '—'} />
        <Row label="Database size" value={info ? formatBytes(info.dbBytes) : '—'} />
        <Row label="Thumbnail cache" value={info ? formatBytes(info.thumbBytes) : '—'} />
        <div
          className="mt-1.5 cursor-pointer text-[12.5px] font-semibold text-rose-500 hover:text-rose-400"
          onClick={() => clearMutation.mutate()}
        >
          Clear thumbnail cache
        </div>
      </div>
    </div>
  );
}

export function BehaviorTab() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const rememberMute = settings?.remember_mute_state === '1';

  const patchMutation = useMutation({
    mutationFn: (value: boolean) => api.patchSettings({ remember_mute_state: value ? '1' : '0' }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      showToast('Behaviour updated');
    },
    onError: (err: Error) => showToast(err.message),
  });

  return (
    <div>
      <TabHeader title="Behaviour" subtitle="Playback and interaction preferences." />
      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13.5px] font-bold">Remember video mute state</div>
            <div className="mt-0.5 max-w-[420px] text-[12px] text-zinc-500">
              When enabled, muting or unmuting a video carries over to the next video you play.
            </div>
          </div>
          <div
            role="switch"
            aria-checked={rememberMute}
            onClick={() => patchMutation.mutate(!rememberMute)}
            className={`relative h-6 w-11 flex-none cursor-pointer rounded-full transition-colors ${
              rememberMute ? 'bg-accent' : 'bg-zinc-700'
            } ${patchMutation.isPending ? 'opacity-60' : ''}`}
          >
            <div
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                rememberMute ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[13px]">
      <span className="text-zinc-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

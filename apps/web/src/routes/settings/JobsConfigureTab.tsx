import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JobSchedule, LibraryWithStats, ScheduleMode } from '@sakuya/shared';
import { api, libraryCoverUrl, thumbUrl, type ScheduleJobType, type UpdateJobScheduleBody } from '../../lib/api';
import { useToast } from '../../components/Toast';

type IntervalOption = { label: string; minutes: number };

const INTERVAL_OPTIONS: IntervalOption[] = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '6 hours', minutes: 360 },
  { label: '12 hours', minutes: 720 },
  { label: '24 hours', minutes: 1440 },
];

const JOB_TYPES: { key: ScheduleJobType; label: string; recommended?: string }[] = [
  { key: 'scan', label: 'Library scan' },
  { key: 'tag', label: 'AI tagging', recommended: 'Recommended: After every scan' },
  { key: 'hash', label: 'Duplicate detection', recommended: 'Recommended: After every scan' },
];

/** All possible <select> values as a discriminated string set. */
type SelectValue = 'off' | 'after-scan' | 'inherit' | `int:${number}`;

function scheduleToValue(schedule: JobSchedule | undefined, scope: 'global' | 'per-library'): SelectValue {
  if (scope === 'per-library' && (!schedule || schedule.useGlobal)) return 'inherit';
  if (!schedule || schedule.mode === 'off') return 'off';
  if (schedule.mode === 'after-scan') return 'after-scan';
  return `int:${schedule.intervalMinutes}`;
}

function valueToPatch(value: SelectValue, jobType: ScheduleJobType, libraryId?: number): UpdateJobScheduleBody {
  const base: UpdateJobScheduleBody = { jobType, libraryId: libraryId ?? null };
  if (value === 'inherit') return { ...base, useGlobal: true };
  if (value === 'off') return { ...base, mode: 'off', intervalMinutes: 0, useGlobal: false };
  if (value === 'after-scan') return { ...base, mode: 'after-scan', intervalMinutes: 0, useGlobal: false };
  const minutes = Number(value.slice(4));
  return { ...base, mode: 'interval', intervalMinutes: minutes, useGlobal: false };
}

function ScheduleSelect({
  value,
  disabled,
  onChange,
  showInherit,
  showAfterScan,
}: {
  value: SelectValue;
  disabled?: boolean;
  onChange: (next: SelectValue) => void;
  showInherit: boolean;
  showAfterScan: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as SelectValue)}
      className="rounded-[7px] border border-zinc-800 bg-zinc-900 px-2 py-[5px] text-[12px] text-zinc-300 outline-none disabled:opacity-40"
    >
      {showInherit && <option value="inherit">Use global</option>}
      <option value="off">Off</option>
      {showAfterScan && <option value="after-scan">After every scan</option>}
      {INTERVAL_OPTIONS.map((opt) => (
        <option key={opt.minutes} value={`int:${opt.minutes}`}>
          Every {opt.label}
        </option>
      ))}
    </select>
  );
}

export function JobsConfigureTab() {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const { data: schedules } = useQuery({ queryKey: ['job-schedules'], queryFn: api.jobSchedules });
  const { data: libraries } = useQuery({ queryKey: ['libraries'], queryFn: api.libraries });

  const updateMutation = useMutation({
    mutationFn: api.updateJobSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['libraries'] });
      showToast('Schedule updated');
    },
    onError: (err: Error) => showToast(err.message),
  });

  const runNowMutation = useMutation({
    mutationFn: (args: { scope: 'global' | { libraryId: number }; jobType?: ScheduleJobType }) =>
      api.runJobsNow(args.scope, args.jobType),
    onSuccess: () => showToast('Jobs enqueued'),
    onError: (err: Error) => showToast(err.message),
  });

  const globals = schedules?.globals ?? {};

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
        <div className="mb-1 text-[13.5px] font-bold">Global defaults</div>
        <div className="mb-3 text-[12px] text-zinc-500">
          Apply to every library that doesn't set its own override.
        </div>
        <div className="flex flex-col gap-2.5">
          {JOB_TYPES.map((jt) => {
            const schedule = globals[jt.key];
            const value = scheduleToValue(schedule, 'global');
            return (
              <div
                key={jt.key}
                className="flex items-center justify-between rounded-[7px] border border-zinc-800 bg-zinc-900 px-3 py-2"
              >
                <div>
                  <div className="text-[13px] font-semibold text-zinc-200">{jt.label}</div>
                  {jt.recommended && <div className="text-[11px] text-zinc-500">{jt.recommended}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <ScheduleSelect
                    value={value}
                    disabled={updateMutation.isPending}
                    onChange={(next) => updateMutation.mutate(valueToPatch(next, jt.key))}
                    showInherit={false}
                    showAfterScan={jt.key !== 'scan'}
                  />
                  <button
                    disabled={runNowMutation.isPending}
                    onClick={() => runNowMutation.mutate({ scope: 'global', jobType: jt.key })}
                    className="cursor-pointer rounded-[7px] border border-zinc-800 px-3 py-[5px] text-[12px] font-semibold text-zinc-300 hover:text-zinc-100 disabled:opacity-40"
                  >
                    Run all now
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-[#111113] p-[18px]">
        <div className="mb-1 text-[13.5px] font-bold">Per-library</div>
        <div className="mb-3 text-[12px] text-zinc-500">
          Override the global defaults per library. Leave as “Use global” to inherit.
        </div>
        <div className="flex flex-col gap-3">
          {(libraries ?? []).map((lib) => (
            <LibraryScheduleCard
              key={lib.id}
              lib={lib}
              schedules={schedules?.perLibrary[lib.id]}
              onChange={(body) => updateMutation.mutate(body)}
              onRunAll={() => runNowMutation.mutate({ scope: { libraryId: lib.id } })}
              pending={updateMutation.isPending}
              runPending={runNowMutation.isPending}
            />
          ))}
          {libraries && libraries.length === 0 && (
            <div className="text-[12.5px] text-zinc-600">No libraries yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function LibraryScheduleCard({
  lib,
  schedules,
  onChange,
  onRunAll,
  pending,
  runPending,
}: {
  lib: LibraryWithStats;
  schedules: Record<string, JobSchedule> | undefined;
  onChange: (body: UpdateJobScheduleBody) => void;
  onRunAll: () => void;
  pending: boolean;
  runPending: boolean;
}) {
  return (
    <div className="rounded-[10px] border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="mb-2.5 flex items-center gap-2.5">
        <div className="h-9 w-9 flex-none overflow-hidden rounded-lg bg-zinc-900">
          {lib.customImagePath ? (
            <img src={libraryCoverUrl(lib.id)} alt="" className="h-full w-full object-cover" />
          ) : (
            lib.thumbMediaId && <img src={thumbUrl(lib.thumbMediaId)} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="flex-1">
          <div className="text-[13px] font-bold">{lib.name}</div>
          <div className="text-[11.5px] capitalize text-zinc-500">
            {lib.type} · {lib.itemCount} items
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {JOB_TYPES.map((jt) => {
          const schedule = schedules?.[jt.key];
          const value = scheduleToValue(schedule, 'per-library');
          return (
            <div key={jt.key} className="flex items-center justify-between">
              <span className="text-[12px] text-zinc-400">{jt.label}</span>
              <ScheduleSelect
                value={value}
                disabled={pending}
                onChange={(next) => onChange(valueToPatch(next, jt.key, lib.id))}
                showInherit
                showAfterScan={jt.key !== 'scan'}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex justify-end">
        <button
          disabled={runPending}
          onClick={onRunAll}
          className="cursor-pointer rounded-[7px] border border-zinc-800 px-3 py-1 text-[12px] font-semibold text-zinc-300 hover:text-zinc-100 disabled:opacity-40"
        >
          Run all for this library
        </button>
      </div>
    </div>
  );
}

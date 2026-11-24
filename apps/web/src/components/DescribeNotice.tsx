import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { SemanticSearchInfo } from '@sakuya/shared';
import { api } from '../lib/api';
import { useJobs } from '../hooks/useJobs';
import { usePatchSettings } from '../hooks/useSettings';
import { toast } from './Toast';
import { settingHref } from '../routes/settings/registry';

const button =
  'flex-none cursor-pointer rounded-btn border border-line px-2.5 py-[3px] text-[12px] font-semibold text-zinc-200 hover:border-line-strong hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Under a search by description: why it found nothing (off, no model, nothing indexed) with the
 * one step that fixes it, or how many files it could not look at yet.
 */
export function DescribeNotice({ info }: { info: SemanticSearchInfo }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const jobs = useJobs();
  const busy = jobs.some(
    (j) =>
      (j.type === 'embeddings' || j.type === 'model-download') && (j.status === 'running' || j.status === 'queued'),
  );
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['media'] });
    queryClient.invalidateQueries({ queryKey: ['semantic-status'] });
  };
  const enable = usePatchSettings(refresh);
  const download = useMutation({
    mutationFn: api.semanticDownload,
    onSuccess: () => toast('Downloading the search model; index your files once it is ready.'),
    onError: (err) => toast(err.message),
  });
  const index = useMutation({
    mutationFn: api.semanticRun,
    onSuccess: () => toast('Indexing files for search…'),
    onError: (err) => toast(err.message),
  });

  const pending = `${info.pendingCount} file${info.pendingCount === 1 ? '' : 's'}`;
  let text: string;
  let action: { label: string; run: () => void; disabled?: boolean } | null;
  if (info.status === 'disabled') {
    text = 'Search by description is off.';
    action = { label: 'Turn it on', run: () => enable.mutate({ semantic_search_enabled: '1' }) };
  } else if (info.status === 'no-model') {
    text = 'Search by description needs its model first, about 155 MB.';
    action = { label: busy ? 'Downloading…' : 'Download', run: () => download.mutate(), disabled: busy };
  } else if (info.status === 'empty') {
    text = 'No file is indexed for search by description yet.';
    action = { label: busy ? 'Indexing…' : `Index ${pending}`, run: () => index.mutate(), disabled: busy };
  } else if (info.pendingCount > 0) {
    text = `${pending} not indexed yet ${info.pendingCount === 1 ? 'is' : 'are'} left out.`;
    action = busy ? null : { label: 'Index now', run: () => index.mutate() };
  } else {
    return null;
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-line bg-surface px-3.5 py-2.5 text-[12.5px] text-zinc-400">
      <span className="min-w-0 flex-1">{text}</span>
      {action && (
        <button type="button" className={button} disabled={action.disabled} onClick={action.run}>
          {action.label}
        </button>
      )}
      {info.status !== 'ready' && (
        <button
          type="button"
          className="flex-none cursor-pointer text-[12px] text-zinc-500 hover:text-zinc-200"
          onClick={() => navigate(settingHref('semantic-search'))}
        >
          Settings
        </button>
      )}
    </div>
  );
}

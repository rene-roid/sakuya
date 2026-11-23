import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Merge, X } from 'lucide-react';
import type { TagInfo, TagRelationResult } from '@sakuya/shared';
import { api } from '../../lib/api';
import { TagName } from '../../components/TagName';
import { invalidateAfterRelationChange, relationToast } from '../../components/TagRelationDialog';
import { toastError } from '../../components/Toast';

function Row({
  icon,
  from,
  to,
  onRemove,
  label,
}: {
  icon: ReactNode;
  from: TagInfo;
  to: TagInfo;
  onRemove: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 border-t border-line px-3.5 py-2 text-[12.5px] font-semibold first:border-t-0">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate text-zinc-300" title={from.name}>
          <TagName tag={from} />
        </span>
        <span className="flex-none text-zinc-500">{icon}</span>
        <span className="min-w-0 truncate text-zinc-100" title={to.name}>
          <TagName tag={to} />
        </span>
      </span>
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={onRemove}
        className="flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-btn text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
      >
        <X size={13} />
      </button>
    </div>
  );
}

/** Every merge and implication, each with a remove button. They are made from a tag's menu. */
export function TagRelations() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['tag-relations'], queryFn: api.tagRelations });
  const remove = useMutation({
    mutationFn: (run: () => Promise<TagRelationResult>) => run(),
    onSuccess: (result) => {
      invalidateAfterRelationChange(qc);
      relationToast(result, 'Relation removed');
    },
    onError: toastError,
  });

  if (!data) return null;
  if (!data.siblings.length && !data.implications.length) {
    return (
      <div className="px-0.5 text-[12.5px] text-zinc-600">
        None yet. Use “Merge into…” or “Implies…” on a tag in Explore or the viewer.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {data.siblings.length > 0 && (
        <div>
          <div className="mb-1.5 px-0.5 text-[11px] font-bold tracking-[0.4px] text-zinc-500">MERGED</div>
          <div className="overflow-hidden rounded-panel border border-line bg-surface glass:bg-white/[0.03]">
            {data.siblings.map((s) => (
              <Row
                key={s.from.name}
                icon={<Merge size={12} />}
                from={s.from}
                to={s.to}
                label={`Stop merging ${s.from.name} into ${s.to.name}`}
                onRemove={() => remove.mutate(() => api.removeTagSibling(s.from.name))}
              />
            ))}
          </div>
        </div>
      )}
      {data.implications.length > 0 && (
        <div>
          <div className="mb-1.5 px-0.5 text-[11px] font-bold tracking-[0.4px] text-zinc-500">IMPLIES</div>
          <div className="overflow-hidden rounded-panel border border-line bg-surface glass:bg-white/[0.03]">
            {data.implications.map((i) => (
              <Row
                key={`${i.tag.name}>${i.implies.name}`}
                icon={<ArrowRight size={12} />}
                from={i.tag}
                to={i.implies}
                label={`Remove ${i.tag.name} implies ${i.implies.name}`}
                onRemove={() => remove.mutate(() => api.removeTagImplication(i.tag.name, i.implies.name))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

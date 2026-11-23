import type { BulkFailure } from '@sakuya/shared';

export const TRASH_DAYS = 30;

/** The toast after a delete: how many went to the trash, and why any could not. */
export function movedToTrashMessage(moved: number, failed: BulkFailure[] = []): string {
  const head = `Moved ${moved} file${moved === 1 ? '' : 's'} to Trash`;
  if (!failed.length) return head;
  return `${head} · ${failed.length} could not be moved: ${failed[0].error}`;
}

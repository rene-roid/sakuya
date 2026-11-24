import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, X } from 'lucide-react';
import { dismissUpload, startUpload, useUploads } from '../lib/uploads';

const ACCEPT = 'image/*,video/*';

interface Library {
  id: number;
  name: string;
}

/** Opens the file picker and uploads the picked files into `library`. */
export function UploadButton({ library }: { library: Library | undefined }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={!library}
        title={library ? `Upload images or videos into ${library.name}, or drop them onto the grid` : undefined}
        onClick={() => input.current?.click()}
        className="flex flex-none cursor-pointer items-center gap-1.5 self-center rounded-btn border border-line px-3 py-1.5 text-[12.5px] font-semibold text-zinc-300 hover:border-line-strong hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 glass:bg-white/[0.04]"
      >
        <Upload size={14} />
        Upload
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (library && e.target.files) startUpload(e.target.files, library, queryClient);
          e.target.value = '';
        }}
      />
    </>
  );
}

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

/** Accepts files dropped anywhere on `children` and uploads them into `library`. */
export function UploadDropZone({ library, children }: { library: Library | undefined; children: ReactNode }) {
  const queryClient = useQueryClient();
  // Enter and leave fire for every child crossed, so count them rather than toggling.
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  // The wrapper stays put while the library loads, so the page inside never remounts.
  return (
    <div
      className="relative"
      onDragEnter={(e) => {
        if (!library || !hasFiles(e)) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!library || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!library || !hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!library || !hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        startUpload(e.dataTransfer.files, library, queryClient);
      }}
    >
      {children}
      {over && library && (
        <div className="pointer-events-none fixed inset-x-3 bottom-[calc(var(--dock-h)+12px)] top-[calc(var(--nav-h)+12px)] z-[60] flex items-center justify-center rounded-panel border-2 border-dashed border-accent bg-zinc-950/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-center">
            <Upload size={26} className="text-zinc-300" />
            <div className="text-[14px] font-semibold text-zinc-100">Drop to upload into {library.name}</div>
            <div className="text-[12px] text-zinc-400">Images and videos</div>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_COLOR = { done: 'text-green-500', uploading: 'text-accent', error: 'text-red-500' };

/** Progress for every upload in flight, wherever it was started from. */
export function UploadTray() {
  const rows = useUploads();
  if (!rows.length) return null;
  return (
    <div className="fixed bottom-[calc(var(--dock-h)+16px)] left-4 z-[65] flex w-[300px] max-w-[calc(100vw-32px)] flex-col gap-1.5">
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex items-center gap-2.5 rounded-panel border border-line-strong bg-zinc-900 px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-zinc-200">{row.label}</div>
            <div className="truncate text-[11px] text-zinc-500">into {row.libraryName}</div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full transition-[width] duration-200 ${row.status === 'error' ? 'bg-red-500' : 'bg-accent'}`}
                style={{ width: `${row.progress}%` }}
              />
            </div>
          </div>
          <span className={`text-[10.5px] font-bold uppercase tracking-[0.3px] ${STATUS_COLOR[row.status]}`}>
            {row.status === 'uploading' ? `${row.progress}%` : row.status}
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissUpload(row.id)}
            className="flex cursor-pointer text-zinc-500 hover:text-zinc-300"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, Square, CornerDownLeft } from 'lucide-react';
import type { ConsoleSessionStatus } from '@sakuya/shared';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';

const MAX_CLIENT_BUFFER = 200_000;

export function DownloaderConsole() {
  const [buffer, setBuffer] = useState('');
  const [status, setStatus] = useState<ConsoleSessionStatus | null>(null);
  const [input, setInput] = useState('');
  const outputRef = useRef<HTMLPreElement>(null);
  const showToast = useToast();

  useEffect(() => {
    const source = new EventSource('/api/downloader/console/stream');
    source.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'snapshot') {
        setBuffer(data.buffer);
        setStatus(data.status);
        return;
      }
      if (data.type === 'data') {
        setBuffer((prev) => (prev + data.chunk).slice(-MAX_CLIENT_BUFFER));
        return;
      }
      if (data.type === 'status') {
        setStatus(data.status);
      }
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [buffer]);

  const startMutation = useMutation({
    mutationFn: (command: string) => api.startConsole(command),
    onError: (err: Error) => showToast(err.message),
  });
  const stopMutation = useMutation({
    mutationFn: () => api.stopConsole(),
    onError: (err: Error) => showToast(err.message),
  });
  const inputMutation = useMutation({
    mutationFn: (text: string) => api.sendConsoleInput(text),
    onError: (err: Error) => showToast(err.message),
  });

  const running = status?.running ?? false;

  // Sends the current input as raw stdin to whatever process is running, never as a new
  // `gallery-dl <input>` invocation — the explicit escape hatch for when the auto-detected
  // running state is stale (e.g. the process just died) and Enter would otherwise misfire.
  const sendAsInput = () => {
    if (!input) return;
    inputMutation.mutate(input);
    setInput('');
  };

  const submit = () => {
    if (running) {
      sendAsInput();
    } else {
      if (!input.trim()) return;
      startMutation.mutate(input.trim());
      setInput('');
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#111113] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[13.5px] font-bold">gallery-dl console</div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold ${running ? 'text-amber-500' : 'text-zinc-600'}`}>
            {running ? `Running${status?.pid ? ` (pid ${status.pid})` : ''}` : 'Idle'}
          </span>
          {running && (
            <button
              onClick={() => stopMutation.mutate()}
              className="flex cursor-pointer items-center gap-1 rounded-[7px] border border-zinc-800 px-2.5 py-1 text-[11.5px] text-zinc-400 hover:text-red-400"
            >
              <Square size={12} /> Stop
            </button>
          )}
        </div>
      </div>
      <div className="mb-3 text-[11.5px] leading-relaxed text-zinc-500">
        Run gallery-dl commands directly — useful for interactive logins (e.g.{' '}
        <span className="font-mono text-zinc-400">oauth:pixiv</span>) or entering 2FA codes. Type a command and press
        Enter (or click Run) to start it. While it's running, Enter sends your text to the process as input. If you
        need to guarantee your text is sent as input and never run as a new <span className="font-mono text-zinc-400">gallery-dl</span> command,
        use "Send as input" instead.
      </div>
      <pre
        ref={outputRef}
        className="mb-3 h-[360px] overflow-y-auto whitespace-pre-wrap break-all rounded-[7px] border border-zinc-800 bg-black/40 p-3 font-mono text-[12px] leading-relaxed text-zinc-300"
      >
        {buffer || 'No output yet.'}
      </pre>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12.5px] text-zinc-600">{running ? '>' : '$ gallery-dl'}</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder={running ? 'Type a response…' : 'e.g. oauth:pixiv'}
          className="flex-1 rounded-[7px] border border-zinc-800 bg-zinc-900 px-2.5 py-[7px] font-mono text-[12.5px] text-zinc-100 outline-none placeholder:text-zinc-600"
        />
        {!running && (
          <button
            onClick={submit}
            disabled={!input.trim() || startMutation.isPending}
            className="flex cursor-pointer items-center gap-1.5 rounded-[7px] bg-accent px-3.5 py-[7px] text-[12.5px] font-semibold text-white disabled:opacity-40"
          >
            <Play size={13} /> Run
          </button>
        )}
        <button
          onClick={sendAsInput}
          disabled={!input || inputMutation.isPending}
          title="Send this text straight to the running process's stdin — never runs it as a new gallery-dl command"
          className="flex cursor-pointer items-center gap-1.5 rounded-[7px] border border-zinc-800 px-3.5 py-[7px] text-[12.5px] font-semibold text-zinc-300 hover:text-zinc-100 disabled:opacity-40"
        >
          <CornerDownLeft size={13} /> Send as input
        </button>
      </div>
    </div>
  );
}

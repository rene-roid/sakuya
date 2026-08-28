import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';

export function LoginGate() {
  const { login } = useAuth();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!secret || submitting) return;
    setSubmitting(true);
    setError(null);
    const err = await login(secret);
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    setSecret('');
  }

  return (
    <div className="grid min-h-screen place-items-center bg-zinc-950 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-zinc-800 bg-zinc-900/60 p-6 shadow-lg"
      >
        <h1 className="mb-1 text-lg font-semibold text-zinc-50">
          Sakuya<span className="text-accent">.</span>
        </h1>
        <p className="mb-4 text-sm text-zinc-400">This site is password protected.</p>
        <input
          type="password"
          autoFocus
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Password"
          className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !secret}
          className="mt-4 w-full cursor-pointer rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}

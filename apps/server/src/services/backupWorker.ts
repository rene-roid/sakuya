import { Database } from 'bun:sqlite';

declare const self: Worker;

self.onmessage = (event: MessageEvent<{ source: string; target: string }>) => {
  const { source, target } = event.data;
  let db: Database | null = null;
  try {
    db = new Database(source, { readonly: true });
    db.query('VACUUM INTO ?').run(target);
    postMessage({});
  } catch (err) {
    postMessage({ error: (err as Error).message });
  } finally {
    db?.close();
  }
};

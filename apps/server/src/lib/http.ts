import path from 'node:path';
import type { Request as ExpressRequest, Response, NextFunction, RequestHandler } from 'express';

/** Express 4 doesn't forward async rejections to the error handler. */
export function wrap(fn: (req: ExpressRequest, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function intParam(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error('Invalid id'), { status: 400 });
  return n;
}

/** Buffer the raw body and let Bun's fetch primitives parse the multipart form. */
export async function readFormData(req: ExpressRequest) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const request = new Request('http://localhost' + req.originalUrl, {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] ?? '' },
    body: Buffer.concat(chunks),
  });
  return request.formData();
}

/** The File parts of a form field; string parts are dropped. */
export function formFiles(form: Awaited<ReturnType<typeof readFormData>>, field: string) {
  return form.getAll(field).filter((f) => typeof f !== 'string');
}

/**
 * A client-supplied filename made safe to join onto a directory. The name comes straight from the
 * multipart header, so a crafted request can send `../../x` and write outside the target folder.
 */
export function sanitizeFilename(name: string): string {
  return path
    .basename(name)
    .replace(/[^\w.\-()[\] ]+/g, '_')
    .slice(-120);
}

/**
 * Start a server-sent event stream. `send` writes one JSON event; the returned cleanup hook runs
 * once the client disconnects, alongside stopping the keep-alive ping.
 */
export function openEventStream(
  req: ExpressRequest,
  res: Response,
): { send: (event: unknown) => void; onClose: (fn: () => void) => void } {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
  const cleanups: (() => void)[] = [() => clearInterval(heartbeat)];
  req.on('close', () => {
    for (const fn of cleanups) fn();
  });
  return {
    send: (event) => res.write(`data: ${JSON.stringify(event)}\n\n`),
    onClose: (fn) => cleanups.push(fn),
  };
}

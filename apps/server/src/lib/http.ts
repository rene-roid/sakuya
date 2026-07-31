import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Express 4 doesn't forward async rejections to the error handler. */
export function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function intParam(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error('Invalid id'), { status: 400 });
  return n;
}

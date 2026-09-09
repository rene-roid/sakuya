import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { wrap, intParam } from '../lib/http';

export const savedSearchesRouter = Router();

savedSearchesRouter.get(
  '/api/saved-searches',
  wrap(async (_req, res) => {
    res.json(db.select().from(schema.savedSearches).orderBy(schema.savedSearches.createdAt).all());
  }),
);

const savedSearchBody = z.object({
  name: z.string().trim().min(1).max(120),
  query: z.string().max(2000),
});

savedSearchesRouter.post(
  '/api/saved-searches',
  wrap(async (req, res) => {
    const body = savedSearchBody.parse(req.body);
    // Re-saving under an existing name overwrites it, so the list doesn't fill with near-duplicates.
    const row = db
      .insert(schema.savedSearches)
      .values({ name: body.name, query: body.query, createdAt: Date.now() })
      .onConflictDoUpdate({ target: schema.savedSearches.name, set: { query: body.query } })
      .returning()
      .get();
    res.status(201).json(row);
  }),
);

savedSearchesRouter.delete(
  '/api/saved-searches/:id',
  wrap(async (req, res) => {
    db.delete(schema.savedSearches).where(eq(schema.savedSearches.id, intParam(req.params.id))).run();
    res.json({ ok: true });
  }),
);

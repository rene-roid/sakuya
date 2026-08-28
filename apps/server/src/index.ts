import express from 'express';
import { PORT } from './lib/config';
import './db';
import { librariesRouter } from './routes/libraries';
import { mediaRouter } from './routes/media';
import { tagsRouter } from './routes/tags';
import { uploadsRouter } from './routes/uploads';
import { jobsRouter } from './routes/jobs';
import { settingsRouter } from './routes/settings';
import { taggerRouter } from './routes/tagger';
import { dashboardRouter } from './routes/dashboard';
import { downloaderRouter } from './routes/downloader';
import { authRouter } from './routes/auth';
import { requireAuth } from './lib/auth';
import { initScheduler } from './services/jobScheduler';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use(authRouter);
app.use(requireAuth);

app.use(uploadsRouter); // must come before express.json would matter; multipart parsed manually
app.use(librariesRouter);
app.use(mediaRouter);
app.use(tagsRouter);
app.use(jobsRouter);
app.use(settingsRouter);
app.use(taggerRouter);
app.use(dashboardRouter);
app.use(downloaderRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err?.status ?? (err?.name === 'ZodError' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err?.message ?? 'Internal error', issues: err?.issues });
});

app.listen(PORT, () => {
  console.log(`Sakuya server listening on http://localhost:${PORT}`);
  initScheduler();
});

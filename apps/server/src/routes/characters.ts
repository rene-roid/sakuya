import { Router } from 'express';
import { z } from 'zod';
import { intParam, wrap } from '../lib/http';
import {
  acceptSuggestion,
  assignDetection,
  characterMedia,
  characterStatus,
  detectionCropPath,
  enqueueCharacterJob,
  getCharacter,
  listCharacters,
  mediaDetections,
  mergeCharacters,
  nameCharacter,
  rejectDetection,
  setCharacterCover,
  setCharacterHidden,
  unscannedMediaIds,
} from '../services/characters';
import { characterModelsReady, enqueueCharacterModelDownload } from '../services/characterModels';

export const charactersRouter = Router();

charactersRouter.get(
  '/api/characters/status',
  wrap(async (_req, res) => {
    res.json(characterStatus());
  }),
);

charactersRouter.post(
  '/api/characters/download',
  wrap(async (_req, res) => {
    const { status } = characterStatus();
    if (status === 'downloading') return res.status(409).json({ error: 'Download already running' });
    if (status === 'ready') return res.status(409).json({ error: 'Character models already downloaded' });
    res.json({ job: enqueueCharacterModelDownload() });
  }),
);

charactersRouter.post(
  '/api/characters/run',
  wrap(async (_req, res) => {
    if (!characterModelsReady()) return res.status(409).json({ error: 'Character models not downloaded' });
    const ids = unscannedMediaIds();
    if (!ids.length) return res.status(409).json({ error: 'Every file has been scanned for characters' });
    res.json({ job: enqueueCharacterJob(ids, `Find characters (${ids.length} files)`) });
  }),
);

charactersRouter.get(
  '/api/characters',
  wrap(async (req, res) => {
    res.json(listCharacters(req.query.hidden === '1'));
  }),
);

charactersRouter.get(
  '/api/characters/crops/:detectionId',
  wrap(async (req, res) => {
    const file = await detectionCropPath(intParam(req.params.detectionId));
    res.sendFile(file, { cacheControl: true, maxAge: '1h' });
  }),
);

charactersRouter.get(
  '/api/characters/:id',
  wrap(async (req, res) => {
    res.json(getCharacter(intParam(req.params.id)));
  }),
);

const pageSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

charactersRouter.get(
  '/api/characters/:id/media',
  wrap(async (req, res) => {
    const { offset, limit } = pageSchema.parse(req.query);
    res.json(characterMedia(intParam(req.params.id), offset, limit));
  }),
);

charactersRouter.post(
  '/api/characters/:id/name',
  wrap(async (req, res) => {
    const { name } = z.object({ name: z.string().min(1).max(200) }).parse(req.body);
    res.json(nameCharacter(intParam(req.params.id), name));
  }),
);

charactersRouter.post(
  '/api/characters/:id/accept-suggestion',
  wrap(async (req, res) => {
    res.json(acceptSuggestion(intParam(req.params.id)));
  }),
);

charactersRouter.post(
  '/api/characters/:id/merge',
  wrap(async (req, res) => {
    const { into } = z.object({ into: z.number().int().positive() }).parse(req.body);
    res.json(mergeCharacters(intParam(req.params.id), into));
  }),
);

charactersRouter.post(
  '/api/characters/:id/hidden',
  wrap(async (req, res) => {
    const { hidden } = z.object({ hidden: z.boolean() }).parse(req.body);
    res.json(setCharacterHidden(intParam(req.params.id), hidden));
  }),
);

charactersRouter.post(
  '/api/characters/:id/cover',
  wrap(async (req, res) => {
    const { detectionId } = z.object({ detectionId: z.number().int().positive() }).parse(req.body);
    res.json(setCharacterCover(intParam(req.params.id), detectionId));
  }),
);

charactersRouter.post(
  '/api/character-detections/:id/reject',
  wrap(async (req, res) => {
    res.json(rejectDetection(intParam(req.params.id)));
  }),
);

charactersRouter.post(
  '/api/character-detections/:id/assign',
  wrap(async (req, res) => {
    const { characterId } = z.object({ characterId: z.number().int().positive() }).parse(req.body);
    res.json(assignDetection(intParam(req.params.id), characterId));
  }),
);

charactersRouter.get(
  '/api/media/:id/detections',
  wrap(async (req, res) => {
    res.json(mediaDetections(intParam(req.params.id)));
  }),
);

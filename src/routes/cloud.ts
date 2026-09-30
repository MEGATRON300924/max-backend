import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { cloudUsage, deleteCloudFile, listCloudFiles, readCloudFile, saveCloudFile } from '../services/cloud.service.js';
import { resolveEcosystemUser } from '../services/user.service.js';

const router = Router();
router.use(requireAuth);

router.get('/usage', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    res.json({ data: await cloudUsage(user.id), tier: req.auth!.tier ?? 'FREE' });
  } catch (error) { next(error); }
});

router.get('/files', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    res.json({ data: await listCloudFiles(user.id) });
  } catch (error) { next(error); }
});

router.post('/files', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const body = z.object({
      filename: z.string().min(1).max(255),
      mimeType: z.string().max(255).default('application/octet-stream'),
      contentBase64: z.string().min(1)
    }).parse(req.body);
    const content = Buffer.from(body.contentBase64, 'base64');
    const file = await saveCloudFile(user.id, req.auth!.tier, { originalName: body.filename, mimeType: body.mimeType, content });
    res.status(201).json({ data: file });
  } catch (error) { next(error); }
});

router.get('/files/:id/download', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const id = z.string().uuid().parse(req.params.id);
    const { file, content } = await readCloudFile(user.id, id);
    res.type(file.mimeType);
    res.setHeader('Content-Length', String(content.length));
    res.setHeader('Content-Disposition', `attachment; filename="${file.originalName.replace(/"/g, '')}"`);
    res.send(content);
  } catch (error) { next(error); }
});

router.delete('/files/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const id = z.string().uuid().parse(req.params.id);
    await deleteCloudFile(user.id, id);
    res.json({ data: { deleted: true } });
  } catch (error) { next(error); }
});

export const cloudRouter = router;

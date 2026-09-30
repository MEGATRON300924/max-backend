import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { maxOsManifest } from '../services/os.service.js';

const router = Router();
router.use(requireAuth);
router.get('/manifest', (_req, res) => res.json({ data: maxOsManifest() }));
export const osRouter = router;

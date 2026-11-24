import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { resolveEcosystemUser } from '../services/user.service.js';

const router = Router();
router.use(requireAuth);

const RETENTION_HOURS = 24;
const MAX_FILES = 100;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const projectIdSchema = z.string().uuid();
const fileIdSchema = z.string().uuid();

function expiryFromNow() {
  return new Date(Date.now() + RETENTION_HOURS * 60 * 60 * 1000);
}

export function normalizeProjectPath(value: string) {
  const path = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.length > 240 || path.startsWith('/') || /^[a-z]:/i.test(path)) {
    throw new ApiError(400, 'PROJECT_FILE_PATH_INVALID', 'Use a valid relative file path.');
  }
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.length > 100 || /[\u0000-\u001f<>:"|?*]/.test(part))) {
    throw new ApiError(400, 'PROJECT_FILE_PATH_INVALID', 'The file path contains an unsupported folder or filename.');
  }
  return parts.join('/');
}

export function mimeTypeForPath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
    mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    txt: 'text/plain', md: 'text/markdown', xml: 'application/xml'
  };
  return types[extension || ''] || 'text/plain';
}

async function getUser(req: AuthenticatedRequest) {
  return resolveEcosystemUser(req.auth!);
}

async function expireOldProjects(userId: string) {
  await prisma.projectWorkspace.deleteMany({
    where: { userId, expiresAt: { lte: new Date() } }
  });
}

async function getWorkspaceForUser(id: string, userId: string) {
  const workspace = await prisma.projectWorkspace.findFirst({
    where: { id, userId, expiresAt: { gt: new Date() } },
    include: { _count: { select: { files: true } } }
  });
  if (!workspace) throw new ApiError(404, 'PROJECT_WORKSPACE_NOT_FOUND', 'This project workspace is unavailable or has expired.');
  return workspace;
}

async function touchWorkspace(id: string) {
  const now = new Date();
  return prisma.projectWorkspace.update({
    where: { id },
    data: { lastActivityAt: now, expiresAt: expiryFromNow() }
  });
}

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    await expireOldProjects(user.id);
    const projects = await prisma.projectWorkspace.findMany({
      where: { userId: user.id },
      orderBy: { lastActivityAt: 'desc' },
      include: { _count: { select: { files: true } } }
    });
    res.json({ data: projects.map(({ _count, ...project }) => ({ ...project, fileCount: _count.files })) });
  } catch (error) { next(error); }
});

router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = z.object({
      name: z.string().trim().min(1).max(100),
      conversationId: z.string().uuid().optional()
    }).parse(req.body);
    const user = await getUser(req);
    await expireOldProjects(user.id);
    if (input.conversationId) {
      const conversation = await prisma.conversation.findFirst({ where: { id: input.conversationId, userId: user.id }, select: { id: true } });
      if (!conversation) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'The selected conversation was not found.');
    }
    const count = await prisma.projectWorkspace.count({ where: { userId: user.id } });
    if (count >= 20) throw new ApiError(429, 'PROJECT_WORKSPACE_LIMIT', 'You have reached the limit of 20 active project workspaces. Delete an older project before creating another.');
    const workspace = await prisma.projectWorkspace.create({
      data: { userId: user.id, conversationId: input.conversationId, name: input.name, expiresAt: expiryFromNow() },
      include: { files: { select: { id: true, path: true, mimeType: true, sizeBytes: true, updatedAt: true } } }
    });
    res.status(201).json({ data: workspace, retentionHours: RETENTION_HOURS });
  } catch (error) { next(error); }
});

router.get('/:projectId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    const projectId = projectIdSchema.parse(req.params.projectId);
    const workspace = await getWorkspaceForUser(projectId, user.id);
    await touchWorkspace(projectId);
    const files = await prisma.projectFile.findMany({
      where: { workspaceId: projectId },
      orderBy: { path: 'asc' },
      select: { id: true, path: true, mimeType: true, sizeBytes: true, createdAt: true, updatedAt: true }
    });
    res.json({ data: { ...workspace, files }, retentionHours: RETENTION_HOURS });
  } catch (error) { next(error); }
});

router.put('/:projectId/files', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = z.object({
      path: z.string().min(1).max(240),
      content: z.string().max(MAX_FILE_BYTES),
      mimeType: z.string().trim().max(100).optional()
    }).parse(req.body);
    const user = await getUser(req);
    const projectId = projectIdSchema.parse(req.params.projectId);
    await getWorkspaceForUser(projectId, user.id);
    const path = normalizeProjectPath(input.path);
    const sizeBytes = Buffer.byteLength(input.content, 'utf8');
    if (sizeBytes > MAX_FILE_BYTES) throw new ApiError(413, 'PROJECT_FILE_TOO_LARGE', 'Each project file must be 512 KB or smaller.');
    const existing = await prisma.projectFile.findUnique({ where: { workspaceId_path: { workspaceId: projectId, path } }, select: { id: true } });
    const fileCount = await prisma.projectFile.count({ where: { workspaceId: projectId } });
    if (!existing && fileCount >= MAX_FILES) throw new ApiError(413, 'PROJECT_FILE_LIMIT', 'A project can contain up to 100 files.');
    const current = await prisma.projectFile.aggregate({ where: { workspaceId: projectId }, _sum: { sizeBytes: true } });
    const previousSize = existing
      ? (await prisma.projectFile.findUnique({ where: { id: existing.id }, select: { sizeBytes: true } }))?.sizeBytes || 0
      : 0;
    if ((current._sum.sizeBytes || 0) - previousSize + sizeBytes > MAX_PROJECT_BYTES) {
      throw new ApiError(413, 'PROJECT_SIZE_LIMIT', 'A project can contain up to 5 MB of source files.');
    }
    const file = await prisma.projectFile.upsert({
      where: { workspaceId_path: { workspaceId: projectId, path } },
      create: { workspaceId: projectId, path, content: input.content, mimeType: input.mimeType || mimeTypeForPath(path), sizeBytes },
      update: { content: input.content, mimeType: input.mimeType || mimeTypeForPath(path), sizeBytes }
    });
    await touchWorkspace(projectId);
    res.json({ data: { id: file.id, path: file.path, mimeType: file.mimeType, sizeBytes: file.sizeBytes, updatedAt: file.updatedAt } });
  } catch (error) { next(error); }
});

router.get('/:projectId/files/:fileId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    const projectId = projectIdSchema.parse(req.params.projectId);
    const fileId = fileIdSchema.parse(req.params.fileId);
    await getWorkspaceForUser(projectId, user.id);
    const file = await prisma.projectFile.findFirst({
      where: { id: fileId, workspaceId: projectId },
      select: { id: true, path: true, content: true, mimeType: true, sizeBytes: true, updatedAt: true }
    });
    if (!file) throw new ApiError(404, 'PROJECT_FILE_NOT_FOUND', 'Project file not found.');
    await touchWorkspace(projectId);
    res.json({ data: file });
  } catch (error) { next(error); }
});

router.delete('/:projectId/files/:fileId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    const projectId = projectIdSchema.parse(req.params.projectId);
    const fileId = fileIdSchema.parse(req.params.fileId);
    await getWorkspaceForUser(projectId, user.id);
    const result = await prisma.projectFile.deleteMany({ where: { id: fileId, workspaceId: projectId } });
    if (!result.count) throw new ApiError(404, 'PROJECT_FILE_NOT_FOUND', 'Project file not found.');
    await touchWorkspace(projectId);
    res.status(204).send();
  } catch (error) { next(error); }
});

router.delete('/:projectId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    const projectId = projectIdSchema.parse(req.params.projectId);
    await getWorkspaceForUser(projectId, user.id);
    await prisma.projectWorkspace.delete({ where: { id: projectId } });
    res.status(204).send();
  } catch (error) { next(error); }
});

export const projectsRouter = router;

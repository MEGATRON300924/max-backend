import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errors.js';
import { env } from '../config/env.js';

const tierQuota: Record<string, number> = {
  FREE: 100 * 1024 * 1024,
  PLUS: 5 * 1024 * 1024 * 1024,
  PRO: 50 * 1024 * 1024 * 1024,
  BUSINESS: 250 * 1024 * 1024 * 1024,
  ENTERPRISE: 1024 * 1024 * 1024 * 1024
};

function root() {
  return path.resolve(env.MAX_CLOUD_STORAGE_PATH);
}
function safeName(name: string) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_').trim();
  return (base || 'file').slice(0, 240);
}
function safeStoragePath(storageKey: string) {
  const resolved = path.resolve(root(), storageKey);
  if (resolved !== root() && !resolved.startsWith(root() + path.sep)) throw new ApiError(400, 'CLOUD_PATH_INVALID', 'Invalid cloud storage path');
  return resolved;
}
function quotaFor(tier?: string | null): number {
  const value = tierQuota[String(tier || 'FREE').toUpperCase()];
  return value ?? 100 * 1024 * 1024;
}

export async function cloudUsage(userId: string) {
  const rows = await prisma.cloudFile.aggregate({ where: { userId }, _sum: { sizeBytes: true }, _count: { _all: true } });
  return { bytes: Number(rows._sum.sizeBytes ?? 0), files: rows._count._all };
}

export async function listCloudFiles(userId: string) {
  const files = await prisma.cloudFile.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, originalName: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true, updatedAt: true }
  });
  return files.map((file) => ({ ...file, sizeBytes: Number(file.sizeBytes) }));
}

export async function saveCloudFile(userId: string, tier: string | null | undefined, input: { originalName: string; mimeType: string; content: Buffer }) {
  if (!input.content.length) throw new ApiError(400, 'CLOUD_EMPTY_FILE', 'The uploaded file is empty');
  if (input.content.length > env.MAX_CLOUD_FILE_BYTES) throw new ApiError(413, 'CLOUD_FILE_TOO_LARGE', 'The uploaded file exceeds the MAX Cloud file limit');
  const usage = await cloudUsage(userId);
  const quota = quotaFor(tier);
  if (usage.bytes + input.content.length > quota) throw new ApiError(413, 'CLOUD_QUOTA_EXCEEDED', 'Your MAX Cloud storage quota has been reached');
  const id = crypto.randomUUID();
  const name = safeName(input.originalName);
  const storageKey = userId + '/' + id + '-' + name;
  const target = safeStoragePath(storageKey);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, input.content, { flag: 'wx' });
  const sha256 = crypto.createHash('sha256').update(input.content).digest('hex');
  try {
    return await prisma.cloudFile.create({
      data: { id, userId, originalName: name, storageKey, mimeType: input.mimeType || 'application/octet-stream', sizeBytes: input.content.length, sha256 },
      select: { id: true, originalName: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true, updatedAt: true }
    }).then((file) => ({ ...file, sizeBytes: Number(file.sizeBytes) }));
  } catch (error) {
    await fs.rm(target, { force: true });
    throw error;
  }
}

export async function readCloudFile(userId: string, id: string) {
  const file = await prisma.cloudFile.findFirst({ where: { id, userId } });
  if (!file) throw new ApiError(404, 'CLOUD_FILE_NOT_FOUND', 'Cloud file not found');
  const target = safeStoragePath(file.storageKey);
  try {
    return { file, content: await fs.readFile(target) };
  } catch {
    throw new ApiError(404, 'CLOUD_FILE_MISSING', 'Cloud file data is unavailable');
  }
}

export async function deleteCloudFile(userId: string, id: string) {
  const file = await prisma.cloudFile.findFirst({ where: { id, userId } });
  if (!file) throw new ApiError(404, 'CLOUD_FILE_NOT_FOUND', 'Cloud file not found');
  await fs.rm(safeStoragePath(file.storageKey), { force: true });
  await prisma.cloudFile.delete({ where: { id: file.id } });
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { ApiError } from '../middleware/errors.js';
import { env } from '../config/env.js';

export type CloudUploadInput = {
  originalName: string;
  mimeType: string;
  content: Buffer;
};

export type CloudStoredFile = {
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

export interface CloudStorageProvider {
  upload(input: CloudUploadInput): Promise<CloudStoredFile>;
  download(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

class LocalCloudProvider implements CloudStorageProvider {
  private root() {
    return path.resolve(env.MAX_CLOUD_STORAGE_PATH);
  }

  private safeStoragePath(storageKey: string) {
    const root = this.root();
    const resolved = path.resolve(root, storageKey);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new ApiError(400, 'CLOUD_PATH_INVALID', 'Invalid cloud storage path');
    }
    return resolved;
  }

  async upload(input: CloudUploadInput) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const name = safeName(input.originalName);
    const storageKey = id + '-' + name;
    const target = this.safeStoragePath(storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, input.content, { flag: 'wx' });
    return { storageKey, originalName: name, mimeType: input.mimeType, sizeBytes: input.content.length };
  }

  async download(storageKey: string) {
    try {
      return await fs.readFile(this.safeStoragePath(storageKey));
    } catch {
      throw new ApiError(404, 'CLOUD_FILE_MISSING', 'Cloud file data is unavailable');
    }
  }

  async delete(storageKey: string) {
    await fs.rm(this.safeStoragePath(storageKey), { force: true });
  }
}

class MediaFireProvider implements CloudStorageProvider {
  private readonly baseUrl = env.MEDIAFIRE_API_URL.replace(/\/$/, '');
  private readonly sessionToken = env.MEDIAFIRE_SESSION_TOKEN!;

  private async json<T>(endpoint: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.baseUrl + endpoint, init);
    const text = await response.text();
    let body: any;
    try { body = JSON.parse(text); } catch { throw new ApiError(502, 'MEDIAFIRE_INVALID_RESPONSE', 'MediaFire returned an invalid response'); }
    const result = body?.response;
    if (!response.ok || result?.result === 'Error') {
      throw new ApiError(502, 'MEDIAFIRE_API_ERROR', result?.message || 'MediaFire API request failed');
    }
    return result as T;
  }

  async upload(input: CloudUploadInput) {
    const params = new URLSearchParams({
      session_token: this.sessionToken,
      response_format: 'json',
      action_on_duplicate: 'keep'
    });
    if (env.MEDIAFIRE_ROOT_FOLDER_KEY) params.set('folder_key', env.MEDIAFIRE_ROOT_FOLDER_KEY);

    const form = new FormData();
    form.append('fileUpload', new Blob([new Uint8Array(input.content)], { type: input.mimeType }), safeName(input.originalName));

    const result = await this.json<any>('/upload/simple.php?' + params.toString(), { method: 'POST', body: form });
    const quickKey = result?.doupload?.quickkey ?? result?.doupload?.quick_key ?? result?.doupload?.key;
    if (!quickKey) throw new ApiError(502, 'MEDIAFIRE_UPLOAD_FAILED', 'MediaFire did not return a file key');

    return {
      storageKey: String(quickKey),
      originalName: safeName(input.originalName),
      mimeType: input.mimeType || 'application/octet-stream',
      sizeBytes: input.content.length
    };
  }

  async download(storageKey: string) {
    const params = new URLSearchParams({
      session_token: this.sessionToken,
      quick_key: storageKey,
      link_type: 'direct_download',
      response_format: 'json'
    });
    const result = await this.json<any>('/file/get_links.php?' + params.toString());
    const directUrl = result?.links?.[0]?.direct_download;
    if (!directUrl) throw new ApiError(404, 'MEDIAFIRE_FILE_NOT_FOUND', 'MediaFire download link is unavailable');

    const response = await fetch(directUrl);
    if (!response.ok) throw new ApiError(404, 'MEDIAFIRE_FILE_NOT_FOUND', 'MediaFire file is unavailable');
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(storageKey: string) {
    const params = new URLSearchParams({
      session_token: this.sessionToken,
      quick_key: storageKey,
      response_format: 'json'
    });
    await this.json('/file/delete.php?' + params.toString());
  }
}

function safeName(name: string) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_').trim();
  return (base || 'file').slice(0, 240);
}

export function createCloudStorageProvider(): CloudStorageProvider {
  if (env.MAX_CLOUD_PROVIDER === 'mediafire') {
    if (!env.MEDIAFIRE_SESSION_TOKEN) {
      throw new ApiError(503, 'MEDIAFIRE_NOT_CONFIGURED', 'MAX Cloud is configured for MediaFire but its session token is missing');
    }
    return new MediaFireProvider();
  }
  return new LocalCloudProvider();
}

import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

function credentials() {
  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret) throw new ApiError(503, 'CLOUDINARY_NOT_CONFIGURED', 'MAX image storage is not configured yet. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to the MAX Backend service.');
  return { cloudName, apiKey, apiSecret };
}

function signatureFor(params: Record<string, string | number>, secret: string) {
  const canonical = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + '=' + String(value)).join('&');
  return crypto.createHash('sha1').update(canonical + secret).digest('hex');
}

export function createChatImageUploadSignature(userId: string, conversationId: string, attachmentId: string) {
  const { cloudName, apiKey, apiSecret } = credentials();
  const folder = 'max-ai/chat/' + userId + '/' + conversationId;
  const publicId = folder + '/' + attachmentId;
  const timestamp = Math.floor(Date.now() / 1000);
  const type = 'authenticated';
  const signature = signatureFor({ folder, public_id: publicId, timestamp, type }, apiSecret);
  return { cloudName, apiKey, timestamp, signature, folder, publicId, type };
}

export function verifyChatImageUpload(input: { userId: string; conversationId: string; attachmentId: string; publicId: string; version: number; signature: string }) {
  const { apiSecret } = credentials();
  const expectedPublicId = 'max-ai/chat/' + input.userId + '/' + input.conversationId + '/' + input.attachmentId;
  if (input.publicId !== expectedPublicId || !Number.isSafeInteger(input.version) || input.version < 1) throw new ApiError(400, 'CLOUDINARY_ASSET_MISMATCH', 'The uploaded image does not match its signed MAX attachment.');
  const expected = signatureFor({ public_id: input.publicId, version: input.version }, apiSecret);
  const actualBuffer = Buffer.from(input.signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) throw new ApiError(400, 'CLOUDINARY_SIGNATURE_INVALID', 'Cloudinary could not verify the uploaded image signature.');
}

export function cloudinaryImageUrl(publicId: string, version: number, format: string) {
  const { cloudName, apiSecret } = credentials();
  const encodedId = publicId.split('/').map(encodeURIComponent).join('/');
  const deliveryPath = 'v' + version + '/' + publicId + '.' + format;
  const digest = crypto.createHash('sha1').update(deliveryPath + apiSecret).digest();
  const urlSignature = digest.toString('base64').replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '').slice(0, 8);
  return 'https://res.cloudinary.com/' + encodeURIComponent(cloudName) + '/image/authenticated/s--' + urlSignature + '--/v' + version + '/' + encodedId + '.' + encodeURIComponent(format);
}

export async function getCloudinaryImageDetails(publicId: string) {
  const { cloudName, apiKey, apiSecret } = credentials();
  const encodedId = publicId.split('/').map(encodeURIComponent).join('/');
  const response = await fetch('https://api.cloudinary.com/v1_1/' + encodeURIComponent(cloudName) + '/resources/image/upload/' + encodedId, {
    headers: { Authorization: 'Basic ' + Buffer.from(apiKey + ':' + apiSecret).toString('base64'), Accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({})) as { public_id?: string; version?: number; format?: string; bytes?: number; width?: number; height?: number; error?: { message?: string } };
  if (!response.ok || payload.public_id !== publicId || !payload.version || !payload.format || !payload.bytes) {
    throw new ApiError(502, 'CLOUDINARY_ASSET_LOOKUP_FAILED', payload.error?.message || 'Cloudinary could not verify the uploaded image.');
  }
  return { version: Number(payload.version), format: String(payload.format).toLowerCase(), bytes: Number(payload.bytes), width: payload.width ? Number(payload.width) : undefined, height: payload.height ? Number(payload.height) : undefined };
}

export async function deleteCloudinaryImage(publicId: string) {
  const { cloudName, apiKey, apiSecret } = credentials();
  const timestamp = Math.floor(Date.now() / 1000);
  const invalidate = 'true';
  const signature = signatureFor({ invalidate, public_id: publicId, timestamp }, apiSecret);
  const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), invalidate, api_key: apiKey, signature });
  const response = await fetch('https://api.cloudinary.com/v1_1/' + encodeURIComponent(cloudName) + '/image/destroy', {
    method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(apiKey + ':' + apiSecret).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body, signal: AbortSignal.timeout(15000)
  });
  const payload = await response.json().catch(() => ({})) as { result?: string; error?: { message?: string } };
  if (!response.ok || (payload.result !== 'ok' && payload.result !== 'not found')) throw new ApiError(502, 'CLOUDINARY_DELETE_FAILED', payload.error?.message || 'Cloudinary could not delete the image.');
}

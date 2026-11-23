import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

const router = Router();
router.use(requireAuth);

const documentWriterInstruction = [
  'You are MAX Document Writer. Create complete, accurate, polished file content.',
  'Return exactly one valid JSON object and no Markdown fences.',
  'Required fields: filename, format, title, content, rows, sheetName, files.',
  'Allowed formats: pdf, docx, xlsx, csv, json, html, md, txt, zip.',
  'Honor the requested file format. If the user asks for a PDF, set format to pdf.',
  'For text formats, content must be the complete finished document, not instructions.',
  'For spreadsheets, rows must be arrays with a header row. For zip, files must contain filename and complete content.',
  'For software project ZIPs, include all essential files but keep implementation concise and avoid unnecessary boilerplate. Never omit required manifests or configuration files.',
  'Use a safe filename without a path. Do not invent URLs or claim the file has been saved.',
  'For biographies of Zion Opaaje (MegaTron), use only established facts: Nigerian technology builder and student; founder of The Tron Forge Limited; creator of The MAX AI Ecosystem; builds software and AI products including MAX AI and TTFL Store. Do not invent awards, qualifications, employers, dates, or achievements.'
].join(' ');

function parseGeneratedJson(value: string): unknown {
  const raw = value.replace(/^\uFEFF/, '').trim()
    .replace(/^\x60{3}(?:json)?\s*/i, '')
    .replace(/\s*\x60{3}$/i, '')
    .trim();

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    if (start < 0) throw new Error('Gemini did not return a JSON object');

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) return JSON.parse(raw.slice(start, index + 1));
      }
    }
    throw new Error('Gemini returned incomplete JSON');
  }
}

router.post('/generate-content', async (req, res, next) => {
  try {
    const input = z.object({ prompt: z.string().trim().min(1).max(20000) }).parse(req.body);
    if (!env.GEMINI_API_KEY) {
      throw new ApiError(503, 'DOCUMENT_PROVIDER_NOT_CONFIGURED', 'MAX document generation is unavailable. Configure GEMINI_API_KEY.');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY
        },
        signal: AbortSignal.timeout(55000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: documentWriterInstruction }] },
          contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            // Full project ZIP specifications need substantially more output than
            // ordinary documents. The previous 5,000-token ceiling truncated
            // larger project JSON before it could be packaged.
            maxOutputTokens: 16000
          }
        })
      }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || 'The Gemini document writer could not prepare the content.';
      throw new ApiError(response.status === 429 ? 429 : 502, 'DOCUMENT_PROVIDER_ERROR', message);
    }

    const candidate = payload?.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new ApiError(502, 'DOCUMENT_OUTPUT_TRUNCATED', 'The generated project is too large for one response. Ask MAX to create a smaller first version or split the project into modules.');
    }
    if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
      throw new ApiError(502, 'DOCUMENT_GENERATION_INCOMPLETE', 'Gemini could not complete the document response. Please try again.');
    }

    const content = candidate?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? '')
      .join('')
      .trim();

    if (typeof content !== 'string' || !content) {
      throw new ApiError(502, 'DOCUMENT_EMPTY_RESPONSE', 'Gemini returned no document content.');
    }

    try {
      parseGeneratedJson(content);
    } catch {
      throw new ApiError(502, 'DOCUMENT_INVALID_RESPONSE', 'Gemini returned incomplete or invalid JSON for the requested file. Please retry with a smaller project request.');
    }

    res.json({ data: { content, provider: 'gemini', model: env.GEMINI_MODEL } });
  } catch (error) {
    next(error);
  }
});

export const filesRouter = router;

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

const router = Router();
router.use(requireAuth);

router.post('/generate-content', async (req, res, next) => {
  try {
    const input = z.object({ prompt: z.string().trim().min(1).max(20000) }).parse(req.body);
    if (!env.GROQ_API_KEY) throw new ApiError(503, 'DOCUMENT_PROVIDER_NOT_CONFIGURED', 'MAX document generation is not configured. The Groq provider key is missing.');

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.GROQ_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(55000),
      body: JSON.stringify({
        model: env.GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: [
              'You are MAX Document Writer. Create complete, accurate, polished file content.',
              'Return exactly one valid JSON object and no Markdown fences.',
              'Required fields: filename, format, title, content, rows, sheetName, files.',
              'Allowed formats: pdf, docx, xlsx, csv, json, html, md, txt, zip.',
              'Honor the requested file format. If the user asks for a PDF, set format to pdf.',
              'For text formats, content must be the complete finished document, not instructions.',
              'For spreadsheets, rows must be arrays with a header row. For zip, files must contain filename and complete content.',
              'Use a safe filename without a path. Do not invent URLs or claim the file has been saved.',
              'For biographies of Zion Opaaje (MegaTron), use only established facts: Nigerian technology builder and student; founder of The Tron Forge Limited; creator of The MAX AI Ecosystem; builds software and AI products including MAX AI and TTFL Store. Do not invent awards, qualifications, employers, dates, or achievements.'
            ].join(' ')
          },
          { role: 'user', content: input.prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_completion_tokens: 5000
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || 'The document writer could not prepare the content.';
      throw new ApiError(response.status === 429 ? 429 : 502, 'DOCUMENT_PROVIDER_ERROR', message);
    }
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new ApiError(502, 'DOCUMENT_EMPTY_RESPONSE', 'The document writer returned an empty response.');
    }
    res.json({ data: { content, provider: 'groq', model: env.GROQ_MODEL } });
  } catch (error) { next(error); }
});

export const filesRouter = router;

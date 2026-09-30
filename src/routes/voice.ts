import express, { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { ApiError } from '../middleware/errors.js';
import { resolveEcosystemUser } from '../services/user.service.js';
import { orchestrate } from '../services/orchestrator.service.js';
import { synthesizeWithElevenLabs, transcribeWithElevenLabs, voiceStatus } from '../services/voice.service.js';
import { env } from '../config/env.js';

export const voiceRouter = Router();
voiceRouter.use(requireAuth);
const audioParser = express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '25mb' });

function getAudio(req: AuthenticatedRequest) {
  if (!Buffer.isBuffer(req.body)) throw new ApiError(415, 'AUDIO_CONTENT_TYPE_REQUIRED', 'Send the audio body with an audio/* content type');
  return req.body;
}
function mimeType(req: AuthenticatedRequest) { return (req.header('content-type') || 'audio/webm').split(';')[0].trim(); }
function turnsFromConversation(messages: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>) {
  return messages.slice(-40).map((message) => ({ role: message.role === 'USER' ? 'user' as const : 'model' as const, content: message.content }));
}

voiceRouter.get('/status', (_req, res) => res.json({ data: voiceStatus() }));

voiceRouter.post('/transcribe', audioParser, async (req: AuthenticatedRequest, res, next) => {
  try { res.json({ data: await transcribeWithElevenLabs(getAudio(req), mimeType(req)) }); } catch (error) { next(error); }
});

voiceRouter.post('/speak', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = z.object({ text: z.string().trim().min(1).max(10000) }).parse(req.body);
    const result = await synthesizeWithElevenLabs(input.text);
    res.setHeader('content-type', result.contentType);
    res.setHeader('cache-control', 'no-store');
    if (result.requestId) res.setHeader('x-elevenlabs-request-id', result.requestId);
    res.send(result.audio);
  } catch (error) { next(error); }
});

voiceRouter.post('/conversations/:conversationId/respond', audioParser, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await resolveEcosystemUser(req.auth!);
    const conversation = await prisma.conversation.findFirst({ where: { id: req.params.conversationId, userId: user.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!conversation) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    const transcript = await transcribeWithElevenLabs(getAudio(req), mimeType(req));
    await prisma.message.create({ data: { conversationId: conversation.id, role: 'USER', content: transcript.text, metadata: { input: 'voice', sttProvider: 'elevenlabs', sttModel: env.ELEVENLABS_STT_MODEL } } });
    const turns = turnsFromConversation([...conversation.messages.filter((m) => m.role === 'USER' || m.role === 'ASSISTANT'), { role: 'USER', content: transcript.text }]);
    const generated = await orchestrate({ ...user }, conversation.id, turns, transcript.text);
    const assistantMessage = await prisma.message.create({ data: { conversationId: conversation.id, role: 'ASSISTANT', content: generated.text, provider: generated.provider, model: generated.model, metadata: { input: 'voice', intent: generated.intent, tools: generated.tools, confirmations: generated.confirmations, interactionId: generated.interactionId, ttsProvider: 'elevenlabs', ttsModel: env.ELEVENLABS_TTS_MODEL } } });
    const speech = await synthesizeWithElevenLabs(generated.text);
    res.json({ data: { transcript, response: { messageId: assistantMessage.id, text: generated.text, provider: generated.provider, model: generated.model, intent: generated.intent, tools: generated.tools, confirmations: generated.confirmations, interactionId: generated.interactionId }, audio: { contentType: speech.contentType, base64: speech.audio.toString('base64'), requestId: speech.requestId } } });
  } catch (error) { next(error); }
});

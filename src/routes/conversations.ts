import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../middleware/errors.js';
import type { AuthenticatedRequest } from '../types/auth.js';
import { resolveEcosystemUser } from '../services/user.service.js';
import { orchestrate, orchestrateStream } from '../services/orchestrator.service.js';
import { createChatImageUploadSignature, cloudinaryImageUrl, deleteCloudinaryImage, verifyChatImageUpload } from '../services/cloudinary.service.js';

const createConversationSchema = z.object({ title: z.string().trim().min(1).max(200).optional() });
const updateConversationSchema = z.object({ title: z.string().trim().min(1).max(100) });
const messageSchema = z.object({ content: z.string().trim().min(1).max(20000) });
const conversationIdSchema = z.string().uuid();

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

async function getUser(req: AuthenticatedRequest) {
  const user = await resolveEcosystemUser(req.auth!);
  const authorization = req.header('authorization');
  const scopes = Array.isArray(req.auth?.claims.scopes)
    ? req.auth.claims.scopes.filter((scope): scope is string => typeof scope === 'string')
    : [];
  return { ...user, scopes, authAccessToken: authorization?.replace(/^Bearer\s+/i, '').trim() };
}

async function getConversationForUser(id: string, userId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId },
    include: { messages: { orderBy: { createdAt: 'asc' }, include: { attachments: true } } }
  });
  if (!conversation) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
  return conversation;
}

function turnsFromConversation(messages: Array<{ role: string; content: string }>) {
  return messages.filter((message) => message.role === 'USER' || message.role === 'ASSISTANT').slice(-40).map((message) => ({
    role: message.role === 'USER' ? 'user' as const : 'model' as const,
    content: message.content
  }));
}

function jsonMetadata(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

conversationsRouter.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = createConversationSchema.parse(req.body);
    const user = await getUser(req);
    const conversation = await prisma.conversation.create({ data: { userId: user.id, title: input.title } });
    res.status(201).json({ data: conversation });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    const conversations = await prisma.conversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, status: true, createdAt: true, updatedAt: true }
    });
    res.json({ data: conversations });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.get('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    const conversationId = conversationIdSchema.parse(req.params.id);
    res.json({ data: await getConversationForUser(conversationId, user.id) });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.patch('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = updateConversationSchema.parse(req.body);
    const user = await getUser(req);
    const conversationId = conversationIdSchema.parse(req.params.id);
    await getConversationForUser(conversationId, user.id);
    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: { title: input.title, updatedAt: new Date() },
      select: { id: true, title: true, status: true, createdAt: true, updatedAt: true }
    });
    res.json({ data: conversation });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    const conversationId = conversationIdSchema.parse(req.params.id);
    await getConversationForUser(conversationId, user.id);
    const attachments = await prisma.conversationAttachment.findMany({ where: { conversationId, userId: user.id }, select: { id: true, publicId: true } });
    for (const attachment of attachments) await deleteCloudinaryImage(attachment.publicId);
    await prisma.conversation.delete({ where: { id: conversationId } });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});


const recordMessagesSchema = z.object({
  messages: z.array(z.object({
    id: z.string().trim().min(1).max(128).optional(),
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(20000),
    provider: z.string().trim().max(80).optional(),
    attachmentIds: z.array(z.string().uuid()).max(5).optional()
  })).min(1).max(20)
});

conversationsRouter.post('/:id/attachments/sign', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    const conversationId = conversationIdSchema.parse(req.params.id);
    await getConversationForUser(conversationId, user.id);
    const input = z.object({
      filename: z.string().trim().min(1).max(255),
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']),
      sizeBytes: z.number().int().positive().max(10 * 1024 * 1024)
    }).parse(req.body);
    const attachmentId = crypto.randomUUID();
    const signed = createChatImageUploadSignature(user.id, conversationId, attachmentId);
    res.json({ data: { attachmentId, ...signed, resourceType: 'image', filename: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes } });
  } catch (error) { next(error); }
});

conversationsRouter.post('/:id/attachments/complete', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    const conversationId = conversationIdSchema.parse(req.params.id);
    await getConversationForUser(conversationId, user.id);
    const input = z.object({
      attachmentId: z.string().uuid(),
      filename: z.string().trim().min(1).max(255),
      publicId: z.string().min(1).max(500),
      version: z.number().int().positive(),
      signature: z.string().regex(/^[a-f0-9]{40}$/i)
    }).parse(req.body);
    verifyChatImageUpload({ userId: user.id, conversationId, attachmentId: input.attachmentId, publicId: input.publicId, version: input.version, signature: input.signature });
    const cloudAsset = await getCloudinaryImageDetails(input.publicId);
    const allowedFormats = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
    if (cloudAsset.version !== input.version || !allowedFormats.has(cloudAsset.format) || cloudAsset.bytes < 1 || cloudAsset.bytes > 10 * 1024 * 1024) {
      await deleteCloudinaryImage(input.publicId).catch(() => undefined);
      throw new ApiError(413, 'CLOUDINARY_ASSET_LIMIT', 'The uploaded image format or size is not allowed.');
    }
    const mimeType = cloudAsset.format === 'jpg' || cloudAsset.format === 'jpeg' ? 'image/jpeg' : 'image/' + cloudAsset.format;
    const secureUrl = cloudinaryImageUrl(input.publicId, input.version, cloudAsset.format);
    const attachment = await prisma.conversationAttachment.create({
      data: {
        id: input.attachmentId, userId: user.id, conversationId, publicId: input.publicId,
        secureUrl, originalName: input.filename.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 255) || 'image.' + cloudAsset.format,
        mimeType, sizeBytes: cloudAsset.bytes, width: cloudAsset.width, height: cloudAsset.height
      },
      select: { id: true, secureUrl: true, originalName: true, mimeType: true, sizeBytes: true, width: true, height: true, createdAt: true }
    });
    res.status(201).json({ data: { ...attachment, sizeBytes: Number(attachment.sizeBytes), url: attachment.secureUrl, name: attachment.originalName, type: attachment.mimeType } });
  } catch (error) { next(error); }
});

conversationsRouter.delete('/:id/attachments/:attachmentId', async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await getUser(req);
    const conversationId = conversationIdSchema.parse(req.params.id);
    const attachmentId = z.string().uuid().parse(req.params.attachmentId);
    const attachment = await prisma.conversationAttachment.findFirst({ where: { id: attachmentId, conversationId, userId: user.id } });
    if (!attachment) throw new ApiError(404, 'ATTACHMENT_NOT_FOUND', 'Conversation attachment not found');
    await deleteCloudinaryImage(attachment.publicId);
    await prisma.conversationAttachment.delete({ where: { id: attachment.id } });
    res.status(204).send();
  } catch (error) { next(error); }
});

conversationsRouter.post('/:id/messages/record', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = recordMessagesSchema.parse(req.body);
    const user = await getUser(req);
    const conversationId = conversationIdSchema.parse(req.params.id);
    const conversation = await getConversationForUser(conversationId, user.id);

    const allAttachmentIds = input.messages.flatMap(message => message.attachmentIds || []);
    if (new Set(allAttachmentIds).size !== allAttachmentIds.length) throw new ApiError(400, 'DUPLICATE_ATTACHMENT_REFERENCE', 'An attachment can only be linked once per message batch');
    const saved = await prisma.$transaction(async (tx) => {
      if (allAttachmentIds.length) {
        const owned = await tx.conversationAttachment.findMany({
          where: { id: { in: allAttachmentIds }, userId: user.id, conversationId: conversation.id, messageId: null },
          select: { id: true }
        });
        if (owned.length !== allAttachmentIds.length) throw new ApiError(404, 'ATTACHMENT_NOT_FOUND', 'One or more uploaded images do not belong to this conversation');
      }
      const created = [];
      for (const message of input.messages) {
        let savedMessage;
        if (message.id) {
          savedMessage = await tx.message.findFirst({
            where: { conversationId: conversation.id, metadata: { path: ['clientMessageId'], equals: message.id } },
            include: { attachments: true }
          });
        }
        if (!savedMessage) {
          savedMessage = await tx.message.create({
            data: {
              conversationId: conversation.id, role: message.role === 'user' ? 'USER' : 'ASSISTANT',
              content: message.content, provider: message.provider || 'gemini',
              metadata: message.id ? { clientMessageId: message.id, source: 'MAX Chat' } : { source: 'MAX Chat' }
            },
            include: { attachments: true }
          });
        }
        if (message.attachmentIds?.length) {
          await tx.conversationAttachment.updateMany({
            where: { id: { in: message.attachmentIds }, userId: user.id, conversationId: conversation.id, messageId: null },
            data: { messageId: savedMessage.id }
          });
          savedMessage.attachments = await tx.conversationAttachment.findMany({ where: { messageId: savedMessage.id } });
        }
        created.push(savedMessage);
      }

      const firstUserMessage = input.messages.find((message) => message.role === 'user');
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          updatedAt: new Date(),
          ...(firstUserMessage && (!conversation.title || conversation.title === 'New chat')
            ? { title: firstUserMessage.content.slice(0, 80) }
            : {})
        }
      });
      return created;
    });

    res.status(201).json({ data: saved.map(message => ({ ...message, attachments: message.attachments.map(attachment => ({ ...attachment, sizeBytes: Number(attachment.sizeBytes), url: attachment.secureUrl, name: attachment.originalName, type: attachment.mimeType })) })) });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.post('/:id/messages', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = messageSchema.parse(req.body);
    const user = await getUser(req);
    const conversationId = conversationIdSchema.parse(req.params.id);
    const conversation = await getConversationForUser(conversationId, user.id);

    await prisma.message.create({ data: { conversationId: conversation.id, role: 'USER', content: input.content } });

    const turns = turnsFromConversation([
      ...conversation.messages.filter((message) => message.role === 'USER' || message.role === 'ASSISTANT'),
      { role: 'USER', content: input.content }
    ]);

    const generated = await orchestrate(user, conversation.id, turns, input.content);
    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: generated.text,
        provider: generated.provider,
        model: generated.model,
        metadata: {
          intent: generated.intent,
          tools: generated.tools,
          confirmations: jsonMetadata(generated.confirmations),
          interactionId: generated.interactionId
        }
      }
    });

    res.status(201).json({ data: assistantMessage, confirmations: generated.confirmations, connections: generated.connections });
  } catch (error) {
    next(error);
  }
});

conversationsRouter.post('/:id/messages/stream', async (req: AuthenticatedRequest, res, next) => {
  try {
    const input = messageSchema.parse(req.body);
    const user = await getUser(req);
    const conversationId = conversationIdSchema.parse(req.params.id);
    const conversation = await getConversationForUser(conversationId, user.id);

    await prisma.message.create({ data: { conversationId: conversation.id, role: 'USER', content: input.content } });

    const turns = turnsFromConversation([
      ...conversation.messages.filter((message) => message.role === 'USER' || message.role === 'ASSISTANT'),
      { role: 'USER', content: input.content }
    ]);

    res.status(200);
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders();
    res.write('event: response_started\ndata: {}\n\n');

    const generated = await orchestrateStream(user, conversation.id, turns, input.content, (text) => {
      res.write(`event: text_delta\ndata: ${JSON.stringify({ text })}\n\n`);
    });

    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: generated.text,
        provider: generated.provider,
        model: generated.model,
        metadata: {
          intent: generated.intent,
          tools: generated.tools,
          confirmations: jsonMetadata(generated.confirmations),
          interactionId: generated.interactionId
        }
      }
    });

    res.write(`event: response_completed\ndata: ${JSON.stringify({ messageId: assistantMessage.id, intent: generated.intent, tools: generated.tools, confirmations: jsonMetadata(generated.confirmations), connections: jsonMetadata(generated.connections), interactionId: generated.interactionId })}\n\n`);
    res.end();
  } catch (error) {
    if (res.headersSent) {
      const code = error instanceof ApiError ? error.code : 'AI_STREAM_ERROR';
      const message = error instanceof Error ? error.message : 'The AI response failed';
      res.write(`event: response_error\ndata: ${JSON.stringify({ code, message })}\n\n`);
      res.end();
      return;
    }
    next(error);
  }
});

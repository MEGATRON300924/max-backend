import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errors.js';
import { maxHomeRequest } from './home.service.js';
import type { GeminiFunctionDeclaration } from './ai.service.js';
import { recordAuditEvent } from './audit.service.js';

type ToolContext = {
  userId: string;
  authSubject?: string;
  confirmed?: boolean;
};

export type MaxTool = {
  name: string;
  capability: string;
  description: string;
  enabled: boolean;
  requiresConfirmation: boolean;
  declaration: GeminiFunctionDeclaration;
};

const memoryInput = z.object({
  type: z.enum(['PREFERENCE', 'FACT', 'INTEREST', 'ROUTINE', 'INSTRUCTION']),
  key: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(4000),
  confidence: z.number().min(0).max(1).optional()
});

const homeInput = z.object({
  action: z.string().trim().min(1).max(100),
  targetId: z.string().trim().min(1).max(200).optional(),
  parameters: z.record(z.unknown()).optional()
});

const tools: MaxTool[] = [
  {
    name: 'memory.save',
    capability: 'memory',
    description: 'Save a durable user memory belonging to the authenticated user.',
    enabled: true,
    requiresConfirmation: false,
    declaration: {
      name: 'memory_save',
      description: 'Save a durable memory when the user explicitly asks MAX to remember a preference, fact, interest, routine, or instruction.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['PREFERENCE', 'FACT', 'INTEREST', 'ROUTINE', 'INSTRUCTION'] },
          key: { type: 'string', description: 'Short memory key.' },
          value: { type: 'string', description: 'The information to remember.' },
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        },
        required: ['type', 'key', 'value']
      }
    }
  },
  {
    name: 'memory.delete',
    capability: 'memory',
    description: 'Delete a durable user memory belonging to the authenticated user.',
    enabled: true,
    requiresConfirmation: true,
    declaration: {
      name: 'memory_delete',
      description: 'Delete a user memory only after explicit confirmation from the user.',
      parameters: {
        type: 'object',
        properties: { memoryId: { type: 'string', description: 'The memory identifier to delete.' } },
        required: ['memoryId']
      }
    }
  },
  {
    name: 'home.execute',
    capability: 'home',
    description: 'Execute an authorized MAX Home action.',
    enabled: Boolean(process.env.MAX_HOME_API_URL),
    requiresConfirmation: true,
    declaration: {
      name: 'home_execute',
      description: 'Execute an authorized smart-home action through MAX Home after explicit confirmation.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'The requested MAX Home action.' },
          targetId: { type: 'string', description: 'The authorized device, room, scene, or other target identifier.' },
          parameters: { type: 'object', description: 'Action-specific parameters.' }
        },
        required: ['action']
      }
    }
  }
];

export function listTools() {
  return tools.map(({ declaration, ...tool }) => ({ ...tool }));
}

export function getGeminiTools() {
  return tools.filter((tool) => tool.enabled).map((tool) => tool.declaration);
}

export function resolveGeminiTool(name: string) {
  return tools.find((tool) => tool.enabled && tool.declaration.name === name);
}

export async function executeTool(name: string, context: ToolContext, input: unknown) {
  const startedAt = Date.now();
  const tool = tools.find((candidate) => candidate.name === name);

  if (!tool || !tool.enabled) {
    await recordAuditEvent({ userId: context.userId, eventType: 'tool_execution', action: 'rejected', status: 'UNAVAILABLE', metadata: { toolName: name } });
    throw new ApiError(503, 'TOOL_NOT_AVAILABLE', `MAX tool ${name} is not available`);
  }

  if (tool.requiresConfirmation && !context.confirmed) {
    await recordAuditEvent({ userId: context.userId, eventType: 'tool_execution', action: 'rejected', status: 'CONFIRMATION_REQUIRED', metadata: { toolName: name } });
    throw new ApiError(409, 'TOOL_CONFIRMATION_REQUIRED', `MAX tool ${name} requires confirmation`);
  }

  try {
    let result: unknown;

    if (name === 'memory.save') {
      const data = memoryInput.parse(input);
      const memory = await prisma.memory.upsert({
        where: { userId_type_key: { userId: context.userId, type: data.type, key: data.key } },
        create: { userId: context.userId, ...data, source: 'max-ai' },
        update: { value: data.value, confidence: data.confidence, source: 'max-ai' }
      });
      result = { success: true, tool: name, memoryId: memory.id };
    } else if (name === 'memory.delete') {
      const data = z.object({ memoryId: z.string().min(1).max(200) }).parse(input);
      const deleted = await prisma.memory.deleteMany({ where: { id: data.memoryId, userId: context.userId } });
      if (deleted.count !== 1) throw new ApiError(404, 'MEMORY_NOT_FOUND', 'The requested memory was not found');
      result = { success: true, tool: name, memoryId: data.memoryId };
    } else if (name === 'home.execute') {
      if (!context.authSubject) throw new ApiError(401, 'AUTH_SUBJECT_REQUIRED', 'MAX Home requires an authenticated MAX identity');
      const data = homeInput.parse(input);
      const homeResult = await maxHomeRequest({
        path: `/api/v1/users/${encodeURIComponent(context.authSubject)}/actions`,
        method: 'POST',
        body: data
      });
      result = { success: true, tool: name, result: homeResult };
    } else {
      throw new ApiError(501, 'TOOL_NOT_IMPLEMENTED', `MAX tool ${name} is registered but not implemented`);
    }

    await recordAuditEvent({
      userId: context.userId,
      eventType: 'tool_execution',
      action: 'completed',
      status: 'COMPLETED',
      metadata: { toolName: name, confirmed: Boolean(context.confirmed), durationMs: Date.now() - startedAt }
    });

    return result;
  } catch (error) {
    await recordAuditEvent({
      userId: context.userId,
      eventType: 'tool_execution',
      action: 'failed',
      status: 'FAILED',
      metadata: {
        toolName: name,
        confirmed: Boolean(context.confirmed),
        durationMs: Date.now() - startedAt,
        errorType: error instanceof Error ? error.name : 'unknown'
      }
    });
    throw error;
  }
}

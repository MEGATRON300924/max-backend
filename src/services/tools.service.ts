import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errors.js';
import type { GeminiFunctionDeclaration } from './ai.service.js';

type ToolContext = {
  userId: string;
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
      description: 'Execute an authorized smart-home action through MAX Home after confirmation.',
      parameters: { type: 'object', properties: { action: { type: 'string' }, target: { type: 'string' } }, required: ['action', 'target'] }
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
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool || !tool.enabled) throw new ApiError(503, 'TOOL_NOT_AVAILABLE', `MAX tool ${name} is not available`);
  if (tool.requiresConfirmation && name !== 'memory.save') throw new ApiError(409, 'TOOL_CONFIRMATION_REQUIRED', `MAX tool ${name} requires confirmation`);

  if (name === 'memory.save') {
    const data = memoryInput.parse(input);
    const memory = await prisma.memory.upsert({
      where: { userId_type_key: { userId: context.userId, type: data.type, key: data.key } },
      create: { userId: context.userId, ...data, source: 'max-ai' },
      update: { value: data.value, confidence: data.confidence, source: 'max-ai' }
    });
    return { success: true, tool: name, memoryId: memory.id };
  }

  throw new ApiError(501, 'TOOL_NOT_IMPLEMENTED', `MAX tool ${name} is registered but not implemented`);
}

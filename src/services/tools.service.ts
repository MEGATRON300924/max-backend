import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errors.js';

type ToolContext = {
  userId: string;
};

export type MaxTool = {
  name: string;
  capability: string;
  description: string;
  enabled: boolean;
  requiresConfirmation: boolean;
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
    requiresConfirmation: false
  },
  {
    name: 'memory.delete',
    capability: 'memory',
    description: 'Delete a durable user memory belonging to the authenticated user.',
    enabled: true,
    requiresConfirmation: true
  },
  {
    name: 'home.execute',
    capability: 'home',
    description: 'Execute an authorized MAX Home action.',
    enabled: Boolean(process.env.MAX_HOME_API_URL),
    requiresConfirmation: true
  },
  {
    name: 'music.execute',
    capability: 'music',
    description: 'Execute an authorized MAX Music action.',
    enabled: false,
    requiresConfirmation: false
  },
  {
    name: 'browser.search',
    capability: 'browser',
    description: 'Search the web through the MAX Browser capability.',
    enabled: false,
    requiresConfirmation: false
  },
  {
    name: 'cloud.files',
    capability: 'cloud',
    description: 'Access files through MAX Cloud according to user permissions.',
    enabled: false,
    requiresConfirmation: true
  },
  {
    name: 'security.execute',
    capability: 'security',
    description: 'Execute an authorized MAX Security action.',
    enabled: false,
    requiresConfirmation: true
  },
  {
    name: 'pay.execute',
    capability: 'pay',
    description: 'Execute an authorized MAX Pay action.',
    enabled: false,
    requiresConfirmation: true
  }
];

export function listTools() {
  return tools.map((tool) => ({ ...tool }));
}

export async function executeTool(name: string, context: ToolContext, input: unknown) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool || !tool.enabled) {
    throw new ApiError(503, 'TOOL_NOT_AVAILABLE', `MAX tool ${name} is not available`);
  }

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

import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../lib/prisma.js';
import { resolveEcosystemUser } from '../services/user.service.js';
import { orchestrate } from '../services/orchestrator.service.js';
import type { AuthPrincipal } from '../types/auth.js';

type DiscordInteraction = {
  id: string;
  application_id: string;
  token: string;
  type: number;
  data?: {
    name?: string;
    options?: Array<{ name: string; value?: string }>;
  };
  member?: { user?: { id?: string } };
  user?: { id?: string };
};

type DiscordIdentityResponse = {
  data?: {
    matched?: boolean;
    identity?: {
      maxUserId: string;
      username?: string;
      displayName?: string;
      avatarUrl?: string | null;
    };
  };
};

const router = Router();
const DISCORD_API = 'https://discord.com/api/v10';

function verifyDiscordRequest(req: Request) {
  const signature = req.header('x-signature-ed25519') ?? '';
  const timestamp = req.header('x-signature-timestamp') ?? '';
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (!env.DISCORD_PUBLIC_KEY || !rawBody || !/^[a-f0-9]{128}$/i.test(signature) ||
      !/^\d{10,}$/.test(timestamp)) return false;

  const requestTime = Number(timestamp);
  if (!Number.isFinite(requestTime) || Math.abs(Date.now() / 1000 - requestTime) > 300) return false;

  try {
    const publicKey = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(env.DISCORD_PUBLIC_KEY, 'hex')
    ]);
    return crypto.verify(
      null,
      Buffer.concat([Buffer.from(timestamp), rawBody]),
      { key: publicKey, format: 'der', type: 'spki' },
      Buffer.from(signature, 'hex')
    );
  } catch {
    return false;
  }
}

async function getLinkedMaxIdentity(discordUserId: string) {
  if (!env.MAX_AUTH_SERVICE_TOKEN) throw new Error('MAX_AUTH_SERVICE_TOKEN is not configured');
  const base = env.MAX_AUTH_INTERNAL_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/identity/discord/${encodeURIComponent(discordUserId)}`, {
    headers: {
      Accept: 'application/json',
      'X-MAX-Auth-Service-Token': env.MAX_AUTH_SERVICE_TOKEN
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`MAX Auth identity lookup failed with ${response.status}`);
  const payload = await response.json() as DiscordIdentityResponse;
  return payload.data?.matched && payload.data.identity ? payload.data.identity : null;
}

async function sendInteractionReply(interaction: DiscordInteraction, content: string) {
  const response = await fetch(
    `${DISCORD_API}/webhooks/${encodeURIComponent(interaction.application_id)}/${encodeURIComponent(interaction.token)}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10000)
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    logger.warn({ status: response.status, detail: detail.slice(0, 200) }, 'Discord interaction reply failed');
  }
}

async function handleAsk(interaction: DiscordInteraction, discordUserId: string, prompt: string) {
  try {
    const identity = await getLinkedMaxIdentity(discordUserId);
    if (!identity) {
      await sendInteractionReply(
        interaction,
        '🔗 Your Discord account is not linked to a MAX Account yet. Sign in at https://auth.max-ai.name.ng, open Connected Accounts, and connect Discord. Then run `/ask` again.'
      );
      return;
    }

    const principal: AuthPrincipal = {
      subject: identity.maxUserId,
      username: identity.username,
      name: identity.displayName,
      picture: identity.avatarUrl ?? undefined,
      claims: {}
    };
    const user = await resolveEcosystemUser(principal);
    let conversation = await prisma.conversation.findFirst({
      where: { userId: user.id, title: 'Discord' },
      orderBy: { updatedAt: 'desc' }
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { userId: user.id, title: 'Discord' }
      });
    }

    await prisma.message.create({
      data: { conversationId: conversation.id, role: 'USER', content: prompt }
    });

    const history = await prisma.message.findMany({
      where: { conversationId: conversation.id, role: { in: ['USER', 'ASSISTANT'] } },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: { role: true, content: true }
    });
    const turns = history.reverse().map((message) => ({
      role: message.role === 'USER' ? 'user' as const : 'model' as const,
      content: message.content
    }));

    const generated = await orchestrate({
      id: user.id,
      displayName: user.displayName,
      locale: user.locale,
      timezone: user.timezone,
      authSubject: identity.maxUserId,
      scopes: []
    }, conversation.id, turns, prompt);

    const reply = generated.confirmations.length
      ? generated.text + '\n\n🔐 This request needs confirmation. Open MAX AI to review and approve it securely.'
      : generated.text;

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: reply,
        provider: generated.provider,
        model: generated.model,
        metadata: { source: 'discord', intent: generated.intent, tools: generated.tools }
      }
    });
    await sendInteractionReply(interaction, reply || 'I could not generate a response just now. Please try again.');
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.name : typeof error }, 'Discord MAX request failed');
    await sendInteractionReply(interaction, '⚠️ MAX could not complete that request right now. Please try again in a moment.');
  }
}

router.post('/interactions', (req, res) => {
  if (!verifyDiscordRequest(req)) {
    res.status(401).json({ error: 'Invalid Discord request signature.' });
    return;
  }

  const interaction = req.body as DiscordInteraction;
  if (interaction.type === 1) {
    res.json({ type: 1 });
    return;
  }

  if (interaction.type !== 2 || interaction.data?.name !== 'ask') {
    res.status(400).json({ error: 'Unsupported Discord interaction.' });
    return;
  }

  const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
  const prompt = interaction.data.options?.find((option) => option.name === 'prompt')?.value?.trim();
  if (!discordUserId || !prompt) {
    res.status(400).json({ error: 'A Discord user and prompt are required.' });
    return;
  }

  res.status(200).json({ type: 5, data: { flags: 64 } });
  void handleAsk(interaction, discordUserId, prompt);
});

export async function registerDiscordCommands() {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_BOT_TOKEN) return;
  const response = await fetch(`${DISCORD_API}/applications/${encodeURIComponent(env.DISCORD_APPLICATION_ID)}/commands`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([{
      name: 'ask',
      description: 'Ask MAX AI anything',
      options: [{
        type: 3,
        name: 'prompt',
        description: 'What would you like MAX to help with?',
        required: true,
        min_length: 1,
        max_length: 2000
      }]
    }]),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Discord command registration failed with ${response.status}: ${detail.slice(0, 300)}`);
  }
  logger.info('Discord /ask command registered');
}

export const discordRouter = router;

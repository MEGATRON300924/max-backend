import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../lib/prisma.js';
import { resolveEcosystemUser } from '../services/user.service.js';
import { orchestrate } from '../services/orchestrator.service.js';
import type { AuthPrincipal } from '../types/auth.js';

export const discordRouter = Router();

type DiscordUser = { id: string; username?: string; global_name?: string | null };
type DiscordOption = { name?: string; value?: unknown };
type DiscordInteraction = {
  type?: number;
  application_id?: string;
  token?: string;
  id?: string;
  guild_id?: string;
  channel_id?: string;
  user?: DiscordUser;
  member?: { user?: DiscordUser };
  data?: { name?: string; options?: DiscordOption[] };
};

const LINK_DISCORD_URL = 'https://api.max-ai.name.ng/connected-apps';
const DISCORD_API = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{5,25}$/;
const messageSchema = z.string().trim().min(1).max(1500);

function rawBody(req: Request): Buffer | undefined {
  return (req as Request & { rawBody?: Buffer }).rawBody;
}

function verifyDiscordRequest(req: Request): boolean {
  if (!env.DISCORD_PUBLIC_KEY) return false;
  const signature = req.header('x-signature-ed25519');
  const timestamp = req.header('x-signature-timestamp');
  const body = rawBody(req);
  if (!signature || !timestamp || !body || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;

  try {
    const prefix = Buffer.from('302a300506032b6570032100', 'hex');
    const keyBytes = Buffer.from(env.DISCORD_PUBLIC_KEY, 'hex');
    if (keyBytes.length !== 32) return false;
    const publicKey = crypto.createPublicKey({ key: Buffer.concat([prefix, keyBytes]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.concat([Buffer.from(timestamp, 'utf8'), body]), publicKey, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

function discordUserFrom(interaction: DiscordInteraction): DiscordUser | undefined {
  return interaction.member?.user ?? interaction.user;
}

function interactionMessage(interaction: DiscordInteraction): string | undefined {
  const option = interaction.data?.options?.find((item) => item.name === 'message');
  return typeof option?.value === 'string' ? option.value : undefined;
}

type MaxIdentity = { linked: boolean; user?: { id: string; username?: string; displayName?: string; tier?: string; locale?: string | null; timezone?: string | null } };

async function lookupMaxIdentity(discordUserId: string): Promise<MaxIdentity> {
  if (!env.MAX_AUTH_SERVICE_TOKEN) throw new Error('MAX Auth service authentication is not configured');
  const base = env.MAX_AUTH_INTERNAL_URL.replace(/\/+$/, '');
  const url = new URL(base + '/discord/identity');
  url.searchParams.set('discordUserId', discordUserId);
  const response = await fetch(url, {
    headers: { 'x-max-auth-service-token': env.MAX_AUTH_SERVICE_TOKEN, accept: 'application/json' },
    signal: AbortSignal.timeout(7000),
  });
  const payload = await response.json().catch(() => ({})) as {
    success?: boolean;
    data?: { linked?: boolean; user?: { id: string; username?: string; displayName?: string; tier?: string; locale?: string | null; timezone?: string | null } };
  };
  if (!response.ok || payload.success !== true) throw new Error('MAX Auth identity lookup failed');
  return { linked: payload.data?.linked === true, user: payload.data?.user };
}

async function updateOriginalResponse(applicationId: string, token: string, content: string) {
  const response = await fetch(`${DISCORD_API}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(token)}/messages/@original`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Discord response update failed (${response.status}): ${detail.slice(0, 200)}`);
  }
}

async function respondToInteraction(interaction: DiscordInteraction) {
  const applicationId = interaction.application_id;
  const token = interaction.token;
  const discordUser = discordUserFrom(interaction);
  const discordUserId = discordUser?.id;
  const channelId = interaction.channel_id ?? 'direct-message';
  const guildId = interaction.guild_id ?? 'direct-message';
  const message = interactionMessage(interaction);

  if (!applicationId || !token || !discordUserId || !SNOWFLAKE.test(discordUserId)) {
    throw new Error('Discord interaction is missing required identity or response fields');
  }

  const parsedMessage = messageSchema.safeParse(message);
  if (!parsedMessage.success) {
    await updateOriginalResponse(applicationId, token, 'Please provide a message of 1–1500 characters with the /max command.');
    return;
  }
  const userMessage = parsedMessage.data;

  const identity = await lookupMaxIdentity(discordUserId);
  if (!identity.linked || !identity.user?.id) {
    await updateOriginalResponse(
      applicationId,
      token,
      `I can recognise your MAX account once you link Discord in MAX Auth: ${LINK_DISCORD_URL}. After linking, run /max again.`
    );
    return;
  }

  const maxUser = identity.user;
  const principal: AuthPrincipal = {
    subject: maxUser.id,
    username: maxUser.username,
    name: maxUser.displayName ?? maxUser.username,
    tier: maxUser.tier,
    claims: {
      sub: maxUser.id,
      username: maxUser.username,
      displayName: maxUser.displayName ?? maxUser.username,
      tier: maxUser.tier,
      language: maxUser.locale,
      timezone: maxUser.timezone,
    },
  };
  const user = await resolveEcosystemUser(principal);
  const title = `Discord:${guildId}:${channelId}:${discordUserId}`;
  let conversation = await prisma.conversation.findFirst({
    where: { userId: user.id, title, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { userId: user.id, title },
      select: { id: true },
    });
  }

  await prisma.message.create({
    data: { conversationId: conversation.id, role: 'USER', content: userMessage, metadata: { platform: 'discord', discordUserId, guildId, channelId } },
  });
  const history = await prisma.message.findMany({
    where: { conversationId: conversation.id, role: { in: ['USER', 'ASSISTANT'] } },
    orderBy: { createdAt: 'desc' },
    take: 40,
    select: { role: true, content: true },
  });
  const turns = history.reverse().map((item) => ({
    role: item.role === 'USER' ? 'user' as const : 'model' as const,
    content: item.content,
  }));

  const generated = await orchestrate({
    id: user.id,
    displayName: user.displayName,
    locale: user.locale,
    timezone: user.timezone,
    authSubject: user.authSubject,
    tier: maxUser.tier ?? null,
  }, conversation.id, turns, userMessage);

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'ASSISTANT',
      content: generated.text,
      provider: generated.provider,
      model: generated.model,
      metadata: { platform: 'discord', intent: generated.intent, tools: generated.tools, confirmations: generated.confirmations.map((item) => ({ id: item.id, toolName: item.toolName, expiresAt: item.expiresAt })) },
    },
  });

  const responseText = generated.confirmations.length
    ? `${generated.text}\n\nFor security, complete the requested confirmation in MAX before I carry out that action.`
    : generated.text;
  await updateOriginalResponse(applicationId, token, responseText);
}

discordRouter.get('/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    success: true,
    data: {
      interactionsConfigured: Boolean(env.DISCORD_APPLICATION_ID && env.DISCORD_PUBLIC_KEY && env.MAX_AUTH_SERVICE_TOKEN),
      authLinking: 'MAX Auth connected Discord account',
      endpoint: `${env.API_PREFIX}/discord/interactions`,
    },
  });
});

discordRouter.post('/interactions', (req, res) => {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_PUBLIC_KEY || !env.MAX_AUTH_SERVICE_TOKEN) {
    res.status(503).json({ error: 'DISCORD_NOT_CONFIGURED', message: 'Discord integration is not configured on this backend.' });
    return;
  }
  if (!verifyDiscordRequest(req)) {
    res.status(401).json({ error: 'DISCORD_SIGNATURE_INVALID' });
    return;
  }

  const interaction = req.body as DiscordInteraction;
  if (!interaction || interaction.application_id !== env.DISCORD_APPLICATION_ID) {
    res.status(401).json({ error: 'DISCORD_APPLICATION_MISMATCH' });
    return;
  }
  if (interaction?.type === 1) {
    res.status(200).json({ type: 1 });
    return;
  }
  if (interaction?.type !== 2 || interaction.data?.name !== 'max') {
    res.status(200).json({ type: 4, data: { content: 'This MAX command is not supported.', flags: 64 } });
    return;
  }

  res.status(200).json({ type: 5, data: { flags: 64 } });
  void respondToInteraction(interaction).catch((error) => {
    logger.error({ err: error, discordInteractionId: interaction.id }, 'Discord MAX interaction failed');
    if (interaction.application_id && interaction.token) {
      void updateOriginalResponse(
        interaction.application_id,
        interaction.token,
        'Sorry, MAX could not complete that request. Please try again shortly.'
      ).catch((updateError) => logger.warn({ err: updateError }, 'Could not send Discord error response'));
    }
  });
});

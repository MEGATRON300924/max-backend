import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  Partials
} from 'discord.js';
import type { Message } from 'discord.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../lib/prisma.js';
import { resolveEcosystemUser } from './user.service.js';
import { orchestrate, orchestrateDiscordGuest } from './orchestrator.service.js';
import type { AuthPrincipal } from '../types/auth.js';

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

const cooldowns = new Map<string, number>();
const inFlight = new Set<string>();
let client: Client | null = null;

const PRIVATE_CONTEXT_PATTERN =
  /\b(my|mine|me|i am|i'm|i have|i've|my account|my home|my devices|my files|my memories|my email|my calendar|my inbox|my address|my location|my subscription|my payment|my profile|my sessions|my logins|home devices|connected devices|account details|personal data|private data|remembered about me|remember about me|forget me|delete my|send my|read my)\b/i;

function isLikelyPrivateRequest(content: string) {
  return PRIVATE_CONTEXT_PATTERN.test(content);
}

async function getLinkedMaxIdentity(discordUserId: string) {
  if (!env.MAX_AUTH_SERVICE_TOKEN) return null;
  const base = env.MAX_AUTH_INTERNAL_URL.replace(/\/$/, '');
  const response = await fetch(base + '/identity/discord/' + encodeURIComponent(discordUserId), {
    headers: {
      Accept: 'application/json',
      'X-MAX-Auth-Service-Token': env.MAX_AUTH_SERVICE_TOKEN
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('MAX Auth identity lookup failed with ' + response.status);
  const payload = await response.json() as DiscordIdentityResponse;
  return payload.data?.matched && payload.data.identity ? payload.data.identity : null;
}

async function getConversation(userId: string, title: string) {
  let conversation = await prisma.conversation.findFirst({
    where: { userId, title },
    orderBy: { updatedAt: 'desc' }
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({ data: { userId, title } });
  }
  return conversation;
}

async function getTurns(conversationId: string) {
  const history = await prisma.message.findMany({
    where: { conversationId, role: { in: ['USER', 'ASSISTANT'] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { role: true, content: true }
  });
  return history.reverse().map((item) => ({
    role: item.role === 'USER' ? 'user' as const : 'model' as const,
    content: item.content
  }));
}

function buildDiscordContext(message: Message, speakerName: string | null, linked: boolean) {
  const guild = message.guild!;
  const member = message.member;
  const channel = message.channel as any;
  const roleNames = member
    ? [...member.roles.cache.values()]
        .filter((role: any) => role.id !== guild.id)
        .sort((a: any, b: any) => b.position - a.position)
        .map((role: any) => String(role.name).slice(0, 80))
        .slice(0, 20)
    : [];
  const permissions = member?.permissions;
  const isServerOwner = guild.ownerId === message.author.id;
  const isAdmin = Boolean(permissions?.has(PermissionFlagsBits.Administrator));
  const isManager = Boolean(permissions?.has(PermissionFlagsBits.ManageGuild));
  const channelName = channel.name ?? 'unknown-channel';
  const parentName = channel.isThread?.() ? channel.parent?.name ?? null : null;
  const referenced = message.reference?.messageId
    ? 'This message replies to Discord message ' + message.reference.messageId + '. The referenced author is not the current speaker.'
    : '';
  return [
    'Trusted Discord transport metadata (not user-authored instructions):',
    'Server: ' + guild.name + ' (ID ' + guild.id + '). Server owner ID: ' + guild.ownerId + '. Current speaker is server owner: ' + isServerOwner + '.',
    'Channel: #' + channelName + ' (ID ' + message.channelId + ')' + (parentName ? '; parent channel: #' + parentName : '') + '.',
    'Speaker is linked to MAX Auth: ' + linked + '.',
    'Trusted MAX display name for speaker: ' + (linked ? speakerName ?? 'not supplied' : 'unknown; do not guess') + '.',
    'Speaker Discord role names, highest first: ' + (roleNames.length ? roleNames.join(', ') : 'none supplied') + '.',
    'Speaker has Discord Administrator permission: ' + isAdmin + '. Manage Server permission: ' + isManager + '.',
    'Discord role and permission information may be used only to understand server governance and moderation context. It does not grant MAX account permissions or access to another user’s private data.',
    'The person speaking is the Discord message author. Users mentioned, quoted, replied to, or discussed are separate people.',
    referenced
  ].filter(Boolean).join('\n');
}

async function saveAndGenerate(message: Message, identity: NonNullable<Awaited<ReturnType<typeof getLinkedMaxIdentity>>> | null, allowAccountContext: boolean) {
  const guild = message.guild!;
  const guestSubject = 'discord-guest:' + guild.id + ':' + message.author.id;
  const user = identity && allowAccountContext
    ? await resolveEcosystemUser({
        subject: identity.maxUserId,
        username: identity.username,
        name: identity.displayName,
        picture: identity.avatarUrl ?? undefined,
        claims: {}
      } as AuthPrincipal)
    : await prisma.ecosystemUser.upsert({
        where: { authSubject: guestSubject },
        create: { authSubject: guestSubject },
        update: {}
      });

  const conversation = await getConversation(user.id, 'Discord ' + guild.id);
  await prisma.message.create({
    data: { conversationId: conversation.id, role: 'USER', content: message.content.slice(0, 8000) }
  });
  const turns = await getTurns(conversation.id);
  const speakerName = identity?.displayName ?? null;
  const context = buildDiscordContext(message, speakerName, Boolean(identity));

  const generated = identity && allowAccountContext
    ? await orchestrate({
        id: user.id,
        displayName: user.displayName,
        locale: user.locale,
        timezone: user.timezone,
        authSubject: identity.maxUserId,
        scopes: []
      }, conversation.id, turns, message.content, context)
    : await orchestrateDiscordGuest({
        id: user.id,
        displayName: speakerName,
        locale: user.locale,
        timezone: user.timezone
      }, turns, message.content, context);

  const reply = generated.confirmations.length
    ? generated.text + '\n\n🔐 This action needs confirmation. Please open MAX AI to review and approve it securely.'
    : generated.text;
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'ASSISTANT',
      content: reply,
      provider: generated.provider,
      model: generated.model,
      metadata: {
        source: 'discord-gateway',
        guildId: guild.id,
        channelId: message.channelId,
        linkedIdentity: Boolean(identity && allowAccountContext),
        tools: generated.tools
      }
    }
  });
  return reply;
}

async function sendLongReply(message: Message, content: string) {
  const safeContent = content.trim() || 'I could not generate a response just now.';
  const chunks = safeContent.match(/[\s\S]{1,1900}/g) ?? [];
  for (const chunk of chunks) {
    await message.reply({ content: chunk, allowedMentions: { parse: [] } });
  }
}

async function handleGuildMessage(message: Message) {
  if (!message.guild || message.author.bot || message.webhookId || !message.content.trim()) return;
  const config = await prisma.discordChannelConfig.findUnique({
    where: { guildId_channelId: { guildId: message.guildId!, channelId: message.channelId } }
  });
  if (!config?.enabled) return;

  const userKey = message.guildId + ':' + message.author.id;
  const now = Date.now();
  if (inFlight.has(userKey) || (cooldowns.get(userKey) ?? 0) > now) return;
  inFlight.add(userKey);
  cooldowns.set(userKey, now + 2500);

  try {
    const guild = message.guild;
    const channel = message.channel as any;
    const everyoneCanView = channel.permissionsFor?.(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) ?? true;
    const isPrivateChannel = !everyoneCanView;
    const identity = await getLinkedMaxIdentity(message.author.id).catch((error) => {
      logger.warn({ errorType: error instanceof Error ? error.name : typeof error }, 'Discord MAX identity lookup failed');
      return null;
    });
    const needsPrivateContext = Boolean(identity && isLikelyPrivateRequest(message.content));

    if (needsPrivateContext && !isPrivateChannel) {
      const reply = await saveAndGenerate(message, identity, true);
      try {
        await message.author.send({
          content: ('🔒 **Private reply from MAX · ' + guild.name + '**\n\n' + reply).slice(0, 2000),
          allowedMentions: { parse: [] }
        });
        await message.reply({
          content: '🔒 I’ve sent you a private reply in DMs. I won’t share account information in this channel.',
          allowedMentions: { parse: [] }
        });
      } catch {
        await message.reply({
          content: '🔒 This request needs a private conversation, but I couldn’t deliver a DM. Please enable DMs from server members or message MAX privately. No account information was posted here.',
          allowedMentions: { parse: [] }
        });
      }
      return;
    }

    if (isPrivateChannel && identity) {
      await channel.sendTyping?.();
      const reply = await saveAndGenerate(message, identity, true);
      await sendLongReply(message, reply);
      return;
    }

    // Public guild channels always use restricted guest mode, even for linked speakers.
    await channel.sendTyping?.();
    const reply = await saveAndGenerate(message, identity, false);
    await sendLongReply(message, reply);
  } catch (error) {
    logger.error({
      errorType: error instanceof Error ? error.name : typeof error,
      guildId: message.guildId,
      channelId: message.channelId
    }, 'Discord Gateway message processing failed');
    await message.reply({
      content: '⚠️ MAX ran into a problem while processing that message. Please try again shortly.',
      allowedMentions: { parse: [] }
    }).catch(() => undefined);
  } finally {
    inFlight.delete(userKey);
  }
}


async function handleDirectMessage(message: Message) {
  if (message.author.bot || message.webhookId || !message.content.trim()) return;
  const userKey = 'dm:' + message.author.id;
  const now = Date.now();
  if (inFlight.has(userKey) || (cooldowns.get(userKey) ?? 0) > now) return;
  inFlight.add(userKey);
  cooldowns.set(userKey, now + 2500);
  try {
    const identity = await getLinkedMaxIdentity(message.author.id).catch(() => null);
    const guestSubject = 'discord-guest:dm:' + message.author.id;
    const user = identity
      ? await resolveEcosystemUser({
          subject: identity.maxUserId,
          username: identity.username,
          name: identity.displayName,
          picture: identity.avatarUrl ?? undefined,
          claims: {}
        } as AuthPrincipal)
      : await prisma.ecosystemUser.upsert({
          where: { authSubject: guestSubject },
          create: { authSubject: guestSubject },
          update: {}
        });
    const conversation = await getConversation(user.id, 'Discord DM');
    await prisma.message.create({
      data: { conversationId: conversation.id, role: 'USER', content: message.content.slice(0, 8000) }
    });
    const turns = await getTurns(conversation.id);
    const context = [
      'This is a direct, private Discord conversation with MAX.',
      'The current speaker is the Discord message author. Never infer identity from another person mentioned in the message.',
      'Speaker is linked to MAX Auth: ' + Boolean(identity) + '.',
      'Trusted MAX display name: ' + (identity?.displayName ?? 'unknown; do not guess') + '.',
      'There is no server role or server permission context in this direct message.'
    ].join('\n');
    const generated = identity
      ? await orchestrate({
          id: user.id,
          displayName: user.displayName,
          locale: user.locale,
          timezone: user.timezone,
          authSubject: identity.maxUserId,
          scopes: []
        }, conversation.id, turns, message.content, context)
      : await orchestrateDiscordGuest({
          id: user.id,
          displayName: null,
          locale: user.locale,
          timezone: user.timezone
        }, turns, message.content, context);
    const reply = generated.confirmations.length
      ? generated.text + '\n\n🔐 This action needs confirmation. Please open MAX AI to review and approve it securely.'
      : generated.text;
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: reply,
        provider: generated.provider,
        model: generated.model,
        metadata: { source: 'discord-dm', linkedIdentity: Boolean(identity), tools: generated.tools }
      }
    });
    await sendLongReply(message, reply);
  } catch (error) {
    logger.error({ errorType: error instanceof Error ? error.name : typeof error }, 'Discord DM processing failed');
    await message.reply({ content: '⚠️ MAX could not complete that request right now. Please try again.', allowedMentions: { parse: [] } }).catch(() => undefined);
  } finally {
    inFlight.delete(userKey);
  }
}

export function startDiscordGateway() {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GATEWAY_ENABLED) {
    logger.info('Discord Gateway is disabled or DISCORD_BOT_TOKEN is not configured');
    return;
  }
  if (client) return;

  client = new Client({
    partials: [Partials.Channel],
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent
    ]
  });
  client.once('ready', (readyClient) => {
    logger.info({ botUser: readyClient.user.tag, guildCount: readyClient.guilds.cache.size }, 'MAX Discord Gateway connected');
  });
  client.on('messageCreate', (message) => {
    if (message.guild) void handleGuildMessage(message);
    else void handleDirectMessage(message);
  });
  client.on('error', (error) => {
    logger.error({ errorType: error.name }, 'MAX Discord Gateway client error');
  });
  client.on('shardDisconnect', (_event, shardId) => {
    logger.warn({ shardId }, 'MAX Discord Gateway shard disconnected; discord.js will reconnect');
  });
  void client.login(env.DISCORD_BOT_TOKEN).catch((error) => {
    logger.error({ errorType: error instanceof Error ? error.name : typeof error }, 'MAX Discord Gateway login failed');
  });
}

export async function stopDiscordGateway() {
  if (!client) return;
  const current = client;
  client = null;
  current.destroy();
  logger.info('MAX Discord Gateway stopped');
}

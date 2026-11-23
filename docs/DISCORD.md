# MAX Backend Discord integration

MAX supports HTTP interactions and a persistent Discord Gateway connection.

## Required configuration

Set these Render environment variables:

- `DISCORD_APPLICATION_ID`: Discord application ID.
- `DISCORD_BOT_TOKEN`: bot token (keep secret).
- `DISCORD_PUBLIC_KEY`: application public key for signed HTTP interactions.
- `MAX_AUTH_SERVICE_TOKEN`: trusted service token shared with MAX Auth.
- `DISCORD_GATEWAY_ENABLED=true`: enables the persistent Gateway listener.

The backend registers the `/ask` and `/max-channel` application commands when the application ID and bot token are configured. The staff text command `!max-channel` is also available in the configured staff channel.

## Discord Developer Portal

Enable the Message Content Intent under Bot → Privileged Gateway Intents. The bot needs View Channels, Read Message History, Send Messages, Send Messages in Threads, and permission to send DMs. Install it with bot and applications.commands scopes.

HTTP Interactions Endpoint URL:

`https://max-backend-z0ee.onrender.com/api/v1/discord/interactions`

## Channel behaviour and addressing

MAX is silence-first in enabled guild channels. It responds only when at least one of these conditions is met:

- A member mentions the actual MAX bot account.
- A member explicitly addresses MAX by name (for example, “Max, can you help?”).
- A member replies directly to a message authored by MAX.

MAX ignores ordinary channel messages and replies between other members. Members do not need to use `/ask` for an addressed conversation. Direct messages to MAX continue to work without a mention.

A server administrator or member with Manage Server permission can configure channels in the staff channel using `!max-channel`:

- `!max-channel #general, #support` — enable multiple channels.
- `!max-channel disable #general, #support` — disable selected channels.
- `!max-channel status` — list enabled channels.
- `!max-channel clear` — remove all channel configurations.

Use a dedicated channel such as `#max-chat`. Channel settings are stored per server and channel. The explicit-address requirement remains in force even after a channel is enabled.

## Message and channel context

When a member addresses MAX in a guild channel, MAX receives the referenced Discord message (when the current message is a reply) and up to eight preceding messages from that channel or thread. Context includes author attribution and preserves Unicode source text, including Japanese. Message bodies and server/channel/display/role names are treated as untrusted content, not instructions.

## Identity and privacy boundaries

- MAX Auth's existing Discord account link is the only source of a linked MAX identity. The current speaker's Discord ID is looked up; mentioned or quoted users are never used as the authenticated principal.
- Unlinked speakers receive an isolated guest conversation. Guest mode has no MAX memories, connected-service personalisation, or account tools.
- Shared guild conversations do not expose a linked user's private identity, memories, or account context. Private account requests use the existing private DM path.
- Discord server roles and permissions describe server authority only. They do not grant MAX account privileges or access to another person's private data.
- The server owner, channel, role hierarchy, and permission context are supplied as context only.
- The bot ignores bot/webhook messages and applies per-user cooldowns.

## Platform awareness

Discord guild, thread, and DM requests carry trusted internal source metadata identifying Discord and the relevant surface. Authenticated MAX Webchat normal and streaming requests carry a Webchat source marker. These markers are internal orchestration context and do not change the user-facing response format.

## Operations

The Gateway client uses discord.js, which manages heartbeats, reconnects, and session resumption. Run one active Render instance for this bot token unless a deliberate sharding strategy is configured. The bot requires the Message Content privileged intent. Direct messages are also enabled for private conversations. The existing `/ask` interaction remains available as a fallback for linked users.

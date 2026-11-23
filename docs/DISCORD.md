# MAX Backend Discord integration

MAX supports HTTP interactions and a persistent Discord Gateway connection.

## Required configuration

Set these Render environment variables:

- DISCORD_APPLICATION_ID: Discord application ID.
- DISCORD_BOT_TOKEN: bot token (keep secret).
- DISCORD_PUBLIC_KEY: application public key for signed HTTP interactions.
- MAX_AUTH_SERVICE_TOKEN: trusted service token shared with MAX Auth.
- DISCORD_GATEWAY_ENABLED=true: enables the persistent Gateway listener.

The backend registers /ask and /max-channel commands when the application ID and bot token are configured.

## Discord Developer Portal

Enable the Message Content Intent under Bot → Privileged Gateway Intents. The bot needs View Channels, Read Message History, Send Messages, Send Messages in Threads, and permission to send DMs. Install it with bot and applications.commands scopes.

HTTP Interactions Endpoint URL:

https://max-backend-z0ee.onrender.com/api/v1/discord/interactions

## Enable ordinary chat

MAX does not answer in any server channel by default. A server administrator or member with Manage Server can run:

- /max-channel action:Enable channel:#max-chat
- /max-channel action:Disable channel:#max-chat
- /max-channel action:Status channel:#max-chat

After enabling a channel, MAX responds to normal messages there; no /ask command or mention is required. Use a dedicated channel such as #max-chat. Channel settings are stored per server and channel.

## Identity and privacy boundaries

- MAX Auth's existing Discord account link is the only source of a linked MAX identity. The speaker's Discord ID is looked up; mentioned or quoted users are never used as the authenticated principal.
- Unlinked speakers receive an isolated guest conversation. Guest mode has no MAX memories, connected-service personalisation, or account tools.
- Public guild channels always use restricted guest mode. A linked speaker's likely personal/account request is processed under that speaker's linked MAX identity and delivered by DM. If DM delivery fails, no private answer is posted in the channel.
- A linked speaker in a channel hidden from @everyone can use account features there. Discord server roles and permissions do not grant MAX account privileges.
- The server owner, channel, role hierarchy, and permission context are provided to MAX as Discord context only.
- The bot ignores bot/webhook messages and applies per-user cooldowns.

## Operations

The Gateway client uses discord.js, which manages heartbeats, reconnects, and session resumption. Run one active Render instance for this bot token unless a deliberate sharding strategy is configured. The bot requires the Message Content privileged intent. Direct messages are also enabled for private conversations. The existing /ask interaction remains available as a fallback for linked users.

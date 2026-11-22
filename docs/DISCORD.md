# MAX Backend Discord integration

Discord interactions endpoint: `POST /api/v1/discord/interactions`.

The backend registers the global `/ask prompt:` slash command when
`DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN` are configured. Set the
Discord application's Interactions Endpoint URL to:

`https://max-backend-z0ee.onrender.com/api/v1/discord/interactions`

Install the bot with the `bot` and `applications.commands` OAuth2 scopes.
The MAX Auth Discord account connection remains the identity source: a Discord
user must link the same Discord account under MAX Auth Connected Accounts.

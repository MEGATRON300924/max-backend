import 'dotenv/config';

const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_COMMAND_GUILD_ID;

if (!token || !applicationId) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID before registering commands.');
  process.exit(1);
}

const command: Record<string, unknown> = {
  name: 'max',
  description: 'Chat with MAX AI',
  options: [{
    type: 3,
    name: 'message',
    description: 'What would you like MAX to help with?',
    required: true,
    max_length: 1500,
  }],
};
if (!guildId) {
  Object.assign(command, { integration_types: [0, 1], contexts: [0, 1, 2] });
}

const collectionPath = guildId
  ? `applications/${applicationId}/guilds/${guildId}/commands`
  : `applications/${applicationId}/commands`;
const headers = {
  Authorization: `Bot ${token}`,
  'Content-Type': 'application/json',
};
const listResponse = await fetch(`https://discord.com/api/v10/${collectionPath}`, { headers });
const existingCommands = await listResponse.json().catch(() => []);
if (!listResponse.ok || !Array.isArray(existingCommands)) {
  console.error('Could not inspect existing Discord commands:', listResponse.status, existingCommands);
  process.exit(1);
}

const existing = existingCommands.find((item: { name?: string }) => item.name === 'max');
const targetPath = existing?.id ? `${collectionPath}/${existing.id}` : collectionPath;
const response = await fetch(`https://discord.com/api/v10/${targetPath}`, {
  method: existing?.id ? 'PATCH' : 'POST',
  headers,
  body: JSON.stringify(command),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error('Discord command registration failed:', response.status, body);
  process.exit(1);
}
console.log(`Registered /max command ${guildId ? 'for guild ' + guildId : 'globally'} without replacing other commands.`);

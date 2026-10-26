const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_COMMAND_GUILD_ID;

if (!token || !applicationId) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID before registering commands.');
  process.exit(1);
}

const command = {
  name: 'max',
  description: 'Chat with MAX AI',
  options: [{
    type: 3,
    name: 'message',
    description: 'What would you like MAX to help with?',
    required: true,
    max_length: 1500,
  }],
  dm_permission: true,
  integration_types: [0, 1],
  contexts: [0, 1, 2],
};

const path = guildId
  ? `applications/${applicationId}/guilds/${guildId}/commands`
  : `applications/${applicationId}/commands`;

const response = await fetch(`https://discord.com/api/v10/${path}`, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify([command]),
});

const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error('Discord command registration failed:', response.status, body);
  process.exit(1);
}
console.log(`Registered /max command ${guildId ? 'for guild ' + guildId : 'globally'}.`);

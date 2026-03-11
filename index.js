require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const http = require('http');

// ─── Railway health-check server ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is online ✅');
}).listen(PORT, () => console.log(`Health check listening on port ${PORT}`));

// ─── Discord client ─────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─── Color palette ──────────────────────────────────────────────────────────────
const PRODUCT_COLORS = [
  0x5865F2, 0xEB459E, 0x57F287, 0xFEE75C, 0xED4245,
  0x9B59B6, 0x1ABC9C, 0xE67E22, 0x3498DB, 0xE74C3C,
  0x2ECC71, 0xF39C12, 0x1F8B4C, 0x206694, 0x71368A,
  0xAD1457, 0x11806A, 0xC27C0E, 0xA84300, 0x979C9F,
];

const productColorMap = {};
let colorIndex = 0;

function getProductColor(productName) {
  const key = productName.toLowerCase().trim();
  if (!(key in productColorMap)) {
    productColorMap[key] = PRODUCT_COLORS[colorIndex % PRODUCT_COLORS.length];
    colorIndex++;
  }
  return productColorMap[key];
}

// ─── Update types ───────────────────────────────────────────────────────────────
const UPDATE_TYPES = {
  'status_change': { label: 'Status Change', emoji: '🔄' },
  'maintenance':   { label: 'Maintenance',   emoji: '🛠️' },
  'update':        { label: 'Update',        emoji: '⬆️' },
  'patch':         { label: 'Patch',         emoji: '🩹' },
  'undetected':    { label: 'Undetected',    emoji: '✅' },
  'detected':      { label: 'Detected',      emoji: '🚨' },
  'disabled':      { label: 'Disabled',      emoji: '⛔' },
  'enabled':       { label: 'Enabled',       emoji: '🟢' },
  'new_product':   { label: 'New Product',   emoji: '🆕' },
  'sale':          { label: 'Sale',          emoji: '💸' },
};

// ─── Slash commands ─────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('update')
    .setDescription('Post a product update to the updates channel')
    .addStringOption(o => o.setName('product').setDescription('Product name (e.g. Ancient - ARC Raiders)').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Update type').setRequired(true)
      .addChoices(
        { name: '🔄 Status Change', value: 'status_change' },
        { name: '🛠️ Maintenance',   value: 'maintenance'   },
        { name: '⬆️ Update',        value: 'update'        },
        { name: '🩹 Patch',         value: 'patch'         },
        { name: '✅ Undetected',    value: 'undetected'    },
        { name: '🚨 Detected',      value: 'detected'      },
        { name: '⛔ Disabled',      value: 'disabled'      },
        { name: '🟢 Enabled',       value: 'enabled'       },
        { name: '🆕 New Product',   value: 'new_product'   },
        { name: '💸 Sale',          value: 'sale'          },
      ))
    .addStringOption(o => o.setName('notes').setDescription('Notes separated by | (e.g. Updated for patch | Keys unfrozen)').setRequired(true))
    .addStringOption(o => o.setName('channel').setDescription('Channel to post in (name or ID)').setRequired(false))
    .addStringOption(o => o.setName('ping').setDescription('Role to ping (role name or ID)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('quickupdate')
    .setDescription('Quick one-liner product status update')
    .addStringOption(o => o.setName('product').setDescription('Product name').setRequired(true))
    .addStringOption(o => o.setName('status').setDescription('Short status message').setRequired(true)),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log('✅ Slash commands registered!');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

// ─── Bot ready ──────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// ─── Interactions ───────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // /update
  if (interaction.commandName === 'update') {
    const product  = interaction.options.getString('product');
    const typeKey  = interaction.options.getString('type');
    const notesRaw = interaction.options.getString('notes');
    const pingStr  = interaction.options.getString('ping') || '';
    const chanName = interaction.options.getString('channel') || '';

    const typeInfo = UPDATE_TYPES[typeKey] || { label: typeKey, emoji: '📢' };
    const notes    = notesRaw.split('|').map(n => `• ${n.trim()}`).join('\n');
    const color    = getProductColor(product);

    const embed = new EmbedBuilder()
      .setTitle(product.toUpperCase())
      .setColor(color)
      .addFields(
        { name: 'Product', value: `\`${product}\``,                       inline: false },
        { name: 'Type',    value: `${typeInfo.emoji}  ${typeInfo.label}`, inline: false },
        { name: 'Notes',   value: notes,                                  inline: false },
      )
      .setFooter({
        text: `${process.env.BOT_NAME || 'Updates'} | ${process.env.SITE_URL || ''}`,
        iconURL: client.user.displayAvatarURL()
      })
      .setTimestamp();

    let targetChannel = interaction.channel;
    if (chanName) {
      const found = interaction.guild.channels.cache.find(
        c => c.name === chanName.replace('#', '') || c.id === chanName
      );
      if (found) targetChannel = found;
    }

    let pingText = '';
    if (pingStr) {
      const roleMatch = pingStr.match(/\d+/);
      if (roleMatch) {
        pingText = `<@&${roleMatch[0]}>`;
      } else {
        const role = interaction.guild.roles.cache.find(
          r => r.name.toLowerCase() === pingStr.replace('@', '').toLowerCase()
        );
        if (role) pingText = `<@&${role.id}>`;
      }
    }

    try {
      await targetChannel.send({ content: pingText || null, embeds: [embed] });
      await interaction.reply({ content: `✅ Update posted to <#${targetChannel.id}>`, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `❌ Failed to post: ${err.message}`, ephemeral: true });
    }
  }

  // /quickupdate
  if (interaction.commandName === 'quickupdate') {
    const product = interaction.options.getString('product');
    const status  = interaction.options.getString('status');
    const color   = getProductColor(product);

    const embed = new EmbedBuilder()
      .setTitle(product.toUpperCase())
      .setDescription(status)
      .setColor(color)
      .setFooter({
        text: `${process.env.BOT_NAME || 'Updates'} | ${process.env.SITE_URL || ''}`,
        iconURL: client.user.displayAvatarURL()
      })
      .setTimestamp();

    await interaction.channel.send({ embeds: [embed] });
    await interaction.reply({ content: '✅ Quick update posted!', ephemeral: true });
  }
});

client.login(process.env.BOT_TOKEN);

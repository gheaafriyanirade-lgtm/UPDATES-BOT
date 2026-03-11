require('dotenv').config();
const {
  Client, GatewayIntentBits, EmbedBuilder, REST, Routes,
  SlashCommandBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('discord.js');
const http = require('http');

// ─── Railway health-check ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is online ✅');
}).listen(PORT, () => console.log(`Health check listening on port ${PORT}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ─── Colors ──────────────────────────────────────────────────────────────────
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

// ─── Update types ─────────────────────────────────────────────────────────────
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
  'bug_fix':       { label: 'Bug Fix',       emoji: '🔧' },
  'announcement':  { label: 'Announcement',  emoji: '📣' },
};

// ─── Status types ─────────────────────────────────────────────────────────────
const STATUS_TYPES = {
  'updating': { emoji: '🔵', label: 'Updating', color: 0x3498DB },
  'testing':  { emoji: '🟡', label: 'Testing',  color: 0xF1C40F },
  'updated':  { emoji: '🟢', label: 'Updated',  color: 0x57F287 },
};

// Tracks last known status per product so we can show "Changed from"
// key: productName.toLowerCase() → statusKey
const productLastStatus = {};

// Tracks live setstatus banner messages
// key: `${guildId}_${channelId}` → { channelId, messageId }
const statusMessages = {};

// ─── Auto-delete helper ───────────────────────────────────────────────────────
async function autoDelete(interaction, ms) {
  await new Promise(r => setTimeout(r, ms));
  try { await interaction.deleteReply(); } catch (_) {}
}

// ─── Commands ─────────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('postupdate')
    .setDescription('Open the product update form'),

  new SlashCommandBuilder()
    .setName('setstatus')
    .setDescription('Set the live status indicator banner')
    .addStringOption(o =>
      o.setName('status')
        .setDescription('New status')
        .setRequired(true)
        .addChoices(
          { name: '🔵 UPDATING — products being updated', value: 'updating' },
          { name: '🟡 TESTING  — in testing phase',       value: 'testing'  },
          { name: '🟢 UPDATED  — all products operational', value: 'updated' },
        )
    )
    .addStringOption(o =>
      o.setName('product')
        .setDescription('Specific product (optional — blank = global)')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('channel')
        .setDescription('Channel to post in (optional)')
        .setRequired(false)
    ),
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

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// ─── Pending store ────────────────────────────────────────────────────────────
const pendingUpdates = {};

// ─── Interactions ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

  // ── /postupdate → type dropdown ──────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'postupdate') {
    const select = new StringSelectMenuBuilder()
      .setCustomId('select_update_type')
      .setPlaceholder('Select update type...')
      .addOptions(
        Object.entries(UPDATE_TYPES).map(([value, { label, emoji }]) =>
          new StringSelectMenuOptionBuilder().setLabel(label).setValue(value).setEmoji(emoji)
        )
      );

    await interaction.reply({
      content: '### 📋 New Product Update\nSelect the **update type** to continue:',
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true,
    });

    autoDelete(interaction, 60_000);
  }

  // ── Type selected → open modal ────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_update_type') {
    const typeKey  = interaction.values[0];
    const typeInfo = UPDATE_TYPES[typeKey];
    pendingUpdates[interaction.user.id] = { typeKey };

    const modal = new ModalBuilder()
      .setCustomId('update_modal')
      .setTitle(`${typeInfo.emoji} ${typeInfo.label} — Product Update`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('product_name')
          .setLabel('PRODUCT NAME')
          .setPlaceholder('e.g. Ancient - ARC Raiders')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('status_transition')
          .setLabel('STATUS  (old → new,  e.g.  updating → updated)')
          .setPlaceholder('updating → updated')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(40)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('notes')
          .setLabel('NOTES  (separate bullet points with  |)')
          .setPlaceholder('e.g. Updated for latest patch | Keys unfrozen')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('channel')
          .setLabel('POST TO CHANNEL  (name or ID, optional)')
          .setPlaceholder('e.g. product-updates')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ping_role')
          .setLabel('PING ROLE  (name or ID, optional)')
          .setPlaceholder('e.g. Product Updates')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
      ),
    );

    await interaction.showModal(modal);
    try { await interaction.deleteReply(); } catch (_) {}
  }

  // ── Modal submitted → post embed ──────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'update_modal') {
    const product        = interaction.fields.getTextInputValue('product_name').trim();
    const notesRaw       = interaction.fields.getTextInputValue('notes');
    const chanName       = interaction.fields.getTextInputValue('channel') || '';
    const pingStr        = interaction.fields.getTextInputValue('ping_role') || '';
    const statusTransRaw = interaction.fields.getTextInputValue('status_transition').trim().toLowerCase();

    const pending  = pendingUpdates[interaction.user.id] || {};
    const typeKey  = pending.typeKey || 'update';
    const typeInfo = UPDATE_TYPES[typeKey] || { label: typeKey, emoji: '📢' };
    delete pendingUpdates[interaction.user.id];

    // ── Parse status transition (e.g. "updating → updated" or "updating->updated") ──
    let oldStatus = null;
    let newStatus = null;

    if (statusTransRaw) {
      // Support →, ->, >, to, /
      const parts = statusTransRaw.split(/→|->|>|\bto\b|\//).map(p => p.trim());
      if (parts.length === 2) {
        oldStatus = STATUS_TYPES[parts[0]] || null;
        newStatus = STATUS_TYPES[parts[1]] || null;
      } else if (parts.length === 1) {
        // Single value = just new status, look up last known old status
        newStatus = STATUS_TYPES[parts[0]] || null;
        const lastKey = productLastStatus[product.toLowerCase()];
        oldStatus = lastKey ? STATUS_TYPES[lastKey] : null;
      }
    }

    // Save new status for next time
    if (newStatus) {
      const newKey = Object.keys(STATUS_TYPES).find(k => STATUS_TYPES[k] === newStatus);
      if (newKey) productLastStatus[product.toLowerCase()] = newKey;
    }

    const notes = notesRaw.split('|').map(n => `• ${n.trim()}`).join('\n');
    const embedColor = newStatus ? newStatus.color : getProductColor(product);

    // Build fields
    const fields = [
      { name: 'Product', value: `\`${product}\``, inline: false },
      { name: 'Type',    value: `${typeInfo.emoji}  ${typeInfo.label}`, inline: false },
    ];

    // Status transition block — shown like the screenshot
    if (oldStatus && newStatus) {
      fields.push(
        { name: 'Changed from', value: `${oldStatus.emoji}  ${oldStatus.label}`,  inline: true },
        { name: 'New Status',   value: `${newStatus.emoji}  ${newStatus.label}`,  inline: true },
      );
    } else if (newStatus) {
      fields.push(
        { name: 'Status', value: `${newStatus.emoji}  ${newStatus.label}`, inline: false },
      );
    }

    fields.push({ name: 'Notes', value: notes, inline: false });

    const embed = new EmbedBuilder()
      .setTitle(product.toUpperCase())
      .setColor(embedColor)
      .addFields(fields)
      .setFooter({
        text: `${process.env.BOT_NAME || 'Updates'} | ${process.env.SITE_URL || ''}`,
        iconURL: client.user.displayAvatarURL(),
      })
      .setTimestamp();

    // Resolve channel
    let targetChannel = interaction.channel;
    if (chanName) {
      const found = interaction.guild.channels.cache.find(
        c => c.name === chanName.replace('#', '') || c.id === chanName
      );
      if (found) targetChannel = found;
    }

    // Resolve ping
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
      await interaction.reply({
        content: `✅ Update posted to <#${targetChannel.id}>  •  *deletes in 5s*`,
        ephemeral: true,
      });
      autoDelete(interaction, 5_000);
    } catch (err) {
      await interaction.reply({
        content: `❌ Failed to post: ${err.message}`,
        ephemeral: true,
      });
      autoDelete(interaction, 8_000);
    }
  }

  // ── /setstatus → post or edit live banner ────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setstatus') {
    const statusKey = interaction.options.getString('status');
    const product   = interaction.options.getString('product') || null;
    const chanName  = interaction.options.getString('channel') || '';
    const s         = STATUS_TYPES[statusKey];

    let targetChannel = interaction.channel;
    if (chanName) {
      const found = interaction.guild.channels.cache.find(
        c => c.name === chanName.replace('#', '') || c.id === chanName
      );
      if (found) targetChannel = found;
    }

    // Look up old status for this product/global
    const trackKey  = product ? product.toLowerCase() : '__global__';
    const oldKey    = productLastStatus[trackKey];
    const oldStatus = oldKey ? STATUS_TYPES[oldKey] : null;

    // Save new status
    productLastStatus[trackKey] = statusKey;

    const title = product
      ? `${s.emoji}  ${product.toUpperCase()}  —  ${s.label}`
      : `${s.emoji}  SERVICE STATUS  —  ${s.label}`;

    const descLines = [
      `\`\`\`\n🔵 UPDATING   🟡 TESTING   🟢 UPDATED\n\`\`\``,
    ];

    if (oldStatus) {
      descLines.push(`**Changed from:**  ${oldStatus.emoji} ${oldStatus.label}  →  ${s.emoji} **${s.label}**`);
    } else {
      descLines.push(`**Current Status:**  ${s.emoji} **${s.label}**`);
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(descLines.join('\n'))
      .setColor(s.color)
      .setFooter({
        text: `${process.env.BOT_NAME || 'Updates'} | ${process.env.SITE_URL || ''}  •  Last updated`,
        iconURL: client.user.displayAvatarURL(),
      })
      .setTimestamp();

    const guildKey = `${interaction.guild.id}_${targetChannel.id}`;

    try {
      const existing = statusMessages[guildKey];
      if (existing) {
        try {
          const ch  = await client.channels.fetch(existing.channelId);
          const msg = await ch.messages.fetch(existing.messageId);
          await msg.edit({ embeds: [embed] });
          await interaction.reply({
            content: `🔄 Status updated to **${s.emoji} ${s.label}** in <#${targetChannel.id}>  •  *deletes in 5s*`,
            ephemeral: true,
          });
          autoDelete(interaction, 5_000);
          return;
        } catch (_) { /* old message gone, post fresh */ }
      }

      const msg = await targetChannel.send({ embeds: [embed] });
      statusMessages[guildKey] = { channelId: targetChannel.id, messageId: msg.id };

      await interaction.reply({
        content: `📌 Status banner posted in <#${targetChannel.id}>  •  *deletes in 5s*`,
        ephemeral: true,
      });
      autoDelete(interaction, 5_000);

    } catch (err) {
      await interaction.reply({
        content: `❌ Failed: ${err.message}`,
        ephemeral: true,
      });
      autoDelete(interaction, 8_000);
    }
  }

});

client.login(process.env.BOT_TOKEN);

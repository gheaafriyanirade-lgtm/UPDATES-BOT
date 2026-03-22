require('dotenv').config();
const { getAllProducts, getProduct, setProductUrl, getProductChunks, getProductByName } = require('./downloads');
const {
  Client, GatewayIntentBits, EmbedBuilder, REST, Routes,
  SlashCommandBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, ChannelType
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
  'bug_fix':       { label: 'Bug Fix',        emoji: '🔧' },
  'announcement':  { label: 'Announcement',   emoji: '📣' },
  'time_extension':{ label: 'Time Extension', emoji: '🕐' },
  'new_feature':   { label: 'New Feature',    emoji: '✨' },
};

// ─── Status types ─────────────────────────────────────────────────────────────
const STATUS_TYPES = {
  'updating': { emoji: '🟣', label: 'Updating', color: 0x9B59B6 },
  'testing':  { emoji: '🟡', label: 'Testing',  color: 0xF1C40F },
  'updated':  { emoji: '🟢', label: 'Updated',  color: 0x57F287 },
};

// Tracks last known status per product so we can show "Changed from"
// key: productName.toLowerCase() → statusKey
const productLastStatus = {};

// Tracks live setstatus banner messages
// key: `${guildId}_${channelId}` → { channelId, messageId }
const statusMessages = {};

// Tracks the pinned website message per guild
// key: guildId → { channelId, messageId }
const websiteMessages = {};

// Reseller button links — persisted in memory (editable via /setresellerlinks)
const resellerLinks = {
  apply: 'https://uhservicess.netlify.app/',
  panel: 'https://uhservicess.netlify.app/',
};

// Tracks the reseller panel message per guild
// key: guildId → { channelId, messageId }
const resellerMessages = {};

// ─── Auto-delete helper ───────────────────────────────────────────────────────
async function autoDelete(interaction, ms) {
  await new Promise(r => setTimeout(r, ms));
  try { await interaction.deleteReply(); } catch (_) {}
}

// ─── Permission check ────────────────────────────────────────────────────────
function hasAccess(interaction) {
  const member = interaction.member;
  // Allow if Administrator
  if (member.permissions.has('Administrator')) return true;
  // Allow if they have the MODERATOR role
  if (member.roles.cache.some(r => r.name === 'MODERATOR')) return true;
  return false;
}

// ─── Commands ─────────────────────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('postupdate')
    .setDescription('Open the product update form'),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send a custom announcement to any channel'),

  new SlashCommandBuilder()
    .setName('downloads')
    .setDescription('Browse and download products'),

  new SlashCommandBuilder()
    .setName('setdownload')
    .setDescription('Admin: Set or update a download link for a product')
    .addStringOption(o =>
      o.setName('product')
        .setDescription('Product name (type to search)')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(o =>
      o.setName('url')
        .setDescription('Download URL')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setupdownloads')
    .setDescription('Admin: Post the download panel to #downloads channel'),

  new SlashCommandBuilder()
    .setName('setwebsite')
    .setDescription('Admin: Set or update the website URL pinned in the website channel')
    .addStringOption(o =>
      o.setName('url')
        .setDescription('Full website URL (e.g. https://uhservices.gg)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('commands')
    .setDescription('Show all available bot commands'),

  new SlashCommandBuilder()
    .setName('setupreseller')
    .setDescription('Admin: Post the reseller program panel to #reseller-program'),

  new SlashCommandBuilder()
    .setName('postimage')
    .setDescription('Admin: Post an image with an optional message to any channel')
    .addAttachmentOption(o =>
      o.setName('image')
        .setDescription('Image to post')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('message')
        .setDescription('Optional message to include')
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName('channel')
        .setDescription('Channel to post in (optional, defaults to current)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('setresellerlinks')
    .setDescription('Admin: Update the Apply and Preview Panel button links'),

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
client.on('error', err => console.error('Client error:', err));

client.on('interactionCreate', async interaction => {
  try {

  // ── /postupdate → type dropdown ──────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'postupdate') {
    if (!hasAccess(interaction)) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
    }
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
      flags: 64,
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

    const isTimeExtension = typeKey === 'time_extension' || typeKey === 'new_feature';

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
          .setLabel(isTimeExtension ? 'TIME ADDED  (e.g. 12 hours, 3 days)' : 'STATUS  (e.g. updating → updated)')
          .setPlaceholder(isTimeExtension ? 'e.g. 12 hours' : 'updating → updated')
          .setStyle(TextInputStyle.Short)
          .setRequired(isTimeExtension)
          .setMaxLength(40)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('notes')
          .setLabel('NOTES  (separate bullet points with  |)')
          .setPlaceholder('e.g. Updated for latest patch | Keys unfrozen')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('custom_title')
          .setLabel('CUSTOM TITLE  (optional)')
          .setPlaceholder('e.g. ALL ANCIENT PRODUCTS!!!')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('image_url')
          .setLabel('IMAGE URL  (optional)')
          .setPlaceholder('https://imgur.com/...')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
      ),
    );

    await interaction.showModal(modal);
    try { await interaction.deleteReply(); } catch (_) {}
  }

  // ── Modal submitted → post embed ──────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'update_modal') {
    const product        = interaction.fields.getTextInputValue('product_name').trim();
    const notesRaw       = interaction.fields.getTextInputValue('notes');
    const customTitle    = interaction.fields.getTextInputValue('custom_title').trim() || '';
    let imageUrl         = interaction.fields.getTextInputValue('image_url').trim() || '';
    if (imageUrl && !imageUrl.startsWith('http')) imageUrl = 'https://' + imageUrl;
    const statusTransRaw = interaction.fields.getTextInputValue('status_transition').trim().toLowerCase();

    const pending  = pendingUpdates[interaction.user.id] || {};
    const typeKey  = pending.typeKey || 'update';
    const typeInfo = UPDATE_TYPES[typeKey] || { label: typeKey, emoji: '📢' };
    delete pendingUpdates[interaction.user.id];

    // ── Parse status transition (skip for time_extension) ────────────────────
    let oldStatus = null;
    let newStatus = null;

    if (statusTransRaw && typeKey !== 'time_extension' && typeKey !== 'new_feature') {
      // Support →, ->, >, to, /
      const parts = statusTransRaw.split(/→|->|>|\bto\b|\//).map(p => p.trim());
      if (parts.length === 2) {
        oldStatus = STATUS_TYPES[parts[0]] || null;
        newStatus = STATUS_TYPES[parts[1]] || null;
      } else if (parts.length === 1) {
        // Single value = just new status, look up last known old status
        newStatus = STATUS_TYPES[parts[0]] || null;
        const lastKey = productLastStatus[product.toLowerCase()];
        const lastStatus = lastKey ? STATUS_TYPES[lastKey] : null;
        // Only set oldStatus if it's actually different from newStatus
        if (lastStatus && lastStatus !== newStatus) {
          oldStatus = lastStatus;
        }
      }
    }

    // Save new status for next time
    if (newStatus) {
      const newKey = Object.keys(STATUS_TYPES).find(k => STATUS_TYPES[k] === newStatus);
      if (newKey) productLastStatus[product.toLowerCase()] = newKey;
    }

    const notes = notesRaw ? notesRaw.split('|').map(n => `• ${n.trim()}`).join('\n') : null;
    const embedColor = newStatus ? newStatus.color : getProductColor(product);

    // Build fields
    const fields = [
      { name: 'Product', value: `\`${product}\``, inline: false },
    ];

    // Time Added field for time_extension type
    if ((typeKey === 'time_extension' || typeKey === 'new_feature') && statusTransRaw) {
      fields.push({ name: 'Time Added', value: statusTransRaw, inline: false });
    }

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

    if (notes) fields.push({ name: 'Notes', value: notes, inline: false });

    // Use custom title if provided, otherwise fall back to product name
    const baseTitle = customTitle ? customTitle.toUpperCase() : product.toUpperCase();
    const embedTitle = baseTitle;

    // Look up download URL from saved product store
    const productData = getProductByName(product);
    const downloadUrl = productData ? (productData.url || '') : '';

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .addFields(fields)
      .setFooter({
        text: `${process.env.BOT_NAME || 'Updates'} | ${process.env.SITE_URL || ''}`,
        iconURL: client.user.displayAvatarURL(),
      })
      .setTimestamp();

    if (customTitle) {
      embed.setTitle(customTitle.toUpperCase());
    } else {
      embed.setDescription(`**${typeInfo.label}**`);
    }
    if (imageUrl) embed.setThumbnail(imageUrl);

    // Always post to the channel the command was used in
    const targetChannel = interaction.channel;

    // Build button row if download URL provided
    const buttonRow = downloadUrl
      ? new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('⬇️  DOWNLOAD')
            .setURL(downloadUrl)
            .setStyle(ButtonStyle.Link),
        )
      : null;

    const msgPayload = {
      embeds: [embed],
      ...(buttonRow ? { components: [buttonRow] } : {}),
    };

    try {
      await targetChannel.send(msgPayload);
      await interaction.reply({
        content: `✅ Update posted to <#${targetChannel.id}>  •  *deletes in 5s*`,
        flags: 64,
      });
      autoDelete(interaction, 5_000);
    } catch (err) {
      await interaction.reply({
        content: `❌ Failed to post: ${err.message}`,
        flags: 64,
      });
      autoDelete(interaction, 8_000);
    }
  }

  // ── /announce → open announcement modal ─────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'announce') {
    if (!hasAccess(interaction)) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
    }
    const modal = new ModalBuilder()
      .setCustomId('announce_modal')
      .setTitle('📣 New Announcement');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('announce_title')
          .setLabel('TITLE')
          .setPlaceholder('e.g. New Update Available')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('announce_message')
          .setLabel('MESSAGE')
          .setPlaceholder('Write your announcement here...')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('announce_download')
          .setLabel('DOWNLOAD LINK  (optional)')
          .setPlaceholder('e.g. gofile.io/d/abc')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('announce_channel')
          .setLabel('POST TO CHANNEL  (name or ID, optional)')
          .setPlaceholder('e.g. general')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('announce_ping')
          .setLabel('PING  (everyone / here / role name or ID)')
          .setPlaceholder('e.g. everyone')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
      ),
    );

    await interaction.showModal(modal);
  }

  // ── Announce modal submitted ───────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'announce_modal') {
    const title      = interaction.fields.getTextInputValue('announce_title').trim();
    const message    = interaction.fields.getTextInputValue('announce_message').trim();
    const chanName   = interaction.fields.getTextInputValue('announce_channel').trim() || '';
    const pingStr    = interaction.fields.getTextInputValue('announce_ping').trim() || '';
    let downloadUrl  = interaction.fields.getTextInputValue('announce_download').trim() || '';

    // Auto-fix URL
    if (downloadUrl && !downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://')) {
      downloadUrl = 'https://' + downloadUrl;
    }

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
      const clean = pingStr.replace('@', '').trim().toLowerCase();
      if (clean === 'everyone') {
        pingText = '@everyone';
      } else if (clean === 'here') {
        pingText = '@here';
      } else {
        const roleMatch = pingStr.match(/\d+/);
        if (roleMatch) {
          pingText = `<@&${roleMatch[0]}>`;
        } else {
          const role = interaction.guild.roles.cache.find(
            r => r.name.toLowerCase() === clean
          );
          if (role) pingText = `<@&${role.id}>`;
        }
      }
    }

    // Build embed
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
    if (title) embed.setTitle(title);
    embed.setDescription(message)
      .setFooter({
        text: `${process.env.BOT_NAME || 'Updates'} | ${process.env.SITE_URL || ''}`,
        iconURL: client.user.displayAvatarURL(),
      })
      .setTimestamp();

    // Build download button if URL provided
    const buttonRow = downloadUrl
      ? new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('⬇️  DOWNLOAD')
            .setURL(downloadUrl)
            .setStyle(ButtonStyle.Link),
        )
      : null;

    const msgPayload = {
      content: pingText || null,
      embeds: [embed],
      ...(buttonRow ? { components: [buttonRow] } : {}),
    };

    try {
      await targetChannel.send(msgPayload);
      await interaction.reply({
        content: `✅ Announcement posted to <#${targetChannel.id}>  •  *deletes in 5s*`,
        flags: 64,
      });
      autoDelete(interaction, 5_000);
    } catch (err) {
      await interaction.reply({
        content: `❌ Failed to post: ${err.message}`,
        flags: 64,
      });
      autoDelete(interaction, 8_000);
    }
  }

  // ── Autocomplete for /setdownload ────────────────────────────────────────
  if (interaction.isAutocomplete() && interaction.commandName === 'setdownload') {
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = getAllProducts()
      .filter(p => p.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(p => ({ name: p.name, value: p.id }));
    return interaction.respond(choices);
  }

  // ── /setdownload → admin sets a product URL ───────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setdownload') {
    if (!hasAccess(interaction)) {
      return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
    }
    const productId = interaction.options.getString('product');
    let url = interaction.options.getString('url').trim();
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    const product = getProduct(productId);
    if (!product) {
      return interaction.reply({ content: '❌ Product not found.', flags: 64 });
    }
    setProductUrl(productId, url);
    await interaction.reply({
      content: `✅ Download link updated for **${product.name}**
🔗 ${url}`,
      flags: 64,
    });
    autoDelete(interaction, 8_000);
    return;
  }

  // ── /setupdownloads → post the download panel to #downloads ──────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setupdownloads') {
    if (!hasAccess(interaction)) {
      return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
    }
    const dlChannel = interaction.guild.channels.cache.find(
      c => c.name === 'downloads' && c.type === ChannelType.GuildText
    ) || interaction.channel;

    const embed = new EmbedBuilder()
      .setTitle('📦  PRODUCT DOWNLOADS')
      .setDescription('> Select your product from the dropdown below and click **DOWNLOAD** to get your file.\n> Use the arrows to browse all products across pages.')
      .setColor(0x5865F2)
      .setFooter({
        text: `${process.env.BOT_NAME || 'Updates'} | ${process.env.SITE_URL || ''}`,
        iconURL: client.user.displayAvatarURL(),
      })
      .setTimestamp();

    const chunks = getProductChunks();

    // Page 1 select menu
    const page1 = new StringSelectMenuBuilder()
      .setCustomId('dl_page_1')
      .setPlaceholder('Products A-F  (Page 1 of 3)')
      .addOptions(chunks[0].map(p => ({
        label: p.name.length > 100 ? p.name.slice(0, 97) + '...' : p.name,
        value: p.id,
        description: p.url ? 'Download available' : 'Coming soon',
      })));

    const page2 = new StringSelectMenuBuilder()
      .setCustomId('dl_page_2')
      .setPlaceholder('Products G-R  (Page 2 of 3)')
      .addOptions(chunks[1].map(p => ({
        label: p.name.length > 100 ? p.name.slice(0, 97) + '...' : p.name,
        value: p.id,
        description: p.url ? 'Download available' : 'Coming soon',
      })));

    const page3 = new StringSelectMenuBuilder()
      .setCustomId('dl_page_3')
      .setPlaceholder('Products S-Z + HWID  (Page 3 of 3)')
      .addOptions(chunks[2].map(p => ({
        label: p.name.length > 100 ? p.name.slice(0, 97) + '...' : p.name,
        value: p.id,
        description: p.url ? 'Download available' : 'Coming soon',
      })));

    await dlChannel.send({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(page1),
        new ActionRowBuilder().addComponents(page2),
        new ActionRowBuilder().addComponents(page3),
      ],
    });

    await interaction.reply({ content: `✅ Download panel posted in <#${dlChannel.id}>`, flags: 64 });
    autoDelete(interaction, 5_000);
    return;
  }

  // ── /downloads → same as panel but ephemeral for the user ────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'downloads') {
    const chunks = getProductChunks();

    const page1 = new StringSelectMenuBuilder()
      .setCustomId('dl_page_1')
      .setPlaceholder('Products A-F  (Page 1 of 3)')
      .addOptions(chunks[0].map(p => ({
        label: p.name.length > 100 ? p.name.slice(0, 97) + '...' : p.name,
        value: p.id,
        description: p.url ? 'Download available' : 'Coming soon',
      })));

    const page2 = new StringSelectMenuBuilder()
      .setCustomId('dl_page_2')
      .setPlaceholder('Products G-R  (Page 2 of 3)')
      .addOptions(chunks[1].map(p => ({
        label: p.name.length > 100 ? p.name.slice(0, 97) + '...' : p.name,
        value: p.id,
        description: p.url ? 'Download available' : 'Coming soon',
      })));

    const page3 = new StringSelectMenuBuilder()
      .setCustomId('dl_page_3')
      .setPlaceholder('Products S-Z + HWID  (Page 3 of 3)')
      .addOptions(chunks[2].map(p => ({
        label: p.name.length > 100 ? p.name.slice(0, 97) + '...' : p.name,
        value: p.id,
        description: p.url ? 'Download available' : 'Coming soon',
      })));

    await interaction.reply({
      content: '### Product Downloads\nSelect your product below:',
      components: [
        new ActionRowBuilder().addComponents(page1),
        new ActionRowBuilder().addComponents(page2),
        new ActionRowBuilder().addComponents(page3),
      ],
      flags: 64,
    });
    autoDelete(interaction, 120_000);
    return;
  }

  // ── User selects a product from any download page ────────────────────────
  if (interaction.isStringSelectMenu() && ['dl_page_1','dl_page_2','dl_page_3'].includes(interaction.customId)) {
    const productId = interaction.values[0];
    const product   = getProduct(productId);

    if (!product) {
      return interaction.reply({ content: '❌ Product not found.', flags: 64 });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📦  ${product.name}`)
      .setColor(0x57F287)
      .setFooter({
        text: `${process.env.BOT_NAME || 'Updates'} | ${process.env.SITE_URL || ''}`,
        iconURL: client.user.displayAvatarURL(),
      })
      .setTimestamp();

    if (product.url) {
      embed.setDescription('Your download is ready! Click the button below.');
      const btn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('⬇️  DOWNLOAD')
          .setURL(product.url)
          .setStyle(ButtonStyle.Link)
      );
      await interaction.reply({ embeds: [embed], components: [btn], flags: 64 });
    } else {
      embed.setDescription('Download link not yet available for this product. Check back soon or contact support.');
      await interaction.reply({ embeds: [embed], flags: 64 });
    }

    autoDelete(interaction, 60_000);
    return;
  }

  // ── /setstatus → post or edit live banner ────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setstatus') {
    if (!hasAccess(interaction)) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
    }
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
            flags: 64,
          });
          autoDelete(interaction, 5_000);
          return;
        } catch (_) { /* old message gone, post fresh */ }
      }

      const msg = await targetChannel.send({ embeds: [embed] });
      statusMessages[guildKey] = { channelId: targetChannel.id, messageId: msg.id };

      await interaction.reply({
        content: `📌 Status banner posted in <#${targetChannel.id}>  •  *deletes in 5s*`,
        flags: 64,
      });
      autoDelete(interaction, 5_000);

    } catch (err) {
      await interaction.reply({
        content: `❌ Failed: ${err.message}`,
        flags: 64,
      });
      autoDelete(interaction, 8_000);
    }
  }

  // ── /commands → show all bot commands ────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'commands') {
    const isAdmin = hasAccess(interaction);

    const embed = new EmbedBuilder()
      .setTitle('UHSERVICES UPDATES — Commands')
      .setColor(0x5865F2)
      .setDescription('All available slash commands for this bot.')
      .addFields(
        {
          name: 'General',
          value: [
            '`/commands` — Show this list',
            '`/downloads` — Browse & download products (ephemeral)',
          ].join('\n'),
        },
        {
          name: 'Staff Only',
          value: [
            '`/postupdate` — Post a product update embed',
            '`/postimage` — Post an image directly to any channel',
            '`/announce` — Send a custom announcement',
            '`/setstatus` — Set the live status banner',
            '`/setupdownloads` — Post the download panel to #downloads',
            '`/setdownload` — Set or update a product download link',
            '`/setwebsite` — Post or update the website URL in #website',
            '`/setupreseller` — Post the reseller program panel',
            '`/setresellerlinks` — Update the Apply & Preview Panel button links',
          ].join('\n'),
        }
      )
      .setFooter({
        text: `${process.env.BOT_NAME || 'Updates'} | ${process.env.SITE_URL || ''}`,
        iconURL: client.user.displayAvatarURL(),
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });
    return;
  }

  // ── /setwebsite → post or edit website URL in #website channel ──────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setwebsite') {
    if (!hasAccess(interaction)) {
      return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
    }

    let url = interaction.options.getString('url').trim();
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    const websiteChannel = interaction.guild.channels.cache.find(
      c => c.name.toLowerCase().includes('website') && c.type === ChannelType.GuildText
    ) || interaction.channel;

    const guildKey = interaction.guild.id;

    const displayUrl = url.replace(/^https?:\/\//, '');
    const websiteEmbed = new EmbedBuilder()
      .setDescription('### [' + displayUrl + '](' + url + ')')
      .setColor(0x5865F2)
      .setTimestamp();

    try {
      const existing = websiteMessages[guildKey];
      if (existing) {
        try {
          const ch  = await client.channels.fetch(existing.channelId);
          const msg = await ch.messages.fetch(existing.messageId);
          await msg.edit({ content: '', embeds: [websiteEmbed] });
          await interaction.reply({
            content: `✅ Website updated to **${url}** in <#${existing.channelId}>`,
            flags: 64,
          });
          autoDelete(interaction, 5_000);
          return;
        } catch (_) { /* old message gone, post fresh */ }
      }

      const msg = await websiteChannel.send({ content: '', embeds: [websiteEmbed] });
      websiteMessages[guildKey] = { channelId: websiteChannel.id, messageId: msg.id };

      await interaction.reply({
        content: `📌 Website posted in <#${websiteChannel.id}>`,
        flags: 64,
      });
      autoDelete(interaction, 5_000);

    } catch (err) {
      await interaction.reply({ content: `❌ Failed: ${err.message}`, flags: 64 });
      autoDelete(interaction, 8_000);
    }
    return;
  }

  // ── /postimage → post an image directly to a channel ─────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'postimage') {
    if (!hasAccess(interaction)) {
      return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
    }

    const attachment = interaction.options.getAttachment('image');
    const message    = interaction.options.getString('message') || null;
    const chanName   = interaction.options.getString('channel') || null;

    let targetChannel = interaction.channel;
    if (chanName) {
      const found = interaction.guild.channels.cache.find(
        c => c.name.toLowerCase() === chanName.toLowerCase().replace('#', '') &&
             c.type === ChannelType.GuildText
      );
      if (found) targetChannel = found;
    }

    try {
      await targetChannel.send({
        content: message || null,
        files: [attachment.url],
      });
      await interaction.reply({
        content: `✅ Image posted to <#${targetChannel.id}>`,
        flags: 64,
      });
      autoDelete(interaction, 5_000);
    } catch (err) {
      await interaction.reply({ content: `❌ Failed: ${err.message}`, flags: 64 });
      autoDelete(interaction, 8_000);
    }
    return;
  }

  // ── /setupreseller → post reseller panel to #reseller-program ────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setupreseller') {
    if (!hasAccess(interaction)) {
      return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    const resellerChannel = interaction.guild.channels.cache.find(
      c => c.name.toLowerCase().includes('reseller') && c.type === ChannelType.GuildText
    ) || interaction.channel;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setDescription(
        '# UH SERVICES IS LOOKING FOR RESELLERS\n' +
        '\n' +
        '**Did you know you can make up to $5000+ monthly reselling our products? Get started selling today !!**\n' +
        '\n' +
        '## Why Start Reselling?\n' +
        '- All keys are bought through our **centralized panel**, where you can **generate, manage, reset, and freeze keys**\n' +
        '- We provide **10+** of the **markets leading products**\n' +
        '- We offer all of our resellers a **minimum discount of 50% off keys** right away\n' +
        '- We take care of the hard part. **Development, testing, updates, and more are all handled by us** so you can focus on what\'s important\n' +
        '- We offer **priority support** in your personal ticket\n' +
        '- We provide **tips on how to grow and expand** your brand\n' +
        '- We offer **dynamic delivery** so you can link your site to our panel for seamless product delivery, no stocking needed\n' +
        '- **Pressure free environment**, we don\'t force you to deposit and you can scale at your own pace\n' +
        '- Access to a community of over **100+ successful resellers** to connect, network and grow with'
      );

    const applyButton = new ButtonBuilder()
      .setLabel('APPLY HERE!')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Link)
      .setURL(resellerLinks.apply);

    const panelButton = new ButtonBuilder()
      .setLabel('Preview Panel')
      .setEmoji('👀')
      .setStyle(ButtonStyle.Link)
      .setURL(resellerLinks.panel);

    const row = new ActionRowBuilder().addComponents(applyButton, panelButton);

    const guildKey = interaction.guild.id;
    const existing = resellerMessages[guildKey];
    if (existing) {
      try {
        const ch  = await client.channels.fetch(existing.channelId);
        const msg = await ch.messages.fetch(existing.messageId);
        await msg.edit({ embeds: [embed], components: [row] });
        await interaction.editReply({ content: `✅ Reseller panel updated in <#${existing.channelId}>` });
        autoDelete(interaction, 5_000);
        return;
      } catch (_) {}
    }

    const msg = await resellerChannel.send({ embeds: [embed], components: [row] });
    resellerMessages[guildKey] = { channelId: resellerChannel.id, messageId: msg.id };
    await interaction.editReply({ content: `✅ Reseller panel posted in <#${resellerChannel.id}>` });
    autoDelete(interaction, 5_000);
    return;
  }

  // ── /setresellerlinks → update apply/panel button URLs via modal ──────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'setresellerlinks') {
    if (!hasAccess(interaction)) {
      return interaction.reply({ content: '❌ You do not have permission.', flags: 64 });
    }

    const modal = new ModalBuilder()
      .setCustomId('reseller_links_modal')
      .setTitle('Update Reseller Button Links');

    const applyInput = new TextInputBuilder()
      .setCustomId('reseller_apply_url')
      .setLabel('APPLY HERE! — Button URL')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('https://discord.gg/...')
      .setValue(resellerLinks.apply)
      .setRequired(true);

    const panelInput = new TextInputBuilder()
      .setCustomId('reseller_panel_url')
      .setLabel('Preview Panel — Button URL')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('https://...')
      .setValue(resellerLinks.panel)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(applyInput),
      new ActionRowBuilder().addComponents(panelInput),
    );

    await interaction.showModal(modal);
    return;
  }

  // ── reseller_links_modal submit ───────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'reseller_links_modal') {
    let applyUrl = interaction.fields.getTextInputValue('reseller_apply_url').trim();
    let panelUrl = interaction.fields.getTextInputValue('reseller_panel_url').trim();

    if (applyUrl && !applyUrl.startsWith('http')) applyUrl = 'https://' + applyUrl;
    if (panelUrl && !panelUrl.startsWith('http')) panelUrl = 'https://' + panelUrl;

    resellerLinks.apply = applyUrl;
    resellerLinks.panel = panelUrl;

    // Update the live panel buttons if it exists
    const guildKey = interaction.guild.id;
    const existing = resellerMessages[guildKey];
    if (existing) {
      try {
        const ch  = await client.channels.fetch(existing.channelId);
        const msg = await ch.messages.fetch(existing.messageId);
        const applyButton = new ButtonBuilder()
          .setLabel('APPLY HERE!')
          .setEmoji('📋')
          .setStyle(ButtonStyle.Link)
          .setURL(resellerLinks.apply);
        const panelButton = new ButtonBuilder()
          .setLabel('Preview Panel')
          .setEmoji('👀')
          .setStyle(ButtonStyle.Link)
          .setURL(resellerLinks.panel);
        await msg.edit({ components: [new ActionRowBuilder().addComponents(applyButton, panelButton)] });
      } catch (_) {}
    }

    await interaction.reply({
      content: `✅ Links updated!\n**Apply:** ${applyUrl}\n**Panel:** ${panelUrl}`,
      flags: 64,
    });
    autoDelete(interaction, 8_000);
    return;
  }

  } catch (err) {
    console.error('Interaction error:', err);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: '❌ An error occurred.', flags: 64 });
      } else {
        await interaction.reply({ content: '❌ An error occurred.', flags: 64 });
      }
    } catch (_) {}
  }
});

client.login(process.env.BOT_TOKEN);

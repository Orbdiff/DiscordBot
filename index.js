require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const axios = require('axios');
const express = require('express');

const {
  DISCORD_TOKEN,
  GITHUB_TOKEN,
  REPO_OWNER,
  REPO_NAME,
  BRANCH,
  GUILD_ID,
  PORT = 3000
} = process.env;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

// === Slash Command ===
const commands = [
  new SlashCommandBuilder()
    .setName('setup-pincode-panel')
    .setDescription('Send the PIN generation panel.')
];

// === GitHub Functions ===

const githubHeaders = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github.v3+json'
};

async function getPinFiles() {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;
  const { data } = await axios.get(url, { headers: githubHeaders });

  return data
    .filter(file => /^pin\d*\.txt$/.test(file.name))
    .map(file => {
      const match = file.name.match(/^pin(\d*)\.txt$/);
      const number = match[1] ? parseInt(match[1]) : 0;
      return { number, name: file.name, sha: file.sha };
    });
}

async function deleteFile(name, sha) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${name}`;
  await axios.delete(url, {
    headers: githubHeaders,
    data: {
      message: `Deleting ${name} to create a new one`,
      sha,
      branch: BRANCH
    }
  });
}

async function deleteAllPins() {
  try {
    const files = await getPinFiles();
    for (const file of files) {
      await deleteFile(file.name, file.sha);
      console.log(`🗑️ Deleted: ${file.name}`);
    }
    console.log('✅ All PIN files have been deleted.');
  } catch (error) {
    console.error('❌ Error deleting PINs:', error?.response?.data || error.message);
  }
}

async function createPinFile(pin, fileName) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${fileName}`;
  const content = Buffer.from(pin).toString('base64');

  await axios.put(url, {
    message: `Creating ${fileName} with PIN ${pin}`,
    content,
    branch: BRANCH
  }, { headers: githubHeaders });
}

async function generatePin() {
  const files = await getPinFiles();
  let nextNumber = 0;

  if (files.length > 0) {
    const last = files.reduce((a, b) => a.number > b.number ? a : b);
    await deleteFile(last.name, last.sha);
    nextNumber = last.number + 1;
  }

  const fileName = `pin${nextNumber || ''}.txt`;
  const pin = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join('');

  await createPinFile(pin, fileName);
  return { pin, fileName };
}

// === Bot Events ===

client.once('ready', async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands.map(cmd => cmd.toJSON()) }
    );
    console.log(`✅ Logged in as ${client.user.tag}`);
  } catch (error) {
    console.error('❌ Error registering commands:', error);
  }
});

client.on('interactionCreate', async interaction => {
  // Slash command to send the panel
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-pincode-panel') {
    const button = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('generate_pin')
        .setLabel('🎟️ Generate PIN')
        .setStyle(ButtonStyle.Success)
    );

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🔐 PIN Code Generator')
      .setDescription('Click the button below to securely generate a temporary PIN.')
      .setFooter({ text: 'Private use only • AstralMC' });

    await interaction.reply({
      embeds: [embed],
      components: [button],
    });
    return;
  }

  // Button interaction
  if (interaction.isButton() && interaction.customId === 'generate_pin') {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const { pin } = await generatePin();

      const embed = new EmbedBuilder()
        .setColor('#43B581')
        .setTitle('✅ Your PIN')
        .setDescription(`\`\`\`${pin}\`\`\``)
        .setFooter({ text: 'This PIN is valid for a short period.' });

      await interaction.editReply({ embeds: [embed] });

      // Cleanup after 2 minutes (not mentioned to user)
      setTimeout(async () => {
        console.log('⏳ Cleaning up PIN files...');
        await deleteAllPins();
      }, 2 * 60 * 1000);

    } catch (error) {
      console.error('❌ Error generating PIN:', error?.response?.data || error.message);
    }
  }
});

// === Express Keep-Alive ===

express()
  .get('/', (_, res) => res.send('✅ Discord bot is running'))
  .listen(PORT, () => console.log(`🌐 Listening on port ${PORT}`));

// === Login ===
client.login(DISCORD_TOKEN);

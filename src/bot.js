const { Client, GatewayIntentBits, SlashCommandBuilder } = require('discord.js');
const db = require('./database');
const { syncUserLibraries } = require('./sync');

class DiscordBot {
  constructor(token, clientId) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages
      ]
    });
    this.token = token;
    this.clientId = clientId;
    this.commands = [];
  }

  async registerCommands() {
    this.commands = [
      new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link your Plex account to your Discord account')
        .addStringOption(option =>
          option.setName('plex_username')
            .setDescription('Your Plex username')
            .setRequired(true)),
      new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check your current library access'),
      new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Request a Plex account invitation')
        .addStringOption(option =>
          option.setName('email')
            .setDescription('Your email address')
            .setRequired(true))
    ];

    await this.client.application.commands.set(this.commands);
    console.log('Commands registered');
  }

  async login() {
    this.start();
    await this.client.login(this.token);
    await this.registerCommands();
  }

  async start() {
    this.client.on('ready', () => {
      console.log(`Logged in as ${this.client.user.tag}`);
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      switch (interaction.commandName) {
        case 'link':
          await this.handleLink(interaction);
          break;
        case 'status':
          await this.handleStatus(interaction);
          break;
        case 'invite':
          await this.handleInvite(interaction);
          break;
      }
    });

    this.client.on('guildMemberUpdate', async (oldMember, newMember) => {
      const oldRoles = oldMember.roles.cache.map(r => r.id);
      const newRoles = newMember.roles.cache.map(r => r.id);
      
      // Check if roles changed (added or removed)
      if (oldRoles.length !== newRoles.length ||
          oldRoles.some(role => !newRoles.includes(role))) {
        // Update the user's role IDs in the database
        db.prepare('UPDATE users SET discord_role_ids = ? WHERE discord_id = ?').run(
          JSON.stringify(newRoles),
          newMember.id
        );
        await this.handleRoleChange(newMember);
      }
    });
  }

  async handleLink(interaction) {
    const plexUsername = interaction.options.getString('plex_username');
    
    const roleIds = interaction.member.roles.cache.map(r => r.id);
    
    db.prepare(`
      INSERT OR REPLACE INTO users (discord_id, discord_username, plex_username, discord_role_ids)
      VALUES (?, ?, ?, ?)
    `).run(interaction.user.id, interaction.user.username, plexUsername, JSON.stringify(roleIds));

    await interaction.reply(`Linked Plex account ${plexUsername} to your Discord account`);
    await syncUserLibraries(interaction.user.id);
  }

  async handleStatus(interaction) {
    const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(interaction.user.id);
    
    if (!user || !user.plex_username) {
      await interaction.reply('You haven\'t linked a Plex account yet. Use /link');
      return;
    }

    const roles = interaction.member.roles.cache
      .filter(r => r.name !== '@everyone')
      .map(r => r.name);

    await interaction.reply(`Your Plex account: ${user.plex_username}\nYour roles: ${roles.join(', ') || 'None'}`);
  }

  async handleInvite(interaction) {
    const email = interaction.options.getString('email');
    
    db.prepare(`
      INSERT OR REPLACE INTO users (discord_id, discord_username, email)
      VALUES (?, ?, ?)
    `).run(interaction.user.id, interaction.user.username, email);

    await interaction.reply(`Invitation request sent to ${email}`);
  }

  async handleRoleChange(member) {
    await syncUserLibraries(member.id);
  }
}

module.exports = DiscordBot;

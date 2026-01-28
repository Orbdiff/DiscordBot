require("dotenv").config();
const express = require("express");
const app = express();
const { 
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField,
    ChannelType,
    StringSelectMenuBuilder
} = require("discord.js");

const TOKEN = process.env.TOKEN;
const PREFIX = process.env.PREFIX || "!";
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const MEDIUM_ROLE_ID = process.env.MEDIUM_ROLE_ID;
const ADVANCED_ROLE_ID = process.env.ADVANCED_ROLE_ID;
const COOLDOWN_ROLE_ID = process.env.COOLDOWN_ROLE_ID;
const DEFAULT_COOLDOWN_TIME = 3 * 24 * 60 * 60 * 1000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

function parseCooldown(arg) {
    if (!arg) return DEFAULT_COOLDOWN_TIME;
    const match = arg.match(/^(\d+)([dhm])$/i);
    if (!match) return DEFAULT_COOLDOWN_TIME;
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === 'd') return value * 24 * 60 * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    if (unit === 'm') return value * 60 * 1000;
    return DEFAULT_COOLDOWN_TIME;
}

async function closeTicket({ channel, user, member, guild, interaction, cooldownTime = DEFAULT_COOLDOWN_TIME }) {
    const ticketOwnerId = channel.permissionOverwrites.cache.find(po => po.allow.has(PermissionsBitField.Flags.ViewChannel))?.id;
    const ticketOwner = guild.members.cache.get(ticketOwnerId);

    if (ticketOwner) {
        await ticketOwner.roles.add(COOLDOWN_ROLE_ID).catch(() => {});
        setTimeout(() => ticketOwner.roles.remove(COOLDOWN_ROLE_ID).catch(() => {}), cooldownTime);

        const durationText = cooldownTime >= 86400000
            ? `${cooldownTime / (24*60*60*1000)} día(s)`
            : cooldownTime >= 3600000
            ? `${cooldownTime / (60*60*1000)} hora(s)`
            : `${cooldownTime / (60*1000)} minuto(s)`;

        await channel.send(`✅ **Se ha asignado el rol de cooldown a <@${ticketOwner.id}> por ${durationText}.**`);
    }

    if (interaction) {
        await interaction.update({ content: "⏳ **Cerrando el ticket, por favor espera...**", components: [] });
    } else {
        await channel.send("⏳ **Cerrando el ticket, por favor espera...**");
    }

    setTimeout(() => channel.delete().catch(() => {}), 3000);
}

client.on("messageCreate", async (msg) => {
    if (!msg.guild || !msg.content.startsWith(PREFIX)) return;

    const args = msg.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === "setup") {
        const embed = new EmbedBuilder()
            .setTitle("Sistema de Tickets")
            .setDescription(
                "📌 **Recordatorio**\n\n" +
                "🎟️ Para crear un ticket, utiliza el **menú desplegable** de abajo.\n" +
                "📖 Antes de continuar, asegúrate de leer <#1448184456446869616>.\n\n" +
                "🔐 **Requisitos por nivel**\n" +
                `• Para acceder a niveles superiores necesitas el rango correspondiente:\n ▫️ <@&${MEDIUM_ROLE_ID}>\n ▫️ <@&${ADVANCED_ROLE_ID}>\n\n` +
                "⏳ **Cooldown**\n• Solo puedes abrir **1 ticket a la vez**.\n• Al cerrar el ticket, el **cooldown se aplica automáticamente**."
            )
            .setColor("#6e00ff");

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("ticket_select")
            .setPlaceholder("🎫 Selecciona el tipo de ticket...")
            .addOptions(
                { label: "🟢 SSTest Basic", description: "Una SSTest basica!", value: "basic" },
                { label: "🟡 SSTest Medium", description: "SSTest Medium (requiere Basic)", value: "medium" },
                { label: "🔴 SSTest Advanced", description: "SSTest Advanced (requiere Medium)", value: "advanced" }
            );

        await msg.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(selectMenu)] });
    }

    else if (command === "close") {
        if (msg.channel.parentId !== TICKET_CATEGORY_ID)
            return msg.reply("❌ **Este comando solo puede usarse dentro de un canal de ticket.**");

        if (!msg.member.roles.cache.has(STAFF_ROLE_ID))
            return msg.reply("🔒 **Solo el staff autorizado puede cerrar tickets.**");

        const cooldownTime = parseCooldown(args[0]);
        await closeTicket({ channel: msg.channel, user: msg.author, member: msg.member, guild: msg.guild, cooldownTime });
    }
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    const guild = interaction.guild;
    const member = interaction.member;
    const user = interaction.user;

    if (interaction.isButton() && interaction.customId === "close_ticket") {
        if (!member.roles.cache.has(STAFF_ROLE_ID)) {
            return interaction.reply({ content: "🔒 **Solo el staff autorizado puede cerrar tickets.**", ephemeral: true });
        }
        await closeTicket({ channel: interaction.channel, user, member, guild });
        return;
    }

    if (!interaction.isStringSelectMenu() || interaction.customId !== "ticket_select") return;

    if (member.roles.cache.has(COOLDOWN_ROLE_ID)) {
        return interaction.reply({ content: `⏳ No puedes abrir un ticket porque tienes el rol de cooldown activo.`, ephemeral: true });
    }

    const ticketType = interaction.values[0];

    const staffRole = guild.roles.resolve(STAFF_ROLE_ID);
    const mediumRole = guild.roles.resolve(MEDIUM_ROLE_ID);
    const advancedRole = guild.roles.resolve(ADVANCED_ROLE_ID);

    if (!staffRole) return interaction.reply({ content: "❌ Rol de STAFF no encontrado.", ephemeral: true });

    let canOpen = false;
    let reason = "";

    if (ticketType === "basic") {
        if ((mediumRole && member.roles.cache.has(mediumRole.id)) ||
            (advancedRole && member.roles.cache.has(advancedRole.id))) {
            reason = `🔒 **Acceso restringido**\nTienes un rol superior, no puedes abrir un ticket BASIC.`;
        } else canOpen = true;
    } else if (ticketType === "medium") {
        if (!mediumRole || !member.roles.cache.has(mediumRole.id)) reason = `🔒 Necesitas <@&${MEDIUM_ROLE_ID}> para abrir MEDIUM.`;
        else if (advancedRole && member.roles.cache.has(advancedRole.id)) reason = `🔒 No puedes abrir MEDIUM si ya tienes ADVANCED.`;
        else canOpen = true;
    } else if (ticketType === "advanced") {
        if (!advancedRole || !member.roles.cache.has(advancedRole.id)) reason = `🔒 Necesitas <@&${ADVANCED_ROLE_ID}> para abrir ADVANCED.`;
        else canOpen = true;
    }

    if (!canOpen) return interaction.reply({ content: reason, ephemeral: true });

    const existing = guild.channels.cache.find(c =>
        c.parentId === TICKET_CATEGORY_ID &&
        c.permissionOverwrites.cache.has(user.id)
    );
    if (existing) return interaction.reply({ content: `❌ No puedes abrir otro ticket. Ticket actual: ${existing}`, ephemeral: true });

    const channelName = `${user.username.toLowerCase()}-${ticketType}`;
    const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
    });

    const embed = new EmbedBuilder()
        .setTitle(`🎫 Ticket ${ticketType.toUpperCase()}`)
        .setDescription(`👋 Hola <@${user.id}>\n✅ Tu ticket **${ticketType.toUpperCase()}** ha sido creado.\n👨‍💼 Un miembro del staff te atenderá.\n⏳ Cooldown se aplicará al cerrar el ticket.`);

    const closeBtn = new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Cerrar Ticket")
        .setStyle(ButtonStyle.Danger);

    await channel.send({
        content: `<@${user.id}> <@&1448178130710954096>`,
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(closeBtn)]
    });

    await interaction.reply({ content: `🎟️ Ticket ${ticketType.toUpperCase()} creado.`, ephemeral: true });
});


client.login(TOKEN);
app.get("/", (req, res) => res.send("Bot de Tickets activo"));
app.listen(process.env.PORT || 3000, () => console.log("Servidor Express en puerto 3000"));

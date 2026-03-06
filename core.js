require("dotenv").config();
const express = require("express");
const app = express();
const {
    Client, GatewayIntentBits, Partials, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionsBitField, ChannelType, StringSelectMenuBuilder
} = require("discord.js");

const TOKEN = process.env.TOKEN;
const PREFIX = process.env.PREFIX || "!";
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;
const MEDIUM_ROLE_ID = process.env.MEDIUM_ROLE_ID;
const ADVANCED_ROLE_ID = process.env.ADVANCED_ROLE_ID;
const COOLDOWN_ROLE_ID = process.env.COOLDOWN_ROLE_ID;
const DEFAULT_COOLDOWN_TIME = 3 * 24 * 60 * 60 * 1000;

const cooldownData = new Map();
const cooldownTimeouts = new Map();

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
    const match = arg?.match(/^(\d+)([dhm])$/i);
    if (!match) return DEFAULT_COOLDOWN_TIME;
    const v = parseInt(match[1]);
    const u = match[2].toLowerCase();
    return u === 'd' ? v * 86400000 : u === 'h' ? v * 3600000 : v * 60000;
}

function formatTimeLeft(ms) {
    if (ms <= 0) return "0 segundos";
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return [d && `${d}d`, h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(" ") || "menos de 1 segundo";
}

function formatDate(ts) {
    return new Date(ts).toLocaleString("es-ES", {
        weekday: "long", year: "numeric", month: "long",
        day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
}

function getWeekRange() {
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { monday, sunday };
}

function resolveMember(guild, arg) {
    if (!arg) return null;
    const id = arg.match(/^<@!?(\d+)>$/)?.[1] ?? arg;
    return guild.members.cache.get(id) ?? null;
}

function scheduleCooldown(member, cooldownTime) {
    if (cooldownTimeouts.has(member.id)) clearTimeout(cooldownTimeouts.get(member.id));
    const assignedAt = Date.now();
    const expiresAt = assignedAt + cooldownTime;
    cooldownData.set(member.id, { expiresAt, assignedAt });
    cooldownTimeouts.set(member.id, setTimeout(() => {
        member.roles.remove(COOLDOWN_ROLE_ID).catch(() => {});
        cooldownData.delete(member.id);
        cooldownTimeouts.delete(member.id);
    }, cooldownTime));
}

async function closeTicket({ channel, user, member, guild, interaction, cooldownTime = DEFAULT_COOLDOWN_TIME }) {
    const ownerId = channel.permissionOverwrites.cache
        .find(po => po.allow.has(PermissionsBitField.Flags.ViewChannel))?.id;
    const owner = ownerId ? guild.members.cache.get(ownerId) : null;

    if (owner) {
        await owner.roles.add(COOLDOWN_ROLE_ID).catch(() => {});
        scheduleCooldown(owner, cooldownTime);
        const durationText = cooldownTime >= 86400000
            ? `${cooldownTime / 86400000} día(s)`
            : cooldownTime >= 3600000
            ? `${cooldownTime / 3600000} hora(s)`
            : `${cooldownTime / 60000} minuto(s)`;
        await channel.send(`✅ **Se ha asignado el rol de cooldown a <@${owner.id}> por ${durationText}.**`);
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
    const { guild } = msg;

    if (command === "setup") {
        const embed = new EmbedBuilder()
            .setTitle("Sistema de Tickets")
            .setDescription(
                "📌 **Recordatorio**\n\n" +
                "🎟️ Para crear un ticket, utiliza el **menú desplegable** de abajo.\n" +
                "📖 Antes de continuar, asegúrate de leer <#1448184456446869616>.\n\n" +
                "🔐 **Requisitos por nivel**\n" +
                `• Para acceder a niveles superiores necesitas el rango correspondiente:\n ▫️ <@&${MEDIUM_ROLE_ID}>\n ▫️ <@&${ADVANCED_ROLE_ID}>\n\n` +
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

    } else if (command === "close") {
        if (msg.channel.parentId !== TICKET_CATEGORY_ID)
            return msg.reply("❌ **Este comando solo puede usarse dentro de un canal de ticket.**");
        if (!msg.member.roles.cache.has(STAFF_ROLE_ID))
            return msg.reply("🔒 **Solo el staff autorizado puede cerrar tickets.**");
        await closeTicket({ channel: msg.channel, user: msg.author, member: msg.member, guild, cooldownTime: parseCooldown(args[0]) });

    } else if (command === "cooldown") {
        if (!msg.member.roles.cache.has(STAFF_ROLE_ID))
            return msg.reply("🔒 **Solo el staff autorizado puede usar este comando.**");
        if (!args[0])
            return msg.reply("❌ **Uso correcto:** `!cooldown @usuario` o `!cooldown <ID>`");

        const target = resolveMember(guild, args[0]);
        if (!target)
            return msg.reply("❌ **No se encontró ese usuario en el servidor.**");

        if (!target.roles.cache.has(COOLDOWN_ROLE_ID)) {
            return msg.channel.send({ embeds: [
                new EmbedBuilder()
                    .setTitle("⏳ Estado de Cooldown")
                    .setColor("#00cc66")
                    .setDescription(`✅ **${target.user.username}** no tiene cooldown activo.`)
                    .setThumbnail(target.user.displayAvatarURL())
            ]});
        }

        const data = cooldownData.get(target.id);
        const description = data
            ? `🔴 **${target.user.username}** tiene cooldown activo.\n\n📅 **Asignado el:** ${formatDate(data.assignedAt)}\n⏱️ **Tiempo restante:** \`${formatTimeLeft(data.expiresAt - Date.now())}\``
            : `🔴 **${target.user.username}** tiene cooldown activo.\n\n📅 **Asignado el:** desconocido (asignado manualmente)\n⏱️ **Tiempo restante:** desconocido`;

        await msg.channel.send({ embeds: [
            new EmbedBuilder()
                .setTitle("⏳ Estado de Cooldown")
                .setColor("#ff4444")
                .setDescription(description)
                .setThumbnail(target.user.displayAvatarURL())
                .setTimestamp()
        ]});

    } else if (command === "removecooldown") {
        if (!msg.member.roles.cache.has(STAFF_ROLE_ID))
            return msg.reply("🔒 **Solo el staff autorizado puede usar este comando.**");
        if (!args[0])
            return msg.reply("❌ **Uso correcto:** `!removecooldown @usuario` o `!removecooldown <ID>`");

        const target = resolveMember(guild, args[0]);
        if (!target)
            return msg.reply("❌ **No se encontró ese usuario en el servidor.**");
        if (!target.roles.cache.has(COOLDOWN_ROLE_ID))
            return msg.reply(`ℹ️ **${target.user.username}** no tiene el rol de cooldown activo.`);

        if (cooldownTimeouts.has(target.id)) {
            clearTimeout(cooldownTimeouts.get(target.id));
            cooldownTimeouts.delete(target.id);
        }
        cooldownData.delete(target.id);
        await target.roles.remove(COOLDOWN_ROLE_ID).catch(() => {});

        await msg.channel.send({ embeds: [
            new EmbedBuilder()
                .setTitle("✅ Cooldown Removido")
                .setColor("#00cc66")
                .setDescription(`✅ Se ha removido el cooldown de **${target.user.username}** correctamente.`)
                .setThumbnail(target.user.displayAvatarURL())
                .setFooter({ text: `Removido por ${msg.author.username}` })
                .setTimestamp()
        ]});

    } else if (command === "testlist") {
        if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator))
            return msg.reply("🔒 **Solo administradores pueden usar este comando.**");

        const { monday, sunday } = getWeekRange();

        const targetChannel = guild.channels.cache.find(c =>
            c.type === ChannelType.GuildText &&
            c.name === "test-results" &&
            c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.ReadMessageHistory)
        );
        if (!targetChannel)
            return msg.reply("❌ **No se encontró el canal `test-results` o el bot no tiene acceso a él.**");

        const statusMsg = await msg.channel.send(
            `🔍 **Buscando tests en #test-results del ${monday.toLocaleDateString("es-ES")} al ${sunday.toLocaleDateString("es-ES")}...**`
        );

        const tagMap = new Map();
        let lastId = null;
        let stop = false;

        while (!stop) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;
            let messages;
            try { messages = await targetChannel.messages.fetch(options); } catch { break; }
            if (!messages.size) break;

            for (const [, m] of messages) {
                if (m.createdAt < monday) { stop = true; break; }
                if (m.createdAt <= sunday && /\[»\]\s*Tag:/i.test(m.content)) {
                    tagMap.set(m.author.id, { count: (tagMap.get(m.author.id)?.count ?? 0) + 1 });
                }
            }
            lastId = messages.last()?.id;
            if (messages.size < 100) break;
        }

        await guild.members.fetch();
        const staffMembers = guild.members.cache.filter(m => m.roles.cache.has(STAFF_ROLE_ID) && !m.user.bot);
        const missingStaff = [...staffMembers.values()].filter(m => !tagMap.has(m.id));

        await statusMsg.delete().catch(() => {});

        if (!tagMap.size) {
            await msg.channel.send("❌ **No se encontraron tests esta semana en #test-results.**");
        } else {
            const entries = [...tagMap.entries()].sort((a, b) => b[1].count - a[1].count);
            for (let i = 0; i < entries.length; i += 25) {
                const chunk = entries.slice(i, i + 25);
                await msg.channel.send({ embeds: [
                    new EmbedBuilder()
                        .setTitle("📋 Lista de Tests del Staff — Semana actual")
                        .setColor("#6e00ff")
                        .setDescription(chunk.map(([id, d], idx) => `**${i + idx + 1}.** <@${id}> → **${d.count}** test(s)`).join("\n"))
                        .setFooter({ text: `Semana: ${monday.toLocaleDateString("es-ES")} — ${sunday.toLocaleDateString("es-ES")} • ${tagMap.size} miembro(s)` })
                        .setTimestamp()
                ]});
            }
        }

        if (missingStaff.length) {
            for (let i = 0; i < missingStaff.length; i += 25) {
                const chunk = missingStaff.slice(i, i + 25);
                await msg.channel.send({ embeds: [
                    new EmbedBuilder()
                        .setTitle("⚠️ Staff sin tests esta semana")
                        .setColor("#ff9900")
                        .setDescription(chunk.map(m => `• <@${m.id}>`).join("\n"))
                        .setFooter({ text: `${missingStaff.length} miembro(s) sin tests` })
                        .setTimestamp()
                ]});
            }
        }
    }
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

    const { guild, member, user } = interaction;

    if (interaction.isButton() && interaction.customId === "close_ticket") {
        if (!member.roles.cache.has(STAFF_ROLE_ID))
            return interaction.reply({ content: "🔒 **Solo el staff autorizado puede cerrar tickets.**", ephemeral: true });
        await closeTicket({ channel: interaction.channel, user, member, guild });
        return;
    }

    if (!interaction.isStringSelectMenu() || interaction.customId !== "ticket_select") return;

    if (member.roles.cache.has(COOLDOWN_ROLE_ID))
        return interaction.reply({ content: "⏳ No puedes abrir un ticket porque tienes el rol de cooldown activo.", ephemeral: true });

    const ticketType = interaction.values[0];
    const staffRole = guild.roles.resolve(STAFF_ROLE_ID);
    const mediumRole = guild.roles.resolve(MEDIUM_ROLE_ID);
    const advancedRole = guild.roles.resolve(ADVANCED_ROLE_ID);

    if (!staffRole)
        return interaction.reply({ content: "❌ Rol de STAFF no encontrado.", ephemeral: true });

    let reason = "";
    if (ticketType === "basic") {
        if ((mediumRole && member.roles.cache.has(mediumRole.id)) || (advancedRole && member.roles.cache.has(advancedRole.id)))
            reason = `🔒 **Acceso restringido**\nTienes un rol superior, no puedes abrir un ticket BASIC.`;
    } else if (ticketType === "medium") {
        if (!mediumRole || !member.roles.cache.has(mediumRole.id)) reason = `🔒 Necesitas <@&${MEDIUM_ROLE_ID}> para abrir MEDIUM.`;
        else if (advancedRole && member.roles.cache.has(advancedRole.id)) reason = `🔒 No puedes abrir MEDIUM si ya tienes ADVANCED.`;
    } else if (ticketType === "advanced") {
        if (!advancedRole || !member.roles.cache.has(advancedRole.id)) reason = `🔒 Necesitas <@&${ADVANCED_ROLE_ID}> para abrir ADVANCED.`;
    }

    if (reason) return interaction.reply({ content: reason, ephemeral: true });

    const existing = guild.channels.cache.find(c =>
        c.parentId === TICKET_CATEGORY_ID && c.permissionOverwrites.cache.has(user.id)
    );
    if (existing)
        return interaction.reply({ content: `❌ No puedes abrir otro ticket. Ticket actual: ${existing}`, ephemeral: true });

    const channel = await guild.channels.create({
        name: `${user.username.toLowerCase()}-${ticketType}`,
        type: ChannelType.GuildText,
        parent: TICKET_CATEGORY_ID,
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: staffRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
    });

    await channel.send({
        content: `<@${user.id}> <@&1448178130710954096>`,
        embeds: [
            new EmbedBuilder()
                .setTitle(`🎫 Ticket ${ticketType.toUpperCase()}`)
                .setDescription(`👋 Hola <@${user.id}>\n✅ Tu ticket **${ticketType.toUpperCase()}** ha sido creado.\n👨‍💼 Un miembro del staff te atenderá.\n⏳ Cooldown se aplicará al cerrar el ticket.`)
        ],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("close_ticket").setLabel("Cerrar Ticket").setStyle(ButtonStyle.Danger)
            )
        ]
    });

    await interaction.reply({ content: `🎟️ Ticket ${ticketType.toUpperCase()} creado.`, ephemeral: true });
});

client.login(TOKEN);
app.get("/", (req, res) => res.send("Bot de Tickets activo"));
app.listen(process.env.PORT || 3000, () => console.log("Servidor Express en puerto 3000"));

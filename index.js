const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();

const {
  DISCORD_TOKEN,
  GITHUB_TOKEN,
  REPO_OWNER,
  REPO_NAME,
  BRANCH,
  GUILD_ID
} = process.env;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages] });

const command = new SlashCommandBuilder()
  .setName('pincode')
  .setDescription('Genera un nuevo PIN en el repositorio.');

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

client.once('ready', async () => {
  const APPLICATION_ID = client.user.id;

  try {
    console.log('⏳ Limpiando comandos antiguos en el guild...');
    await rest.put(
      Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID),
      { body: [] } // borra todos los comandos existentes en el guild
    );
    console.log('✅ Comandos antiguos borrados.');

    console.log('⏳ Registrando comando /pincode...');
    await rest.put(
      Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID),
      { body: [command.toJSON()] }
    );
    console.log(`✅ Bot listo como ${client.user.tag} y comando /pincode registrado correctamente.`);
  } catch (error) {
    console.error('❌ Error registrando comando:', error);
  }
});

async function obtenerArchivosPin() {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;
  const headers = { Authorization: `token ${GITHUB_TOKEN}` };

  const res = await axios.get(url, { headers });
  return res.data
    .filter(file => /^pin\d*\.txt$/.test(file.name))
    .map(file => {
      const match = file.name.match(/^pin(\d*)\.txt$/);
      const numero = match[1] ? parseInt(match[1]) : 0;
      return { numero, name: file.name, sha: file.sha };
    });
}

async function eliminarArchivo(fileName, sha) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${fileName}`;
  const headers = {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json'
  };
  const data = {
    message: `Eliminando ${fileName} para crear uno nuevo`,
    sha: sha,
    branch: BRANCH
  };
  await axios.delete(url, { headers, data });
}

async function eliminarPinEspecifico(pinFileName) {
  try {
    const archivos = await obtenerArchivosPin();
    const archivoPin = archivos.find(file => file.name === pinFileName);

    if (archivoPin) {
      await eliminarArchivo(archivoPin.name, archivoPin.sha);
      console.log(`Archivo PIN ${archivoPin.name} eliminado.`);
    }
  } catch (error) {
    console.error('❌ Error eliminando el archivo PIN específico:', error?.response?.data || error.message);
  }
}

async function crearArchivo(pin, fileName) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${fileName}`;
  const headers = {
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json'
  };
  const content = Buffer.from(pin).toString('base64');
  const data = {
    message: `Creando nuevo ${fileName} con PIN ${pin}`,
    content: content,
    branch: BRANCH
  };
  await axios.put(url, data, { headers });
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'pincode') {
    try {
      await interaction.deferReply();

      const archivos = await obtenerArchivosPin();

      let siguienteNumero = 0;
      if (archivos.length > 0) {
        const ultimoArchivo = archivos.reduce((a, b) => a.numero > b.numero ? a : b);
        await eliminarArchivo(ultimoArchivo.name, ultimoArchivo.sha);
        siguienteNumero = ultimoArchivo.numero + 1;
      }

      const nombreArchivo = `pin${siguienteNumero === 0 ? '' : siguienteNumero}.txt`;
      const nuevoPIN = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join('');

      // Crear archivo con el nuevo PIN
      await crearArchivo(nuevoPIN, nombreArchivo);

      // Enviar mensaje privado al usuario con el PIN generado
      const usuario = interaction.user;
      await usuario.send(`✨ Tu PIN generado es: **${nuevoPIN}**`);

      // Mensaje público mencionando al usuario
      await interaction.editReply({
        content: `✨ El comando fue ejecutado por ${usuario}. Te he enviado tu PIN en privado.`
      });

      // Iniciar el contador para eliminar el PIN después de 2 minutos
      let tiempoRestante = 120; // 2 minutos en segundos
      const intervalo = setInterval(async () => {
        tiempoRestante -= 1;

        // Enviar mensaje con el tiempo restante
        if (tiempoRestante <= 0) {
          clearInterval(intervalo);
          await eliminarPinEspecifico(nombreArchivo); // Eliminar el archivo PIN específico
          await usuario.send(`⏳ Tu PIN ha sido eliminado.`);
        } else {
          await usuario.send(`⏳ Tu PIN estará disponible por ${tiempoRestante} segundos más.`);
        }
      }, 1000); // Se actualiza cada segundo
    } catch (error) {
      console.error('❌ Error general en comando /pincode:', error?.response?.data || error.message);
    }
  }
});

client.login(DISCORD_TOKEN);

const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot Discord corriendo');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});

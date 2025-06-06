import discord
from discord import app_commands
import requests
import base64
import random
import string
import re
import asyncio
from dotenv import load_dotenv
import os
from keep_alive import keep_alive


# Cargar variables de entorno
load_dotenv()

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
REPO_OWNER = os.getenv("REPO_OWNER")
REPO_NAME = os.getenv("REPO_NAME")
BRANCH = os.getenv("BRANCH")

intents = discord.Intents.default()
bot = discord.Client(intents=intents)
tree = app_commands.CommandTree(bot)

# Funciones GitHub
def obtener_archivos_pin():
    url = f'https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/contents'
    headers = {'Authorization': f'token {GITHUB_TOKEN}'}
    r = requests.get(url, headers=headers)
    if r.status_code == 200:
        archivos = r.json()
        archivos_pin = []
        for archivo in archivos:
            match = re.match(r'pin(\d*)\.txt$', archivo['name'])
            if match:
                numero = match.group(1)
                numero = int(numero) if numero else 0
                archivos_pin.append((numero, archivo['name'], archivo['sha']))
        return archivos_pin
    else:
        return []

def eliminar_archivo(file_name, sha):
    url = f'https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/contents/{file_name}'
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github.v3+json'
    }
    data = {
        "message": f"Eliminando {file_name} para crear uno nuevo",
        "sha": sha,
        "branch": BRANCH
    }
    r = requests.delete(url, json=data, headers=headers)
    return r.status_code == 200

def crear_archivo(pin, file_name):
    url = f'https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/contents/{file_name}'
    headers = {
        'Authorization': f'token {GITHUB_TOKEN}',
        'Accept': 'application/vnd.github.v3+json'
    }
    content = base64.b64encode(pin.encode()).decode()
    data = {
        "message": f"Creando nuevo {file_name} con PIN {pin}",
        "content": content,
        "branch": BRANCH
    }
    r = requests.put(url, json=data, headers=headers)
    return r.status_code == 201

# Comando de Discord
@tree.command(name="pincode", description="Genera un nuevo PIN en el repositorio.")
async def pincode_command(interaction: discord.Interaction):
    await interaction.response.defer(thinking=True)

    archivos_pin = obtener_archivos_pin()

    if archivos_pin:
        archivo_max = max(archivos_pin, key=lambda x: x[0])
        eliminar_archivo(archivo_max[1], archivo_max[2])
        siguiente_numero = archivo_max[0] + 1
    else:
        siguiente_numero = 0

    nuevo_nombre = f"pin{'' if siguiente_numero == 0 else siguiente_numero}.txt"
    nuevo_pin = ''.join(random.choices(string.digits, k=6))

    creado = crear_archivo(nuevo_pin, nuevo_nombre)

    if creado:
        await interaction.followup.send(f"✅ Nuevo PIN generado: **{nuevo_pin}**\n📁 Archivo: `{nuevo_nombre}`")
    else:
        await interaction.followup.send("❌ Error creando el archivo en GitHub.")

# Evento on_ready
@bot.event
async def on_ready():
    await tree.sync()
    print(f'✅ Bot listo como {bot.user}')

keep_alive()



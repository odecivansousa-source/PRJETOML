const path = require('node:path');
const fs = require('node:fs');
const QRCode = require('qrcode');
const pino = require('pino');

let makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers;
try {
  const baileys = require('@whiskeysockets/baileys');
  makeWASocket = baileys.default;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  DisconnectReason = baileys.DisconnectReason;
  Browsers = baileys.Browsers;
} catch (e) {
  console.warn('Baileys não carregado:', e.message);
}

const ROOT = path.resolve(__dirname);
const AUTH_DIR = path.join(ROOT, '.linkpronto-whatsapp-auth');
const CONFIG_FILE = path.join(ROOT, '.linkpronto-whatsapp.json');

let sock = null;
let currentQR = null;
let qrDataUrl = null;
let connectionStatus = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
let connectedUser = null;
let cachedGroups = [];
let isConnecting = false;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { groupId: null, groupName: null };
  }
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function getStatus() {
  const config = readConfig();
  return {
    ok: true,
    status: connectionStatus,
    qrCode: qrDataUrl,
    user: connectedUser || (sock?.user ? { id: sock.user.id, name: sock.user.name || sock.user.id.split(':')[0] } : null),
    selectedGroup: config.groupId,
    selectedGroupName: config.groupName,
    groupsCount: cachedGroups.length
  };
}

async function fetchGroups() {
  if (!sock || connectionStatus !== 'connected') return cachedGroups;
  try {
    const participating = await sock.groupFetchAllParticipating();
    cachedGroups = Object.values(participating).map(g => ({
      id: g.id,
      name: g.subject || g.id,
      participantsCount: g.participants?.length || 0
    })).sort((a, b) => a.name.localeCompare(b.name));
    return cachedGroups;
  } catch (err) {
    console.warn('Erro ao listar grupos do WhatsApp:', err.message);
    return cachedGroups;
  }
}

async function startWhatsApp(forceNew = false) {
  if (!makeWASocket) throw new Error('Módulo WhatsApp não disponível.');

  if (forceNew) {
    await disconnectWhatsApp();
  }

  // Se já está conectado, retorna
  if (sock && connectionStatus === 'connected') {
    return getStatus();
  }

  // Se já está com QR pronto e aguardando scan, retorna o QR atual
  if (sock && connectionStatus === 'qr_ready' && qrDataUrl) {
    return getStatus();
  }

  // Se já está em processo de conexão, evita chamadas concorrentes
  if (isConnecting) {
    return getStatus();
  }

  isConnecting = true;

  // Limpa socket anterior
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end();
    } catch {}
    sock = null;
  }

  connectionStatus = 'connecting';
  currentQR = null;
  qrDataUrl = null;

  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    // Tenta restaurar credenciais do Supabase se o diretório local estiver vazio
    try {
      const credsPath = path.join(AUTH_DIR, 'creds.json');
      if (!fs.existsSync(credsPath)) {
        const db = require('./supabase');
        const remoteCreds = await db.loadAuthCredential('creds.json');
        if (remoteCreds) {
          fs.writeFileSync(credsPath, typeof remoteCreds === 'string' ? remoteCreds : JSON.stringify(remoteCreds), 'utf8');
          console.log('[WhatsApp] Sessão recuperada da nuvem Supabase!');
        }
      }
    } catch (e) {
      // Ignora falha de restauração
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: Browsers ? Browsers.windows('Desktop') : ['Mossoró Ofertas', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 25000,
    });

    sock.ev.on('creds.update', async () => {
      saveCreds();
      try {
        const credsPath = path.join(AUTH_DIR, 'creds.json');
        if (fs.existsSync(credsPath)) {
          const db = require('./supabase');
          const data = fs.readFileSync(credsPath, 'utf8');
          db.saveAuthCredential('creds.json', data);
        }
      } catch (e) {}
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQR = qr;
        try {
          qrDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
          connectionStatus = 'qr_ready';
          console.log('[WhatsApp] Novo QR Code gerado.');
        } catch (e) {
          console.error('[WhatsApp] Erro ao gerar imagem QR:', e);
        }
      }

      if (connection === 'open') {
        connectionStatus = 'connected';
        isConnecting = false;
        currentQR = null;
        qrDataUrl = null;
        connectedUser = sock.user ? {
          id: sock.user.id,
          name: sock.user.name || sock.user.id.split(':')[0]
        } : null;
        console.log('[WhatsApp] CONECTADO COM SUCESSO! Usuário:', sock.user?.id || 'OK');

        // Busca grupos e tenta auto-vincular
        setTimeout(async () => {
          try {
            await fetchGroups();
            const config = readConfig();
            if (!config.groupId) {
              // Tenta vincular pelo convite do grupo Mossoró Ofertas
              try {
                await sock.groupAcceptInvite('JpXC7HRpu7N6PmPY6CT8iw');
                await fetchGroups();
              } catch {}
              const mossoro = cachedGroups.find(g => /mossor[oó]/i.test(g.name));
              if (mossoro) {
                saveConfig({ groupId: mossoro.id, groupName: mossoro.name });
                console.log('[WhatsApp] Grupo auto-configurado:', mossoro.name);
              }
            }
          } catch (e) {
            console.warn('[WhatsApp] Auto-setup grupo:', e.message);
          }
        }, 1500);
      }

      if (connection === 'close') {
        isConnecting = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason?.loggedOut;
        console.log(`[WhatsApp] Conexão fechada. Código: ${statusCode}. Reconectar? ${shouldReconnect}`);

        try { sock.ev.removeAllListeners(); } catch {}
        sock = null;

        if (statusCode === DisconnectReason?.loggedOut) {
          connectionStatus = 'disconnected';
          connectedUser = null;
          currentQR = null;
          qrDataUrl = null;
          try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
          console.log('[WhatsApp] Sessão deslogada.');
        } else {
          // Reconnect automático (inclusive para código 515 restartRequired)
          connectionStatus = 'connecting';
          setTimeout(() => {
            startWhatsApp(false).catch(e => console.warn('[WhatsApp] Erro ao reconectar:', e.message));
          }, 1500);
        }
      }
    });

    isConnecting = false;
    return getStatus();
  } catch (err) {
    isConnecting = false;
    connectionStatus = 'disconnected';
    console.error('[WhatsApp] Erro ao iniciar:', err);
    throw err;
  }
}

async function disconnectWhatsApp() {
  try {
    if (sock) {
      try { sock.ev.removeAllListeners(); } catch {}
      try { await sock.logout(); } catch {}
      try { sock.end(); } catch {}
      sock = null;
    }
    isConnecting = false;
    connectionStatus = 'disconnected';
    connectedUser = null;
    currentQR = null;
    qrDataUrl = null;
    cachedGroups = [];
    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
    saveConfig({ groupId: null, groupName: null });
    return { ok: true, message: 'WhatsApp desconectado com sucesso.' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendToWhatsAppGroup(payload) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp não está conectado. Escaneie o QR Code nas configurações primeiro.');
  }

  const config = readConfig();
  let targetGroupId = payload.groupId || config.groupId;

  // Se nenhum grupo estiver salvo, tenta achar um grupo com Mossoró
  if (!targetGroupId) {
    await fetchGroups();
    const found = cachedGroups.find(g => /mossor[oó]/i.test(g.name)) || cachedGroups[0];
    if (found) {
      targetGroupId = found.id;
      saveConfig({ groupId: found.id, groupName: found.name });
    }
  }

  if (!targetGroupId) {
    throw new Error('Nenhum grupo do WhatsApp selecionado. Escolha o grupo nas configurações.');
  }

  const cleanTarget = targetGroupId.includes('@') ? targetGroupId : `${targetGroupId}@g.us`;
  const caption = String(payload.caption || payload.text || '').trim();
  const image = payload.image;

  if (image) {
    let buffer;
    if (typeof image === 'string' && image.startsWith('data:image/')) {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      buffer = Buffer.from(base64Data, 'base64');
    } else if (Buffer.isBuffer(image)) {
      buffer = image;
    } else if (typeof image === 'string' && /^https?:\/\//i.test(image)) {
      const res = await fetch(image, {
        signal: AbortSignal.timeout(12000),
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'accept': 'image/avif,image/webp,image/png,image/jpeg,*/*'
        }
      });
      if (!res.ok) throw new Error('Não foi possível carregar a imagem para envio no WhatsApp.');
      buffer = Buffer.from(await res.arrayBuffer());
    }

    if (buffer) {
      try {
        const sharp = require('sharp');
        buffer = await sharp(buffer)
          .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
          .toBuffer();
      } catch (err) {
        console.warn('[WhatsApp] Conversão JPEG opcional ignorada:', err.message);
      }

      await sock.sendMessage(cleanTarget, {
        image: buffer,
        caption: caption,
        mimetype: 'image/jpeg'
      });
      console.log(`[WhatsApp] Foto e legenda enviadas com sucesso para ${cleanTarget}`);
      return { ok: true, message: `Foto e legenda enviadas com sucesso no grupo ${config.groupName || 'do WhatsApp'}!` };
    }
  }

  // Envio somente texto se não houver imagem
  await sock.sendMessage(cleanTarget, { text: caption });
  return { ok: true, message: `Oferta enviada no grupo ${config.groupName || 'do WhatsApp'}!` };
}

// Iniciar conexão automática ao carregar se houver credenciais salvas
if (fs.existsSync(AUTH_DIR)) {
  setTimeout(() => {
    startWhatsApp(false).catch(err => console.warn('[WhatsApp] Auto-start:', err.message));
  }, 1000);
}

module.exports = {
  getStatus,
  startWhatsApp,
  disconnectWhatsApp,
  fetchGroups,
  readConfig,
  saveConfig,
  sendToWhatsAppGroup
};

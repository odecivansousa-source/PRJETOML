const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname);
const QUEUE_FILE = path.join(ROOT, '.linkpronto-queue.json');

let whatsapp = null;
try {
  whatsapp = require('./whatsapp');
} catch (e) {
  console.warn('[Scheduler] WhatsApp não carregado:', e.message);
}

let db = null;
try {
  db = require('./supabase');
} catch (e) {
  console.warn('[Scheduler] Supabase não carregado:', e.message);
}

let queueState = {
  isRunning: false,
  intervalMinutes: 5,
  startTime: '08:00',
  endTime: '22:00',
  sendWhatsApp: true,
  sendTelegram: true,
  autoRefill: true,
  nextDispatchAt: null,
  items: [],
  history: []
};

let timer = null;

// Retorna a hora e minuto atuais no fuso horário oficial do Brasil (Brasília / UTC-3)
function getBrazilTime() {
  const now = new Date();
  const brazilString = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
  const brazilDate = new Date(brazilString);
  const hours = brazilDate.getHours();
  const minutes = brazilDate.getMinutes();
  const pad = n => String(n).padStart(2, '0');
  return {
    hours,
    minutes,
    timeString: `${pad(hours)}:${pad(minutes)}`,
    date: brazilDate
  };
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

// Verifica se o momento atual está dentro da janela permitida de disparos
function checkOperatingHours() {
  const { hours, minutes, timeString } = getBrazilTime();
  const currentTotal = hours * 60 + minutes;

  const startTotal = parseTimeToMinutes(queueState.startTime) ?? (8 * 60);
  const endTotal = parseTimeToMinutes(queueState.endTime) ?? (22 * 60);

  let isAllowed = false;
  let nextStartMs = 0;

  if (startTotal <= endTotal) {
    // Janela diurna normal (ex: 08:00 às 22:00)
    isAllowed = currentTotal >= startTotal && currentTotal <= endTotal;
    if (!isAllowed) {
      if (currentTotal < startTotal) {
        // Hoje mesmo no horário de início
        nextStartMs = (startTotal - currentTotal) * 60 * 1000;
      } else {
        // Amanhã no horário de início
        nextStartMs = ((24 * 60 - currentTotal) + startTotal) * 60 * 1000;
      }
    }
  } else {
    // Janela que vira a noite (ex: 22:00 às 06:00)
    isAllowed = currentTotal >= startTotal || currentTotal <= endTotal;
    if (!isAllowed) {
      nextStartMs = (startTotal - currentTotal) * 60 * 1000;
    }
  }

  return {
    isAllowed,
    nextStartMs,
    currentTime: timeString,
    startTime: queueState.startTime,
    endTime: queueState.endTime
  };
}

async function loadQueue() {
  // 1. Tenta carregar do arquivo local primeiro (rápido)
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
      queueState = {
        ...queueState,
        intervalMinutes: data.intervalMinutes || 5,
        startTime: data.startTime || '08:00',
        endTime: data.endTime || '22:00',
        sendWhatsApp: data.sendWhatsApp ?? true,
        sendTelegram: data.sendTelegram ?? true,
        autoRefill: data.autoRefill ?? true,
        items: Array.isArray(data.items) ? data.items : [],
        history: Array.isArray(data.history) ? data.history.slice(-30) : []
      };
    }
  } catch (err) {
    console.warn('[Scheduler] Erro ao carregar fila local:', err.message);
  }

  // 2. Sincroniza com Supabase se disponível
  if (db) {
    try {
      const [settings, queueItems, remoteHistory] = await Promise.all([
        db.fetchSettings().catch(() => null),
        db.fetchQueue().catch(() => []),
        db.fetchRecentHistory().catch(() => [])
      ]);

      if (settings) {
        if (settings.interval_minutes) queueState.intervalMinutes = settings.interval_minutes;
        if (settings.start_time) queueState.startTime = settings.start_time;
        if (settings.end_time) queueState.endTime = settings.end_time;
        if (settings.send_whatsapp !== undefined) queueState.sendWhatsApp = settings.send_whatsapp;
        if (settings.send_telegram !== undefined) queueState.sendTelegram = settings.send_telegram;
      }

      if (Array.isArray(queueItems) && queueItems.length > 0) {
        // Se houver itens no Supabase, mescla preservando unicidade por ID
        const map = new Map();
        queueState.items.forEach(it => map.set(it.id, it));
        queueItems.forEach(it => map.set(it.id, it));
        queueState.items = Array.from(map.values());
      }

      if (Array.isArray(remoteHistory) && remoteHistory.length > 0) {
        queueState.history = remoteHistory.slice(-30);
      }

      saveQueueLocal();
      console.log(`[Scheduler] Sincronizado com Supabase! ${queueState.items.length} itens na fila.`);
    } catch (e) {
      console.warn('[Scheduler] Falha na sincronização inicial com Supabase:', e.message);
    }
  }
}

function saveQueueLocal() {
  try {
    const toSave = {
      intervalMinutes: queueState.intervalMinutes,
      startTime: queueState.startTime,
      endTime: queueState.endTime,
      sendWhatsApp: queueState.sendWhatsApp,
      sendTelegram: queueState.sendTelegram,
      autoRefill: queueState.autoRefill,
      items: queueState.items,
      history: queueState.history.slice(-30)
    };
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Scheduler] Erro ao salvar fila localmente:', err.message);
  }
}

function getStatus() {
  const hoursCheck = checkOperatingHours();
  return {
    ok: true,
    isRunning: queueState.isRunning,
    intervalMinutes: queueState.intervalMinutes,
    startTime: queueState.startTime,
    endTime: queueState.endTime,
    isWithinOperatingHours: hoursCheck.isAllowed,
    currentBrazilTime: hoursCheck.currentTime,
    sendWhatsApp: queueState.sendWhatsApp,
    sendTelegram: queueState.sendTelegram,
    autoRefill: queueState.autoRefill,
    nextDispatchAt: queueState.nextDispatchAt,
    queueCount: queueState.items.length,
    items: queueState.items,
    history: queueState.history.slice(-15)
  };
}

async function updateConfig(data) {
  if (data.intervalMinutes && Number(data.intervalMinutes) >= 1) {
    queueState.intervalMinutes = Number(data.intervalMinutes);
  }
  if (data.startTime && typeof data.startTime === 'string') {
    queueState.startTime = data.startTime.trim();
  }
  if (data.endTime && typeof data.endTime === 'string') {
    queueState.endTime = data.endTime.trim();
  }
  if (typeof data.sendWhatsApp === 'boolean') queueState.sendWhatsApp = data.sendWhatsApp;
  if (typeof data.sendTelegram === 'boolean') queueState.sendTelegram = data.sendTelegram;
  if (typeof data.autoRefill === 'boolean') queueState.autoRefill = data.autoRefill;

  saveQueueLocal();

  if (db) {
    db.updateSettings({
      intervalMinutes: queueState.intervalMinutes,
      startTime: queueState.startTime,
      endTime: queueState.endTime,
      sendWhatsApp: queueState.sendWhatsApp,
      sendTelegram: queueState.sendTelegram,
      isRunning: queueState.isRunning
    }).catch(err => console.warn('[Scheduler] Erro ao salvar config no Supabase:', err.message));
  }

  return getStatus();
}

async function addItem(offer) {
  const newItem = {
    id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    title: String(offer.title || 'Oferta imperdível').trim(),
    price: Number(offer.price) || null,
    originalPrice: Number(offer.originalPrice) || null,
    coupon: String(offer.coupon || '').trim(),
    highlights: (Array.isArray(offer.highlights) ? offer.highlights : []).filter(h => !/comiss[aã]o|comiss/i.test(h)),
    affiliateUrl: String(offer.affiliateUrl || '').trim(),
    image: String(offer.image || '').trim(),
    store: String(offer.store || 'Oferta').trim(),
    details: String(offer.details || '').trim(),
    theme: String(offer.theme || 'purple'),
    createdAt: Date.now()
  };

  queueState.items.push(newItem);
  saveQueueLocal();

  if (db) {
    db.addQueueItem(newItem).catch(err => console.warn('[Scheduler] Erro ao salvar item no Supabase:', err.message));
  }

  console.log(`[Piloto Automático] Item adicionado à fila: "${newItem.title}". Total na fila: ${queueState.items.length}`);
  return { ok: true, item: newItem, queueCount: queueState.items.length };
}

async function updateItemImage(id, newImage) {
  const item = queueState.items.find(i => i.id === id);
  if (item) {
    item.image = newImage;
    saveQueueLocal();
    if (db) {
      db.updateQueueItem(id, { image: newImage }).catch(() => {});
    }
    return { ok: true };
  }
  return { ok: false, error: 'Item não encontrado na fila.' };
}

async function removeItem(id) {
  queueState.items = queueState.items.filter(item => item.id !== id);
  saveQueueLocal();

  if (db) {
    db.removeQueueItem(id).catch(err => console.warn('[Scheduler] Erro ao remover do Supabase:', err.message));
  }

  return { ok: true, queueCount: queueState.items.length };
}

async function clearQueue() {
  queueState.items = [];
  saveQueueLocal();

  if (db) {
    db.clearQueueItems().catch(err => console.warn('[Scheduler] Erro ao limpar no Supabase:', err.message));
  }

  return { ok: true, queueCount: 0 };
}

let sendOfferCallback = null;

function setSendCallback(fn) {
  sendOfferCallback = fn;
}

async function dispatchNext() {
  if (!queueState.isRunning) return;

  if (queueState.items.length === 0) {
    if (queueState.autoRefill) {
      try {
        console.log('[Piloto Automático] ⚡ Fila vazia com Auto-Abastecimento ativo! Minerando 10 novas ofertas...');
        const shopee = require('./shopee');
        const randomPage = Math.floor(Math.random() * 8) + 1;
        const hotOffers = await shopee.getTopShopeeOffers(10, randomPage);
        if (hotOffers && hotOffers.length > 0) {
          for (const ho of hotOffers) {
            queueState.items.push({
              id: ho.id,
              title: ho.title,
              price: ho.price,
              originalPrice: ho.originalPrice,
              coupon: '',
              highlights: (ho.highlights || []).filter(h => !/comiss[aã]o|comiss/i.test(h)),
              affiliateUrl: ho.affiliateUrl,
              image: ho.image,
              store: ho.store,
              details: 'Minerado automaticamente pela Shopee API.',
              theme: 'purple',
              createdAt: Date.now()
            });
          }
          saveQueueLocal();
          console.log(`[Piloto Automático] ✅ Abastecido com ${hotOffers.length} novas ofertas quentes!`);
        }
      } catch (err) {
        console.warn('[Piloto Automático] Aviso ao auto-abastecer fila:', err.message);
      }
    }

    if (queueState.items.length === 0) {
      console.log('[Piloto Automático] Fila vazia. Piloto pausado automaticamente.');
      queueState.isRunning = false;
      queueState.nextDispatchAt = null;
      if (timer) clearTimeout(timer);
      timer = null;
      if (db) db.updateSettings({ isRunning: false }).catch(() => {});
      return;
    }
  }

  // 1. Verifica se está no horário permitido de disparos
  const hoursCheck = checkOperatingHours();
  if (!hoursCheck.isAllowed) {
    console.log(`[Piloto Automático] 💤 Fora do horário permitido (${queueState.startTime} às ${queueState.endTime}). Horário atual: ${hoursCheck.currentTime}. Próximo disparo programado para ${queueState.startTime}.`);
    queueState.nextDispatchAt = Date.now() + hoursCheck.nextStartMs;
    // Aguarda até o horário de início (com verificação a cada 60s para reagir a alterações)
    const checkDelay = Math.min(hoursCheck.nextStartMs, 60000);
    timer = setTimeout(dispatchNext, checkDelay);
    return;
  }

  // 2. Retira o primeiro item da fila
  const currentItem = queueState.items.shift();
  saveQueueLocal();

  console.log(`[Piloto Automático] DISPARANDO: "${currentItem.title}"... Restam ${queueState.items.length} na fila.`);

  let statusMsg = '';
  let statusResult = 'success';
  try {
    if (sendOfferCallback) {
      const res = await sendOfferCallback(currentItem, {
        sendWhatsApp: queueState.sendWhatsApp,
        sendTelegram: queueState.sendTelegram
      });
      statusMsg = res.message || 'Disparado com sucesso!';
    }
  } catch (err) {
    console.error(`[Piloto Automático] Falha no disparo de "${currentItem.title}":`, err.message);
    statusResult = 'error';
    statusMsg = err.message;
  }

  const historyEntry = {
    ...currentItem,
    sentAt: new Date().toISOString(),
    status: statusResult,
    statusMsg
  };

  queueState.history.push(historyEntry);
  saveQueueLocal();

  if (db) {
    db.markQueueItemProcessed(currentItem.id, statusResult === 'success' ? 'sent' : 'error').catch(() => {});
    db.recordHistoryItem(historyEntry).catch(() => {});
  }

  // 3. Agenda o próximo disparo se houver mais itens
  if (queueState.isRunning && queueState.items.length > 0) {
    const delayMs = queueState.intervalMinutes * 60 * 1000;
    queueState.nextDispatchAt = Date.now() + delayMs;
    console.log(`[Piloto Automático] Próximo disparo em ${queueState.intervalMinutes} minutos (${new Date(queueState.nextDispatchAt).toLocaleTimeString('pt-BR')}).`);
    timer = setTimeout(dispatchNext, delayMs);
  } else if (queueState.items.length === 0) {
    console.log('[Piloto Automático] Todas as ofertas da fila foram disparadas com sucesso!');
    queueState.isRunning = false;
    queueState.nextDispatchAt = null;
    timer = null;
    if (db) db.updateSettings({ isRunning: false }).catch(() => {});
  }
}

function startQueue(triggerImmediately = true) {
  if (queueState.items.length === 0) {
    throw new Error('A fila está vazia! Adicione ofertas antes de iniciar o Piloto Automático.');
  }

  queueState.isRunning = true;
  if (timer) clearTimeout(timer);

  if (db) db.updateSettings({ isRunning: true }).catch(() => {});

  const hoursCheck = checkOperatingHours();
  if (!hoursCheck.isAllowed) {
    console.log(`[Piloto Automático] Piloto iniciado, mas aguardando janela de horário (${queueState.startTime} às ${queueState.endTime}).`);
    queueState.nextDispatchAt = Date.now() + hoursCheck.nextStartMs;
    timer = setTimeout(dispatchNext, Math.min(hoursCheck.nextStartMs, 60000));
  } else if (triggerImmediately) {
    dispatchNext();
  } else {
    const delayMs = queueState.intervalMinutes * 60 * 1000;
    queueState.nextDispatchAt = Date.now() + delayMs;
    timer = setTimeout(dispatchNext, delayMs);
  }

  return getStatus();
}

function pauseQueue() {
  queueState.isRunning = false;
  queueState.nextDispatchAt = null;
  if (timer) clearTimeout(timer);
  timer = null;
  if (db) db.updateSettings({ isRunning: false }).catch(() => {});
  console.log('[Piloto Automático] Fila pausada pelo usuário.');
  return getStatus();
}

// Carrega fila ao iniciar
loadQueue();

module.exports = {
  getStatus,
  addItem,
  updateItemImage,
  removeItem,
  clearQueue,
  updateConfig,
  startQueue,
  pauseQueue,
  setSendCallback,
  checkOperatingHours
};

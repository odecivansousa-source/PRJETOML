const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bnjrbvlnyvyudotngtrb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJuanJidmxueXZ5dWRvdG5ndHJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1ODI0MjksImV4cCI6MjEwOTE1ODQyOX0.TanRo-ioNOtipU3oJE5YU-zPmhfA-QABjuWvqXP5aNQ';

let supabase = null;
try {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });
  console.log('[Supabase] Cliente inicializado com sucesso para:', SUPABASE_URL);
} catch (err) {
  console.warn('[Supabase] Falha ao inicializar cliente:', err.message);
}

// Configurações Globais
async function fetchSettings() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('linkpronto_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();
    if (error) throw error;
    return data;
  } catch (e) {
    console.warn('[Supabase] Erro ao carregar configurações:', e.message);
    return null;
  }
}

async function updateSettings(settings) {
  if (!supabase) return null;
  try {
    const payload = {
      id: 'default',
      updated_at: new Date().toISOString()
    };
    if (settings.intervalMinutes !== undefined) payload.interval_minutes = Number(settings.intervalMinutes);
    if (settings.startTime !== undefined) payload.start_time = String(settings.startTime);
    if (settings.endTime !== undefined) payload.end_time = String(settings.endTime);
    if (settings.isRunning !== undefined) payload.is_running = Boolean(settings.isRunning);
    if (settings.sendWhatsApp !== undefined) payload.send_whatsapp = Boolean(settings.sendWhatsApp);
    if (settings.sendTelegram !== undefined) payload.send_telegram = Boolean(settings.sendTelegram);
    if (settings.telegramToken !== undefined) payload.telegram_token = settings.telegramToken;
    if (settings.telegramChatId !== undefined) payload.telegram_chat_id = settings.telegramChatId;
    if (settings.telegramChatTitle !== undefined) payload.telegram_chat_title = settings.telegramChatTitle;
    if (settings.whatsappGroupId !== undefined) payload.whatsapp_group_id = settings.whatsappGroupId;
    if (settings.whatsappGroupName !== undefined) payload.whatsapp_group_name = settings.whatsappGroupName;

    const { data, error } = await supabase
      .from('linkpronto_settings')
      .upsert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.warn('[Supabase] Erro ao salvar configurações:', e.message);
    return null;
  }
}

// Fila de Disparo (Queue)
async function fetchQueue() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('linkpronto_queue')
      .select('*')
      .eq('status', 'pending')
      .order('order_index', { ascending: true });
    if (error) throw error;
    return (data || []).map(row => ({
      id: row.id,
      title: row.title,
      price: row.price ? Number(row.price) : null,
      originalPrice: row.original_price ? Number(row.original_price) : null,
      coupon: row.coupon || '',
      highlights: Array.isArray(row.highlights) ? row.highlights : [],
      affiliateUrl: row.affiliate_url,
      image: row.image || '',
      store: row.store || 'Oferta',
      details: row.details || '',
      theme: row.theme || 'purple',
      createdAt: new Date(row.created_at).getTime()
    }));
  } catch (e) {
    console.warn('[Supabase] Erro ao buscar fila:', e.message);
    return [];
  }
}

async function addQueueItem(item) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('linkpronto_queue')
      .insert({
        id: item.id,
        title: item.title,
        price: item.price,
        original_price: item.originalPrice,
        coupon: item.coupon || '',
        highlights: item.highlights || [],
        affiliate_url: item.affiliateUrl,
        image: item.image || '',
        store: item.store || 'Oferta',
        details: item.details || '',
        theme: item.theme || 'purple',
        status: 'pending'
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.warn('[Supabase] Erro ao adicionar item na fila:', e.message);
    return null;
  }
}

async function removeQueueItem(id) {
  if (!supabase) return;
  try {
    await supabase.from('linkpronto_queue').delete().eq('id', id);
  } catch (e) {
    console.warn('[Supabase] Erro ao remover item da fila:', e.message);
  }
}

async function clearQueueItems() {
  if (!supabase) return;
  try {
    await supabase.from('linkpronto_queue').delete().neq('id', '');
  } catch (e) {
    console.warn('[Supabase] Erro ao limpar fila:', e.message);
  }
}

async function markQueueItemProcessed(id, status = 'sent') {
  if (!supabase) return;
  try {
    await supabase
      .from('linkpronto_queue')
      .update({ status })
      .eq('id', id);
  } catch (e) {
    console.warn('[Supabase] Erro ao marcar item como processado:', e.message);
  }
}

// Histórico de Disparos
async function recordHistoryItem(item) {
  if (!supabase) return;
  try {
    await supabase.from('linkpronto_history').insert({
      title: item.title,
      price: item.price,
      original_price: item.originalPrice,
      affiliate_url: item.affiliateUrl,
      image: item.image,
      store: item.store,
      status: item.status || 'success',
      status_msg: item.statusMsg || 'Disparado com sucesso',
      sent_at: item.sentAt || new Date().toISOString()
    });
  } catch (e) {
    console.warn('[Supabase] Erro ao registrar histórico:', e.message);
  }
}

async function fetchRecentHistory(limit = 15) {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('linkpronto_history')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(row => ({
      id: row.id,
      title: row.title,
      price: row.price ? Number(row.price) : null,
      originalPrice: row.original_price ? Number(row.original_price) : null,
      affiliateUrl: row.affiliate_url,
      image: row.image,
      store: row.store,
      status: row.status,
      statusMsg: row.status_msg,
      sentAt: row.sent_at
    }));
  } catch (e) {
    console.warn('[Supabase] Erro ao carregar histórico:', e.message);
    return [];
  }
}

// Sincronização de credenciais de sessão do WhatsApp no Supabase
async function saveAuthCredential(key, value) {
  if (!supabase) return;
  try {
    await supabase.from('linkpronto_whatsapp_auth').upsert({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      updated_at: new Date().toISOString()
    });
  } catch (e) {
    // Silencioso para não poluir logs
  }
}

async function loadAuthCredential(key) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('linkpronto_whatsapp_auth')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return null;
    try {
      return JSON.parse(data.value);
    } catch {
      return data.value;
    }
  } catch {
    return null;
  }
}

async function removeAuthCredential(key) {
  if (!supabase) return;
  try {
    await supabase.from('linkpronto_whatsapp_auth').delete().eq('key', key);
  } catch {}
}

module.exports = {
  supabase,
  fetchSettings,
  updateSettings,
  fetchQueue,
  addQueueItem,
  removeQueueItem,
  clearQueueItems,
  markQueueItemProcessed,
  recordHistoryItem,
  fetchRecentHistory,
  saveAuthCredential,
  loadAuthCredential,
  removeAuthCredential
};

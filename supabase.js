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

// ==========================================
// AUTENTICAÇÃO E GESTÃO DE CLIENTES (SAAS)
// ==========================================

async function loginUser(email, password) {
  if (!supabase) throw new Error('Banco de dados indisponível no momento.');
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPass = String(password || '').trim();

  if (!cleanEmail || !cleanPass) {
    throw new Error('Preencha seu e-mail e senha para entrar.');
  }

  const { data: user, error } = await supabase
    .from('linkpronto_users')
    .select('*')
    .eq('email', cleanEmail)
    .maybeSingle();

  if (error || !user) {
    throw new Error('E-mail ou senha incorretos. Caso queira assinar, chame no WhatsApp!');
  }

  if (user.password !== cleanPass) {
    throw new Error('E-mail ou senha incorretos.');
  }

  if (user.status === 'blocked') {
    throw new Error('Seu acesso está bloqueado. Fale com o suporte no WhatsApp.');
  }

  // Verifica expiração de acesso
  const now = new Date();
  const expiresAt = new Date(user.access_expires_at);
  const isExpired = user.role !== 'admin' && expiresAt < now;
  const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    whatsapp: user.whatsapp,
    role: user.role,
    status: isExpired ? 'expired' : user.status,
    isExpired,
    daysLeft: user.role === 'admin' ? 9999 : Math.max(0, daysLeft),
    accessExpiresAt: user.access_expires_at
  };
}

async function listUsers() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('linkpronto_users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const now = new Date();
    return (data || []).map(u => {
      const expiresAt = new Date(u.access_expires_at);
      const isExpired = u.role !== 'admin' && expiresAt < now;
      const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        whatsapp: u.whatsapp,
        role: u.role,
        status: isExpired ? 'expired' : u.status,
        daysLeft: u.role === 'admin' ? 9999 : daysLeft,
        accessExpiresAt: u.access_expires_at,
        createdAt: u.created_at,
        notes: u.notes || ''
      };
    });
  } catch (e) {
    console.warn('[Supabase] Erro ao listar usuários:', e.message);
    return [];
  }
}

async function createUser({ name, email, password, whatsapp, days = 30, notes = '' }) {
  if (!supabase) throw new Error('Banco de dados indisponível.');
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPass = String(password || '').trim();
  const cleanName = String(name || '').trim();
  const cleanWhats = String(whatsapp || '').replace(/\D/g, '');

  if (!cleanEmail || !cleanPass || !cleanName) {
    throw new Error('Nome, e-mail e senha são obrigatórios.');
  }

  const daysNum = Number(days) || 30;
  const expiresAt = new Date(Date.now() + daysNum * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('linkpronto_users')
    .insert({
      name: cleanName,
      email: cleanEmail,
      password: cleanPass,
      whatsapp: cleanWhats,
      role: 'client',
      status: 'active',
      access_expires_at: expiresAt,
      notes
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') throw new Error('Já existe um cliente cadastrado com este e-mail.');
    throw new Error(error.message);
  }

  // Cria configuração padrão para o novo cliente
  await updateSettings({
    shopeeAffiliateId: '',
    intervalMinutes: 5,
    startTime: '08:00',
    endTime: '22:00',
    sendWhatsApp: true,
    sendTelegram: true
  }, data.id);

  return data;
}

async function renewUserAccess(userId, additionalDays = 30) {
  if (!supabase) throw new Error('Banco de dados indisponível.');
  const { data: user, error: getErr } = await supabase
    .from('linkpronto_users')
    .select('access_expires_at')
    .eq('id', userId)
    .single();

  if (getErr || !user) throw new Error('Cliente não encontrado.');

  const currentExp = new Date(user.access_expires_at);
  const baseTime = currentExp > new Date() ? currentExp.getTime() : Date.now();
  const newExp = new Date(baseTime + Number(additionalDays) * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('linkpronto_users')
    .update({
      access_expires_at: newExp,
      status: 'active',
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function toggleUserStatus(userId, newStatus) {
  if (!supabase) throw new Error('Banco de dados indisponível.');
  const { data, error } = await supabase
    .from('linkpronto_users')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteUser(userId) {
  if (!supabase) throw new Error('Banco de dados indisponível.');
  await supabase.from('linkpronto_queue').delete().eq('user_id', userId);
  await supabase.from('linkpronto_settings').delete().eq('id', userId);
  const { error } = await supabase.from('linkpronto_users').delete().eq('id', userId);
  if (error) throw error;
  return { ok: true };
}

// ==========================================
// CONFIGURAÇÕES GLOBAIS E POR CLIENTE
// ==========================================

async function fetchSettings(userId = 'default') {
  if (!supabase) return null;
  try {
    const targetId = String(userId || 'default');
    const { data, error } = await supabase
      .from('linkpronto_settings')
      .select('*')
      .eq('id', targetId)
      .maybeSingle();

    if (error) throw error;
    if (!data && targetId !== 'default') {
      // Se não tem settings específicas, clona as da default
      const def = await fetchSettings('default');
      return def;
    }
    return data;
  } catch (e) {
    console.warn('[Supabase] Erro ao carregar configurações:', e.message);
    return null;
  }
}

async function updateSettings(settings, userId = 'default') {
  if (!supabase) return null;
  try {
    const targetId = String(userId || 'default');
    const payload = {
      id: targetId,
      user_id: targetId,
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
    if (settings.whatsappGroupLink !== undefined) payload.whatsapp_group_link = settings.whatsappGroupLink;
    if (settings.shopeeAffiliateId !== undefined) payload.shopee_affiliate_id = settings.shopeeAffiliateId;

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

// ==========================================
// FILA DE DISPARO (QUEUE) POR USUÁRIO
// ==========================================

async function fetchQueue(userId = 'default') {
  if (!supabase) return [];
  try {
    const targetUser = String(userId || 'default');
    const { data, error } = await supabase
      .from('linkpronto_queue')
      .select('*')
      .eq('user_id', targetUser)
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
      createdAt: new Date(row.created_at).getTime(),
      userId: row.user_id || 'default'
    }));
  } catch (e) {
    console.warn('[Supabase] Erro ao buscar fila:', e.message);
    return [];
  }
}

async function addQueueItem(item, userId = 'default') {
  if (!supabase) return null;
  try {
    const targetUser = String(userId || 'default');
    const { data, error } = await supabase
      .from('linkpronto_queue')
      .insert({
        id: item.id,
        user_id: targetUser,
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

async function removeQueueItem(id, userId = 'default') {
  if (!supabase) return;
  try {
    let query = supabase.from('linkpronto_queue').delete().eq('id', id);
    if (userId && userId !== 'all') {
      query = query.eq('user_id', userId);
    }
    await query;
  } catch (e) {
    console.warn('[Supabase] Erro ao remover item da fila:', e.message);
  }
}

async function clearQueueItems(userId = 'default') {
  if (!supabase) return;
  try {
    const targetUser = String(userId || 'default');
    await supabase.from('linkpronto_queue').delete().eq('user_id', targetUser);
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

// ==========================================
// HISTÓRICO DE DISPAROS
// ==========================================

async function recordHistoryItem(item, userId = 'default') {
  if (!supabase) return;
  try {
    const targetUser = String(userId || 'default');
    await supabase.from('linkpronto_history').insert({
      user_id: targetUser,
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

async function fetchRecentHistory(limit = 15, userId = 'default') {
  if (!supabase) return [];
  try {
    const targetUser = String(userId || 'default');
    const { data, error } = await supabase
      .from('linkpronto_history')
      .select('*')
      .eq('user_id', targetUser)
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

// ==========================================
// SESSÃO DO WHATSAPP
// ==========================================

async function saveAuthCredential(key, value) {
  if (!supabase) return;
  try {
    await supabase.from('linkpronto_whatsapp_auth').upsert({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      updated_at: new Date().toISOString()
    });
  } catch (e) {}
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

module.exports = {
  supabase,
  loginUser,
  listUsers,
  createUser,
  renewUserAccess,
  toggleUserStatus,
  deleteUser,
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
  loadAuthCredential
};

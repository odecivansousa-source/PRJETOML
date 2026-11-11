const API_BASE = (window.location.protocol === 'file:') ? 'http://127.0.0.1:4174' : '';
function apiUrl(path) {
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);

// Elementos principais
const form = $('#link-form');
const linkInput = $('#product-link');
const findButton = $('#find-button');
const loadingBox = $('#loading-box');
const errorBox = $('#error-box');
const productSection = $('#product-section');
const statusBadge = $('#status-badge');

// Campos de edição
const titleInput = $('#edit-title');
const priceInput = $('#edit-price');
const originalPriceInput = $('#edit-original-price');
const couponInput = $('#edit-coupon');
const affiliateUrlPreview = $('#affiliate-url-preview');
const affiliateStatusTitle = $('#affiliate-status-title');

// Desconto e Badges
const discountBadge = $('#discount-badge');
const discountPercentText = $('#discount-percent-text');
const discountEconomyText = $('#discount-economy-text');

// Contador Diário e Tema
const dailyCountBadge = $('#daily-count-badge');
const themeToggleBtn = $('#theme-toggle');

// Abas de Prévia
const tabTextBtn = $('#tab-text-btn');
const tabArtBtn = $('#tab-art-btn');
const previewTextContainer = $('#preview-text-container');
const previewArtContainer = $('#preview-art-container');
const liveCanvasPreview = $('#live-canvas-preview');

// Notificações e Histórico
const toast = $('#toast');
const historyGrid = $('#history-grid');
const clearHistoryButton = $('#clear-history-button');
const exportSummaryBtn = $('#export-summary-btn');

// Configurações de Canais
const whatsappGroupInput = $('#whatsapp-group-link');
const saveWhatsappBtn = $('#save-whatsapp-btn');
const whatsappQuickButton = $('#whatsapp-quick-button');

let product = null;
let toastTimer;
let currentCopyStyle = 'padrao'; // 'padrao' | 'urgente' | 'curto'
let currentArtFormat = 'feed';   // 'feed' (1:1) | 'story' (9:16)
let currentArtTheme = 'purple';  // 'purple' | 'shopee' | 'meli' | 'dark'

let currentAuthUser = null;

function getActiveUserId() {
  if (!currentAuthUser) return 'visitor';
  if (currentAuthUser.role === 'admin' || currentAuthUser.email === 'odecivansousa@gmail.com') return 'default';
  return String(currentAuthUser.id || 'client');
}

function getUserStorageKey(baseKey) {
  const uid = getActiveUserId();
  if (uid === 'default') return baseKey;
  return `${baseKey}_${uid}`;
}

const HISTORY_KEY = 'mossoro_ofertas_history_v2';
const WHATSAPP_KEY = 'mossoro_whatsapp_group_v2';
const THEME_KEY = 'mossoro_theme_v2';
const DAILY_COUNT_KEY = 'mossoro_daily_count_v2';

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function cleanText(value) {
  return String(value || '').replace(/[<>]/g, '').trim();
}

function parseCurrencyInput(inputElement) {
  const raw = (inputElement.value || '').trim().replace(/\s/g, '');
  if (!raw) return null;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function currentTitle() {
  return cleanText(titleInput.value) || 'Oferta especial';
}

function calculateDiscount() {
  const price = parseCurrencyInput(priceInput);
  const originalPrice = parseCurrencyInput(originalPriceInput);
  if (originalPrice && price && originalPrice > price) {
    const percent = Math.round(((originalPrice - price) / originalPrice) * 100);
    const savings = originalPrice - price;
    return { percent, savings, valid: true };
  }
  return { percent: 0, savings: 0, valid: false };
}

function updateDiscountBadge() {
  const discount = calculateDiscount();
  if (discount.valid) {
    discountPercentText.textContent = `🔥 ${discount.percent}% OFF`;
    discountEconomyText.textContent = `Economia de ${formatPrice(discount.savings)}`;
    discountBadge.hidden = false;
  } else {
    discountBadge.hidden = true;
  }
}

const SHOPEE_AFFILIATE_ID = '18326420168';

function verifyAffiliateTag(url) {
  const text = String(url || '').toLowerCase();
  const isShopee = /shopee|shp\.ee|shope\.ee/.test(text);
  const isMeli = /mercadoli[bv]re|meli\.la/.test(text);

  let hasTag = false;
  let tagInfo = '';

  if (isShopee) {
    hasTag = /s\.shopee|shp\.ee|shope\.ee|affiliate|utm_campaign|share_channel_code|18326420168/.test(text);
    tagInfo = '✓ ID Shopee Oficial (18326420168) ativo — comissão garantida';
  } else if (isMeli) {
    hasTag = /meli\.la|matt_tool|matt_word|recs_options/.test(text);
    tagInfo = '✓ Link de afiliado Mercado Livre verificado';
  }

  if (hasTag) {
    affiliateStatusTitle.textContent = tagInfo || 'Link de afiliado verificado (comissão ativa)';
    affiliateStatusTitle.style.color = 'var(--green)';
  } else {
    affiliateStatusTitle.textContent = isShopee 
      ? `Shopee: ID 18326420168 será mantido na divulgação`
      : 'Link sem tag identificada. Confira antes de postar';
    affiliateStatusTitle.style.color = 'var(--green)';
  }
}

function productHashtags(title) {
  const stopWords = new Set(['com', 'para', 'sem', 'por', 'uma', 'novo', 'nova', 'masculino', 'feminino', 'unissex', 'promocao']);
  const words = String(title).normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[A-Za-z0-9]+/g) || [];
  const productTags = [...new Set(words.filter(word => word.length > 2 && !stopWords.has(word.toLowerCase())))].slice(0, 3).map(word => `#${word}`);
  return [...productTags, '#OfertaDoDia', '#Achadinhos', '#Promocao'].join(' ');
}

function buildMessage() {
  if (!product) return '';
  const price = parseCurrencyInput(priceInput);
  const originalPrice = parseCurrencyInput(originalPriceInput);
  const coupon = cleanText(couponInput.value);
  const title = currentTitle();
  const affiliateUrl = product.affiliateUrl || '';
  const discount = calculateDiscount();

  if (currentCopyStyle === 'curto') {
    const lines = [`🚀 *${title}*`];
    if (discount.valid) {
      lines.push(`❌ ~De ${formatPrice(originalPrice)}~`);
      lines.push(`💰 *Por ${formatPrice(price)}* (-${discount.percent}%)`);
    } else if (price) {
      lines.push(`💰 *${formatPrice(price)}*`);
    }
    if (coupon) lines.push(`🎟️ Cupom: *${coupon}*`);
    lines.push('', `👉 Compre aqui: ${affiliateUrl}`);
    return lines.join('\n');
  }

  if (currentCopyStyle === 'urgente') {
    const lines = [
      '⚡ *ALERTA DE PREÇO BAIXO! CORRE!* 🏃‍♂️💨',
      '',
      `🔥 *${title}*`
    ];
    for (const highlight of (product.highlights || []).slice(0, 4)) lines.push(highlight);

    if (discount.valid) {
      lines.push('', `❌ ~De ${formatPrice(originalPrice)}~`);
      lines.push(`💥 *POR APENAS ${formatPrice(price)}!*`);
      lines.push(`🏷️ *DESCONTO: ${discount.percent}% OFF (Você economiza ${formatPrice(discount.savings)})*`);
    } else if (price) {
      lines.push('', `💥 *POR APENAS ${formatPrice(price)}!*`);
    }

    if (coupon) lines.push(`🎟️ Use o cupom: *${coupon}*`);
    lines.push('', '⚠️ *Estoque limitado ou preço pode subir a qualquer momento!*');
    lines.push('', '👇 *PEGUE A SUA OFERTA ANTES QUE ACABE:*');
    lines.push(affiliateUrl);
    lines.push('', productHashtags(title));
    return lines.join('\n');
  }

  // Padrão (Imperdível)
  const lines = ['🔥 *OFERTA IMPERDÍVEL! 📱*', '', `🚀 *${title}*`];
  for (const highlight of (product.highlights || []).slice(0, 5)) lines.push(highlight);

  if (discount.valid) {
    lines.push('', `❌ ~De ${formatPrice(originalPrice)}~`);
    lines.push(`💰 *POR APENAS ${formatPrice(price)}!*`);
    lines.push(`🏷️ *DESCONTO: ${discount.percent}% OFF (Economia de ${formatPrice(discount.savings)})*`);
  } else if (price) {
    lines.push('', `💰 *POR APENAS ${formatPrice(price)}!*`);
  }

  if (coupon) lines.push(`🎟️ Cupom: *${coupon}*`);
  lines.push('', '🛒 Garanta o seu antes que acabe!', '', '👇 *COMPRE AQUI:*');
  lines.push(affiliateUrl);
  lines.push('', productHashtags(title));
  return lines.join('\n');
}

function refreshMessage() {
  if (!product) return;
  const message = buildMessage();
  $('#message-preview').textContent = message;
  $('#summary-title').textContent = currentTitle();
  updateDiscountBadge();
  updateLiveArtPreview();
}

function setImage(url) {
  const image = $('#product-image');
  const placeholder = $('#image-empty');
  if (!url) {
    image.hidden = true;
    placeholder.hidden = false;
    updateLiveArtPreview();
    return;
  }
  image.onload = () => {
    image.hidden = false;
    placeholder.hidden = true;
    updateLiveArtPreview();
  };
  image.onerror = () => {
    image.hidden = true;
    placeholder.hidden = false;
    updateLiveArtPreview();
  };
  if (url.startsWith('data:image/')) {
    image.src = url;
  } else {
    image.src = apiUrl(`/api/image?url=${encodeURIComponent(url)}`);
  }
}

function renderProduct(data, skipHistorySave = false) {
  const titleText = String(data.title || '').trim();
  const suffix = titleText.match(/\s*(?:[-–—|]\s*)?R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)\s*$/i);
  const suffixPrice = suffix ? Number(suffix[1].replace(/\./g, '').replace(',', '.')) : null;
  const cleanedTitle = suffix ? titleText.slice(0, suffix.index).replace(/\s*[-–—|]\s*$/, '').trim() : titleText;
  const resolvedPrice = Number.isFinite(data.price) && data.price > 0 ? data.price : suffixPrice;

  product = {
    ...data,
    title: cleanedTitle || titleText,
    price: resolvedPrice,
    originalPrice: Number.isFinite(data.originalPrice) ? data.originalPrice : null
  };

  titleInput.value = product.title || '';
  priceInput.value = Number.isFinite(product.price)
    ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(product.price)
    : '';
  originalPriceInput.value = Number.isFinite(product.originalPrice)
    ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(product.originalPrice)
    : '';
  couponInput.value = product.coupon || '';

  const storeName = (product.store || 'LOJA').toLocaleUpperCase('pt-BR');
  $('#store-tag').textContent = storeName;
  $('#data-note').textContent = product.details || 'Confira os dados antes de publicar.';

  // Sugerir tema visual baseado na loja automaticamente
  if (storeName.includes('SHOPEE')) {
    setArtTheme('shopee');
  } else if (storeName.includes('MERCADO')) {
    setArtTheme('meli');
  }

  if (data.needsManualFill) {
    statusBadge.innerHTML = '<span>⚠️</span> Preenchimento manual';
    statusBadge.classList.add('warning');
    setTimeout(() => {
      if (!titleInput.value) titleInput.focus();
      else priceInput.focus();
    }, 200);
  } else {
    statusBadge.innerHTML = '<span>✓</span> Dados verificados';
    statusBadge.classList.remove('warning');
  }

  affiliateUrlPreview.textContent = product.affiliateUrl || '';
  verifyAffiliateTag(product.affiliateUrl);
  setImage(product.image);

  productSection.hidden = false;
  refreshMessage();
  productSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (!skipHistorySave && (product.title || product.price)) {
    saveToHistory(product);
    incrementDailyCount();
  }
}

// Histórico de Ofertas & Contador Diário
function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadDailyCount() {
  try {
    const raw = localStorage.getItem(DAILY_COUNT_KEY);
    if (!raw) return 0;
    const data = JSON.parse(raw);
    return data.date === getTodayString() ? Number(data.count) || 0 : 0;
  } catch {
    return 0;
  }
}

function incrementDailyCount() {
  const today = getTodayString();
  const current = loadDailyCount();
  const next = current + 1;
  localStorage.setItem(DAILY_COUNT_KEY, JSON.stringify({ date: today, count: next }));
  updateDailyBadge();
}

function updateDailyBadge() {
  const count = loadDailyCount();
  dailyCountBadge.textContent = `🔥 ${count} ${count === 1 ? 'oferta hoje' : 'ofertas hoje'}`;
}

function loadHistory() {
  try {
    const key = getUserStorageKey(HISTORY_KEY);
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToHistory(item) {
  if (!item || !item.affiliateUrl) return;
  try {
    let history = loadHistory();
    history = history.filter(h => h.affiliateUrl !== item.affiliateUrl);
    history.unshift({
      title: item.title,
      price: item.price,
      originalPrice: item.originalPrice,
      image: item.image,
      store: item.store,
      affiliateUrl: item.affiliateUrl,
      coupon: item.coupon,
      highlights: item.highlights,
      timestamp: Date.now()
    });
    if (history.length > 15) history = history.slice(0, 15);
    const key = getUserStorageKey(HISTORY_KEY);
    localStorage.setItem(key, JSON.stringify(history));
    renderHistory();
  } catch (e) {
    console.warn('Erro ao salvar histórico', e);
  }
}

function renderHistory() {
  const history = loadHistory();
  if (!history.length) {
    historyGrid.innerHTML = '<div class="history-empty">Nenhuma oferta gerada ainda. As ofertas que você criar aparecerão aqui.</div>';
    return;
  }

  historyGrid.innerHTML = '';
  history.forEach(item => {
    const card = document.createElement('div');
    card.className = 'history-card';
    const fmtPrice = item.price ? formatPrice(item.price) : 'Sem preço';
    const storeBadge = item.store === 'Shopee' ? 'Shopee' : 'Mercado Livre';

    card.innerHTML = `
      <div class="history-card-img">
        ${item.image ? `<img src="${item.image.startsWith('data:') ? item.image : apiUrl(`/api/image?url=${encodeURIComponent(item.image)}`)}" alt="">` : '<span>🛍️</span>'}
      </div>
      <div class="history-card-info">
        <span class="history-store">${storeBadge}</span>
        <b class="history-card-title">${item.title || 'Oferta sem título'}</b>
        <span class="history-card-price">${fmtPrice}</span>
      </div>
      <button class="history-card-btn" type="button" title="Carregar esta oferta">Carregar ↺</button>
    `;

    card.querySelector('.history-card-btn').addEventListener('click', () => {
      linkInput.value = item.affiliateUrl;
      renderProduct(item, true);
      showToast('Oferta recuperada do histórico!');
    });

    historyGrid.appendChild(card);
  });
}

clearHistoryButton.addEventListener('click', () => {
  if (confirm('Deseja limpar o histórico das últimas ofertas?')) {
    const key = getUserStorageKey(HISTORY_KEY);
    localStorage.removeItem(key);
    renderHistory();
    showToast('Histórico limpo.');
  }
});

// Copiar Resumo do Dia
exportSummaryBtn.addEventListener('click', async () => {
  const history = loadHistory();
  if (!history.length) {
    showToast('Nenhuma oferta no histórico para resumir.', true);
    return;
  }

  const lines = [
    '🛍️ *ACHADINHOS & OFERTAS DO DIA — MOSSORÓ OFERTAS* 🔥',
    'Confira os melhores preços selecionados hoje:',
    ''
  ];

  history.slice(0, 10).forEach((item, index) => {
    const num = index + 1;
    const priceStr = item.price ? `💰 Por apenas *${formatPrice(item.price)}*` : '';
    lines.push(`${num}️⃣ *${item.title || 'Oferta Especial'}*`);
    if (priceStr) lines.push(priceStr);
    if (item.coupon) lines.push(`🎟️ Cupom: *${item.coupon}*`);
    lines.push(`👉 Compre aqui: ${item.affiliateUrl}`);
    lines.push('');
  });

  lines.push('⚠️ _Preços e cupons sujeitos a alteração da loja a qualquer momento._');
  await copyText(lines.join('\n'));
  showToast('Resumo do dia copiado! Pronto para postar no grupo.');
});

// Entrada Manual de Oferta
function startManualOffer(customLink = '') {
  const raw = customLink || linkInput.value.trim();
  const urlMatch = raw.match(/https?:\/\/[^\s"'<>]+/i);
  const finalLink = urlMatch ? urlMatch[0].replace(/[.,;!?)]+$/, '') : raw;

  if (!finalLink) {
    showToast('Cole o link do produto primeiro!', true);
    linkInput.focus();
    return;
  }

  const isShopee = /shopee|shp\.ee|shope\.ee/i.test(finalLink);
  const store = isShopee ? 'Shopee' : 'Mercado Livre';

  let guessedTitle = '';
  try {
    const parsed = new URL(finalLink);
    const slug = decodeURIComponent(parsed.pathname || '').replace(/\/product\/\d+\/\d+/i, '');
    const cleanSlug = slug.replace(/[-_]+/g, ' ').replace(/\s*-i\.\d+.*$/i, '').replace(/^\/+/, '').trim();
    if (cleanSlug.length > 3) guessedTitle = cleanSlug;
  } catch {}

  renderProduct({
    title: guessedTitle,
    price: null,
    originalPrice: null,
    currency: 'BRL',
    image: '',
    itemUrl: finalLink,
    store: store,
    highlights: [],
    coupon: '',
    affiliateUrl: finalLink,
    needsManualFill: true,
    details: 'Link de afiliado preservado. Digite o título e o preço para gerar sua oferta.'
  });

  errorBox.hidden = true;
  showToast('Painel aberto para edição da oferta!');
}

$('#manual-compose-button').addEventListener('click', () => {
  if (!checkAuthAccess()) return;
  startManualOffer();
});

// Busca de Produto
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!checkAuthAccess()) return;
  const link = linkInput.value.trim();
  errorBox.hidden = true;

  if (!link) {
    errorBox.textContent = 'Cole o link de afiliado do produto para continuar.';
    errorBox.hidden = false;
    linkInput.focus();
    return;
  }

  findButton.disabled = true;
  loadingBox.hidden = false;
  productSection.hidden = true;

  try {
    const response = await fetch(apiUrl(`/api/preview?url=${encodeURIComponent(link)}`));
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Não foi possível ler o produto.');
    renderProduct(result.product);
  } catch (error) {
    errorBox.innerHTML = `
      <div>${error.message || 'Falha ao buscar automaticamente os dados do anúncio.'}</div>
      <button type="button" class="btn-error-fallback" id="error-fallback-btn">
        👉 Abrir oferta com este link e preencher os dados
      </button>
    `;
    errorBox.hidden = false;
    $('#error-fallback-btn')?.addEventListener('click', () => startManualOffer(link));
  } finally {
    findButton.disabled = false;
    loadingBox.hidden = true;
  }
});

// Eventos de alteração nos inputs
for (const input of [titleInput, priceInput, originalPriceInput, couponInput]) {
  input.addEventListener('input', () => {
    refreshMessage();
    if (product) {
      product.title = currentTitle();
      product.price = parseCurrencyInput(priceInput);
      product.originalPrice = parseCurrencyInput(originalPriceInput);
      product.coupon = cleanText(couponInput.value);
    }
  });
}

// Seletor de estilo de copy
$$('.copy-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    $$('.copy-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentCopyStyle = pill.dataset.style;
    refreshMessage();
    showToast(`Estilo alterado para: ${pill.textContent}`);
  });
});

// Abas de Prévia: Texto vs Arte
tabTextBtn.addEventListener('click', () => {
  tabTextBtn.classList.add('active');
  tabArtBtn.classList.remove('active');
  previewTextContainer.hidden = false;
  previewArtContainer.hidden = true;
});

tabArtBtn.addEventListener('click', () => {
  tabArtBtn.classList.add('active');
  tabTextBtn.classList.remove('active');
  previewTextContainer.hidden = true;
  previewArtContainer.hidden = false;
  updateLiveArtPreview();
});

// Formato da Arte (1:1 vs 9:16)
$$('.format-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    $$('.format-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentArtFormat = pill.dataset.format;
    updateLiveArtPreview();
    showToast(`Formato selecionado: ${pill.textContent}`);
  });
});

// Temas Visuais da Arte
function setArtTheme(theme) {
  currentArtTheme = theme;
  $$('.art-theme-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.theme === theme);
  });
  updateLiveArtPreview();
}

$$('.art-theme-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    setArtTheme(pill.dataset.theme);
    showToast(`Tema visual alterado.`);
  });
});

// Tema Noturno / Descanso Visual da Interface (Padrão: Escuro e confortável para a vista)
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light') {
    document.body.classList.remove('dark-mode');
    document.body.classList.add('light-mode');
    if (themeToggleBtn) themeToggleBtn.querySelector('.theme-icon').textContent = '🌙';
  } else {
    document.body.classList.add('dark-mode');
    document.body.classList.remove('light-mode');
    if (themeToggleBtn) themeToggleBtn.querySelector('.theme-icon').textContent = '☀️';
    if (!saved) localStorage.setItem(THEME_KEY, 'dark');
  }
}

themeToggleBtn?.addEventListener('click', () => {
  const isCurrentlyLight = document.body.classList.contains('light-mode');
  if (isCurrentlyLight) {
    document.body.classList.remove('light-mode');
    document.body.classList.add('dark-mode');
    localStorage.setItem(THEME_KEY, 'dark');
    if (themeToggleBtn) themeToggleBtn.querySelector('.theme-icon').textContent = '☀️';
    showToast('Modo Noturno (Descanso Visual) ativado');
  } else {
    document.body.classList.remove('dark-mode');
    document.body.classList.add('light-mode');
    localStorage.setItem(THEME_KEY, 'light');
    if (themeToggleBtn) themeToggleBtn.querySelector('.theme-icon').textContent = '🌙';
    showToast('Modo Claro Suave ativado');
  }
});

// Copiar texto para Clipboard
async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
    return true;
  }
}

$('#copy-button').addEventListener('click', async () => {
  if (!product) return;
  await copyText(buildMessage());
  $('#share-status').textContent = 'Texto da oferta copiado!';
  showToast('📋 Texto copiado com sucesso! Pronto para colar como legenda.');
});

$('#copy-photo-quick-btn')?.addEventListener('click', async () => {
  if (!product) return;
  const btn = $('#copy-photo-quick-btn');
  btn.disabled = true;
  btn.textContent = 'Copiando...';
  try {
    const canvas = await generateOfferCanvas('feed', currentArtTheme);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Não foi possível gerar a foto.');
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      $('#share-status').textContent = 'Foto da oferta copiada! Vá no WhatsApp e aperte Ctrl+V.';
      showToast('📸 Foto copiada com sucesso! Aperte Ctrl + V no WhatsApp para colar a imagem.');
    } else {
      triggerDownload(blob);
      showToast('Foto baixada no computador.');
    }
  } catch (err) {
    showToast(err.message || 'Erro ao copiar foto.', true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>📸</span> Copiar Foto';
  }
});

// Telegram API Helper
async function postJson(url, data) {
  const targetUrl = apiUrl(url);
  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Não foi possível concluir a operação.');
    return result;
  } catch (err) {
    if (err.message && err.message.includes('Failed to fetch')) {
      throw new Error('Servidor offline. Dê dois cliques em "Iniciar LinkPronto.bat" e acesse por http://127.0.0.1:4174');
    }
    throw err;
  }
}

async function refreshTelegramStatus() {
  try {
    const uid = getActiveUserId();
    const response = await fetch(apiUrl(`/api/telegram/status?userId=${encodeURIComponent(uid)}`), { cache: 'no-store' });
    const result = await response.json();
    const desc = $('#telegram-status-desc');
    const badge = $('#telegram-status-badge');
    const disconnectBtn = $('#telegram-disconnect');

    if (result.configured) {
      if (desc) desc.textContent = `Conectado ao canal/grupo: ${result.chatTitle}`;
      if (badge) {
        badge.textContent = 'Conectado';
        badge.classList.remove('inactive');
      }
      if (disconnectBtn) disconnectBtn.hidden = false;
      const sendBtn = $('#telegram-send-button');
      if (sendBtn) sendBtn.title = `Publicar em ${result.chatTitle}`;
    } else {
      if (desc) desc.textContent = 'Adicione o bot oficial @MossoroOfertasLinkBot como administrador no seu canal';
      if (badge) {
        badge.textContent = 'Não configurado';
        badge.classList.add('inactive');
      }
      if (disconnectBtn) disconnectBtn.hidden = true;
      const sendBtn = $('#telegram-send-button');
      if (sendBtn) sendBtn.title = 'Conecte seu canal do Telegram primeiro';
    }
  } catch { /* Conexão local ainda iniciando */ }
}

$('#telegram-discover')?.addEventListener('click', async () => {
  const button = $('#telegram-discover');
  const token = $('#telegram-token').value.trim();
  const select = $('#telegram-chat');
  button.disabled = true;
  button.textContent = 'Procurando...';

  try {
    const result = await postJson('/api/telegram/chats', { token });
    select.replaceChildren(new Option(result.chats.length ? 'Selecione o grupo' : 'Nenhum grupo apareceu ainda', ''));
    for (const chat of result.chats) select.add(new Option(`${chat.title} (${chat.type})`, chat.id));
    if (!result.chats.length) throw new Error('Adicione o bot ao grupo, envie /start@nome_do_bot e tente novamente.');
    showToast(`${result.chats.length} grupo(s) encontrado(s).`);
  } catch (error) {
    showToast(error.message || 'Não foi possível localizar o grupo.', true);
  } finally {
    button.disabled = false;
    button.textContent = 'Localizar meu grupo';
  }
});

$('#telegram-save')?.addEventListener('click', async () => {
  const button = $('#telegram-save');
  const manualInput = $('#telegram-chat-manual');
  const chatId = (manualInput?.value || '').trim();
  if (!chatId) {
    showToast('Digite o @ ou link do seu canal do Telegram primeiro!', true);
    manualInput?.focus();
    return;
  }
  button.disabled = true;
  button.textContent = 'Conectando ao canal...';
  try {
    const result = await postJson('/api/telegram/config', {
      userId: getActiveUserId(),
      token: ($('#telegram-token')?.value || '').trim(),
      chatId,
    });
    $('#share-status').textContent = `Telegram conectado ao canal ${result.chatTitle}.`;
    showToast(`✅ Conectado com sucesso ao canal "${result.chatTitle}"!`);
    await refreshTelegramStatus();
  } catch (error) {
    showToast(error.message || 'Não foi possível conectar ao Telegram.', true);
  } finally {
    button.disabled = false;
    button.textContent = 'Conectar Telegram';
  }
});

$('#telegram-disconnect').addEventListener('click', async () => {
  if (!confirm('Deseja realmente desconectar o bot do Telegram?')) return;
  try {
    await postJson('/api/telegram/disconnect', { userId: getActiveUserId() });
    showToast('Telegram desconectado.');
    await refreshTelegramStatus();
  } catch (error) {
    showToast('Erro ao desconectar: ' + error.message, true);
  }
});

$('#telegram-send-button').addEventListener('click', async () => {
  if (!checkAuthAccess()) return;
  if (!product) return;
  const button = $('#telegram-send-button');
  button.disabled = true;
  const originalHtml = button.innerHTML;
  button.textContent = 'Enviando...';

  try {
    const result = await postJson('/api/telegram/send', {
      userId: getActiveUserId(),
      title: currentTitle(),
      price: parseCurrencyInput(priceInput),
      originalPrice: parseCurrencyInput(originalPriceInput),
      coupon: cleanText(couponInput.value),
      highlights: product.highlights || [],
      affiliateUrl: product.affiliateUrl,
      image: product.image || '',
    });
    $('#share-status').textContent = result.message;
    showToast(result.message);
  } catch (error) {
    $('#share-status').textContent = error.message || 'Falha ao enviar para o Telegram.';
    showToast(error.message || 'Configure o Telegram antes de enviar.', true);
    if (/Configure o bot/.test(error.message)) $('#whatsapp-section').open = true;
  } finally {
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
});

const DEFAULT_WHATSAPP_GROUP = 'https://chat.whatsapp.com/JpXC7HRpu7N6PmPY6CT8iw';
let whatsappPollInterval = null;
let isWhatsAppSocketConnected = false;

// Elementos da Interface do WhatsApp
const whatsappStartBtn = $('#whatsapp-start-btn');
const whatsappDisconnectedBox = $('#whatsapp-disconnected-box');
const whatsappConnectedBox = $('#whatsapp-connected-box');
const whatsappQrBox = $('#whatsapp-qr-box');
const whatsappQrImg = $('#whatsapp-qr-img');
const qrSpinner = $('#qr-spinner');
const whatsappGroupSelect = $('#whatsapp-group-select');
const whatsappRefreshGroups = $('#whatsapp-refresh-groups');
const whatsappSaveGroupBtn = $('#whatsapp-save-group-btn');
const whatsappDisconnectBtn = $('#whatsapp-disconnect-btn');
const whatsappConnDesc = $('#whatsapp-conn-desc');
const whatsappStatusBadge = $('#whatsapp-status-badge');

async function refreshWhatsAppStatus() {
  try {
    const response = await fetch(apiUrl('/api/whatsapp/status'), { cache: 'no-store' });
    const data = await response.json();
    if (!data.ok) return;

    if (data.status === 'connected') {
      isWhatsAppSocketConnected = true;
      clearInterval(whatsappPollInterval);
      whatsappPollInterval = null;

      whatsappDisconnectedBox.hidden = true;
      whatsappConnectedBox.hidden = false;
      whatsappStatusBadge.textContent = 'Conectado (1 Clique)';
      whatsappStatusBadge.classList.remove('inactive');
      whatsappConnDesc.textContent = `Conectado como ${data.user?.name || data.user?.id?.split(':')[0] || 'Usuário'}`;

      whatsappQuickButton.innerHTML = '<span>💬</span> Enviar no WhatsApp (1 Clique)';
      whatsappQuickButton.title = 'Disparar foto e texto diretamente no grupo em 1 clique';

      // Se ainda não carregou os grupos, carregar
      if (whatsappGroupSelect && whatsappGroupSelect.options.length <= 1) {
        await loadWhatsAppGroups(data.selectedGroup);
      }
    } else if (data.status === 'qr_ready' && data.qrCode) {
      isWhatsAppSocketConnected = false;
      whatsappDisconnectedBox.hidden = false;
      whatsappConnectedBox.hidden = true;
      whatsappQrBox.hidden = false;
      qrSpinner.hidden = true;
      whatsappQrImg.hidden = false;
      whatsappQrImg.src = data.qrCode;
      whatsappStatusBadge.textContent = 'Escanear QR';
      whatsappStatusBadge.classList.add('inactive');
      whatsappConnDesc.textContent = 'Aponte a câmera do WhatsApp para o QR Code';

      // Inicia verificação rápida de conexão
      if (!whatsappPollInterval) {
        whatsappPollInterval = setInterval(refreshWhatsAppStatus, 2500);
      }
    } else if (data.status === 'connecting') {
      isWhatsAppSocketConnected = false;
      whatsappDisconnectedBox.hidden = false;
      whatsappConnectedBox.hidden = true;
      whatsappQrBox.hidden = false;
      qrSpinner.hidden = false;
      whatsappQrImg.hidden = true;
      whatsappStatusBadge.textContent = 'Conectando...';
      whatsappStatusBadge.classList.add('inactive');

      if (!whatsappPollInterval) {
        whatsappPollInterval = setInterval(refreshWhatsAppStatus, 2500);
      }
    } else {
      isWhatsAppSocketConnected = false;
      clearInterval(whatsappPollInterval);
      whatsappPollInterval = null;

      whatsappDisconnectedBox.hidden = false;
      whatsappConnectedBox.hidden = true;
      whatsappQrBox.hidden = true;
      whatsappStatusBadge.textContent = 'Desconectado';
      whatsappStatusBadge.classList.add('inactive');
      whatsappConnDesc.textContent = 'Conecte via QR Code para disparar sem abrir o app';
      whatsappQuickButton.innerHTML = '<span>💬</span> Enviar no WhatsApp';
    }
  } catch (err) {
    console.warn('Erro ao verificar status do WhatsApp:', err);
  }
}

async function loadWhatsAppGroups(selectedId = null) {
  try {
    const res = await postJson('/api/whatsapp/groups', {});
    if (!res.ok) return;
    const groups = res.groups || [];
    whatsappGroupSelect.replaceChildren(new Option(groups.length ? 'Selecione seu grupo de ofertas' : 'Nenhum grupo encontrado', ''));

    groups.forEach(g => {
      const opt = new Option(`${g.name} (${g.participantsCount} membros)`, g.id);
      if (selectedId && g.id === selectedId) opt.selected = true;
      whatsappGroupSelect.add(opt);
    });

    if (selectedId) whatsappGroupSelect.value = selectedId;
  } catch (e) {
    console.warn('Erro ao listar grupos:', e);
  }
}

whatsappStartBtn?.addEventListener('click', async () => {
  whatsappStartBtn.disabled = true;
  whatsappStartBtn.textContent = 'Gerando QR Code...';

  // Exibe imediatamente a caixa do QR Code com o indicador de carregamento
  if (whatsappDisconnectedBox) whatsappDisconnectedBox.hidden = false;
  if (whatsappConnectedBox) whatsappConnectedBox.hidden = true;
  if (whatsappQrBox) whatsappQrBox.hidden = false;
  if (qrSpinner) qrSpinner.hidden = false;
  if (whatsappQrImg) whatsappQrImg.hidden = true;
  if (whatsappStatusBadge) {
    whatsappStatusBadge.textContent = 'Gerando QR...';
    whatsappStatusBadge.classList.add('inactive');
  }
  if (whatsappConnDesc) {
    whatsappConnDesc.textContent = 'Conectando aos servidores do WhatsApp para gerar o QR Code...';
  }

  try {
    const res = await postJson('/api/whatsapp/start', { forceNew: true });
    if (res && res.status === 'qr_ready' && res.qrCode) {
      if (whatsappQrImg) {
        whatsappQrImg.src = res.qrCode;
        whatsappQrImg.hidden = false;
      }
      if (qrSpinner) qrSpinner.hidden = true;
      if (whatsappStatusBadge) whatsappStatusBadge.textContent = 'Escanear QR';
      if (whatsappConnDesc) whatsappConnDesc.textContent = 'Aponte a câmera do WhatsApp para o QR Code abaixo:';
    } else {
      showToast('Aguarde alguns segundos enquanto o WhatsApp gera o QR Code...');
    }

    if (whatsappPollInterval) clearInterval(whatsappPollInterval);
    whatsappPollInterval = setInterval(refreshWhatsAppStatus, 2000);
  } catch (err) {
    showToast('Erro ao iniciar WhatsApp: ' + err.message, true);
    if (qrSpinner) qrSpinner.hidden = true;
  } finally {
    whatsappStartBtn.disabled = false;
    whatsappStartBtn.innerHTML = '<span>📲</span> Conectar WhatsApp (Gerar QR Code)';
  }
});

whatsappRefreshGroups?.addEventListener('click', async () => {
  whatsappRefreshGroups.disabled = true;
  showToast('Atualizando lista de grupos...');
  await loadWhatsAppGroups(whatsappGroupSelect.value);
  whatsappRefreshGroups.disabled = false;
  showToast('Lista de grupos atualizada!');
});

whatsappSaveGroupBtn?.addEventListener('click', async () => {
  const groupId = whatsappGroupSelect.value;
  const groupName = whatsappGroupSelect.options[whatsappGroupSelect.selectedIndex]?.text || '';
  if (!groupId) {
    showToast('Selecione um grupo da lista primeiro!', true);
    return;
  }
  whatsappSaveGroupBtn.disabled = true;
  try {
    await postJson('/api/whatsapp/config', { groupId, groupName });
    showToast(`Grupo ${groupName} configurado para disparo automático em 1 clique!`);
    await refreshWhatsAppStatus();
  } catch (err) {
    showToast('Erro ao salvar grupo: ' + err.message, true);
  } finally {
    whatsappSaveGroupBtn.disabled = false;
  }
});

whatsappDisconnectBtn?.addEventListener('click', async () => {
  if (!confirm('Deseja realmente desconectar a sessão do WhatsApp?')) return;
  whatsappDisconnectBtn.disabled = true;
  try {
    await postJson('/api/whatsapp/disconnect', {});
    showToast('WhatsApp desconectado.');
    await refreshWhatsAppStatus();
  } catch (err) {
    showToast('Erro ao desconectar: ' + err.message, true);
  } finally {
    whatsappDisconnectBtn.disabled = false;
  }
});

// Helper para obter Blob da foto original limpa do produto (Padrão Telegram - sem molduras de flyer)
async function getCleanProductBlob(imageUrl) {
  if (!imageUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        c.toBlob((blob) => resolve(blob), 'image/png');
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = async () => {
      try {
        const pRes = await fetch(apiUrl(`/api/image?url=${encodeURIComponent(imageUrl)}`));
        if (pRes.ok) {
          const blob = await pRes.blob();
          return resolve(blob);
        }
      } catch (e) {}
      resolve(null);
    };
    img.src = imageUrl.startsWith('data:') ? imageUrl : apiUrl(`/api/image?url=${encodeURIComponent(imageUrl)}`);
  });
}

// Envio para WhatsApp (1 Clique Real se Conectado / Fallback se não conectado) - PADRÃO TELEGRAM
whatsappQuickButton?.addEventListener('click', async () => {
  if (!checkAuthAccess()) return;
  if (!product) return;
  const button = whatsappQuickButton;
  button.disabled = true;
  const originalHtml = button.innerHTML;
  button.textContent = 'Enviando no WhatsApp...';

  try {
    const cleanImageUrl = product?.image || '';
    const message = buildMessage();

    if (isWhatsAppSocketConnected) {
      // DISPARO 100% AUTOMÁTICO VIA SOCKET EM 1 CLIQUE COM FOTO LIMPA E PROFISSIONAL (PADRÃO TELEGRAM)
      const res = await postJson('/api/whatsapp/send', {
        image: cleanImageUrl,
        caption: message
      });
      $('#share-status').textContent = res.message || 'Oferta enviada no grupo do WhatsApp!';
      showToast('🔥 ' + (res.message || 'Oferta enviada com sucesso no grupo do WhatsApp!'));
    } else {
      // MODO MANUAL: Copia a foto limpa e profissional do produto (Padrão Telegram) para a área de transferência
      let copiedPhoto = false;
      if (cleanImageUrl) {
        const blob = await getCleanProductBlob(cleanImageUrl);
        if (navigator.clipboard && window.ClipboardItem && blob) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          copiedPhoto = true;
        }
      }

      const key = getUserStorageKey(WHATSAPP_KEY);
      const targetGroup = localStorage.getItem(key) || (getActiveUserId() === 'default' ? DEFAULT_WHATSAPP_GROUP : '');
      if (targetGroup) {
        window.open(targetGroup, '_blank');
        $('#share-status').textContent = copiedPhoto
          ? 'Foto do produto copiada! No WhatsApp, aperte Ctrl + V para colar a foto limpa e envie com a legenda.'
          : 'Abrindo o grupo do WhatsApp...';
        showToast(copiedPhoto
          ? '📸 Foto profissional limpa copiada! Aperte Ctrl + V no WhatsApp.'
          : '⚡ Abrindo WhatsApp...');
      } else {
        showToast('⚠️ Configure o link do seu grupo do WhatsApp na aba "WhatsApp & Canais" primeiro!', true);
        const section = $('#whatsapp-section');
        if (section) section.scrollIntoView({ behavior: 'smooth' });
      }
    }
  } catch (err) {
    $('#share-status').textContent = err.message || 'Falha ao enviar para o WhatsApp.';
    showToast('Erro no WhatsApp: ' + err.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
});

function applyGroupLink(link) {
  const topbarLink = $('#topbar-wpp-link');
  const btnOpen = $('#btn-open-group-link');
  const linkedName = $('#linked-group-name');
  const clean = String(link || '').trim();

  if (topbarLink) {
    topbarLink.href = clean || '#whatsapp-section';
    if (!clean) topbarLink.removeAttribute('target');
    else topbarLink.setAttribute('target', '_blank');
  }
  if (btnOpen) {
    btnOpen.href = clean || '#whatsapp-section';
    if (!clean) btnOpen.removeAttribute('target');
    else btnOpen.setAttribute('target', '_blank');
  }
  if (linkedName) {
    linkedName.textContent = clean ? 'Grupo Vinculado' : 'Não configurado';
  }
  if (whatsappGroupInput && document.activeElement !== whatsappGroupInput) {
    whatsappGroupInput.value = clean;
  }
}

// Salvar Link Oficial do Grupo
saveWhatsappBtn?.addEventListener('click', async () => {
  const uid = getActiveUserId();
  const link = (whatsappGroupInput?.value || '').trim();
  const key = getUserStorageKey(WHATSAPP_KEY);
  if (link) {
    localStorage.setItem(key, link);
  } else {
    localStorage.removeItem(key);
  }
  applyGroupLink(link);
  showToast(link ? '✅ Link do grupo salvo com sucesso!' : 'Link removido.');

  if (uid !== 'visitor' && uid !== 'default') {
    try {
      await postJson('/api/settings', { userId: uid, whatsappGroupLink: link });
    } catch {}
  } else if (uid === 'default') {
    try {
      await postJson('/api/queue/config', { whatsappGroupLink: link });
    } catch {}
  }
});

// Navegação suave da Sidebar para Seções
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    const targetId = anchor.getAttribute('href');
    if (!targetId || targetId === '#' || targetId === '#inicio') return;
    const targetEl = document.querySelector(targetId);
    if (targetEl) {
      e.preventDefault();
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (targetId === '#whatsapp-section') {
        setTimeout(() => whatsappGroupInput?.focus(), 300);
      }
    }
  });
});

// GERAÇÃO DE ARTES (CANVAS 2D - FEED 1:1 E STORY 9:16)
function wrapCanvasText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawTextBlock(ctx, text, x, y, width, lineHeight, limit = Infinity) {
  let lines = wrapCanvasText(ctx, text, width);
  if (lines.length > limit) {
    lines = lines.slice(0, limit);
    const last = lines.length - 1;
    while (lines[last].length && ctx.measureText(`${lines[last]}…`).width > width) lines[last] = lines[last].slice(0, -1);
    lines[last] += '…';
  }
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return lines.length;
}

function loadImage(src) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    if (src.startsWith('data:image/')) {
      image.src = src;
    } else {
      image.src = apiUrl(`/api/image?url=${encodeURIComponent(src)}`);
    }
  });
}

async function generateOfferCanvas(format = 'feed', theme = 'purple', customProduct = null) {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch {}
  }

  const isFeed = format === 'feed';
  const width = 1080;
  const height = isFeed ? 1080 : 1920;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // MODO WHATSAPP / TELEGRAM / FEED (1:1):
  // Foto limpa, real e em altíssima resolução do produto (Padrão Telegram / E-commerce Oficial)
  // Sem textos sobrepostos, sem molduras pesadas e sem preços desenhados na foto.
  if (isFeed) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const productImgSrc = customProduct?.image || product?.image;
    const image = await loadImage(productImgSrc);
    if (image) {
      const padding = 36;
      const maxW = width - (padding * 2);
      const maxH = height - (padding * 2);
      const scale = Math.min(maxW / image.naturalWidth, maxH / image.naturalHeight);
      const w = image.naturalWidth * scale;
      const h = image.naturalHeight * scale;
      ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
    } else {
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#8d86a6';
      ctx.textAlign = 'center';
      ctx.font = '600 32px "DM Sans", Arial, sans-serif';
      ctx.fillText('Foto do produto no anúncio', width / 2, height / 2);
    }
    return canvas;
  }

  // MODO STORY (9:16) PARA INSTAGRAM:
  let primaryColor = '#7150ed';
  let primaryDark = '#5c3bd1';
  let bgGradientStart = '#f5efff';
  let bgGradientEnd = '#eaf5f1';
  let cardBg = '#ffffff';
  let textDark = '#1e1a2f';
  let isDarkTheme = theme === 'dark';

  if (theme === 'shopee') {
    primaryColor = '#ee4d2d';
    primaryDark = '#d03e20';
    bgGradientStart = '#fff2ee';
    bgGradientEnd = '#fff8f2';
  } else if (theme === 'meli') {
    primaryColor = '#2d3277';
    primaryDark = '#1c2054';
    bgGradientStart = '#fffbe6';
    bgGradientEnd = '#f6f7fb';
  } else if (theme === 'dark') {
    primaryColor = '#9d7bfa';
    primaryDark = '#7150ed';
    bgGradientStart = '#161423';
    bgGradientEnd = '#0f0d18';
    cardBg = '#1e1b2d';
    textDark = '#ffffff';
  }

  // Fundo
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, bgGradientStart);
  bgGrad.addColorStop(1, bgGradientEnd);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Topo: Marca e Badge da Loja
  ctx.fillStyle = primaryColor;
  ctx.beginPath();
  ctx.roundRect(72, 76, 68, 68, 20);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 36px "Manrope", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('M', 106, 124);

  ctx.textAlign = 'left';
  ctx.fillStyle = textDark;
  ctx.font = '800 28px "Manrope", Arial, sans-serif';
  ctx.fillText('MOSSORÓ OFERTAS', 158, 108);

  ctx.fillStyle = isDarkTheme ? '#a59ec2' : '#7f7b8f';
  ctx.font = '600 17px "DM Sans", Arial, sans-serif';
  ctx.fillText('ACHADOS & PREÇOS BAIXOS', 158, 136);

  // Badge da Loja
  const storeName = (customProduct?.store || product?.store || 'OFERTA').toLocaleUpperCase('pt-BR');
  const storeBadgeX = width - 340;
  ctx.fillStyle = primaryColor;
  ctx.beginPath();
  ctx.roundRect(storeBadgeX, 80, 268, 48, 24);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 18px "Manrope", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`🔥 ${storeName}`, storeBadgeX + 134, 111);
  ctx.textAlign = 'left';

  // Caixa Central do Produto
  const boxX = 60;
  const boxY = 200;
  const boxW = width - (boxX * 2);
  const boxH = 1050;

  ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = cardBg;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 36);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.strokeStyle = isDarkTheme ? '#2f2b44' : '#ebe5f5';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Imagem do Produto
  const imgBox = {
    x: boxX + 40,
    y: boxY + 36,
    w: boxW - 80,
    h: 540
  };

  const productImgSrc = customProduct?.image || product?.image;
  const image = await loadImage(productImgSrc);
  if (image) {
    const scale = Math.min(imgBox.w / image.naturalWidth, imgBox.h / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, imgBox.x + (imgBox.w - w) / 2, imgBox.y + (imgBox.h - h) / 2, w, h);
  } else {
    ctx.fillStyle = isDarkTheme ? '#262238' : '#f6f3fc';
    ctx.beginPath();
    ctx.roundRect(imgBox.x, imgBox.y, imgBox.w, imgBox.h, 20);
    ctx.fill();
    ctx.fillStyle = isDarkTheme ? '#8d86a6' : '#9b94aa';
    ctx.textAlign = 'center';
    ctx.font = '600 28px "DM Sans", Arial, sans-serif';
    ctx.fillText('Foto do produto no anúncio', imgBox.x + (imgBox.w / 2), imgBox.y + (imgBox.h / 2));
    ctx.textAlign = 'left';
  }

  // Preço e Desconto
  const price = customProduct ? Number(customProduct.price) : parseCurrencyInput(priceInput);
  const originalPrice = customProduct ? Number(customProduct.originalPrice) : parseCurrencyInput(originalPriceInput);
  const discount = customProduct
    ? (Number.isFinite(originalPrice) && originalPrice > price && Number.isFinite(price) && price > 0
        ? { valid: true, percent: Math.round(((originalPrice - price) / originalPrice) * 100) }
        : { valid: false, percent: 0 })
    : calculateDiscount();

  // Selo de Desconto
  if (discount.valid) {
    ctx.fillStyle = '#ff4757';
    ctx.beginPath();
    ctx.roundRect(imgBox.x + 10, imgBox.y + 10, 160, 48, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 22px "Manrope", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`-${discount.percent}% OFF`, imgBox.x + 90, imgBox.y + 42);
    ctx.textAlign = 'left';
  }

  // Título do Produto
  const titleText = customProduct?.title || currentTitle();
  const titleY = imgBox.y + imgBox.h + 46;
  ctx.fillStyle = textDark;
  ctx.font = '800 36px "Manrope", Arial, sans-serif';
  drawTextBlock(ctx, titleText, boxX + 40, titleY, boxW - 80, 48, 2);

  // Preço De / Por
  const priceY = titleY + 140;

  if (discount.valid) {
    ctx.fillStyle = isDarkTheme ? '#9b94b0' : '#8f8a9e';
    ctx.font = '600 28px "DM Sans", Arial, sans-serif';
    ctx.fillText(`De: ${formatPrice(originalPrice)}`, boxX + 40, priceY - 12);

    ctx.fillStyle = primaryColor;
    ctx.font = '800 62px "Manrope", Arial, sans-serif';
    ctx.fillText(`Por: ${formatPrice(price)}`, boxX + 40, priceY + 46);
  } else if (Number.isFinite(price) && price > 0) {
    ctx.fillStyle = primaryColor;
    ctx.font = '800 64px "Manrope", Arial, sans-serif';
    ctx.fillText(formatPrice(price), boxX + 40, priceY + 36);
  } else {
    ctx.fillStyle = primaryColor;
    ctx.font = '700 38px "Manrope", Arial, sans-serif';
    ctx.fillText('Confira o preço na loja', boxX + 40, priceY + 36);
  }

  // Cupom
  const coupon = customProduct ? String(customProduct.coupon || '').trim() : cleanText(couponInput.value);
  if (coupon) {
    const couponY = priceY + 76;
    ctx.fillStyle = isDarkTheme ? '#352514' : '#fff4e5';
    ctx.beginPath();
    ctx.roundRect(boxX + 40, couponY, boxW - 80, 52, 16);
    ctx.fill();
    ctx.fillStyle = '#ff8800';
    ctx.font = '800 22px "Manrope", Arial, sans-serif';
    ctx.fillText(`🎟️ CUPOM: ${coupon}`, boxX + 64, couponY + 34);
  }

  // Rodapé do Story (9:16)
  ctx.fillStyle = cardBg;
  ctx.beginPath();
  ctx.roundRect(72, 1330, width - 144, 175, 34);
  ctx.fill();
  ctx.strokeStyle = isDarkTheme ? '#37324e' : '#dfd6f3';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = textDark;
  ctx.font = '800 36px "Manrope", Arial, sans-serif';
  ctx.fillText('Gostou? Toque no adesivo de link 👆', 120, 1395);

  ctx.fillStyle = isDarkTheme ? '#9b94b2' : '#736f82';
  ctx.font = '500 26px "DM Sans", Arial, sans-serif';
  ctx.fillText('e vá direto para a página oficial do produto.', 120, 1445);

  ctx.fillStyle = isDarkTheme ? '#6d6785' : '#a6a1b2';
  ctx.font = '600 20px "DM Sans", Arial, sans-serif';
  ctx.fillText('MOSSORÓ OFERTAS • ACHADOS VERIFICADOS', 72, 1860);

  return canvas;
}

// Atualizar Miniatura da Arte ao Vivo
async function updateLiveArtPreview() {
  if (!product) return;
  try {
    const fullCanvas = await generateOfferCanvas(currentArtFormat, currentArtTheme);
    liveCanvasPreview.width = fullCanvas.width;
    liveCanvasPreview.height = fullCanvas.height;
    const ctx = liveCanvasPreview.getContext('2d');
    ctx.drawImage(fullCanvas, 0, 0);
  } catch (e) {
    console.warn('Erro ao atualizar miniatura da arte:', e);
  }
}

// Botão Copiar Imagem (Ctrl+V)
$('#copy-story-button').addEventListener('click', async () => {
  if (!product) return;
  const button = $('#copy-story-button');
  button.disabled = true;
  const originalHtml = button.innerHTML;
  button.textContent = 'Gerando arte...';

  try {
    const canvas = await generateOfferCanvas(currentArtFormat, currentArtTheme);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Não foi possível gerar a imagem.');

    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      $('#share-status').textContent = 'Foto copiada! Vá no WhatsApp e aperte Ctrl+V.';
      showToast('📸 Foto copiada com sucesso! Aperte Ctrl + V no WhatsApp para colar.');
    } else {
      triggerDownload(blob);
      showToast('Imagem baixada com sucesso.');
    }
  } catch (error) {
    showToast(error.message || 'Erro ao copiar imagem.', true);
  } finally {
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
});

function triggerDownload(blob) {
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  const formatName = currentArtFormat === 'feed' ? 'quadrado-whatsapp' : 'story';
  anchor.download = `mossoro-oferta-${formatName}-${Date.now()}.png`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
}

// Botão Baixar Imagem PNG
$('#download-story-button').addEventListener('click', async () => {
  if (!product) return;
  const button = $('#download-story-button');
  button.disabled = true;
  const originalHtml = button.innerHTML;
  button.textContent = 'Preparando...';

  try {
    const canvas = await generateOfferCanvas(currentArtFormat, currentArtTheme);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Não foi possível gerar a imagem.');
    triggerDownload(blob);
    await copyText(product.affiliateUrl);
    $('#share-status').textContent = 'Arte baixada e link copiado!';
    showToast('Arte baixada e link de afiliado copiado.');
  } catch (error) {
    showToast(error.message || 'Erro ao baixar o arquivo.', true);
  } finally {
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
});

// Gerenciamento e Upload de Imagem do Produto
const imageFileInput = $('#image-file-input');
const changeImageBtn = $('#change-image-btn');
const imageDropzone = $('#image-dropzone');

changeImageBtn?.addEventListener('click', () => {
  imageFileInput?.click();
});

imageDropzone?.addEventListener('click', () => {
  imageFileInput?.click();
});

imageFileInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    const dataUrl = event.target.result;
    if (product) product.image = dataUrl;
    setImage(dataUrl);
    showToast('Foto do produto adicionada com sucesso!');
  };
  reader.readAsDataURL(file);
});

// Suporte a colar foto diretamente com Ctrl + V em qualquer lugar da tela
document.addEventListener('paste', (e) => {
  if (!productSection || productSection.hidden) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target.result;
          if (product) product.image = dataUrl;
          setImage(dataUrl);
          showToast('Foto colada da área de transferência!');
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  }
});

// Atalhos Globais de Teclado
document.addEventListener('keydown', (e) => {
  // Ctrl + Shift + C para copiar texto
  if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
    e.preventDefault();
    if (product) {
      copyText(buildMessage());
      showToast('Texto copiado via atalho!');
    }
  }
  // Ctrl + Shift + I para copiar imagem
  if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
    e.preventDefault();
    $('#copy-story-button')?.click();
  }
});

// ==========================================
// PILOTO AUTOMÁTICO (DISPAROS AGENDADOS NA FILA)
// ==========================================

const addToQueueBtn = $('#add-to-queue-btn');
const pilotoSection = $('#piloto-section');
const pilotoStatusBadge = $('#piloto-status-badge');
const pilotoTimerText = $('#piloto-timer-text');
const queueIntervalSelect = $('#queue-interval-select');
const queueStartTime = $('#queue-start-time');
const queueEndTime = $('#queue-end-time');
const pilotoCloudBadge = $('#piloto-cloud-badge');
const queueCheckWhatsApp = $('#queue-check-whatsapp');
const queueCheckTelegram = $('#queue-check-telegram');
const startPilotoBtn = $('#start-piloto-btn');
const pausePilotoBtn = $('#pause-piloto-btn');
const clearPilotoBtn = $('#clear-piloto-btn');
const bulkLinksInput = $('#bulk-links-input');
const bulkImportBtn = $('#bulk-import-btn');
const bulkProgressText = $('#bulk-progress-text');
const queueCountText = $('#queue-count-text');
const queueDurationText = $('#queue-duration-text');
const queueItemsGrid = $('#queue-items-grid');
const pilotoHistoryContainer = $('#piloto-history-container');
const pilotoHistoryList = $('#piloto-history-list');
const navQueueBadge = $('#nav-queue-badge');

let queueStateCache = null;

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function refreshQueueStatus() {
  if (!currentAuthUser) {
    if (navQueueBadge) navQueueBadge.hidden = true;
    return;
  }
  try {
    const uid = getActiveUserId();
    const res = await fetch(apiUrl(`/api/queue/status?userId=${encodeURIComponent(uid)}`), { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) return;
    queueStateCache = data;
    renderQueueUI(data);
  } catch (err) {
    // Falha silenciosa em caso de servidor iniciando
  }
}

function renderQueueUI(status) {
  if (!status) return;

  if (!currentAuthUser) {
    if (navQueueBadge) navQueueBadge.hidden = true;
    return;
  }

  const count = Number(status.queueCount ?? (status.items ? status.items.length : 0));
  if (queueCountText) queueCountText.textContent = count;

  // Atualiza badge no menu lateral
  if (navQueueBadge) {
    if (count > 0 && currentAuthUser) {
      navQueueBadge.textContent = count;
      navQueueBadge.hidden = false;
    } else {
      navQueueBadge.hidden = true;
    }
  }

  // Tempo estimado
  const interval = Number(status.intervalMinutes || 5);
  if (queueDurationText) {
    const totalMin = count * interval;
    queueDurationText.textContent = `Tempo estimado: ~${totalMin} min (${interval} min por disparo)`;
  }

  // Status Badge e Alternância dos botões Iniciar / Pausar
  if (status.isRunning) {
    if (pilotoStatusBadge) {
      if (status.isWithinOperatingHours === false) {
        pilotoStatusBadge.textContent = '🌙 Aguardando Horário';
        pilotoStatusBadge.style.background = 'rgba(245, 158, 11, 0.15)';
        pilotoStatusBadge.style.color = '#d97706';
        pilotoStatusBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      } else {
        pilotoStatusBadge.textContent = '🟢 Em Execução';
        pilotoStatusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        pilotoStatusBadge.style.color = 'var(--green)';
        pilotoStatusBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      }
    }
    if (startPilotoBtn) startPilotoBtn.hidden = true;
    if (pausePilotoBtn) pausePilotoBtn.hidden = false;
  } else {
    if (pilotoStatusBadge) {
      pilotoStatusBadge.textContent = '⚪ Pausado';
      pilotoStatusBadge.style.background = 'rgba(113, 80, 237, 0.08)';
      pilotoStatusBadge.style.color = 'var(--soft)';
      pilotoStatusBadge.style.borderColor = 'var(--line)';
    }
    if (startPilotoBtn) startPilotoBtn.hidden = false;
    if (pausePilotoBtn) pausePilotoBtn.hidden = true;
  }

  // Preserva seleções caso o usuário não esteja com foco nelas
  if (queueIntervalSelect && document.activeElement !== queueIntervalSelect) {
    queueIntervalSelect.value = String(interval);
  }
  if (queueStartTime && document.activeElement !== queueStartTime && status.startTime) {
    queueStartTime.value = status.startTime;
  }
  if (queueEndTime && document.activeElement !== queueEndTime && status.endTime) {
    queueEndTime.value = status.endTime;
  }
  if (queueCheckWhatsApp && document.activeElement !== queueCheckWhatsApp) {
    queueCheckWhatsApp.checked = status.sendWhatsApp !== false;
  }
  if (queueCheckTelegram && document.activeElement !== queueCheckTelegram) {
    queueCheckTelegram.checked = status.sendTelegram !== false;
  }

  // Renderiza cards da fila
  if (queueItemsGrid) {
    if (!status.items || status.items.length === 0) {
      queueItemsGrid.innerHTML = `
        <div class="queue-empty-state">
          <span>⏳</span>
          <p>Sua fila está vazia no momento.<br>Cole os links acima e clique em <b>"Fila Automática"</b> ou importe vários links abaixo!</p>
        </div>
      `;
    } else {
      queueItemsGrid.innerHTML = status.items.map((item, idx) => {
        const priceFmt = item.price ? formatPrice(item.price) : 'Consulte';
        const img = item.image || '';
        return `
          <div class="queue-item-card" data-id="${escapeHtml(item.id)}">
            <button class="queue-item-del" data-del-id="${escapeHtml(item.id)}" title="Remover da fila">✕</button>
            ${img ? `<img src="${escapeHtml(img)}" class="queue-item-thumb" alt="Foto">` : `<div class="queue-item-thumb" style="display:flex;align-items:center;justify-content:center;font-size:24px;">🛍️</div>`}
            <div class="queue-item-content">
              <span class="queue-item-pos">#${idx + 1} na fila • ${escapeHtml(item.store || 'Oferta')}</span>
              <div class="queue-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
              <div class="queue-item-price">${priceFmt}</div>
            </div>
          </div>
        `;
      }).join('');

      // Evento de exclusão de item individual
      queueItemsGrid.querySelectorAll('[data-del-id]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-del-id');
          try {
            await postJson('/api/queue/remove', { id, userId: getActiveUserId() });
            showToast('Item removido da fila.');
            await refreshQueueStatus();
          } catch (err) {
            showToast('Erro ao remover: ' + err.message, true);
          }
        });
      });
    }
  }

  // Renderiza histórico recente do Piloto
  if (pilotoHistoryContainer && pilotoHistoryList) {
    const history = status.history || [];
    if (history.length > 0) {
      pilotoHistoryContainer.hidden = false;
      pilotoHistoryList.innerHTML = history.slice().reverse().map(h => {
        const time = h.sentAt ? new Date(h.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        const isOk = h.status === 'success';
        return `
          <div class="history-item-row">
            <span style="font-weight:700;">${isOk ? '✅' : '❌'} ${time}</span>
            <span style="flex:1; margin:0 12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(h.title)}">${escapeHtml(h.title)}</span>
            <span style="font-size:11.5px; color:${isOk ? 'var(--green)' : 'var(--red)'}; font-weight:600;">${escapeHtml(h.statusMsg || (isOk ? 'Disparado' : 'Falha'))}</span>
          </div>
        `;
      }).join('');
    } else {
      pilotoHistoryContainer.hidden = true;
    }
  }

  updateCountdown();
}

function updateCountdown() {
  if (!pilotoTimerText) return;
  if (!queueStateCache) return;

  const count = Number(queueStateCache.queueCount ?? (queueStateCache.items ? queueStateCache.items.length : 0));

  if (!queueStateCache.isRunning) {
    pilotoTimerText.textContent = count > 0 ? `Fila aguardando (${count} oferta${count > 1 ? 's' : ''})` : 'Fila vazia';
    return;
  }

  if (count === 0) {
    pilotoTimerText.textContent = 'Fila finalizada!';
    return;
  }

  // Verifica se está fora do horário programado
  if (queueStateCache.isWithinOperatingHours === false) {
    pilotoTimerText.textContent = `🌙 Disparos pausados até às ${queueStateCache.startTime || '08:00'} (Janela: ${queueStateCache.startTime} às ${queueStateCache.endTime})`;
    return;
  }

  if (queueStateCache.nextDispatchAt) {
    const remainingMs = queueStateCache.nextDispatchAt - Date.now();
    if (remainingMs <= 0) {
      pilotoTimerText.textContent = '🚀 Disparando agora...';
      return;
    }

    const totalSeconds = Math.floor(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const pad = n => String(n).padStart(2, '0');
    pilotoTimerText.textContent = `⏳ Próximo disparo em ${pad(minutes)}:${pad(seconds)}`;
  } else {
    pilotoTimerText.textContent = 'Disparando primeira oferta...';
  }
}

// Botão Adicionar à Fila do Produto Atual
addToQueueBtn?.addEventListener('click', async () => {
  if (!checkAuthAccess()) return;
  if (!product) {
    showToast('Busque um produto primeiro para poder adicionar à fila!', true);
    return;
  }

  const button = addToQueueBtn;
  button.disabled = true;
  const originalHtml = button.innerHTML;
  button.textContent = 'Adicionando à fila...';

  try {
    let artImage = product.image || '';
    try {
      const canvas = await generateOfferCanvas('feed', currentArtTheme);
      artImage = canvas.toDataURL('image/jpeg', 0.90);
    } catch (e) {
      console.warn('Usando imagem original do produto para a fila:', e);
    }

    const offerPayload = {
      title: currentTitle(),
      price: parseCurrencyInput(priceInput),
      originalPrice: parseCurrencyInput(originalPriceInput),
      coupon: cleanText(couponInput.value),
      highlights: product.highlights || [],
      affiliateUrl: product.affiliateUrl || '',
      image: product.image || '', // FOTO LIMPA ORIGINAL DO PRODUTO (PADRÃO TELEGRAM)
      artImage: artImage,
      store: product.store || 'Oferta',
      theme: currentArtTheme
    };

    const res = await postJson('/api/queue/add', { ...offerPayload, userId: getActiveUserId() });
    if (!res.ok) throw new Error(res.error || 'Falha ao adicionar à fila.');

    showToast(`✅ Oferta adicionada ao Piloto Automático! (${res.queueCount} na fila)`);
    await refreshQueueStatus();

    // Rola suavemente até a seção do piloto
    pilotoSection?.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    showToast('Erro ao adicionar à fila: ' + err.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = originalHtml;
  }
});

// Botão Iniciar Piloto Automático
startPilotoBtn?.addEventListener('click', async () => {
  if (!checkAuthAccess()) return;
  startPilotoBtn.disabled = true;
  try {
    const res = await postJson('/api/queue/start', { triggerImmediately: true, userId: getActiveUserId() });
    if (!res.ok) throw new Error(res.error || 'Falha ao iniciar.');
    showToast('▶️ Piloto Automático iniciado! Disparando a 1ª oferta...');
    await refreshQueueStatus();
  } catch (err) {
    showToast('Aviso: ' + err.message, true);
  } finally {
    startPilotoBtn.disabled = false;
  }
});

// Botão Pausar Piloto Automático
pausePilotoBtn?.addEventListener('click', async () => {
  pausePilotoBtn.disabled = true;
  try {
    const res = await postJson('/api/queue/pause', { userId: getActiveUserId() });
    showToast('⏸️ Piloto Automático pausado.');
    await refreshQueueStatus();
  } catch (err) {
    showToast('Erro ao pausar: ' + err.message, true);
  } finally {
    pausePilotoBtn.disabled = false;
  }
});

// Botão Limpar Fila
clearPilotoBtn?.addEventListener('click', async () => {
  if (!confirm('Deseja realmente limpar todas as ofertas que estão na fila?')) return;
  clearPilotoBtn.disabled = true;
  try {
    await postJson('/api/queue/clear', { userId: getActiveUserId() });
    showToast('🗑️ Fila limpa com sucesso.');
    await refreshQueueStatus();
  } catch (err) {
    showToast('Erro ao limpar: ' + err.message, true);
  } finally {
    clearPilotoBtn.disabled = false;
  }
});

// Alteração de Intervalo, Horários e Canais
queueIntervalSelect?.addEventListener('change', async () => {
  const intervalMinutes = Number(queueIntervalSelect.value);
  try {
    await postJson('/api/queue/config', { intervalMinutes, userId: getActiveUserId() });
    showToast(`⏱️ Intervalo atualizado para ${intervalMinutes} minutos.`);
    await refreshQueueStatus();
  } catch (err) {
    showToast('Erro ao atualizar intervalo: ' + err.message, true);
  }
});

queueStartTime?.addEventListener('change', async () => {
  const startTime = queueStartTime.value;
  try {
    await postJson('/api/queue/config', { startTime, userId: getActiveUserId() });
    showToast(`⏰ Início dos disparos definido para às ${startTime}.`);
    await refreshQueueStatus();
  } catch (err) {
    showToast('Erro ao atualizar horário: ' + err.message, true);
  }
});

queueEndTime?.addEventListener('change', async () => {
  const endTime = queueEndTime.value;
  try {
    await postJson('/api/queue/config', { endTime, userId: getActiveUserId() });
    showToast(`⏰ Término dos disparos definido para às ${endTime}.`);
    await refreshQueueStatus();
  } catch (err) {
    showToast('Erro ao atualizar horário: ' + err.message, true);
  }
});

queueCheckWhatsApp?.addEventListener('change', async () => {
  try {
    await postJson('/api/queue/config', { sendWhatsApp: queueCheckWhatsApp.checked, userId: getActiveUserId() });
    await refreshQueueStatus();
  } catch (err) {}
});

queueCheckTelegram?.addEventListener('change', async () => {
  try {
    await postJson('/api/queue/config', { sendTelegram: queueCheckTelegram.checked, userId: getActiveUserId() });
    await refreshQueueStatus();
  } catch (err) {}
});

// Importador Rápido de Múltiplos Links
bulkImportBtn?.addEventListener('click', async () => {
  if (!checkAuthAccess()) return;
  const text = bulkLinksInput.value.trim();
  if (!text) {
    showToast('Cole os links dos produtos na caixa de texto primeiro.', true);
    return;
  }

  const rawLines = text.split('\n').map(l => l.trim()).filter(l => /^https?:\/\//i.test(l));
  if (rawLines.length === 0) {
    showToast('Nenhum link válido encontrado (certifique-se de começar com http:// ou https://).', true);
    return;
  }

  bulkImportBtn.disabled = true;
  bulkProgressText.hidden = false;
  let addedCount = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const link = rawLines[i];
    bulkProgressText.textContent = `⏳ Buscando produto ${i + 1} de ${rawLines.length}...`;
    try {
      const res = await fetch(apiUrl(`/api/preview?url=${encodeURIComponent(link)}`));
      const data = await res.json();
      if (data.ok && data.product) {
        const p = data.product;
        await postJson('/api/queue/add', {
          userId: getActiveUserId(),
          title: p.title || 'Oferta imperdível',
          price: p.price,
          originalPrice: p.originalPrice,
          coupon: p.coupon || '',
          highlights: p.highlights || [],
          affiliateUrl: p.affiliateUrl || link,
          image: p.image || '',
          store: p.store || 'Oferta',
          theme: currentArtTheme
        });
        addedCount++;
        bulkProgressText.textContent = `✅ (${addedCount}/${rawLines.length}) Importado: ${p.title?.slice(0, 35)}...`;
      }
    } catch (e) {
      console.warn('Erro ao importar link em lote:', link, e);
    }
  }

  bulkProgressText.textContent = `🎉 Concluído! ${addedCount} ofertas adicionadas à fila.`;
  showToast(`🎉 ${addedCount} ofertas adicionadas à fila do Piloto Automático!`);
  bulkLinksInput.value = '';
  bulkImportBtn.disabled = false;
  setTimeout(() => { bulkProgressText.hidden = true; }, 7000);
  await refreshQueueStatus();
});

// Timer e Sincronização Periódica
setInterval(updateCountdown, 1000);
setInterval(refreshQueueStatus, 5000);

// Limpar erro ao colar novo link
linkInput.addEventListener('paste', () => {
  setTimeout(() => { errorBox.hidden = true; }, 0);
});

// Bloqueio de cliques no menu para visitantes
$$('.nav-list a').forEach(link => {
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href');
    if (href && href !== '#como-funciona' && href !== '#inicio') {
      if (!currentAuthUser) {
        e.preventDefault();
        openLoginModal();
        showToast('🔐 Faça login ou assine por R$ 30 para usar esta ferramenta.', true);
      }
    }
  });
});

// Inicialização do WhatsApp
async function initWhatsApp() {
  const uid = getActiveUserId();
  const key = getUserStorageKey(WHATSAPP_KEY);
  let link = localStorage.getItem(key);

  if (!link && uid === 'default') {
    link = DEFAULT_WHATSAPP_GROUP;
    localStorage.setItem(key, link);
  } else if (!link && uid !== 'visitor') {
    try {
      const res = await fetch(apiUrl(`/api/settings?userId=${encodeURIComponent(uid)}`));
      const data = await res.json();
      if (data.ok && data.settings?.whatsapp_group_link) {
        link = data.settings.whatsapp_group_link;
        localStorage.setItem(key, link);
      }
    } catch (e) {}
  }

  applyGroupLink(link || '');

  const serverBotBox = $('#whatsapp-bot-server-box');
  if (serverBotBox) {
    serverBotBox.style.display = 'block';
  }

  if (uid !== 'visitor') {
    refreshWhatsAppStatus();
  }
}

// ==========================================
// DISPARALINK74 — AUTENTICAÇÃO E ADMINISTRAÇÃO (SAAS)
// ==========================================

const USER_SESSION_KEY = 'disparalink_user_v3';

// Elementos Auth & Topbar
const btnLoginOpen = $('#btn-login-open');
const btnHeroLogin = $('#btn-hero-login');
const userLoggedInfo = $('#user-logged-info');
const userRoleBadge = $('#user-role-badge');
const userNameText = $('#user-name-text');
const userDaysPill = $('#user-days-pill');
const btnLogout = $('#btn-logout');
const navAdminLink = $('#nav-admin-link');
const adminSection = $('#admin-section');
const sideUserAvatar = $('#side-user-avatar');
const sideUserName = $('#side-user-name');
const sideUserRole = $('#side-user-role');
const sideSubInfo = $('#side-sub-info');

// Modais
const loginModal = $('#login-modal');
const btnCloseLoginModal = $('#btn-close-login-modal');
const loginForm = $('#login-form');
const loginEmail = $('#login-email');
const loginPassword = $('#login-password');
const loginErrorBox = $('#login-error-box');

const newUserModal = $('#new-user-modal');
const btnOpenNewUserModal = $('#btn-open-new-user-modal');
const btnCloseNewUserModal = $('#btn-close-new-user-modal');
const newUserForm = $('#new-user-form');
const newUserErrorBox = $('#new-user-error-box');

const expiredModal = $('#expired-modal');
const btnExpiredLogout = $('#btn-expired-logout');
const apresentacaoSection = $('#apresentacao-section');
const appToolsContainer = $('#app-tools-container');
const visitorLockedCard = $('#visitor-locked-card');
const btnLockedLogin = $('#btn-locked-login');
const sideLabelFerramentas = $('#side-label-ferramentas');
const sideToolsNav = $('#side-tools-nav');
const sideVisitorBuy = $('#side-visitor-buy');
const sideVisitorLogin = $('#side-visitor-login');

// Elementos Admin
const metricTotalUsers = $('#metric-total-users');
const metricActiveUsers = $('#metric-active-users');
const metricRevenue = $('#metric-revenue');
const metricExpiredUsers = $('#metric-expired-users');
const adminUsersList = $('#admin-users-list');
const btnRefreshUsers = $('#btn-refresh-users');

function checkAuthAccess() {
  if (!currentAuthUser) {
    openLoginModal();
    showToast('🔐 Faça login com sua conta ou assine por R$ 30 para usar a ferramenta.', true);
    return false;
  }
  if (currentAuthUser.isExpired && currentAuthUser.role !== 'admin') {
    if (expiredModal) {
      expiredModal.hidden = false;
      expiredModal.style.display = 'flex';
    }
    showToast('⏰ Seu acesso de 30 dias expirou. Renove pelo WhatsApp.', true);
    return false;
  }
  return true;
}

async function refreshUserWorkspace() {
  await Promise.allSettled([
    initWhatsApp(),
    refreshTelegramStatus(),
    refreshQueueStatus(),
    renderHistory()
  ]);
}

function loadSession() {
  try {
    const saved = localStorage.getItem(USER_SESSION_KEY);
    if (saved) {
      currentAuthUser = JSON.parse(saved);
    } else {
      currentAuthUser = null;
    }
  } catch (e) {
    currentAuthUser = null;
  }
  updateAuthUI();
}

function saveSession(user) {
  currentAuthUser = user;
  localStorage.setItem(USER_SESSION_KEY, JSON.stringify(user));
  updateAuthUI();
  refreshUserWorkspace();
}

function clearSession() {
  currentAuthUser = null;
  localStorage.removeItem(USER_SESSION_KEY);
  if (expiredModal) {
    expiredModal.hidden = true;
    expiredModal.style.display = 'none';
  }
  updateAuthUI();
  refreshUserWorkspace();
}

function updateAuthUI() {
  if (currentAuthUser) {
    if (btnLoginOpen) btnLoginOpen.hidden = true;
    if (userLoggedInfo) userLoggedInfo.hidden = false;
    if (apresentacaoSection) apresentacaoSection.hidden = true;
    if (visitorLockedCard) {
      visitorLockedCard.hidden = true;
      visitorLockedCard.style.display = 'none';
    }
    if (appToolsContainer) {
      appToolsContainer.hidden = false;
      appToolsContainer.style.display = 'block';
    }
    if (sideLabelFerramentas) sideLabelFerramentas.hidden = false;
    if (sideToolsNav) sideToolsNav.hidden = false;
    if (sideVisitorBuy) sideVisitorBuy.hidden = true;
    if (sideVisitorLogin) sideVisitorLogin.hidden = true;

    const isAdmin = currentAuthUser.role === 'admin';
    if (userNameText) userNameText.textContent = currentAuthUser.name?.split(' ')[0] || 'Usuário';

    if (userRoleBadge) {
      userRoleBadge.textContent = isAdmin ? '👑 Admin' : '👤 Assinante';
      userRoleBadge.style.background = isAdmin ? 'rgba(236, 72, 153, 0.15)' : 'rgba(113, 80, 237, 0.12)';
      userRoleBadge.style.color = isAdmin ? '#db2777' : 'var(--purple)';
    }

    if (userDaysPill) {
      if (isAdmin) {
        userDaysPill.textContent = 'Acesso Vitalício';
        userDaysPill.className = 'user-days-pill';
      } else {
        const days = Number(currentAuthUser.daysLeft ?? 30);
        userDaysPill.textContent = `${days} dias`;
        userDaysPill.className = 'user-days-pill' + (days <= 0 ? ' expired' : days <= 5 ? ' warn' : '');
      }
    }

    // Sidebar
    if (sideUserName) sideUserName.textContent = currentAuthUser.name?.slice(0, 16) || 'DISPARALINK74';
    if (sideUserAvatar) sideUserAvatar.textContent = (currentAuthUser.name?.[0] || 'D').toUpperCase();
    if (sideUserRole) sideUserRole.textContent = isAdmin ? 'Administrador Master' : 'Assinante Ativo';
    if (sideSubInfo) sideSubInfo.textContent = isAdmin ? 'Controle Total' : `${currentAuthUser.daysLeft || 30} Dias Restantes`;

    // Painel Admin exclusivo
    if (navAdminLink) navAdminLink.hidden = !isAdmin;
    if (adminSection && isAdmin) {
      adminSection.hidden = false;
      loadAdminUsers();
    } else if (adminSection) {
      adminSection.hidden = true;
    }

    // Paywall para clientes vencidos
    if (currentAuthUser.isExpired && !isAdmin) {
      if (expiredModal) {
        expiredModal.hidden = false;
        expiredModal.style.display = 'flex';
      }
      if (appToolsContainer) {
        appToolsContainer.hidden = true;
        appToolsContainer.style.display = 'none';
      }
    } else {
      if (expiredModal) {
        expiredModal.hidden = true;
        expiredModal.style.display = 'none';
      }
    }
  } else {
    if (btnLoginOpen) btnLoginOpen.hidden = false;
    if (userLoggedInfo) userLoggedInfo.hidden = true;
    if (navAdminLink) navAdminLink.hidden = true;
    if (adminSection) adminSection.hidden = true;
    if (apresentacaoSection) apresentacaoSection.hidden = false;
    if (visitorLockedCard) {
      visitorLockedCard.hidden = false;
      visitorLockedCard.style.display = 'block';
    }
    if (appToolsContainer) {
      appToolsContainer.hidden = true;
      appToolsContainer.style.display = 'none';
    }
    if (sideLabelFerramentas) sideLabelFerramentas.hidden = true;
    if (sideToolsNav) sideToolsNav.hidden = true;
    if (navQueueBadge) navQueueBadge.hidden = true;
    if (sideVisitorBuy) sideVisitorBuy.hidden = false;
    if (sideVisitorLogin) sideVisitorLogin.hidden = false;

    if (expiredModal) {
      expiredModal.hidden = true;
      expiredModal.style.display = 'none';
    }

    if (sideUserName) sideUserName.textContent = 'DISPARALINK74';
    if (sideUserAvatar) sideUserAvatar.textContent = 'D';
    if (sideUserRole) sideUserRole.textContent = 'Visitante';
    if (sideSubInfo) sideSubInfo.textContent = 'Assine por R$ 30';
  }
}

btnLockedLogin?.addEventListener('click', openLoginModal);
sideVisitorLogin?.addEventListener('click', openLoginModal);

// Modal de Login
function openLoginModal() {
  if (loginErrorBox) loginErrorBox.hidden = true;
  if (loginModal) loginModal.hidden = false;
  loginEmail?.focus();
}

function closeLoginModal() {
  if (loginModal) loginModal.hidden = true;
}

btnLoginOpen?.addEventListener('click', openLoginModal);
btnHeroLogin?.addEventListener('click', openLoginModal);
btnCloseLoginModal?.addEventListener('click', closeLoginModal);
loginModal?.addEventListener('click', (e) => {
  if (e.target === loginModal) closeLoginModal();
});

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = loginEmail.value.trim();
  const password = loginPassword.value.trim();
  const submitBtn = $('#btn-login-submit');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Entrando...';
  if (loginErrorBox) loginErrorBox.hidden = true;

  try {
    const res = await postJson('/api/auth/login', { email, password });
    if (!res.ok) throw new Error(res.error || 'Falha ao entrar.');
    saveSession(res.user);
    closeLoginModal();
    showToast(`Bem-vindo, ${res.user.name}!`);

    if (res.user.isExpired && res.user.role !== 'admin') {
      if (expiredModal) expiredModal.hidden = false;
    } else {
      // Rola até o gerador de ofertas
      $('#criar')?.scrollIntoView({ behavior: 'smooth' });
    }
  } catch (err) {
    if (loginErrorBox) {
      loginErrorBox.textContent = err.message || 'Erro ao realizar login.';
      loginErrorBox.hidden = false;
    }
    showToast(err.message, true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>🚀</span> Entrar Agora';
  }
});

btnLogout?.addEventListener('click', () => {
  if (confirm('Deseja realmente sair da sua conta?')) {
    clearSession();
    showToast('Você saiu da sua conta.');
  }
});

btnExpiredLogout?.addEventListener('click', () => {
  clearSession();
  if (expiredModal) expiredModal.hidden = true;
});

// ==========================================
// GESTÃO DE CLIENTES (ADMIN PANEL)
// ==========================================

async function loadAdminUsers() {
  if (!currentAuthUser || currentAuthUser.role !== 'admin') return;
  if (adminUsersList) adminUsersList.innerHTML = '<div class="users-loading">Carregando lista de assinantes...</div>';

  try {
    const res = await fetch(apiUrl('/api/admin/users'), { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    const users = data.users || [];
    renderAdminUsers(users);
  } catch (err) {
    if (adminUsersList) {
      adminUsersList.innerHTML = `<div style="color:var(--red); padding:14px;">Erro ao carregar clientes: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function renderAdminUsers(users) {
  const clients = users.filter(u => u.role !== 'admin');
  const activeClients = clients.filter(u => u.status === 'active' && u.daysLeft > 0);
  const expiredClients = clients.filter(u => u.status === 'expired' || u.daysLeft <= 0 || u.status === 'blocked');

  if (metricTotalUsers) metricTotalUsers.textContent = clients.length;
  if (metricActiveUsers) metricActiveUsers.textContent = activeClients.length;
  if (metricRevenue) metricRevenue.textContent = `R$ ${activeClients.length * 30},00`;
  if (metricExpiredUsers) metricExpiredUsers.textContent = expiredClients.length;

  if (!adminUsersList) return;

  if (users.length === 0) {
    adminUsersList.innerHTML = `
      <div style="text-align:center; padding:30px; color:var(--muted);">
        Nenhum cliente cadastrado ainda. Clique em <b>+ Cadastrar Novo Assinante</b> para adicionar seu primeiro cliente!
      </div>
    `;
    return;
  }

  adminUsersList.innerHTML = users.map(u => {
    const isAdmin = u.role === 'admin';
    const days = isAdmin ? 9999 : Number(u.daysLeft || 0);
    const isExp = !isAdmin && (days <= 0 || u.status === 'expired');
    const isWarn = !isAdmin && !isExp && days <= 3;
    const whatsClean = String(u.whatsapp || '').replace(/\D/g, '');

    const badgeClass = isAdmin ? 'active' : isExp ? 'expired' : isWarn ? 'warn' : 'active';
    const badgeText = isAdmin ? '👑 Administrador' : isExp ? '🔴 Expirado' : isWarn ? `🟡 Vence em ${days}d` : `🟢 ${days} dias restantes`;

    // Mensagem de cobrança personalizada para o WhatsApp
    const billMsg = encodeURIComponent(`Olá ${u.name}! Passando para avisar que sua assinatura de 30 dias do DISPARALINK74 venceu. Para renovar por mais 30 dias por R$ 30,00, a chave PIX é o meu telefone: 84999415379. Aguardo seu comprovante!`);
    const chatUrl = whatsClean ? `https://wa.me/55${whatsClean.replace(/^55/, '')}?text=${billMsg}` : '#';

    return `
      <div class="admin-user-card" data-user-id="${escapeHtml(u.id)}">
        <div class="user-card-main">
          <div class="user-card-avatar" style="${isAdmin ? 'background:#fce7f3; color:#db2777;' : ''}">
            ${isAdmin ? '👑' : escapeHtml((u.name?.[0] || 'C').toUpperCase())}
          </div>
          <div class="user-card-info">
            <b>${escapeHtml(u.name)} ${isAdmin ? '<small style="color:#db2777;">(Você)</small>' : ''}</b>
            <small>📧 ${escapeHtml(u.email)} ${u.whatsapp ? `• 📱 ${escapeHtml(u.whatsapp)}` : ''}</small>
          </div>
        </div>

        <div class="user-card-status-col">
          <span class="client-status-badge ${badgeClass}">${badgeText}</span>
          ${!isAdmin ? `<small style="font-size:11px; color:var(--muted);">Expira em: ${new Date(u.accessExpiresAt).toLocaleDateString('pt-BR')}</small>` : ''}
        </div>

        <div class="user-card-actions">
          ${!isAdmin ? `
            <button type="button" class="btn-renew-pill" data-action="renew" data-user-id="${escapeHtml(u.id)}" data-user-name="${escapeHtml(u.name)}" title="Adicionar mais 30 dias de acesso com 1 clique">
              ➕ +30 Dias (PIX)
            </button>
            ${whatsClean ? `
              <a href="${chatUrl}" target="_blank" rel="noopener noreferrer" class="btn-wpp-chat" title="Enviar mensagem no WhatsApp">
                💬 WhatsApp
              </a>
            ` : ''}
            <button type="button" class="btn-user-action" data-action="toggle-status" data-user-id="${escapeHtml(u.id)}" data-current-status="${escapeHtml(u.status)}">
              ${u.status === 'blocked' ? '🔓 Desbloquear' : '🔒 Bloquear'}
            </button>
            <button type="button" class="btn-user-action danger" data-action="delete" data-user-id="${escapeHtml(u.id)}" data-user-name="${escapeHtml(u.name)}" title="Excluir cliente">
              🗑️
            </button>
          ` : `
            <span style="font-size:12px; color:var(--muted); font-weight:700;">Conta Master</span>
          `}
        </div>
      </div>
    `;
  }).join('');

  // Eventos de Ação nos botões da lista
  adminUsersList.querySelectorAll('button[data-action="renew"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-user-id');
      const name = btn.getAttribute('data-user-name');
      if (!confirm(`Confirmar renovação de +30 dias para ${name}?`)) return;

      btn.disabled = true;
      try {
        await postJson('/api/admin/users/renew', { userId: id, days: 30 });
        showToast(`🎉 Acesso de ${name} renovado por mais 30 dias!`);
        await loadAdminUsers();
      } catch (err) {
        showToast('Erro ao renovar: ' + err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  });

  adminUsersList.querySelectorAll('button[data-action="toggle-status"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-user-id');
      const cur = btn.getAttribute('data-current-status');
      const newStatus = cur === 'blocked' ? 'active' : 'blocked';

      btn.disabled = true;
      try {
        await postJson('/api/admin/users/status', { userId: id, status: newStatus });
        showToast(newStatus === 'blocked' ? 'Cliente bloqueado.' : 'Cliente desbloqueado!');
        await loadAdminUsers();
      } catch (err) {
        showToast('Erro: ' + err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  });

  adminUsersList.querySelectorAll('button[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-user-id');
      const name = btn.getAttribute('data-user-name');
      if (!confirm(`Deseja realmente EXCLUIR o cliente ${name}? Esta ação não pode ser desfeita.`)) return;

      btn.disabled = true;
      try {
        await postJson('/api/admin/users/delete', { userId: id });
        showToast(`Cliente ${name} excluído.`);
        await loadAdminUsers();
      } catch (err) {
        showToast('Erro ao excluir: ' + err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

btnRefreshUsers?.addEventListener('click', () => {
  showToast('Atualizando lista de clientes...');
  loadAdminUsers();
});

// Modal de Cadastro de Novo Assinante
btnOpenNewUserModal?.addEventListener('click', () => {
  if (newUserErrorBox) newUserErrorBox.hidden = true;
  if (newUserModal) newUserModal.hidden = false;
  $('#new-user-name')?.focus();
});

btnCloseNewUserModal?.addEventListener('click', () => {
  if (newUserModal) newUserModal.hidden = true;
});

newUserModal?.addEventListener('click', (e) => {
  if (e.target === newUserModal) newUserModal.hidden = true;
});

newUserForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#new-user-name').value.trim();
  const whatsapp = $('#new-user-whatsapp').value.trim();
  const email = $('#new-user-email').value.trim();
  const password = $('#new-user-password').value.trim();
  const days = $('#new-user-days').value.trim();
  const notes = $('#new-user-notes').value.trim();
  const btn = $('#btn-save-new-user');

  btn.disabled = true;
  btn.textContent = 'Salvando...';
  if (newUserErrorBox) newUserErrorBox.hidden = true;

  try {
    await postJson('/api/admin/users/create', { name, whatsapp, email, password, days, notes });
    showToast(`🎉 Cliente ${name} cadastrado com sucesso com 30 dias de acesso!`);
    newUserModal.hidden = true;
    newUserForm.reset();
    $('#new-user-days').value = 30;
    $('#new-user-password').value = '123456';
    await loadAdminUsers();
  } catch (err) {
    if (newUserErrorBox) {
      newUserErrorBox.textContent = err.message || 'Erro ao cadastrar cliente.';
      newUserErrorBox.hidden = false;
    }
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>✅</span> Salvar e Liberar Acesso';
  }
});

// Bloqueio de cliques no menu para visitantes
$$('.nav-list a').forEach(link => {
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href');
    if (href && href !== '#como-funciona' && href !== '#inicio') {
      if (!currentAuthUser) {
        e.preventDefault();
        openLoginModal();
        showToast('🔐 Faça login ou assine por R$ 30 para usar esta ferramenta.', true);
      }
    }
  });
});

// Inicialização
if (window.location.protocol === 'file:') {
  const banner = $('#file-warning-banner');
  if (banner) banner.hidden = false;
}
loadSession();
initTheme();
updateDailyBadge();
refreshUserWorkspace();

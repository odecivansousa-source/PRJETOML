const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4174);
const REDIRECT_HOSTS = new Set([
  'meli.la', 'mercadolivre.com.br', 'mercadolibre.com.br', 'mercadolibre.com',
  'shopee.com.br', 's.shopee.com.br', 'shope.ee', 'shp.ee', 'br.shp.ee', 's.shope.ee',
  'shopee.com', 'shopee.sg', 'universal-link.shopee.com.br', 'affiliate.shopee.com.br', 'm.shopee.com.br'
]);
const IMAGE_HOSTS = [
  'mlstatic.com', 'mercadolibre.com', 'mercadolivre.com', 'shopee.com.br', 'shopee.sg',
  'shopee.com', 'shopeemobile.com', 'susercontent.com', 'cf.shopee.com.br',
  'down-br.img.susercontent.com', 'down-ws-br.img.susercontent.com', 'down-tx-br.img.susercontent.com',
  'down-zl-br.img.susercontent.com'
];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};
const TELEGRAM_CONFIG = path.join(ROOT, '.linkpronto-telegram.json');
const DEFAULT_PLATFORM_BOT_TOKEN = process.env.TELEGRAM_DEFAULT_BOT_TOKEN || '9107168154:AAG4NH557LxZL25R36io8543Bqv6BseFcgM';
const DEFAULT_PLATFORM_BOT_NAME = 'MossoroOfertasLinkBot';

let whatsapp;
try {
  whatsapp = require('./whatsapp');
} catch (e) {
  console.warn('Módulo WhatsApp indisponível:', e.message);
}

let scheduler;
try {
  scheduler = require('./scheduler');
} catch (e) {
  console.warn('Módulo Scheduler indisponível:', e.message);
}

let shopee;
try {
  shopee = require('./shopee');
} catch (e) {
  console.warn('Módulo Shopee API indisponível:', e.message);
}

let db;
try {
  db = require('./supabase');
} catch (e) {
  console.warn('Módulo Supabase indisponível:', e.message);
}

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'cache-control': 'max-age=0',
  'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

function readTelegramConfig() {
  try { return JSON.parse(fs.readFileSync(TELEGRAM_CONFIG, 'utf8')); }
  catch { return null; }
}

function checkLocalOrigin(request) {
  const origin = request.headers['origin'];
  if (!origin || origin === 'null') return true;
  try {
    const parsed = new URL(origin);
    const host = (request.headers['host'] || '').split(':')[0].toLowerCase();
    return ['127.0.0.1', 'localhost', '0.0.0.0'].includes(parsed.hostname) || parsed.hostname === host;
  } catch {
    return false;
  }
}

async function telegramCall(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram recusou o pedido (HTTP ${response.status}).`);
  return result.result;
}

function readJsonBody(request, maxBytes = 5000000) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('Os dados enviados são grandes demais.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Os dados enviados não são válidos.')); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  response.end(JSON.stringify(payload));
}

function escapeTelegramHtml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function productHashtags(title = '') {
  const stopWords = new Set(['com', 'para', 'sem', 'por', 'uma', 'novo', 'nova', 'masculino', 'feminino', 'unissex', 'promocao']);
  const words = String(title).normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[A-Za-z0-9]+/g) || [];
  const productTags = [...new Set(words.filter(word => word.length > 2 && !stopWords.has(word.toLowerCase())))].slice(0, 3).map(word => `#${word}`);
  return [...productTags, '#OfertaDoDia', '#Achadinhos', '#Promocao'].join(' ');
}

function extractHighlights(attributes = []) {
  const patterns = /cor|mem[oó]ria|\bram\b|armazenamento|\bstorage\b|\bnfc\b|vers[aã]o|acess[oó]rio|embalagem|inclu[ií]do|tamanho|material/i;
  const seen = new Set();
  return (Array.isArray(attributes) ? attributes : []).flatMap(attribute => {
    const name = String(attribute?.name || attribute?.id || '').trim();
    const rawValue = attribute?.value_name ?? attribute?.value?.name ?? attribute?.value;
    const value = String(rawValue ?? '').trim();
    if (!name || !value || value.length > 48 || !patterns.test(name)) return [];
    const key = `${name}:${value}`.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    const icon = /cor/i.test(name) ? '💚' : /mem[oó]ria|\bram\b|armazenamento|storage/i.test(name) ? '💾' : /acess[oó]rio|embalagem|inclu[ií]do/i.test(name) ? '🎁' : '📲';
    return [`${icon} ${name}: ${value}`];
  }).slice(0, 4);
}

function inferTitleHighlights(title = '') {
  const text = String(title);
  const highlights = [];
  const ram = text.match(/\b(\d+(?:[.,]\d+)?(?:\s*GB)?)\s*RAM\b/i);
  const storage = text.match(/\b(\d{2,4})\s*GB\b/i);
  const color = text.match(/\b(verde|preto|preta|branco|branca|azul|rosa|roxo|roxa|cinza|prata|dourado|dourada)\b/i);
  if (storage && (!ram || storage[1] !== ram[1].match(/\d{2,4}/)?.[0])) highlights.push(`💾 Armazenamento: ${storage[1]} GB`);
  if (ram) highlights.push(`🧠 Memória RAM: ${ram[1].replace(/\s+/g, '')}`);
  if (/\bglobal\b/i.test(text)) highlights.push('📲 Versão Global');
  if (/\bnfc\b/i.test(text)) highlights.push('📲 NFC');
  if (color) highlights.push(`💚 Cor: ${color[1][0].toLocaleUpperCase('pt-BR')}${color[1].slice(1).toLocaleLowerCase('pt-BR')}`);
  if (/\bfone\b|fone de ouvido/i.test(text)) highlights.push('🎁 Acompanha fone');
  return highlights;
}

function productHighlights(attributes, title) {
  return [...new Set([...extractHighlights(attributes), ...inferTitleHighlights(title)])].slice(0, 5);
}

function buildTelegramCaption(data) {
  const title = escapeTelegramHtml(String(data.title || '').trim().slice(0, 180) || 'Oferta especial');
  const price = Number(data.price);
  const originalPrice = Number(data.originalPrice);
  const lines = ['🔥 <b>OFERTA IMPERDÍVEL! 📱</b>', '', `🚀 <b>${title}</b>`];
  const highlights = Array.isArray(data.highlights) ? data.highlights.slice(0, 6) : [];
  if (highlights.length) lines.push(...highlights.map(escapeTelegramHtml));
  
  if (Number.isFinite(originalPrice) && originalPrice > price && Number.isFinite(price) && price > 0) {
    const fmtOriginal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(originalPrice);
    const fmtPrice = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price);
    lines.push('', `❌ <s>De ${escapeTelegramHtml(fmtOriginal)}</s>`, `💰 <b>POR APENAS ${escapeTelegramHtml(fmtPrice)}!</b>`);
  } else if (Number.isFinite(price) && price > 0) {
    lines.push('', `💰 <b>POR APENAS ${escapeTelegramHtml(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price))}!</b>`);
  }
  
  const coupon = String(data.coupon || '').trim().slice(0, 80);
  if (coupon) lines.push(`🎟️ Cupom: <b>${escapeTelegramHtml(coupon)}</b>`);
  lines.push('', '🛒 Garanta o seu antes que acabe!', '', '👇 <b>COMPRE AQUI:</b>', escapeTelegramHtml(data.affiliateUrl), '', productHashtags(data.title));
  return lines.join('\n');
}

function buildWhatsAppOfferCaption(offer) {
  const title = String(offer.title || '').trim();
  const price = Number(offer.price);
  const originalPrice = Number(offer.originalPrice);
  const coupon = String(offer.coupon || '').trim();
  const affiliateUrl = String(offer.affiliateUrl || '').trim();

  const lines = ['🔥 *OFERTA IMPERDÍVEL! 📱*', '', `🚀 *${title}*`];
  const highlights = Array.isArray(offer.highlights) ? offer.highlights.slice(0, 5) : [];
  for (const h of highlights) lines.push(h);

  if (Number.isFinite(originalPrice) && originalPrice > price && Number.isFinite(price) && price > 0) {
    const fmtOriginal = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(originalPrice);
    const fmtPrice = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price);
    const pct = Math.round(((originalPrice - price) / originalPrice) * 100);
    lines.push('', `❌ ~De ${fmtOriginal}~`, `💰 *POR APENAS ${fmtPrice}!*`, `🏷️ *DESCONTO: ${pct}% OFF*`);
  } else if (Number.isFinite(price) && price > 0) {
    const fmtPrice = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price);
    lines.push('', `💰 *POR APENAS ${fmtPrice}!*`);
  }

  if (coupon) lines.push(`🎟️ Cupom: *${coupon}*`);
  lines.push('', '🛒 Garanta o seu antes que acabe!', '', '👇 *COMPRE AQUI:*', affiliateUrl, '', productHashtags(title));
  return lines.join('\n');
}

async function dispatchOfferToChannels(offer, opts = { sendWhatsApp: true, sendTelegram: true }) {
  const results = [];

  // 1. WhatsApp
  if (opts.sendWhatsApp && whatsapp) {
    try {
      const caption = buildWhatsAppOfferCaption(offer);
      await whatsapp.sendToWhatsAppGroup({
        image: offer.image,
        caption: caption
      });
      results.push('WhatsApp: OK');
    } catch (e) {
      console.error('[Scheduler] Erro no WhatsApp:', e.message);
      results.push('WhatsApp: Erro (' + e.message + ')');
    }
  }

  // 2. Telegram
  if (opts.sendTelegram) {
    try {
      let config = null;
      if (!offer.userId || offer.userId === 'default') {
        config = readTelegramConfig();
        if (config && !config.token) config.token = DEFAULT_PLATFORM_BOT_TOKEN;
      } else if (db) {
        const s = await db.fetchSettings(offer.userId);
        if (s?.telegram_chat_id) {
          config = {
            token: s.telegram_token || DEFAULT_PLATFORM_BOT_TOKEN,
            chatId: s.telegram_chat_id,
            chatTitle: s.telegram_chat_title || 'Telegram'
          };
        }
      }

      if (config?.token && config?.chatId) {
        const caption = buildTelegramCaption(offer);
        const image = offer.image;
        let buffer = null;
        let mimeType = 'image/jpeg';
        let filename = 'oferta.jpg';

        if (image) {
          if (image.startsWith('data:image/')) {
            const match = image.match(/^data:image\/(\w+);base64,(.+)$/);
            if (match) {
              mimeType = `image/${match[1]}`;
              filename = `oferta.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
              buffer = Buffer.from(match[2], 'base64');
            }
          } else if (/^https?:\/\//i.test(image)) {
            try {
              const imgData = await imageProxy(image);
              buffer = imgData.bytes;
              mimeType = imgData.type || 'image/jpeg';
            } catch (e) {}
          }
        }

        if (buffer) {
          const blob = new Blob([buffer], { type: mimeType });
          const formData = new FormData();
          formData.append('chat_id', config.chatId);
          formData.append('photo', blob, filename);
          formData.append('caption', caption);
          formData.append('parse_mode', 'HTML');
          await fetch(`https://api.telegram.org/bot${config.token}/sendPhoto`, { method: 'POST', body: formData });
        } else {
          await telegramCall(config.token, 'sendMessage', { chat_id: config.chatId, text: caption, parse_mode: 'HTML' });
        }
        results.push('Telegram: OK');
      }
    } catch (e) {
      console.error('[Scheduler] Erro no Telegram:', e.message);
      results.push('Telegram: Erro (' + e.message + ')');
    }
  }

  return { ok: true, message: results.join(' | ') };
}

if (scheduler) {
  scheduler.setSendCallback((offer, opts) => dispatchOfferToChannels(offer, opts));
}

function isShopeeHost(host = '') {
  const h = String(host).toLowerCase();
  return /shopee|shp\.ee|shope\.ee/i.test(h);
}

function isMeliHost(host = '') {
  const h = String(host).toLowerCase();
  return /mercadoli[bv]re|meli\.la/i.test(h);
}

function hostAllowed(host, roots) {
  return roots.some(root => host === root || host.endsWith(`.${root}`));
}

function extractCleanUrl(raw) {
  const match = String(raw || '').match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) throw new Error('Cole um link completo e válido.');
  return match[0].replace(/[.,;!?)]+$/, '');
}

function safeUrl(raw, roots) {
  const cleaned = extractCleanUrl(raw);
  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error('Cole um link completo e válido.');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!isShopeeHost(hostname) && !isMeliHost(hostname) && !hostAllowed(hostname, roots)) {
    throw new Error('Por segurança, use um link oficial do Mercado Livre ou da Shopee.');
  }
  return parsed;
}

async function followMarketplaceLink(raw) {
  let current = safeUrl(raw, [...REDIRECT_HOSTS]);
  let lastHtml = '';
  let bestUrlWithProduct = current;
  const cookieJar = new Map();

  for (let hop = 0; hop < 10; hop++) {
    try {
      const currStr = current.toString();
      if (currStr.includes('-i.') || currStr.includes('/product/') || currStr.includes('MLB')) {
        bestUrlWithProduct = current;
      }

      const headers = { ...BROWSER_HEADERS };
      if (cookieJar.size > 0) {
        headers['cookie'] = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      }

      const response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
        headers,
      });

      const rawCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
      for (const c of rawCookies) {
        const [pair] = c.split(';');
        const [k, ...v] = pair.split('=');
        if (k && v.length) cookieJar.set(k.trim(), v.join('=').trim());
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) break;

        if (location.includes('error_page') || location.includes('/verify/traffic') || location.includes('/verify/')) {
          if (bestUrlWithProduct && bestUrlWithProduct !== current) {
            return { finalUrl: bestUrlWithProduct, html: lastHtml };
          }
        }

        let nextUrl = new URL(location, current);
        for (const p of ['redir', 'af_web_dp', 'url', 'target_url', 'target', 'redirect_url']) {
          if (nextUrl.searchParams.has(p)) {
            try {
              const val = decodeURIComponent(nextUrl.searchParams.get(p));
              if (/^https?:\/\//i.test(val)) {
                nextUrl = new URL(val);
                break;
              }
            } catch {}
          }
        }

        if (nextUrl.searchParams.has('af_dp')) {
          try {
            const afDp = decodeURIComponent(nextUrl.searchParams.get('af_dp'));
            const match = afDp.match(/product\/(\d+)\/(\d+)/);
            if (match) {
              nextUrl = new URL(`https://shopee.com.br/product/${match[1]}/${match[2]}`);
            }
          } catch {}
        }

        current = safeUrl(nextUrl.toString(), [...REDIRECT_HOSTS]);
        continue;
      }

      if (response.ok) {
        lastHtml = await response.text();
        const metaRefresh = lastHtml.match(/<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i);
        if (metaRefresh && metaRefresh[1] && hop < 9) {
          try {
            current = safeUrl(new URL(metaRefresh[1].trim(), current).toString(), [...REDIRECT_HOSTS]);
            continue;
          } catch {}
        }
        return { finalUrl: current, html: lastHtml };
      }

      return { finalUrl: bestUrlWithProduct || current, html: lastHtml };
    } catch (fetchErr) {
      return { finalUrl: bestUrlWithProduct || current, html: lastHtml };
    }
  }
  return { finalUrl: bestUrlWithProduct || current, html: lastHtml };
}

function decodeEntities(value = '') {
  return value
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])[^>]*content=["']([^"']*)["'][^>]*>`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

function jsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of blocks) {
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const product = item['@type'] === 'Product' ? item : item['@graph']?.find?.(x => x['@type'] === 'Product');
        if (product) return product;
      }
    } catch { /* Formato inválido em analytics */ }
  }
  return null;
}

function splitTrailingPrice(title) {
  const text = String(title || '').trim();
  const match = text.match(/\s*(?:[-–—|]\s*)?R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)\s*$/i);
  if (!match) return { title: text, price: null };
  const amount = Number(match[1].replace(/\./g, '').replace(',', '.'));
  return {
    title: text.slice(0, match.index).replace(/\s*[-–—|]\s*$/, '').trim() || text,
    price: Number.isFinite(amount) && amount > 0 ? amount : null,
  };
}

async function getMercadoLivreData(finalUrl, html) {
  const identifiers = [...finalUrl.toString().matchAll(/MLB-?(\d{6,})/gi)].map(m => `MLB${m[1]}`);
  const itemId = [...new Set(identifiers)].at(-1);
  if (itemId) {
    const response = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
      signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/json', 'user-agent': 'LinkPronto/1.1' },
    });
    if (response.ok) {
      const item = await response.json();
      const price = Number.isFinite(item.price) ? item.price : null;
      const originalPrice = Number.isFinite(item.original_price) && item.original_price > price ? item.original_price : null;
      return {
        title: item.title || '',
        price,
        originalPrice,
        currency: item.currency_id || 'BRL',
        image: item.pictures?.[0]?.secure_url || item.thumbnail || '',
        itemUrl: item.permalink || finalUrl.toString(),
        store: 'Mercado Livre',
        highlights: productHighlights(item.attributes, item.title),
        coupon: '',
        details: 'Dados lidos do anúncio oficial do Mercado Livre.',
      };
    }
  }
  const product = jsonLd(html);
  const rawTitle = product?.name || meta(html, 'og:title') || '';
  const titleParts = splitTrailingPrice(rawTitle);
  const priceValue = product?.offers?.price ?? product?.offers?.[0]?.price;
  const parsedPrice = Number(String(priceValue ?? '').replace(',', '.'));
  const verifiedPrice = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : titleParts.price;
  return {
    title: titleParts.title,
    price: verifiedPrice,
    originalPrice: null,
    currency: product?.offers?.priceCurrency || 'BRL',
    image: (Array.isArray(product?.image) ? product.image[0] : product?.image) || meta(html, 'og:image') || '',
    itemUrl: finalUrl.toString(),
    store: 'Mercado Livre',
    highlights: productHighlights(product?.additionalProperty, titleParts.title),
    coupon: '',
    details: verifiedPrice
      ? 'Título e preço identificados no anúncio. Confira as condições antes de publicar.'
      : 'A loja não mostrou o preço na leitura direta. Você pode conferir e digitar abaixo.',
  };
}

function extractShopeeTitle(finalUrl, html) {
  // 1. Tentar JSON-LD
  const product = jsonLd(html);
  if (product?.name) return cleanTextTitle(product.name);

  // 2. Tentar meta tags comuns
  const ogTitle = meta(html, 'og:title') || meta(html, 'twitter:title');
  if (ogTitle && !/shopee\s*(brasil|br)?$/i.test(ogTitle.trim())) {
    return cleanTextTitle(ogTitle);
  }

  // 3. Tentar a tag <title>
  const titleTagMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTagMatch) {
    const rawTitle = decodeEntities(titleTagMatch[1])
      .replace(/\s*\|\s*Shopee\s*(Brasil|BR)?/i, '')
      .replace(/\s*-\s*Shopee\s*(Brasil|BR)?/i, '')
      .trim();
    if (rawTitle && !/^shopee/i.test(rawTitle)) {
      return cleanTextTitle(rawTitle);
    }
  }

  // 4. Tentar extrair do slug da URL final ou do parâmetro redir: ex /Nome-Do-Produto-i.1234.5678
  try {
    let urlToInspect = finalUrl;
    if (finalUrl.searchParams && finalUrl.searchParams.has('redir')) {
      try { urlToInspect = new URL(finalUrl.searchParams.get('redir')); } catch {}
    }
    const pathname = decodeURIComponent(urlToInspect.pathname || '');
    const slugMatch = pathname.match(/\/([^\/]+)-i\.\d+\.\d+/i) || pathname.match(/\/([^\/]+)$/i);
    if (slugMatch && slugMatch[1] && slugMatch[1] !== 'product' && !slugMatch[1].startsWith('verify')) {
      const slugTitle = slugMatch[1]
        .replace(/-i\.\d+.*$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim();
      if (/^\d+$/.test(slugTitle)) return '';
      if (slugTitle.length > 3) {
        return cleanTextTitle(slugTitle);
      }
    }
  } catch {}

  return '';
}

function cleanTextTitle(title = '') {
  return String(title)
    .replace(/\s*\|\s*Shopee\s*(Brasil|BR)?/i, '')
    .replace(/\s*\|\s*Mercado\s*Livre/i, '')
    .trim();
}

function extractShopeePrice(html, title) {
  const product = jsonLd(html);
  const priceValue = product?.offers?.price ?? product?.offers?.[0]?.price;
  const parsedPrice = Number(String(priceValue ?? '').replace(',', '.'));
  if (Number.isFinite(parsedPrice) && parsedPrice > 0) return parsedPrice;

  // Tenta extrair do final do título se houver
  const titleParts = splitTrailingPrice(title);
  if (titleParts.price) return titleParts.price;

  // Tenta regex no HTML para preços comuns da Shopee
  const priceMeta = meta(html, 'product:price:amount');
  if (priceMeta) {
    const p = Number(priceMeta.replace(',', '.'));
    if (Number.isFinite(p) && p > 0) return p;
  }

  return null;
}

function extractShopeeImage(html) {
  const product = jsonLd(html);
  const jsonImg = (Array.isArray(product?.image) ? product.image[0] : product?.image);
  if (jsonImg) return jsonImg;

  const ogImg = meta(html, 'og:image') || meta(html, 'twitter:image');
  if (ogImg) return ogImg;

  const linkImg = html.match(/<link\b[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["']/i);
  if (linkImg) return decodeEntities(linkImg[1]);

  return '';
}

async function findShopeeImageByTitle(title) {
  if (!title || title.length < 3) return '';
  const query = `${title} shopee brasil`;
  try {
    const tokenRes = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      }
    });
    const tokenHtml = await tokenRes.text();
    const tokenMatch = tokenHtml.match(/vqd=([a-zA-Z0-9_\-]+)/) || tokenHtml.match(/vqd=["']([a-zA-Z0-9_\-]+)["']/);
    if (!tokenMatch) return '';
    const vqd = tokenMatch[1];
    const imgRes = await fetch(`https://duckduckgo.com/i.js?l=wt-wt&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'referer': 'https://duckduckgo.com/'
      }
    });
    const data = await imgRes.json();
    const results = data.results || [];
    const shopeeImg = results.find(r => /susercontent\.com|shopee\.com/i.test(r.image));
    if (shopeeImg?.image) return shopeeImg.image;
    if (results[0]?.image) return results[0].image;
  } catch (err) {
    console.warn('[Shopee] Aviso busca de imagem:', err.message);
  }
  return '';
}

async function getShopeeData(finalUrl, html) {
  const title = extractShopeeTitle(finalUrl, html);
  const titleParts = splitTrailingPrice(title);
  const finalTitle = titleParts.title || title;
  const price = extractShopeePrice(html, title);
  let image = extractShopeeImage(html);

  if (!image && finalTitle) {
    image = await findShopeeImageByTitle(finalTitle);
  }

  return {
    title: finalTitle,
    price: price || titleParts.price,
    originalPrice: null,
    currency: 'BRL',
    image: image || '',
    itemUrl: finalUrl.toString(),
    store: 'Shopee',
    highlights: productHighlights([], finalTitle),
    coupon: '',
    details: 'Dados importados da Shopee. Confira o preço e o cupom no anúncio antes de publicar.',
  };
}

const SHOPEE_AFFILIATE_ID = '18326420168';

function ensureShopeeAffiliate(rawUrl) {
  const str = String(rawUrl || '');
  if (!/shopee/i.test(str)) return str;
  if (/s\.shopee|shp\.ee|shope\.ee|universal-link|utm_source|an_|af_sub_siteid/i.test(str)) {
    return str;
  }
  return `https://universal-link.shopee.com.br/universal-link/redir?redir=${encodeURIComponent(str)}&utm_source=an_${SHOPEE_AFFILIATE_ID}&af_sub_siteid=${SHOPEE_AFFILIATE_ID}`;
}

async function previewProduct(raw) {
  const source = safeUrl(raw, [...REDIRECT_HOSTS]);
  const host = source.hostname.toLowerCase();
  const isShopee = isShopeeHost(host);
  const isMeli = isMeliHost(host);

  // 1. INTEGRAÇÃO OFICIAL SHOPEE AFFILIATE OPEN API (GraphQL)
  // Resolve link de afiliado oficial encurtado, dados de catálogo e foto em alta definição
  if (isShopee && shopee) {
    try {
      const shopeeData = await shopee.resolveShopeeProduct(source.toString());
      if (shopeeData.ok) {
        return shopeeData;
      }
    } catch (err) {
      console.warn('[Shopee API] Fallback para leitura web:', err.message);
    }
  }

  const finalAffiliate = isShopee ? ensureShopeeAffiliate(source.toString()) : source.toString();

  try {
    const { finalUrl, html } = await followMarketplaceLink(source.toString());
    const finalHost = finalUrl.hostname.toLowerCase();

    let data;
    if (isMeliHost(finalHost)) {
      data = await getMercadoLivreData(finalUrl, html);
    } else {
      // Shopee ou qualquer outro host do fluxo
      data = await getShopeeData(finalUrl, html);
    }

    if (!data.title) {
      return {
        ...data,
        title: '',
        affiliateUrl: finalAffiliate,
        needsManualFill: true,
        details: 'A Shopee protegeu este link contra leitura direta. Preencha o nome e preço abaixo para gerar sua oferta com o link de afiliado preservado.',
      };
    }

    return { ...data, affiliateUrl: finalAffiliate };
  } catch (err) {
    return {
      title: '',
      price: null,
      originalPrice: null,
      image: '',
      itemUrl: source.toString(),
      store: isMeli ? 'Mercado Livre' : 'Shopee',
      highlights: [],
      coupon: '',
      affiliateUrl: finalAffiliate,
      needsManualFill: true,
      details: 'Link importado! Digite o título e o preço para gerar o post com seu link de afiliado.',
    };
  }
}

async function imageProxy(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Protocolo inválido');
  } catch {
    throw new Error('Link de imagem inválido.');
  }
  const response = await fetch(parsed.toString(), {
    signal: AbortSignal.timeout(12000),
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'accept': 'image/avif,image/webp,image/png,image/jpeg,*/*'
    }
  });
  if (!response.ok) throw new Error('Não foi possível carregar a foto do produto.');
  const type = response.headers.get('content-type') || 'image/jpeg';
  return { type, bytes: Buffer.from(await response.arrayBuffer()) };
}

function getRequestUserId(requestUrl, body = {}) {
  const queryUserId = requestUrl?.searchParams ? requestUrl.searchParams.get('userId') : null;
  const bodyUserId = body && body.userId ? body.userId : null;
  const raw = String(bodyUserId || queryUserId || '').trim();
  if (!raw || raw === 'visitor') return 'visitor';
  if (raw === 'default' || raw === 'admin' || raw === '00000000-0000-0000-0000-000000000001') return 'default';
  return raw;
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type'
    });
    response.end();
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (requestUrl.pathname === '/api/telegram/status' && request.method === 'GET') {
    const targetUserId = getRequestUserId(requestUrl);
    if (targetUserId === 'visitor') {
      sendJson(response, 200, { ok: true, configured: false, chatTitle: '', botName: DEFAULT_PLATFORM_BOT_NAME });
      return;
    }
    if (targetUserId === 'default') {
      const config = readTelegramConfig();
      sendJson(response, 200, {
        ok: true,
        configured: Boolean(config?.chatId),
        chatTitle: config?.chatTitle || '',
        botName: config?.botName || DEFAULT_PLATFORM_BOT_NAME
      });
      return;
    }
    if (db) {
      try {
        const s = await db.fetchSettings(targetUserId);
        const configured = Boolean(s?.telegram_chat_id);
        sendJson(response, 200, {
          ok: true,
          configured,
          chatTitle: s?.telegram_chat_title || (configured ? 'Canal Conectado' : ''),
          botName: DEFAULT_PLATFORM_BOT_NAME
        });
        return;
      } catch (e) {
        console.warn('Erro ao carregar status do Telegram do cliente:', e.message);
      }
    }
    sendJson(response, 200, { ok: true, configured: false, chatTitle: '', botName: DEFAULT_PLATFORM_BOT_NAME });
    return;
  }

  if (requestUrl.pathname === '/api/telegram/disconnect' && request.method === 'POST') {
    if (!checkLocalOrigin(request)) {
      sendJson(response, 403, { ok: false, error: 'Acesso recusado por segurança.' });
      return;
    }
    try {
      const body = await readJsonBody(request).catch(() => ({}));
      const targetUserId = getRequestUserId(requestUrl, body);
      if (targetUserId === 'default') {
        if (fs.existsSync(TELEGRAM_CONFIG)) fs.unlinkSync(TELEGRAM_CONFIG);
      } else if (db) {
        await db.updateSettings({
          telegramToken: '',
          telegramChatId: '',
          telegramChatTitle: '',
          sendTelegram: false
        }, targetUserId);
      }
      sendJson(response, 200, { ok: true, message: 'Telegram desconectado.' });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/telegram/chats' && request.method === 'POST') {
    if (!checkLocalOrigin(request)) {
      sendJson(response, 403, { ok: false, error: 'Acesso recusado por segurança.' });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const token = String(body.token || '').trim() || DEFAULT_PLATFORM_BOT_TOKEN;
      const updates = await telegramCall(token, 'getUpdates', { limit: 100, allowed_updates: ['message', 'channel_post'] });
      const chats = new Map();
      for (const update of updates) {
        const chat = update.message?.chat || update.channel_post?.chat;
        if (chat && ['group', 'supergroup', 'channel'].includes(chat.type)) {
          chats.set(String(chat.id), { id: String(chat.id), title: chat.title || chat.username || String(chat.id), type: chat.type });
        }
      }
      sendJson(response, 200, { ok: true, chats: [...chats.values()] });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || 'Não foi possível localizar o grupo.' });
    }
    return;
  }

  if (requestUrl.pathname === '/api/telegram/config' && request.method === 'POST') {
    if (!checkLocalOrigin(request)) {
      sendJson(response, 403, { ok: false, error: 'Acesso recusado por segurança.' });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const targetUserId = getRequestUserId(requestUrl, body);
      let token = String(body.token || '').trim();
      let rawChat = String(body.chatId || '').trim();

      rawChat = rawChat.replace(/^https?:\/\/t\.me\//i, '@').replace(/^t\.me\//i, '@');
      if (!rawChat.startsWith('-') && !rawChat.startsWith('@') && /^[a-zA-Z0-9_]{3,}$/.test(rawChat)) {
        rawChat = '@' + rawChat;
      }
      if (!rawChat) throw new Error('Informe o @ do canal ou grupo (ex: @seucanal ou link t.me/seucanal).');

      // Se o usuário não passou token, usa o bot oficial padrão da plataforma
      if (!token) {
        token = DEFAULT_PLATFORM_BOT_TOKEN;
      } else if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
        throw new Error('Token inválido. Deixe em branco para usar o Bot Oficial!');
      }

      const bot = await telegramCall(token, 'getMe', {}).catch(err => {
        throw new Error('Falha ao comunicar com o Telegram: ' + err.message);
      });
      const botName = bot.username || DEFAULT_PLATFORM_BOT_NAME;

      const chat = await telegramCall(token, 'getChat', { chat_id: rawChat }).catch(err => {
        throw new Error(`O bot @${botName} ainda não foi adicionado como Administrador no canal/grupo "${rawChat}". Abra seu canal no Telegram, vá em Administradores > Adicionar Administrador, busque por @${botName} e conceda permissão de postar!`);
      });

      const chatTitle = chat.title || chat.username || rawChat;
      const resolvedChatId = String(chat.id || rawChat);

      if (targetUserId === 'default') {
        const config = { token, chatId: resolvedChatId, chatTitle, botName };
        const temporaryPath = `${TELEGRAM_CONFIG}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify(config), { mode: 0o600 });
        fs.renameSync(temporaryPath, TELEGRAM_CONFIG);
      } else if (db) {
        await db.updateSettings({
          telegramToken: token === DEFAULT_PLATFORM_BOT_TOKEN ? '' : token,
          telegramChatId: resolvedChatId,
          telegramChatTitle: chatTitle,
          sendTelegram: true
        }, targetUserId);
      }
      sendJson(response, 200, { ok: true, configured: true, chatTitle, botName });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || 'Não foi possível configurar o Telegram.' });
    }
    return;
  }

  if (requestUrl.pathname === '/api/telegram/send' && request.method === 'POST') {
    if (!checkLocalOrigin(request)) {
      sendJson(response, 403, { ok: false, error: 'Acesso recusado por segurança.' });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const targetUserId = getRequestUserId(requestUrl, body);
      let config = null;

      if (targetUserId === 'default') {
        config = readTelegramConfig();
        if (config && !config.token) config.token = DEFAULT_PLATFORM_BOT_TOKEN;
      } else if (db) {
        const s = await db.fetchSettings(targetUserId);
        if (s?.telegram_chat_id) {
          config = {
            token: s.telegram_token || DEFAULT_PLATFORM_BOT_TOKEN,
            chatId: s.telegram_chat_id,
            chatTitle: s.telegram_chat_title || 'Canal Telegram'
          };
        }
      }

      if (!config?.token || !config?.chatId) throw new Error('Conecte seu canal ou grupo do Telegram antes de publicar.');
      const affiliateUrl = safeUrl(String(body.affiliateUrl || ''), [...REDIRECT_HOSTS]).toString();
      const caption = buildTelegramCaption({ ...body, affiliateUrl });
      if (caption.length > 4096) throw new Error('O link e o texto passaram do limite de mensagem do Telegram.');
      const image = String(body.image || '');
      if (image) {
        let buffer = null;
        let mimeType = 'image/jpeg';
        let filename = 'oferta.jpg';

        if (image.startsWith('data:image/')) {
          const match = image.match(/^data:image\/(\w+);base64,(.+)$/);
          if (match) {
            mimeType = `image/${match[1]}`;
            filename = `oferta.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
            buffer = Buffer.from(match[2], 'base64');
          }
        } else if (/^https?:\/\//i.test(image)) {
          try {
            const imgData = await imageProxy(image);
            buffer = imgData.bytes;
            mimeType = imgData.type || 'image/jpeg';
            filename = mimeType.includes('png') ? 'oferta.png' : 'oferta.jpg';
          } catch (e) {
            console.warn('[Telegram] Não foi possível baixar imagem via proxy, tentando envio direto:', e.message);
          }
        }

        if (buffer) {
          const blob = new Blob([buffer], { type: mimeType });
          const formData = new FormData();
          formData.append('chat_id', config.chatId);
          formData.append('photo', blob, filename);
          if (caption.length <= 1024) {
            formData.append('caption', caption);
            formData.append('parse_mode', 'HTML');
            const res = await fetch(`https://api.telegram.org/bot${config.token}/sendPhoto`, { method: 'POST', body: formData });
            const j = await res.json().catch(() => ({}));
            if (!res.ok || !j.ok) throw new Error(j.description || 'Telegram recusou o envio da foto.');
          } else {
            await fetch(`https://api.telegram.org/bot${config.token}/sendPhoto`, { method: 'POST', body: formData });
            await telegramCall(config.token, 'sendMessage', { chat_id: config.chatId, text: caption, parse_mode: 'HTML' });
          }
        } else if (/^https?:\/\//i.test(image)) {
          if (caption.length <= 1024) {
            await telegramCall(config.token, 'sendPhoto', { chat_id: config.chatId, photo: image, caption, parse_mode: 'HTML' });
          } else {
            await telegramCall(config.token, 'sendPhoto', { chat_id: config.chatId, photo: image });
            await telegramCall(config.token, 'sendMessage', { chat_id: config.chatId, text: caption, parse_mode: 'HTML' });
          }
        } else {
          await telegramCall(config.token, 'sendMessage', { chat_id: config.chatId, text: caption, parse_mode: 'HTML' });
        }
      } else {
        await telegramCall(config.token, 'sendMessage', { chat_id: config.chatId, text: caption, parse_mode: 'HTML' });
      }
      sendJson(response, 200, { ok: true, message: `Oferta enviada para ${config.chatTitle}!` });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || 'Não foi possível publicar no Telegram.' });
    }
    return;
  }

  // ==========================================
  // CONFIGURAÇÕES DO USUÁRIO (SAAS)
  // ==========================================
  if (requestUrl.pathname === '/api/settings' && request.method === 'GET') {
    const targetUserId = getRequestUserId(requestUrl);
    if (!db || targetUserId === 'visitor') {
      sendJson(response, 200, { ok: true, settings: null });
      return;
    }
    try {
      const s = await db.fetchSettings(targetUserId);
      sendJson(response, 200, { ok: true, settings: s });
    } catch (err) {
      sendJson(response, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/settings' && request.method === 'POST') {
    if (!checkLocalOrigin(request)) {
      sendJson(response, 403, { ok: false, error: 'Acesso recusado.' });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const targetUserId = getRequestUserId(requestUrl, body);
      if (targetUserId === 'visitor') {
        throw new Error('Usuário não autenticado.');
      }
      if (db) {
        await db.updateSettings(body, targetUserId);
      }
      sendJson(response, 200, { ok: true, message: 'Configurações salvas.' });
    } catch (err) {
      sendJson(response, 400, { ok: false, error: err.message });
    }
    return;
  }

  // ==========================================
  // ROTAS DE AUTENTICAÇÃO E ADMINISTRAÇÃO (SAAS)
  // ==========================================
  if (requestUrl.pathname === '/api/auth/login' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      if (!db) throw new Error('Serviço de autenticação temporariamente indisponível.');
      const user = await db.loginUser(body.email, body.password);
      sendJson(response, 200, { ok: true, user });
    } catch (err) {
      sendJson(response, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/admin/users' && request.method === 'GET') {
    try {
      if (!db) throw new Error('Banco de dados indisponível.');
      const users = await db.listUsers();
      sendJson(response, 200, { ok: true, users });
    } catch (err) {
      sendJson(response, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/admin/users/create' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      if (!db) throw new Error('Banco de dados indisponível.');
      const user = await db.createUser(body);
      sendJson(response, 200, { ok: true, user, message: 'Cliente cadastrado com sucesso!' });
    } catch (err) {
      sendJson(response, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/admin/users/renew' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      if (!db) throw new Error('Banco de dados indisponível.');
      const user = await db.renewUserAccess(body.userId, body.days || 30);
      sendJson(response, 200, { ok: true, user, message: 'Acesso renovado com sucesso!' });
    } catch (err) {
      sendJson(response, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/admin/users/status' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      if (!db) throw new Error('Banco de dados indisponível.');
      const user = await db.toggleUserStatus(body.userId, body.status);
      sendJson(response, 200, { ok: true, user });
    } catch (err) {
      sendJson(response, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/admin/users/delete' && request.method === 'POST') {
    try {
      const body = await readJsonBody(request);
      if (!db) throw new Error('Banco de dados indisponível.');
      await db.deleteUser(body.userId);
      sendJson(response, 200, { ok: true, message: 'Cliente excluído com sucesso.' });
    } catch (err) {
      sendJson(response, 400, { ok: false, error: err.message });
    }
    return;
  }

  // ROTAS DO WHATSAPP
  if (requestUrl.pathname === '/api/whatsapp/status' && request.method === 'GET') {
    if (!whatsapp) {
      sendJson(response, 200, { ok: false, status: 'unavailable', error: 'Módulo WhatsApp indisponível' });
      return;
    }
    try {
      const status = await whatsapp.getStatus();
      sendJson(response, 200, { ok: true, ...status });
    } catch (err) {
      sendJson(response, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/whatsapp/start' && request.method === 'POST') {
    if (!checkLocalOrigin(request) || !whatsapp) {
      sendJson(response, 403, { ok: false, error: 'Acesso recusado ou módulo indisponível.' });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const status = await whatsapp.startWhatsApp(Boolean(body.forceNew));
      sendJson(response, 200, { ok: true, ...status });
    } catch (err) {
      sendJson(response, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/whatsapp/groups' && request.method === 'POST') {
    if (!checkLocalOrigin(request) || !whatsapp) {
      sendJson(response, 403, { ok: false, error: 'Acesso recusado.' });
      return;
    }
    try {
      const groups = await whatsapp.fetchGroups();
      sendJson(response, 200, { ok: true, groups });
    } catch (err) {
      sendJson(response, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/whatsapp/config' && request.method === 'POST') {
    if (!checkLocalOrigin(request) || !whatsapp) {
      sendJson(response, 403, { ok: false, error: 'Acesso recusado.' });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const groupId = String(body.groupId || '').trim();
      const groupName = String(body.groupName || '').trim();
      whatsapp.saveConfig({ groupId, groupName });
      sendJson(response, 200, { ok: true, message: `Grupo ${groupName || groupId} salvo com sucesso!` });
    } catch (err) {
      sendJson(response, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/whatsapp/disconnect' && request.method === 'POST') {
    if (!checkLocalOrigin(request) || !whatsapp) {
      sendJson(response, 403, { ok: false, error: 'Acesso recusado.' });
      return;
    }
    try {
      const result = await whatsapp.disconnectWhatsApp();
      sendJson(response, 200, result);
    } catch (err) {
      sendJson(response, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (requestUrl.pathname === '/api/whatsapp/send' && request.method === 'POST') {
    if (!checkLocalOrigin(request) || !whatsapp) {
      sendJson(response, 403, { ok: false, error: 'Acesso recusado.' });
      return;
    }
    try {
      const body = await readJsonBody(request);
      const result = await whatsapp.sendToWhatsAppGroup(body);
      sendJson(response, 200, result);
    } catch (err) {
      sendJson(response, 400, { ok: false, error: err.message || 'Falha ao enviar para o WhatsApp.' });
    }
    return;
  }

  // ROTAS DO PILOTO AUTOMÁTICO (FILA DE DISPARO MULTI-TENANT)
  if (requestUrl.pathname === '/api/queue/status' && request.method === 'GET') {
    const targetUserId = getRequestUserId(requestUrl);
    if (targetUserId === 'visitor') {
      return sendJson(response, 200, {
        ok: true,
        isRunning: false,
        items: [],
        total: 0,
        queueCount: 0,
        intervalMinutes: 5,
        startTime: '08:00',
        endTime: '22:00',
        sendWhatsapp: false,
        sendTelegram: false,
        nextRunInMinutes: null
      });
    }

    if (targetUserId === 'default') {
      if (!scheduler) return sendJson(response, 503, { ok: false, error: 'Piloto automático não disponível.' });
      return sendJson(response, 200, scheduler.getStatus());
    }

    // Cliente isolado
    try {
      const items = db ? await db.fetchQueue(targetUserId) : [];
      const settings = db ? await db.fetchSettings(targetUserId) : null;
      return sendJson(response, 200, {
        ok: true,
        userId: targetUserId,
        items: items || [],
        total: items ? items.length : 0,
        queueCount: items ? items.length : 0,
        isRunning: settings?.is_running ?? false,
        intervalMinutes: settings?.interval_minutes || 5,
        startTime: settings?.start_time || '08:00',
        endTime: settings?.end_time || '22:00',
        sendWhatsapp: settings?.send_whatsapp ?? true,
        sendTelegram: settings?.send_telegram ?? false,
        nextRunInMinutes: null
      });
    } catch (err) {
      return sendJson(response, 500, { ok: false, error: err.message });
    }
  }

  if (requestUrl.pathname === '/api/queue/add' && request.method === 'POST') {
    if (!checkLocalOrigin(request)) return sendJson(response, 403, { ok: false, error: 'Acesso recusado.' });
    try {
      const body = await readJsonBody(request);
      const targetUserId = getRequestUserId(requestUrl, body);
      if (targetUserId === 'visitor') throw new Error('Acesso exclusivo para assinantes. Faça login para usar o piloto.');

      if (targetUserId === 'default') {
        if (!scheduler) return sendJson(response, 503, { ok: false, error: 'Piloto não disponível.' });
        const res = await scheduler.addItem(body);
        return sendJson(response, 200, res);
      }

      // Cliente isolado
      const newItem = {
        id: body.id || 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title: body.title,
        price: body.price,
        originalPrice: body.originalPrice,
        discount: body.discount,
        affiliateLink: body.affiliateLink,
        directLink: body.directLink,
        imageUrl: body.imageUrl,
        platform: body.platform,
        theme: body.theme || 'purple',
        createdAt: Date.now()
      };
      if (db) {
        await db.addQueueItem(newItem, targetUserId);
      }
      const clientItems = db ? await db.fetchQueue(targetUserId) : [newItem];
      return sendJson(response, 200, { ok: true, item: newItem, queueCount: clientItems.length });
    } catch (err) {
      return sendJson(response, 400, { ok: false, error: err.message });
    }
  }

  if (requestUrl.pathname === '/api/queue/update-image' && request.method === 'POST') {
    if (!checkLocalOrigin(request)) return sendJson(response, 403, { ok: false, error: 'Acesso recusado.' });
    try {
      const body = await readJsonBody(request);
      const targetUserId = getRequestUserId(requestUrl, body);
      if (targetUserId === 'default' && scheduler) {
        await scheduler.updateItemImage(body.id, body.image);
      }
      if (db) {
        await db.updateQueueItem(body.id, { image: body.image }, targetUserId);
      }
      return sendJson(response, 200, { ok: true });
    } catch (err) {
      return sendJson(response, 400, { ok: false, error: err.message });
    }
  }

  if (requestUrl.pathname === '/api/queue/remove' && request.method === 'POST') {
    if (!checkLocalOrigin(request)) return sendJson(response, 403, { ok: false, error: 'Acesso recusado.' });
    try {
      const body = await readJsonBody(request);
      const targetUserId = getRequestUserId(requestUrl, body);
      if (targetUserId === 'default') {
        if (!scheduler) return sendJson(response, 503, { ok: false, error: 'Piloto não disponível.' });
        const res = await scheduler.removeItem(body.id);
        return sendJson(response, 200, res);
      }

      if (db) {
        await db.removeQueueItem(body.id, targetUserId);
      }
      const clientItems = db ? await db.fetchQueue(targetUserId) : [];
      return sendJson(response, 200, { ok: true, queueCount: clientItems.length });
    } catch (err) {
      return sendJson(response, 400, { ok: false, error: err.message });
    }
  }

  if (requestUrl.pathname === '/api/queue/clear' && request.method === 'POST') {
    if (!checkLocalOrigin(request)) return sendJson(response, 403, { ok: false, error: 'Acesso recusado.' });
    try {
      const body = await readJsonBody(request).catch(() => ({}));
      const targetUserId = getRequestUserId(requestUrl, body);
      if (targetUserId === 'default') {
        if (!scheduler) return sendJson(response, 503, { ok: false, error: 'Piloto não disponível.' });
        const res = await scheduler.clearQueue();
        return sendJson(response, 200, res);
      }

      if (db) {
        await db.clearQueueItems(targetUserId);
      }
      return sendJson(response, 200, { ok: true, cleared: true, queueCount: 0 });
    } catch (err) {
      return sendJson(response, 400, { ok: false, error: err.message });
    }
  }

  if (requestUrl.pathname === '/api/queue/config' && request.method === 'POST') {
    if (!checkLocalOrigin(request)) return sendJson(response, 403, { ok: false, error: 'Acesso recusado.' });
    try {
      const body = await readJsonBody(request);
      const targetUserId = getRequestUserId(requestUrl, body);
      if (targetUserId === 'default') {
        if (!scheduler) return sendJson(response, 503, { ok: false, error: 'Piloto não disponível.' });
        const res = await scheduler.updateConfig(body);
        return sendJson(response, 200, res);
      }

      if (db) {
        await db.updateSettings({
          intervalMinutes: body.intervalMinutes,
          startTime: body.startTime,
          endTime: body.endTime,
          sendWhatsApp: body.sendWhatsApp,
          sendTelegram: body.sendTelegram,
          isRunning: body.isRunning
        }, targetUserId);
      }
      return sendJson(response, 200, { ok: true });
    } catch (err) {
      return sendJson(response, 400, { ok: false, error: err.message });
    }
  }

  if (requestUrl.pathname === '/api/queue/start' && request.method === 'POST') {
    if (!checkLocalOrigin(request)) return sendJson(response, 403, { ok: false, error: 'Acesso recusado.' });
    try {
      const body = await readJsonBody(request).catch(() => ({}));
      const targetUserId = getRequestUserId(requestUrl, body);
      if (targetUserId === 'default') {
        if (!scheduler) return sendJson(response, 503, { ok: false, error: 'Piloto não disponível.' });
        const res = scheduler.startQueue(body.triggerImmediately ?? true);
        return sendJson(response, 200, res);
      }

      if (db) {
        await db.updateSettings({ isRunning: true }, targetUserId);
      }
      return sendJson(response, 200, { ok: true, isRunning: true, message: 'Piloto Automático ativado para sua conta.' });
    } catch (err) {
      return sendJson(response, 400, { ok: false, error: err.message });
    }
  }

  if (requestUrl.pathname === '/api/queue/pause' && request.method === 'POST') {
    if (!checkLocalOrigin(request)) return sendJson(response, 403, { ok: false, error: 'Acesso recusado.' });
    try {
      const body = await readJsonBody(request).catch(() => ({}));
      const targetUserId = getRequestUserId(requestUrl, body);
      if (targetUserId === 'default') {
        if (!scheduler) return sendJson(response, 503, { ok: false, error: 'Piloto não disponível.' });
        const res = scheduler.pauseQueue();
        return sendJson(response, 200, res);
      }

      if (db) {
        await db.updateSettings({ isRunning: false }, targetUserId);
      }
      return sendJson(response, 200, { ok: true, isRunning: false, message: 'Piloto Automático pausado.' });
    } catch (err) {
      return sendJson(response, 400, { ok: false, error: err.message });
    }
  }

  if (requestUrl.pathname === '/api/preview' && request.method === 'GET') {
    try {
      const link = requestUrl.searchParams.get('url') || '';
      if (link.length > 3000) throw new Error('O link é longo demais.');
      const product = await previewProduct(link);
      sendJson(response, 200, { ok: true, product });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || 'Não foi possível ler este produto.' });
    }
    return;
  }

  if (requestUrl.pathname === '/api/image' && request.method === 'GET') {
    try {
      const image = await imageProxy(requestUrl.searchParams.get('url') || '');
      response.setHeader('content-type', image.type);
      response.setHeader('access-control-allow-origin', '*');
      response.setHeader('cache-control', 'public, max-age=3600');
      response.end(image.bytes);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || 'Imagem indisponível.' });
    }
    return;
  }

  if (requestUrl.pathname === '/favicon.ico') {
    const iconPath = path.join(ROOT, 'favicon.svg');
    if (fs.existsSync(iconPath)) {
      response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
      fs.createReadStream(iconPath).pipe(response);
      return;
    }
  }

  const requested = requestUrl.pathname === '/' ? '/index.html' : decodeURIComponent(requestUrl.pathname);
  if (requested.split('/').some(part => part.startsWith('.'))) {
    response.writeHead(404).end('Not found');
    return;
  }
  const filePath = path.resolve(ROOT, `.${requested}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) { response.writeHead(404).end('Not found'); return; }
    response.setHeader('content-type', MIME[path.extname(filePath)] || 'application/octet-stream');
    response.setHeader('x-content-type-options', 'nosniff');
    response.end(data);
  });
});

const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => console.log(`LinkPronto ativo em http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`));

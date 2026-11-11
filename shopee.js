// ============================================================================
// shopee.js - Integração Oficial com Shopee Affiliate Open API (GraphQL)
// Plataforma DISPARALINK74
// ============================================================================

const crypto = require('crypto');

const SHOPEE_APP_ID = process.env.SHOPEE_APP_ID || '18326420168';
const SHOPEE_SECRET = process.env.SHOPEE_SECRET || '7YVTC6JAINEUOY2WSKIR6AJGLZRNWXNI';
const SHOPEE_GRAPHQL_ENDPOINT = process.env.SHOPEE_GRAPHQL_ENDPOINT || 'https://open-api.affiliate.shopee.com.br/graphql';

/**
 * Cria o cabeçalho de autenticação oficial exigido pela Shopee Affiliate Open API
 * Padrão: SHA256 Credential={appId},Timestamp={timestamp},Signature={signature}
 * Onde Signature = SHA256(appId + timestamp + payloadString + secret)
 */
function createShopeeAuthHeader(payloadString, timestamp = Math.floor(Date.now() / 1000)) {
  const factor = `${SHOPEE_APP_ID}${timestamp}${payloadString}${SHOPEE_SECRET}`;
  const signature = crypto.createHash('sha256').update(factor, 'utf8').digest('hex');
  return `SHA256 Credential=${SHOPEE_APP_ID},Timestamp=${timestamp},Signature=${signature}`;
}

/**
 * Executa uma chamada GraphQL autenticada na API da Shopee
 */
async function shopeeGraphQL(query, variables = null) {
  const payloadObj = { query };
  if (variables && Object.keys(variables).length > 0) {
    payloadObj.variables = variables;
  }
  const payloadString = JSON.stringify(payloadObj);
  const authHeader = createShopeeAuthHeader(payloadString);

  const response = await fetch(SHOPEE_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: payloadString,
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`Shopee API retornou status HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Shopee API: ${json.errors[0].message}`);
  }

  return json.data;
}

/**
 * Identifica se a URL pertence aos domínios da Shopee
 */
function isShopeeUrl(url) {
  const str = String(url || '').toLowerCase();
  return /shopee|shp\.ee|shope\.ee/i.test(str);
}

/**
 * Extrai itemId e shopId de qualquer link Shopee (web, mobile, universal-link ou redirecionado)
 */
function extractShopeeItemId(urlStr) {
  if (!urlStr) return null;
  const str = String(urlStr);

  // 1. Padrão canônico web: -i.123456.789012
  const matchI = str.match(/-i\.(\d+)\.(\d+)/i);
  if (matchI) return { shopId: matchI[1], itemId: matchI[2] };

  // 2. Padrão rota de produto: /product/123456/789012
  const matchProduct = str.match(/\/product\/(\d+)\/(\d+)/i);
  if (matchProduct) return { shopId: matchProduct[1], itemId: matchProduct[2] };

  // 3. Padrão opaanlp ou rota numérica direta: /293235339/19445899201
  const matchSlash = str.match(/\/(\d{5,})\/(\d{7,})/i);
  if (matchSlash) return { shopId: matchSlash[1], itemId: matchSlash[2] };

  // 4. Parâmetros de busca: ?item_id=789012 ou ?itemId=789012
  const matchParam = str.match(/[?&](?:item_id|itemId|itemid)=(\d+)/i);
  const matchShopParam = str.match(/[?&](?:shop_id|shopId|shopid)=(\d+)/i);
  if (matchParam) {
    return {
      shopId: matchShopParam ? matchShopParam[1] : null,
      itemId: matchParam[1]
    };
  }

  return null;
}

/**
 * Resolve redirecionamentos de links curtos da Shopee (ex: s.shopee.com.br, shope.ee)
 * para obter o link canônico do produto com os IDs
 */
async function resolveShopeeRedirect(url) {
  const clean = String(url || '').trim();
  if (!/s\.shopee|shp\.ee|shope\.ee/i.test(clean)) {
    return clean;
  }

  try {
    const res = await fetch(clean, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(10000)
    });
    return res.url || clean;
  } catch (err) {
    console.warn('[Shopee] Aviso ao resolver redirecionamento:', err.message);
    return clean;
  }
}

/**
 * Gera um link de afiliado oficial encurtado via mutation generateShortLink
 * Garante comissão 100% creditada ao AppID da conta do usuário
 */
async function generateShortLink(originUrl, subIds = ['disparalink74']) {
  try {
    const mutation = `mutation GenerateShortLink($input: ShortLinkInput!) {
      generateShortLink(input: $input) {
        shortLink
      }
    }`;
    const data = await shopeeGraphQL(mutation, {
      input: {
        originUrl: String(originUrl).trim(),
        subIds: subIds.slice(0, 5)
      }
    });
    const link = data?.generateShortLink?.shortLink;
    if (link) return link;
  } catch (err) {
    console.warn('[Shopee API] generateShortLink falhou, usando fallback:', err.message);
  }

  // Fallback: Link universal padrão com o Affiliate ID oficial
  return `https://universal-link.shopee.com.br/universal-link/redir?redir=${encodeURIComponent(originUrl)}&utm_source=an_${SHOPEE_APP_ID}&af_sub_siteid=${SHOPEE_APP_ID}`;
}

/**
 * Consulta a oferta oficial do produto via productOfferV2 pelo itemId
 * Retorna dados limpos da base oficial: título, foto HD, preços e comissão
 */
async function getProductOffer(itemId) {
  const numId = Number(itemId);
  if (!numId) return null;

  try {
    const query = `{
      productOfferV2(itemId: ${numId}, page: 1, limit: 1) {
        nodes {
          itemId
          shopId
          productName
          imageUrl
          priceMin
          priceMax
          priceDiscountRate
          productLink
          offerLink
          commissionRate
          shopName
        }
      }
    }`;

    const data = await shopeeGraphQL(query);
    const node = data?.productOfferV2?.nodes?.[0];
    return node || null;
  } catch (err) {
    console.warn(`[Shopee API] getProductOffer falhou para itemId ${itemId}:`, err.message);
    return null;
  }
}

/**
 * Garante imagem da Shopee na resolução máxima (remove sufixos de miniatura _tn)
 */
function cleanShopeeImageUrl(url) {
  if (!url) return '';
  let clean = String(url).trim();
  // Remove sufixos de thumbnail da Shopee (_tn, _m, _s)
  clean = clean.replace(/_tn(\.[a-z0-9]+)$/i, '$1');
  return clean;
}

/**
 * Resolve o produto completo da Shopee a partir de qualquer URL
 * Combina API oficial (productOfferV2 + generateShortLink) para máxima velocidade e confiabilidade
 */
async function resolveShopeeProduct(rawUrl) {
  const originalInput = String(rawUrl || '').trim();

  // 1. Gera link de afiliado oficial encurtado imediatamente
  let affiliateUrl = null;
  try {
    affiliateUrl = await generateShortLink(originalInput);
  } catch (e) {
    affiliateUrl = `https://universal-link.shopee.com.br/universal-link/redir?redir=${encodeURIComponent(originalInput)}&utm_source=an_${SHOPEE_APP_ID}&af_sub_siteid=${SHOPEE_APP_ID}`;
  }

  // 2. Extrai itemId do link original ou resolve redirecionamento se for link curto
  let ids = extractShopeeItemId(originalInput);
  let resolvedUrl = originalInput;

  if (!ids && /s\.shopee|shp\.ee|shope\.ee/i.test(originalInput)) {
    resolvedUrl = await resolveShopeeRedirect(originalInput);
    ids = extractShopeeItemId(resolvedUrl);
  }

  // 3. Se temos o itemId, consulta diretamente a base oficial de ofertas da Shopee
  if (ids && ids.itemId) {
    const offer = await getProductOffer(ids.itemId);
    if (offer) {
      const priceMin = parseFloat(offer.priceMin || offer.price || 0);
      const priceMax = parseFloat(offer.priceMax || 0);
      const discount = Number(offer.priceDiscountRate || 0);

      let price = priceMin > 0 ? priceMin : null;
      let originalPrice = null;

      if (discount > 0 && price) {
        originalPrice = Number((price / (1 - (discount / 100))).toFixed(2));
      } else if (priceMax > priceMin && priceMax > 0) {
        originalPrice = priceMax;
      }

      const imageUrl = cleanShopeeImageUrl(offer.imageUrl);
      const finalAffiliate = affiliateUrl || offer.offerLink || originalInput;

      return {
        ok: true,
        title: offer.productName || 'Oferta Shopee',
        price: price,
        originalPrice: originalPrice,
        currency: 'BRL',
        image: imageUrl,
        itemUrl: offer.productLink || resolvedUrl,
        affiliateUrl: finalAffiliate,
        store: offer.shopName ? `Shopee (${offer.shopName})` : 'Shopee',
        highlights: [
          'Produto Original',
          'Garantia Shopee',
          'Entrega Rápida'
        ],
        coupon: '',
        details: offer.commissionRate ? `Comissão estimada: ${(Number(offer.commissionRate) * 100).toFixed(0)}%` : 'Oferta verificada via Shopee Affiliate API.',
        needsManualFill: false
      };
    }
  }

  // Se não foi possível obter os dados completos via API, retorna o link de afiliado garantido
  return {
    ok: false,
    affiliateUrl: affiliateUrl || originalInput,
    resolvedUrl: resolvedUrl,
    itemId: ids?.itemId || null,
    shopId: ids?.shopId || null
  };
}

module.exports = {
  SHOPEE_APP_ID,
  SHOPEE_SECRET,
  SHOPEE_GRAPHQL_ENDPOINT,
  isShopeeUrl,
  extractShopeeItemId,
  resolveShopeeRedirect,
  generateShortLink,
  getProductOffer,
  cleanShopeeImageUrl,
  resolveShopeeProduct
};

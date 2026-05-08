const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const childProcess = require('child_process');

let bcrypt = null;
try {
  bcrypt = require('bcryptjs');
} catch (_) {
  bcrypt = null;
}

const PORT = Number(process.env.NAVERTAGV2_PORT || 8787);
const HOST = '127.0.0.1';
const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const DATA_DIR = path.join(APP_DIR, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DESKTOP_DIR = path.join(os.homedir(), 'Desktop');
const KEY_DIR = path.join(DESKTOP_DIR, 'key');
const KEY_FILE = path.join(KEY_DIR, 'navertagv2.keys.json');
const LEGACY_NAVER_KEY_FILE = path.join(KEY_DIR, 'naver_client_key.txt');
const LEGACY_OPENAI_KEY_FILE = path.join(KEY_DIR, 'api_key.txt');
const LEGACY_ANTHROPIC_KEY_FILE = path.join(KEY_DIR, 'anthropic_api_key.txt');
const CACHE_FILE = path.join(DATA_DIR, 'tag-cache.json');
const PROMPT_FILE = path.join(DATA_DIR, 'prompt-config.json');
const UPDATE_HISTORY_FILE = path.join(DATA_DIR, 'tag-update-history.json');
const CATEGORY_FILE = path.join(DATA_DIR, 'naver_categories.csv');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(KEY_DIR, { recursive: true });

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const defaultKeys = () => ({
  commerce: {
    clientId: '',
    clientSecret: '',
    accessToken: ''
  },
  searchAd: {
    apiKey: '',
    secretKey: '',
    customerId: ''
  },
  datalab: {
    clientId: '',
    clientSecret: ''
  },
  llm: {
    provider: 'openai',
    openaiApiKey: '',
    anthropicApiKey: '',
    openaiModel: 'gpt-4o-mini',
    anthropicModel: 'claude-3-5-haiku-latest',
    temperature: 0.2
  }
});

const defaultPromptConfig = () => ({
  provider: 'openai',
  model: '',
  temperature: 0.2,
  template: [
    '너는 네이버 스마트스토어 SEO 상품명/#검색어/카테고리 최적화 전문가다.',
    '네이버는 "키워드 단위를 깨지 않고 검색 인식영역에 정확히 배치하는 구조"로 만든다.',
    '상품명 적합도가 최우선이고, 태그는 상품명에 못 넣은 보조 키워드 분산용으로 사용한다.',
    '',
    '상품명: {상품명}',
    '카테고리: {카테고리}',
    '카테고리후보:',
    '{카테고리후보}',
    '기존태그: {기존태그}',
    '속성: {속성}',
    '옵션: {옵션}',
    '상품번호: {상품번호}',
    '',
    '네이버 상품명 공식:',
    '[붙박이/배열고정 핵심검색어] + [대표속성] + [용도/대상] + [규격/수량]',
    '- 목표 글자수는 50~70자다.',
    '- 핵심 검색어 조합을 중간에 끊지 않는다.',
    '- 중요한 키워드는 상품명 앞쪽에 배치한다.',
    '- 조사, 문장형 표현, 과장어는 빼고 검색어 조립형으로 만든다.',
    '- 공백 1칸으로 자연스럽게 이어 붙인다.',
    '',
    '키워드 3분류:',
    '- 붙박이 키워드: 반드시 붙여 써야 검색어 단위가 유지되는 키워드. 예: 토종꿀, 차량용방향제, 냉감패드',
    '- 배열고정 키워드: 순서가 바뀌면 검색 의도나 적합도가 떨어지는 키워드. 예: 알레르망 냉감패드, 국내산 토종꿀',
    '- 조립형 키워드: 상품명, 속성, 태그 등에서 조합 가능한 보조 키워드. 예: 여름, 침대, 선물용, 답례품, 싱글, 사무실, 주방',
    '',
    '검색 인식영역 배치:',
    '- 핵심 키워드 = 상품명 앞쪽',
    '- 보조 키워드 = 태그/속성에 분산',
    '- 브랜드/제조사/카테고리 정보는 해당 영역에 넣고 태그에 반복하지 않는다.',
    '',
    '태그 공식:',
    '- 태그는 상품명에 못 넣은 보조 키워드 중심으로 만든다.',
    '- 상품명에 이미 들어간 단어는 가급적 태그에서 제외한다.',
    '- 카테고리명, 브랜드명, 판매처명은 태그로 쓰지 않는다.',
    '- 너무 넓은 단어보다 구매자가 검색할 법한 보조 조합을 우선한다.',
    '- 금지어: 네이버, 스마트스토어, 홈런마켓, 쿠팡, 쇼핑몰, 카테고리명, 브랜드명',
    '',
    '카테고리 규칙:',
    '- 카테고리후보 중 상품과 가장 맞는 네이버 leaf 카테고리를 1~5개 추천한다.',
    '- 카테고리후보에 없는 카테고리 ID를 새로 만들지 않는다.',
    '',
    '반드시 JSON만 출력한다.'
  ].join('\n')
});

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function mergeDeep(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = mergeDeep(target[key] || {}, value);
    } else if (value !== undefined && value !== null && value !== '') {
      target[key] = value;
    }
  }
  return target;
}

function parseLooseKeyText(text) {
  const parsed = defaultKeys();
  try {
    const asJson = JSON.parse(text);
    return mergeDeep(parsed, asJson);
  } catch (_) {
    // continue with KEY=VALUE parser
  }

  const pairs = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([^:=\s]+)\s*[:=]\s*(.+)$/);
    if (!match) continue;
    pairs[match[1].toLowerCase()] = match[2].trim().replace(/^["']|["']$/g, '');
  }

  const get = (...names) => {
    for (const name of names) {
      const value = pairs[name.toLowerCase()];
      if (value) return value;
    }
    return '';
  };

  parsed.commerce.clientId = get('NAVER_COMMERCE_CLIENT_ID', 'COMMERCE_CLIENT_ID', 'commerce_client_id');
  parsed.commerce.clientSecret = get('NAVER_COMMERCE_CLIENT_SECRET', 'COMMERCE_CLIENT_SECRET', 'commerce_client_secret');
  parsed.commerce.accessToken = get('NAVER_COMMERCE_ACCESS_TOKEN', 'COMMERCE_ACCESS_TOKEN', 'access_token');
  parsed.searchAd.apiKey = get('NAVER_SEARCHAD_API_KEY', 'SEARCHAD_API_KEY', 'searchad_api_key', 'api_key');
  parsed.searchAd.secretKey = get('NAVER_SEARCHAD_SECRET_KEY', 'SEARCHAD_SECRET_KEY', 'searchad_secret_key', 'secret_key');
  parsed.searchAd.customerId = get('NAVER_SEARCHAD_CUSTOMER_ID', 'SEARCHAD_CUSTOMER_ID', 'customer_id');
  parsed.datalab.clientId = get('NAVER_DATALAB_CLIENT_ID', 'DATALAB_CLIENT_ID', 'naver_client_id', 'client_id');
  parsed.datalab.clientSecret = get('NAVER_DATALAB_CLIENT_SECRET', 'DATALAB_CLIENT_SECRET', 'naver_client_secret', 'client_secret');
  parsed.llm.openaiApiKey = get('OPENAI_API_KEY', 'openai_api_key');
  parsed.llm.anthropicApiKey = get('ANTHROPIC_API_KEY', 'anthropic_api_key');
  return parsed;
}

function loadKeys() {
  const keys = defaultKeys();
  if (fs.existsSync(LEGACY_NAVER_KEY_FILE)) {
    mergeDeep(keys, parseLooseKeyText(fs.readFileSync(LEGACY_NAVER_KEY_FILE, 'utf8')));
  }
  if (fs.existsSync(LEGACY_OPENAI_KEY_FILE)) {
    const value = fs.readFileSync(LEGACY_OPENAI_KEY_FILE, 'utf8').trim();
    if (value && !keys.llm.openaiApiKey) keys.llm.openaiApiKey = value;
  }
  if (fs.existsSync(LEGACY_ANTHROPIC_KEY_FILE)) {
    const value = fs.readFileSync(LEGACY_ANTHROPIC_KEY_FILE, 'utf8').trim();
    if (value && !keys.llm.anthropicApiKey) keys.llm.anthropicApiKey = value;
  }
  mergeDeep(keys, readJson(KEY_FILE, {}));
  return keys;
}

function saveKeys(incoming) {
  const keys = mergeDeep(loadKeys(), incoming || {});
  writeJson(KEY_FILE, keys);
  return keys;
}

function mask(value) {
  if (!value) return '';
  if (String(value).length <= 8) return '****';
  return `${String(value).slice(0, 4)}...${String(value).slice(-4)}`;
}

function keyStatus() {
  const keys = loadKeys();
  return {
    keyFile: KEY_FILE,
    legacyFileDetected: fs.existsSync(LEGACY_NAVER_KEY_FILE),
    commerce: {
      clientId: mask(keys.commerce.clientId),
      clientSecret: keys.commerce.clientSecret ? 'saved' : '',
      accessToken: keys.commerce.accessToken ? 'saved' : '',
      ready: Boolean((keys.commerce.clientId && keys.commerce.clientSecret) || keys.commerce.accessToken)
    },
    searchAd: {
      apiKey: mask(keys.searchAd.apiKey),
      secretKey: keys.searchAd.secretKey ? 'saved' : '',
      customerId: mask(keys.searchAd.customerId),
      ready: Boolean(keys.searchAd.apiKey && keys.searchAd.secretKey && keys.searchAd.customerId)
    },
    datalab: {
      clientId: mask(keys.datalab.clientId),
      clientSecret: keys.datalab.clientSecret ? 'saved' : '',
      ready: Boolean(keys.datalab.clientId && keys.datalab.clientSecret)
    },
    llm: {
      provider: keys.llm.provider,
      openaiApiKey: keys.llm.openaiApiKey ? 'saved' : '',
      anthropicApiKey: keys.llm.anthropicApiKey ? 'saved' : '',
      openaiModel: keys.llm.openaiModel,
      anthropicModel: keys.llm.anthropicModel,
      ready: Boolean(keys.llm.openaiApiKey || keys.llm.anthropicApiKey)
    }
  };
}

function jsonResponse(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = decodeURIComponent(url.pathname);
  if (filePath === '/') filePath = '/index.html';
  const resolved = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  fs.createReadStream(resolved).pipe(res);
}

const stopwords = new Set([
  '무료배송', '당일배송', '국내배송', '해외배송', '정품', '신상', '특가', '세일',
  '할인', '추천', '인기', '최저가', '리뷰', '이벤트', '옵션', '택1', '랜덤',
  '새상품', '스마트스토어', '네이버', '쿠팡', '오늘출발', '빠른배송', '기획전',
  'best', 'new', 'sale', 'hot', '무료', '배송', '세트상품'
]);

function normalizeText(value) {
  return String(value || '')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[+~!@#$%^&*_=|\\:;"'<>,.?/{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTag(value) {
  return normalizeText(value).replace(/\s+/g, '').slice(0, 30);
}

function extractTokens(value) {
  const clean = normalizeText(value).toLowerCase();
  const raw = clean.match(/[가-힣a-z0-9]+/g) || [];
  const tokens = [];
  for (const token of raw) {
    if (stopwords.has(token)) continue;
    if (/^\d+$/.test(token)) continue;
    if (token.length < 2) continue;
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens.slice(0, 24);
}

function parseCount(value) {
  if (value === undefined || value === null) return 0;
  const raw = String(value).replace(/,/g, '').trim();
  if (raw.startsWith('<')) return 5;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function addCandidate(map, text, reason, score) {
  const tag = normalizeTag(text);
  if (!tag || tag.length < 2) return;
  if (stopwords.has(tag)) return;
  const existing = map.get(tag) || { text: tag, score: 0, reasons: [], metrics: null };
  existing.score += score;
  if (reason && !existing.reasons.includes(reason)) existing.reasons.push(reason);
  map.set(tag, existing);
}

function localCandidates(product, regenerateSeed = 0) {
  const map = new Map();
  const nameTokens = extractTokens(product.productName);
  const categoryTokens = extractTokens(product.categoryName);
  const attrTokens = extractTokens([product.attributes, product.optionName, product.currentTags].join(' '));
  const tokens = [...new Set([...nameTokens, ...attrTokens])];

  for (let i = 0; i < nameTokens.length; i += 1) {
    addCandidate(map, nameTokens[i], '상품명 단일 키워드', 18 - i);
    if (nameTokens[i + 1]) addCandidate(map, `${nameTokens[i]} ${nameTokens[i + 1]}`, '상품명 인접 조합', 34 - i);
    if (nameTokens[i + 1] && nameTokens[i + 2]) {
      addCandidate(map, `${nameTokens[i]} ${nameTokens[i + 1]} ${nameTokens[i + 2]}`, '상품명 3단 조합', 28 - i);
    }
  }

  for (const token of attrTokens) addCandidate(map, token, '속성/옵션 키워드', 12);

  const categoryCore = categoryTokens[categoryTokens.length - 1] || '';
  if (categoryCore) {
    for (const token of tokens.slice(0, 10)) {
      if (token === categoryCore) continue;
      addCandidate(map, `${token} ${categoryCore}`, '카테고리 결합', 22);
      addCandidate(map, `${categoryCore} ${token}`, '카테고리 역결합', 14);
    }
  }

  const purposeWords = ['가정용', '업소용', '휴대용', '실내용', '야외용', '남성', '여성', '어린이', '대용량', '미니'];
  for (const token of nameTokens.slice(0, 6)) {
    if (regenerateSeed % 2 === 0) {
      addCandidate(map, `${purposeWords[(token.length + regenerateSeed) % purposeWords.length]} ${token}`, '용도 확장', 8);
    }
  }

  return { map, nameTokens, categoryTokens, attrTokens };
}

async function searchAdKeywordTool(hints) {
  const keys = loadKeys();
  if (!keys.searchAd.apiKey || !keys.searchAd.secretKey || !keys.searchAd.customerId) {
    return { ok: false, reason: '검색광고 API 키가 저장되지 않았습니다.', keywords: [] };
  }

  const method = 'GET';
  const uri = '/keywordstool';
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac('sha256', keys.searchAd.secretKey)
    .update(`${timestamp}.${method}.${uri}`)
    .digest('base64');
  const params = new URLSearchParams({
    hintKeywords: hints.slice(0, 5).join(','),
    showDetail: '1'
  });
  const url = `https://api.searchad.naver.com${uri}?${params.toString()}`;
  const response = await fetch(url, {
    method,
    headers: {
      'X-Timestamp': timestamp,
      'X-API-KEY': keys.searchAd.apiKey,
      'X-Customer': keys.searchAd.customerId,
      'X-Signature': signature
    }
  });
  const body = await response.text();
  if (!response.ok) {
    return { ok: false, reason: `검색광고 API 오류 ${response.status}: ${body.slice(0, 300)}`, keywords: [] };
  }
  const json = JSON.parse(body);
  return { ok: true, keywords: json.keywordList || [] };
}

function isRelatedKeyword(keyword, tokens) {
  const normalized = normalizeTag(keyword);
  if (!normalized) return false;
  return tokens.some(token => normalized.includes(normalizeTag(token)) || normalizeTag(token).includes(normalized));
}

function mergeSearchAdMetrics(map, relItems, tokens) {
  for (const item of relItems) {
    const text = normalizeTag(item.relKeyword);
    if (!text || !isRelatedKeyword(text, tokens)) continue;
    const pc = parseCount(item.monthlyPcQcCnt);
    const mobile = parseCount(item.monthlyMobileQcCnt);
    const clicks = parseCount(item.monthlyAvePcClkCnt) + parseCount(item.monthlyAveMobileClkCnt);
    const volumeScore = Math.min(45, Math.log10(Math.max(pc + mobile, 1)) * 12);
    const clickScore = Math.min(18, Math.log10(Math.max(clicks, 1)) * 8);
    const compScore = item.compIdx === 'low' ? 10 : item.compIdx === 'mid' ? 6 : item.compIdx === 'high' ? 1 : 4;
    addCandidate(map, text, '검색광고 연관검색어', volumeScore + clickScore + compScore);
    const candidate = map.get(text);
    candidate.metrics = {
      monthlyPcQcCnt: item.monthlyPcQcCnt,
      monthlyMobileQcCnt: item.monthlyMobileQcCnt,
      monthlyAvePcClkCnt: item.monthlyAvePcClkCnt,
      monthlyAveMobileClkCnt: item.monthlyAveMobileClkCnt,
      compIdx: item.compIdx
    };
  }
}

function buildKeywordResult(product, candidates, context) {
  const categoryCandidates = categoryCandidatesForProduct(product, 8);
  const selectedCategory = categoryCandidates.find(item => !item.current) || categoryCandidates[0] || null;
  const categoryExact = new Set(context.categoryTokens.map(normalizeTag));
  const productExact = new Set(context.nameTokens.map(normalizeTag));
  const sorted = [...candidates.values()]
    .map(item => {
      const exactCategoryPenalty = categoryExact.has(item.text) ? 100 : 0;
      const exactProductPenalty = productExact.has(item.text) ? 12 : 0;
      return {
        ...item,
        finalScore: Math.round((item.score - exactCategoryPenalty - exactProductPenalty) * 10) / 10
      };
    })
    .filter(item => item.finalScore > 0)
    .sort((a, b) => b.finalScore - a.finalScore || a.text.localeCompare(b.text, 'ko'));

  const keywords = sorted.slice(0, 20).map(item => ({
    text: item.text,
    score: item.finalScore,
    reasons: item.reasons,
    metrics: item.metrics
  }));

  const shopTags = sorted
    .filter(item => !categoryExact.has(item.text))
    .slice(0, 10)
    .map(item => ({
      text: item.text,
      score: item.finalScore,
      status: '검증대기'
    }));

  return {
    id: product.id || product.originProductNo || product.channelProductNo || '',
    originProductNo: product.originProductNo || product.id || '',
    channelProductNo: product.channelProductNo || '',
    productName: product.productName || '',
    suggestedProductName: cleanProductTitle(product.productName || ''),
    categoryName: product.categoryName || '',
    currentCategoryId: product.categoryId || product.leafCategoryId || product.currentCategoryId || '',
    currentCategoryName: product.categoryName || '',
    categoryCandidates,
    selectedCategoryId: selectedCategory?.id || '',
    selectedCategoryName: selectedCategory?.name || '',
    selectedCategoryPath: selectedCategory?.path || '',
    currentTags: product.currentTags || '',
    keywords,
    shopTags,
    generatedAt: new Date().toISOString()
  };
}

function loadPromptConfig() {
  return mergeDeep(defaultPromptConfig(), readJson(PROMPT_FILE, {}));
}

function savePromptConfig(config) {
  const merged = mergeDeep(loadPromptConfig(), config || {});
  writeJson(PROMPT_FILE, merged);
  return merged;
}

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function findCategoryFiles(root, result = []) {
  if (!fs.existsSync(root) || result.length >= 80) return result;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.chrome-profile'].includes(entry.name)) continue;
      findCategoryFiles(full, result);
    } else if (/naver_categories\.csv$/i.test(entry.name) || /naver_category_tree\.txt$/i.test(entry.name)) {
      result.push(full);
    }
    if (result.length >= 80) break;
  }
  return result;
}

function categorySourceFiles() {
  const files = [];
  if (fs.existsSync(CATEGORY_FILE)) files.push(CATEGORY_FILE);
  files.push(...findCategoryFiles(path.join(DESKTOP_DIR, 'EXPORT')));
  return [...new Set(files)]
    .filter(file => fs.existsSync(file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function parseCategoryCsv(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map(value => value.toLowerCase());
  const codeIdx = header.indexOf('category_code');
  const nameIdx = header.indexOf('category_name');
  const pathIdx = header.indexOf('full_path');
  const leafIdx = header.indexOf('is_leaf');
  if (codeIdx < 0 || pathIdx < 0) return [];
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    return {
      id: cells[codeIdx],
      name: nameIdx >= 0 ? cells[nameIdx] : String(cells[pathIdx] || '').split('>').pop(),
      path: cells[pathIdx],
      isLeaf: leafIdx < 0 || cells[leafIdx] === 'Y'
    };
  }).filter(item => item.id && item.path && item.isLeaf);
}

function parseCategoryTree(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map(line => {
    const [id, fullPath] = line.split('\t');
    const cleanPath = String(fullPath || '').trim();
    return {
      id: String(id || '').trim(),
      name: cleanPath.split('>').pop() || '',
      path: cleanPath,
      isLeaf: true
    };
  }).filter(item => /^\d+$/.test(item.id) && item.path);
}

let categoryCache = null;

function loadCategoryCatalog() {
  const files = categorySourceFiles();
  const sourceFile = files[0] || '';
  const mtimeMs = sourceFile ? fs.statSync(sourceFile).mtimeMs : 0;
  if (categoryCache && categoryCache.sourceFile === sourceFile && categoryCache.mtimeMs === mtimeMs) {
    return categoryCache;
  }

  let categories = [];
  for (const file of files) {
    try {
      categories = /csv$/i.test(file) ? parseCategoryCsv(file) : parseCategoryTree(file);
      if (categories.length) {
        categoryCache = {
          sourceFile: file,
          mtimeMs: fs.statSync(file).mtimeMs,
          categories,
          byId: new Map(categories.map(item => [String(item.id), item]))
        };
        return categoryCache;
      }
    } catch (_) {
      // Try the next discovered category reference.
    }
  }

  categoryCache = { sourceFile: '', mtimeMs: 0, categories: [], byId: new Map() };
  return categoryCache;
}

function categoryStatus() {
  const catalog = loadCategoryCatalog();
  return {
    sourceFile: catalog.sourceFile,
    count: catalog.categories.length,
    updatedAt: catalog.mtimeMs ? new Date(catalog.mtimeMs).toISOString() : ''
  };
}

function categoryTokens(value) {
  return extractTokens(String(value || '').replace(/[>/]/g, ' '));
}

function categoryCandidatesForProduct(product, limit = 8) {
  const catalog = loadCategoryCatalog();
  if (!catalog.categories.length) return [];
  const strong = categoryTokens(product.productName);
  const medium = categoryTokens([product.attributes, product.optionName, product.currentTags].join(' '));
  const weak = categoryTokens(product.categoryName);
  const productCompact = normalizeTag(product.productName);
  const genericLeaves = new Set(['휴대용', '여행', '위생', '안전', '생활', '선물', '정리', '수납', '기타']);
  const genericTokens = new Set(['일회용', '휴대용', '여행', '사무실', '매장', '위생', '낱개', '대용량', '미니', '1개']);
  const weights = new Map();
  for (const token of strong) weights.set(token, Math.max(weights.get(token) || 0, genericTokens.has(token) ? 1.5 : 10));
  for (const token of medium) weights.set(token, Math.max(weights.get(token) || 0, 3));
  for (const token of weak) weights.set(token, Math.max(weights.get(token) || 0, 0.35));

  const currentId = String(product.categoryId || product.leafCategoryId || product.currentCategoryId || '');
  const scored = [];
  for (const category of catalog.categories) {
    const pathTokens = categoryTokens(category.path);
    const leaf = normalizeTag(category.name);
    const top = String(category.path || '').split('>')[0] || '';
    const isGenericLeaf = genericLeaves.has(leaf) || leaf.length <= 2;
    let score = 0;
    for (const token of pathTokens) {
      score += weights.get(token) || 0;
    }
    for (const token of strong) {
      const normalized = normalizeTag(token);
      if (!leaf || !normalized) continue;
      const genericToken = genericTokens.has(token);
      if (leaf === normalized && !genericToken) score += 45;
      else if (!genericToken && leaf.includes(normalized)) score += 8;
      else if (!isGenericLeaf && !genericToken && normalized.includes(leaf)) score += 18;
    }
    if (!isGenericLeaf && leaf.length >= 3 && productCompact.includes(leaf)) score += 45;
    if (isGenericLeaf && productCompact.includes(leaf)) score += 5;
    if (top === '도서' && !/(도서|책|교재|문제집|에세이|소설|수험서)/.test(product.productName || '')) score *= 0.25;
    if (top === '출산/육아' && !/(유아|아기|아동|어린이|키즈|육아|출산|임산부|신생아)/.test(product.productName || '')) score *= 0.45;
    if (String(category.id) === currentId) score += 1;
    if (score >= 12 || String(category.id) === currentId) {
      scored.push({
        id: String(category.id),
        name: category.name,
        path: category.path,
        score: Math.round(score * 10) / 10,
        current: String(category.id) === currentId
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, 'ko'));
  const current = currentId ? catalog.byId.get(currentId) : null;
  const top = scored.slice(0, limit);
  if (current && !top.some(item => item.id === String(current.id))) {
    top.push({
      id: String(current.id),
      name: current.name,
      path: current.path,
      score: 0,
      current: true
    });
  }
  return top.slice(0, limit);
}

function searchCategories(query, limit = 30) {
  const catalog = loadCategoryCatalog();
  const tokens = categoryTokens(query);
  if (!tokens.length) return catalog.categories.slice(0, limit).map(category => ({
    id: String(category.id),
    name: category.name,
    path: category.path,
    score: 0
  }));
  return catalog.categories.map(category => {
    const pathTokens = categoryTokens(category.path);
    let score = 0;
    for (const token of tokens) {
      if (pathTokens.includes(token)) score += 10;
      if (normalizeTag(category.path).includes(normalizeTag(token))) score += 3;
    }
    return { id: String(category.id), name: category.name, path: category.path, score };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, 'ko'))
    .slice(0, limit);
}

function formatCategoryContext(candidates) {
  if (!candidates.length) return '카테고리 참조 파일을 찾지 못함';
  return candidates.map(item => `${item.id}\t${item.path}`).join('\n');
}

function renderTemplate(template, product) {
  const values = {
    상품명: product.productName || '',
    카테고리: product.categoryName || '',
    카테고리후보: product.categoryCandidateText || '',
    기존태그: product.currentTags || '',
    속성: product.attributes || '',
    옵션: product.optionName || '',
    상품번호: product.originProductNo || product.channelProductNo || product.id || '',
    원상품번호: product.originProductNo || '',
    채널상품번호: product.channelProductNo || ''
  };
  return String(template || '').replace(/\{([^}]+)\}/g, (_, key) => values[key.trim()] ?? '');
}

function llmOutputInstruction() {
  return [
    '',
    '출력 형식은 아래 JSON 객체 하나만 허용한다.',
    '{',
    '  "productNameCandidate": "네이버 공식에 맞춘 50~70자 상품명 후보",',
    '  "keywordCandidates": ["후보1", "후보2"],',
    '  "shopTags": ["최종태그1", "최종태그2"],',
    '  "categoryCandidates": [{"id": "네이버카테고리ID", "path": "대분류>중분류>소분류", "reason": "짧은 이유"}],',
    '  "notes": "짧은 판단 근거"',
    '}',
    'productNameCandidate는 핵심검색어가 앞쪽에 오도록 50~70자 목표로 작성한다.',
    'keywordCandidates는 정확히 20개 이하, shopTags는 정확히 10개 이하로 작성한다.',
    'categoryCandidates는 반드시 제공된 카테고리후보 안에서만 고른다.',
    'JSON 바깥의 설명, 마크다운, 코드블록은 출력하지 않는다.'
  ].join('\n');
}

function extractJsonObject(text) {
  const raw = String(text || '').trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(raw);
  } catch (_) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    const arrStart = raw.indexOf('[');
    const arrEnd = raw.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
      return { keywordCandidates: JSON.parse(raw.slice(arrStart, arrEnd + 1)) };
    }
    throw new Error('LLM 응답에서 JSON을 파싱하지 못했습니다.');
  }
}

function cleanKeywordList(values, limit) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const text = normalizeTag(typeof value === 'string' ? value : value?.text);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function cleanProductTitle(value) {
  return normalizeText(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function normalizeCategoryCandidate(value, catalog) {
  if (!value) return null;
  const rawId = typeof value === 'string' ? value : value.id || value.categoryId || value.category_code;
  const rawPath = typeof value === 'string' ? value : value.path || value.fullPath || value.full_path || value.name;
  const id = String(rawId || '').replace(/[^\d]/g, '');
  const fromId = id ? catalog.byId.get(id) : null;
  if (fromId) {
    return {
      id: String(fromId.id),
      name: fromId.name,
      path: fromId.path,
      score: Number(value.score || 100),
      reason: typeof value === 'object' ? value.reason || '' : '',
      llm: true
    };
  }
  const normalizedPath = normalizeTag(rawPath);
  if (!normalizedPath) return null;
  const found = catalog.categories.find(category => normalizeTag(category.path) === normalizedPath);
  if (!found) return null;
  return {
    id: String(found.id),
    name: found.name,
    path: found.path,
    score: Number(value.score || 100),
    reason: typeof value === 'object' ? value.reason || '' : '',
    llm: true
  };
}

function mergeCategoryCandidates(llmValues, localValues) {
  const catalog = loadCategoryCatalog();
  const result = [];
  const seen = new Set();
  for (const raw of llmValues || []) {
    const item = normalizeCategoryCandidate(raw, catalog);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  for (const item of localValues || []) {
    if (!item || seen.has(String(item.id))) continue;
    seen.add(String(item.id));
    result.push(item);
  }
  return result.slice(0, 8);
}

async function callOpenAi(prompt, config, keys) {
  const model = config.model || keys.llm.openaiModel || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${keys.llm.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: Number(config.temperature ?? keys.llm.temperature ?? 0.2),
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You produce valid JSON only. Do not include markdown.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`OpenAI 오류 ${response.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  return json.choices?.[0]?.message?.content || '';
}

async function callAnthropic(prompt, config, keys) {
  const model = config.model || keys.llm.anthropicModel || 'claude-3-5-haiku-latest';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': keys.llm.anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: Number(config.temperature ?? keys.llm.temperature ?? 0.2),
      messages: [
        {
          role: 'user',
          content: `${prompt}\n\nJSON만 출력해. 마크다운 금지.`
        }
      ]
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Anthropic 오류 ${response.status}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  return (json.content || []).map(part => part.text || '').join('\n');
}

async function generateWithLlm(product, options) {
  const keys = loadKeys();
  const savedConfig = loadPromptConfig();
  const config = mergeDeep(savedConfig, options.promptConfig || {});
  const provider = options.llmProvider || config.provider || keys.llm.provider || 'openai';
  config.provider = provider;
  const localCategoryCandidates = categoryCandidatesForProduct(product, 12);
  const promptProduct = {
    ...product,
    categoryCandidateText: formatCategoryContext(localCategoryCandidates)
  };
  const prompt = `${renderTemplate(config.template, promptProduct)}${llmOutputInstruction()}`;

  let content = '';
  if (provider === 'anthropic') {
    if (!keys.llm.anthropicApiKey) throw new Error('Anthropic API 키가 없습니다.');
    content = await callAnthropic(prompt, config, keys);
  } else {
    if (!keys.llm.openaiApiKey) throw new Error('OpenAI API 키가 없습니다.');
    content = await callOpenAi(prompt, config, keys);
  }

  const parsed = extractJsonObject(content);
  const suggestedProductName = cleanProductTitle(parsed.productNameCandidate || parsed.suggestedProductName || parsed.productTitle || product.productName || '');
  const keywordTexts = cleanKeywordList(parsed.keywordCandidates || parsed.keywords || parsed.candidates || [], 20);
  const shopTagTexts = cleanKeywordList(parsed.shopTags || parsed.tags || keywordTexts.slice(0, 10), 10);
  const categoryCandidates = mergeCategoryCandidates(parsed.categoryCandidates || parsed.categories || [], localCategoryCandidates);
  const selectedCategory = categoryCandidates[0] || null;
  const fallback = localCandidates(product, 0);
  const fallbackRow = buildKeywordResult(product, fallback.map, fallback);
  const keywords = keywordTexts.length ? keywordTexts : fallbackRow.keywords.map(item => item.text);
  const shopTags = shopTagTexts.length ? shopTagTexts : keywords.slice(0, 10);

  return {
    id: product.id || product.originProductNo || product.channelProductNo || '',
    originProductNo: product.originProductNo || product.id || '',
    channelProductNo: product.channelProductNo || '',
    productName: product.productName || '',
    suggestedProductName,
    categoryName: product.categoryName || '',
    currentCategoryId: product.categoryId || product.leafCategoryId || product.currentCategoryId || '',
    currentCategoryName: product.categoryName || '',
    categoryCandidates,
    selectedCategoryId: selectedCategory?.id || '',
    selectedCategoryName: selectedCategory?.name || '',
    selectedCategoryPath: selectedCategory?.path || '',
    currentTags: product.currentTags || '',
    keywords: keywords.slice(0, 20).map((text, index) => ({
      text,
      score: 100 - index,
      reasons: ['LLM 프롬프트'],
      metrics: null
    })),
    shopTags: shopTags.slice(0, 10).map((text, index) => ({
      text,
      score: 100 - index,
      status: '검증대기'
    })),
    generatedAt: new Date().toISOString(),
    external: {
      searchAd: 'LLM 프롬프트 사용',
      llm: `${provider}:${config.model || 'default'}`
    },
    notes: parsed.notes || ''
  };
}

async function generateForProduct(product, options) {
  if (options.useLLM) {
    return generateWithLlm(product, options);
  }
  const seed = options.regenerate ? Math.floor(Math.random() * 100000) : 0;
  const context = localCandidates(product, seed);
  const hints = context.nameTokens.slice(0, 5);
  let external = { ok: false, reason: '검색광고 API 미사용', keywords: [] };
  if (options.useSearchAd && hints.length) {
    external = await searchAdKeywordTool(hints);
    if (external.ok) mergeSearchAdMetrics(context.map, external.keywords, [...context.nameTokens, ...context.attrTokens]);
  }
  const result = buildKeywordResult(product, context.map, context);
  result.external = {
    searchAd: external.ok ? '사용' : external.reason
  };
  return result;
}

async function issueCommerceToken() {
  const keys = loadKeys();
  if (keys.commerce.accessToken) return keys.commerce.accessToken;
  if (!keys.commerce.clientId || !keys.commerce.clientSecret) {
    throw new Error('커머스API clientId/clientSecret이 없습니다.');
  }
  if (!bcrypt) {
    throw new Error('bcryptjs가 설치되지 않았습니다. run.bat을 다시 실행해 npm install을 완료하세요.');
  }
  const timestamp = Date.now().toString();
  const password = `${keys.commerce.clientId}_${timestamp}`;
  const hashed = bcrypt.hashSync(password, keys.commerce.clientSecret);
  const clientSecretSign = Buffer.from(hashed, 'utf8').toString('base64');
  const params = new URLSearchParams({
    client_id: keys.commerce.clientId,
    timestamp,
    client_secret_sign: clientSecretSign,
    grant_type: 'client_credentials',
    type: 'SELF'
  });
  const response = await fetch('https://api.commerce.naver.com/external/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`커머스API 토큰 발급 실패 ${response.status}: ${body.slice(0, 300)}`);
  const json = JSON.parse(body);
  return json.access_token;
}

async function commerceRequest(method, apiPath, body) {
  const token = await issueCommerceToken();
  const response = await fetch(`https://api.commerce.naver.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = { raw: text };
  }
  if (!response.ok) {
    const message = json?.message || text || `HTTP ${response.status}`;
    const invalid = json?.invalidInputs ? ` ${JSON.stringify(json.invalidInputs)}` : '';
    throw new Error(`커머스API 오류 ${response.status}: ${message}${invalid}`);
  }
  return json;
}

function todayKstDate() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 60 * 60000);
  return kst.toISOString().slice(0, 10);
}

function normalizeCommerceProduct(item) {
  const origin = item.originProduct || {};
  const channel = Array.isArray(item.channelProducts) ? item.channelProducts[0] || {} : {};
  const sellerTags = Array.isArray(channel.sellerTags) ? channel.sellerTags : [];
  return {
    id: String(item.originProductNo || channel.originProductNo || channel.channelProductNo || ''),
    originProductNo: item.originProductNo || channel.originProductNo || null,
    channelProductNo: channel.channelProductNo || null,
    productName: channel.name || '',
    categoryId: origin.leafCategoryId || channel.categoryId || '',
    leafCategoryId: origin.leafCategoryId || channel.categoryId || '',
    categoryName: channel.wholeCategoryName || '',
    wholeCategoryId: channel.wholeCategoryId || '',
    sellerManagementCode: channel.sellerManagementCode || '',
    statusType: channel.statusType || '',
    displayStatusType: channel.channelProductDisplayStatusType || '',
    salePrice: channel.salePrice ?? '',
    stockQuantity: channel.stockQuantity ?? '',
    regDate: channel.regDate || '',
    modifiedDate: channel.modifiedDate || '',
    representativeImage: channel.representativeImage?.url || '',
    manufacturerName: channel.manufacturerName || '',
    attributes: [channel.manufacturerName, channel.wholeCategoryName].filter(Boolean).join(' '),
    optionName: '',
    currentTags: sellerTags.map(tag => tag.text).filter(Boolean).join('|'),
    currentTagObjects: sellerTags,
    sourceType: 'commerce'
  };
}

async function listCommerceProducts(options = {}) {
  const statusTypes = Array.isArray(options.statusTypes) && options.statusTypes.length
    ? options.statusTypes
    : ['SALE'];
  const size = Math.min(Math.max(Number(options.size || 500), 1), 500);
  const maxPages = Math.min(Math.max(Number(options.maxPages || 20), 1), 200);
  const fromDate = options.fromDate || '2000-01-01';
  const toDate = options.toDate || todayKstDate();
  const products = [];
  const seen = new Set();

  for (const statusType of statusTypes) {
    for (let page = 1; page <= maxPages; page += 1) {
      const payload = {
        productStatusTypes: [statusType],
        page,
        size,
        orderType: 'NO',
        periodType: 'PROD_MOD_DAY',
        fromDate,
        toDate
      };
      const json = await commerceRequest('POST', '/external/v1/products/search', payload);
      const contents = Array.isArray(json.contents) ? json.contents : [];
      for (const item of contents) {
        const normalized = normalizeCommerceProduct(item);
        const key = normalized.originProductNo || normalized.channelProductNo;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        products.push(normalized);
      }
      if (json.last || contents.length < size) break;
    }
  }
  const history = readJson(UPDATE_HISTORY_FILE, {});
  return products.map(product => {
    const key = String(product.originProductNo || product.channelProductNo || product.id);
    const record = history[key] || {};
    return {
      ...product,
      tagUpdatedAt: record.updatedAt || '',
      tagUpdateStatus: record.updatedAt ? 'UPDATED' : 'UNMODIFIED',
      tagUpdateSource: record.source || ''
    };
  });
}

function sanitizeTagsForUpload(tags) {
  const seen = new Set();
  const result = [];
  for (const raw of tags || []) {
    const text = typeof raw === 'string' ? raw : raw?.text;
    const normalized = normalizeTag(text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({ text: normalized });
    if (result.length >= 10) break;
  }
  return result;
}

function backupOriginProduct(originProductNo, before, afterTags, afterCategoryId, mode) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `${stamp}_${originProductNo}_${mode}.json`);
  writeJson(file, {
    originProductNo,
    mode,
    before,
    afterTags,
    afterCategoryId,
    backedUpAt: new Date().toISOString()
  });
  return file;
}

async function updateOriginProductTags(originProductNo, tags, dryRun = true, categoryId = '') {
  if (!originProductNo) throw new Error('originProductNo가 없습니다.');
  const sellerTags = sanitizeTagsForUpload(tags);
  if (!sellerTags.length) throw new Error('업로드할 #검색어가 없습니다.');
  const product = await commerceRequest('GET', `/external/v2/products/origin-products/${originProductNo}`);
  const before = JSON.parse(JSON.stringify(product));
  const previousCategoryId = product.originProduct?.leafCategoryId || '';
  product.originProduct = product.originProduct || {};
  const newCategoryId = String(categoryId || '').replace(/[^\d]/g, '');
  if (newCategoryId) product.originProduct.leafCategoryId = newCategoryId;
  product.originProduct.detailAttribute = product.originProduct.detailAttribute || {};
  product.originProduct.detailAttribute.seoInfo = product.originProduct.detailAttribute.seoInfo || {};
  const previousTags = product.originProduct.detailAttribute.seoInfo.sellerTags || [];
  product.originProduct.detailAttribute.seoInfo.sellerTags = sellerTags;
  const backupFile = backupOriginProduct(originProductNo, before, sellerTags, newCategoryId, dryRun ? 'dryrun' : 'update');

  if (dryRun) {
    return {
      originProductNo,
      dryRun: true,
      previousTags,
      newTags: sellerTags,
      previousCategoryId,
      newCategoryId,
      backupFile
    };
  }

  const result = await commerceRequest('PUT', `/external/v2/products/origin-products/${originProductNo}`, product);
  const history = readJson(UPDATE_HISTORY_FILE, {});
  history[String(originProductNo)] = {
    updatedAt: new Date().toISOString(),
    source: 'navertagv2',
    tags: sellerTags.map(tag => tag.text),
    categoryId: newCategoryId,
    backupFile
  };
  writeJson(UPDATE_HISTORY_FILE, history);
  return {
    originProductNo,
    dryRun: false,
    previousTags,
    newTags: sellerTags,
    previousCategoryId,
    newCategoryId,
    backupFile,
    result
  };
}

async function routeApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') {
    jsonResponse(res, 200, { ok: true });
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/keys/status') {
      jsonResponse(res, 200, { ok: true, status: keyStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/keys') {
      const body = await readBody(req);
      saveKeys(body.keys || {});
      jsonResponse(res, 200, { ok: true, status: keyStatus() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/prompt') {
      jsonResponse(res, 200, { ok: true, config: loadPromptConfig() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/prompt') {
      const body = await readBody(req);
      const config = savePromptConfig(body.config || {});
      jsonResponse(res, 200, { ok: true, config });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/update-history') {
      jsonResponse(res, 200, { ok: true, history: readJson(UPDATE_HISTORY_FILE, {}) });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/categories/status') {
      jsonResponse(res, 200, { ok: true, status: categoryStatus() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/categories/search') {
      const query = url.searchParams.get('q') || '';
      const limit = Number(url.searchParams.get('limit') || 30);
      jsonResponse(res, 200, { ok: true, categories: searchCategories(query, limit), status: categoryStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/keywords/batch') {
      const body = await readBody(req);
      const products = Array.isArray(body.products) ? body.products : [];
      const options = {
        regenerate: Boolean(body.regenerate),
        useSearchAd: Boolean(body.useSearchAd),
        useLLM: Boolean(body.useLLM),
        promptConfig: body.promptConfig || null,
        llmProvider: body.llmProvider || ''
      };
      const rows = [];
      for (const product of products.slice(0, 1000)) {
        rows.push(await generateForProduct(product, options));
      }
      jsonResponse(res, 200, { ok: true, rows });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/commerce/products') {
      const body = await readBody(req);
      const products = await listCommerceProducts(body || {});
      jsonResponse(res, 200, { ok: true, products, count: products.length });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/commerce/apply-tags') {
      const body = await readBody(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const dryRun = body.dryRun !== false;
      const confirmText = String(body.confirmText || '');
      if (!dryRun && confirmText !== 'UPLOAD') {
        jsonResponse(res, 400, { ok: false, error: '실제 업로드는 confirmText=UPLOAD가 필요합니다.' });
        return;
      }
      const results = [];
      const applyCategory = body.applyCategory !== false;
      for (const row of rows.slice(0, 500)) {
        try {
          const originProductNo = row.originProductNo || row.id;
          const tags = row.shopTags || row.tags || [];
          const categoryId = applyCategory ? row.selectedCategoryId || '' : '';
          const result = await updateOriginProductTags(originProductNo, tags, dryRun, categoryId);
          results.push({ ok: true, ...result });
        } catch (error) {
          results.push({
            ok: false,
            originProductNo: row.originProductNo || row.id,
            error: error.message
          });
        }
      }
      jsonResponse(res, 200, { ok: true, dryRun, results });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tag-cache') {
      jsonResponse(res, 200, { ok: true, cache: readJson(CACHE_FILE, {}) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/tag-cache') {
      const body = await readBody(req);
      const cache = readJson(CACHE_FILE, {});
      Object.assign(cache, body.cache || {});
      writeJson(CACHE_FILE, cache);
      jsonResponse(res, 200, { ok: true, cache });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/commerce/token-test') {
      const token = await issueCommerceToken();
      jsonResponse(res, 200, { ok: true, token: mask(token) });
      return;
    }

    jsonResponse(res, 404, { ok: false, error: 'API not found' });
  } catch (error) {
    jsonResponse(res, 500, { ok: false, error: error.message });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    routeApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`NaverTag V2 running at ${url}`);
  console.log(`Keys: ${KEY_FILE}`);
  if (process.env.NAVERTAGV2_NO_BROWSER !== '1') {
    childProcess.exec(`start "" "${url}"`);
  }
});

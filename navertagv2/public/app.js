const state = {
  products: [],
  rows: [],
  selectedProducts: new Set(),
  selectedResults: new Set(),
  page: 1,
  categoryStatus: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const json = await response.json();
  if (!response.ok || json.ok === false) throw new Error(json.error || `API 오류 ${response.status}`);
  return json;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function splitCsvLine(line, delimiter) {
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
    } else if (char === delimiter && !quoted) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find(line => line.trim()) || '';
  return firstLine.includes('\t') ? '\t' : ',';
}

function findHeader(headers, names) {
  const normalized = headers.map(header => header.replace(/\s+/g, '').toLowerCase());
  for (const name of names) {
    const idx = normalized.findIndex(header => header.includes(name.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseProducts(text) {
  const clean = text.trim();
  if (!clean) return [];
  const delimiter = detectDelimiter(clean);
  const lines = clean.split(/\r?\n/).filter(line => line.trim());
  const first = splitCsvLine(lines[0], delimiter);
  const hasHeader = first.some(cell => /상품명|product|name|카테고리|태그|검색어/i.test(cell));

  if (!hasHeader) {
    return lines.map((line, index) => ({
      id: String(index + 1),
      originProductNo: '',
      channelProductNo: '',
      productName: line.trim(),
      categoryName: '',
      attributes: '',
      optionName: '',
      currentTags: '',
      statusType: 'MANUAL',
      modifiedDate: '',
      tagUpdatedAt: '',
      sourceType: 'manual'
    })).filter(product => product.productName);
  }

  const headers = first;
  const idIdx = findHeader(headers, ['상품번호', '원상품번호', 'originproductno', 'id']);
  const channelIdx = findHeader(headers, ['채널상품번호', 'channelproductno']);
  const nameIdx = findHeader(headers, ['상품명', 'productname', 'name']);
  const categoryIdx = findHeader(headers, ['카테고리', 'category']);
  const categoryIdIdx = findHeader(headers, ['카테고리id', 'categoryid', 'leafcategoryid']);
  const attrIdx = findHeader(headers, ['속성', 'attribute']);
  const optionIdx = findHeader(headers, ['옵션', 'option']);
  const tagIdx = findHeader(headers, ['기존태그', '태그', '검색어', 'currenttags']);

  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line, delimiter);
    const id = idIdx >= 0 ? cells[idIdx] : String(index + 1);
    return {
      id,
      originProductNo: id,
      channelProductNo: channelIdx >= 0 ? cells[channelIdx] : '',
      productName: nameIdx >= 0 ? cells[nameIdx] : cells[0],
      categoryId: categoryIdIdx >= 0 ? cells[categoryIdIdx] : '',
      categoryName: categoryIdx >= 0 ? cells[categoryIdx] : '',
      attributes: attrIdx >= 0 ? cells[attrIdx] : '',
      optionName: optionIdx >= 0 ? cells[optionIdx] : '',
      currentTags: tagIdx >= 0 ? cells[tagIdx] : '',
      statusType: 'MANUAL',
      modifiedDate: '',
      tagUpdatedAt: '',
      sourceType: 'manual'
    };
  }).filter(product => product.productName);
}

function productKey(product) {
  return String(product.originProductNo || product.channelProductNo || product.id || product.productName);
}

function rowKey(row) {
  return String(row.originProductNo || row.channelProductNo || row.id || row.productName);
}

function formatDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function productDate(product) {
  return formatDate(product.modifiedDate || product.regDate || '');
}

function activateTab(name) {
  $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
  $$('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `tab-${name}`));
}

function getSelectedLoadStatuses() {
  return [...$('#statusFilterLoad').selectedOptions].map(option => option.value);
}

function tagChips(items, className, limit) {
  return (items || []).slice(0, limit).map(item => {
    const text = typeof item === 'string' ? item : item.text;
    const score = typeof item === 'string' || item.score === undefined ? '' : ` title="score ${item.score}"`;
    return `<span class="tag ${className}"${score}>${escapeHtml(text)}</span>`;
  }).join('');
}

function filteredProducts() {
  const query = $('#productSearchInput').value.trim().toLowerCase();
  const status = $('#statusViewFilter').value;
  const workStatus = $('#workStatusFilter').value;
  const from = $('#dateFromInput').value;
  const to = $('#dateToInput').value;

  return state.products.filter(product => {
    const haystack = [
      product.productName,
      product.categoryName,
      product.categoryId,
      product.sellerManagementCode,
      product.currentTags,
      product.originProductNo,
      product.channelProductNo
    ].join(' ').toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (status && product.statusType !== status) return false;
    if (workStatus === 'commerce' && product.sourceType !== 'commerce') return false;
    if (workStatus === 'manual' && product.sourceType !== 'manual') return false;
    if (workStatus === 'updated' && !product.tagUpdatedAt) return false;
    if (workStatus === 'unmodified' && product.tagUpdatedAt) return false;
    const date = productDate(product);
    if (from && (!date || date < from)) return false;
    if (to && (!date || date > to)) return false;
    return true;
  });
}

function currentPageProducts() {
  const products = filteredProducts();
  const pageSize = Number($('#pageSizeSelect').value || 20);
  const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
  state.page = Math.min(Math.max(state.page, 1), totalPages);
  const start = (state.page - 1) * pageSize;
  return { products, pageItems: products.slice(start, start + pageSize), totalPages };
}

function renderPageNumbers(totalPages) {
  const container = $('#pageNumbers');
  const groupStart = Math.floor((state.page - 1) / 10) * 10 + 1;
  const groupEnd = Math.min(totalPages, groupStart + 9);
  const buttons = [];
  for (let page = groupStart; page <= groupEnd; page += 1) {
    buttons.push(`<button class="page-number ${page === state.page ? 'active' : ''}" data-page="${page}">${page}</button>`);
  }
  container.innerHTML = buttons.join('');
}

function renderCategorySource() {
  const target = $('#categorySource');
  if (!target) return;
  const status = state.categoryStatus;
  if (!status || !status.count) {
    target.textContent = '카테고리 표: 아직 확인 전 또는 파일 없음';
    return;
  }
  target.textContent = `카테고리 표: ${status.count.toLocaleString()}개 로드됨 / ${status.sourceFile}`;
}

function renderProductTable() {
  const { products, pageItems, totalPages } = currentPageProducts();
  $('#productSummary').textContent = `전체 ${state.products.length.toLocaleString()}개 / 필터 ${products.length.toLocaleString()}개 / 선택 ${state.selectedProducts.size.toLocaleString()}개`;
  $('#pageInfo').textContent = `${state.page} / ${totalPages}`;
  $('#prevPageBtn').disabled = state.page <= 1;
  $('#nextPageBtn').disabled = state.page >= totalPages;
  renderPageNumbers(totalPages);
  renderCategorySource();

  $('#productBody').innerHTML = pageItems.map(product => {
    const key = productKey(product);
    const checked = state.selectedProducts.has(key) ? 'checked' : '';
    const sourceText = product.sourceType === 'commerce' ? '네이버등록' : '수기입력';
    const updateBadge = product.tagUpdatedAt
      ? `<span class="pill done">수정 ${escapeHtml(formatDate(product.tagUpdatedAt))}</span>`
      : '<span class="pill warn">미수정</span>';
    return `
      <tr>
        <td class="select-col"><input type="checkbox" data-product-key="${escapeHtml(key)}" ${checked}></td>
        <td class="product-cell">
          <div class="product-title">${updateBadge} <span class="pill source">${sourceText}</span> ${escapeHtml(product.productName)}</div>
          <div class="muted">${escapeHtml(product.sellerManagementCode || product.originProductNo || '')}</div>
        </td>
        <td>
          <div>${escapeHtml(product.categoryName || '-')}</div>
          <div class="muted">${escapeHtml(product.categoryId || product.leafCategoryId || '')}</div>
        </td>
        <td><div class="tag-list">${tagChips((product.currentTags || '').split('|').filter(Boolean), 'shop', 10)}</div></td>
        <td><span class="pill">${escapeHtml(product.statusType || '-')}</span></td>
        <td>${escapeHtml(productDate(product) || '-')}</td>
      </tr>
    `;
  }).join('');

  const pageKeys = pageItems.map(productKey);
  $('#selectPageCheck').checked = pageKeys.length > 0 && pageKeys.every(key => state.selectedProducts.has(key));
}

function renderKeyStatus(status) {
  $('#keyFile').textContent = status.keyFile;
  const items = [
    ['커머스API', status.commerce.ready, status.commerce.clientId || '미저장'],
    ['검색광고', status.searchAd.ready, status.searchAd.apiKey || '미저장'],
    ['데이터랩', status.datalab.ready, status.datalab.clientId || '미저장'],
    ['AI 프롬프트', status.llm.ready, `${status.llm.provider || ''} ${status.llm.openaiApiKey || status.llm.anthropicApiKey || '미저장'}`]
  ];
  $('#keyStatus').innerHTML = items.map(([label, ready, detail]) => `
    <div class="status-item">
      <strong>${escapeHtml(label)}</strong>
      <span class="muted">${escapeHtml(detail)}</span>
      <span class="pill ${ready ? 'ok' : 'warn'}">${ready ? '준비됨' : '대기'}</span>
    </div>
  `).join('');
}

async function refreshKeys() {
  const json = await api('/api/keys/status');
  renderKeyStatus(json.status);
}

function collectKeys() {
  const val = id => $(`#${id}`).value.trim();
  return {
    commerce: {
      clientId: val('commerceClientId'),
      clientSecret: val('commerceClientSecret')
    },
    searchAd: {
      apiKey: val('searchAdApiKey'),
      secretKey: val('searchAdSecretKey'),
      customerId: val('searchAdCustomerId')
    },
    datalab: {
      clientId: val('datalabClientId'),
      clientSecret: val('datalabClientSecret')
    },
    llm: {
      provider: $('#llmProviderSelect').value,
      openaiApiKey: val('openaiApiKey'),
      anthropicApiKey: val('anthropicApiKey'),
      openaiModel: val('openaiModel'),
      anthropicModel: val('anthropicModel'),
      temperature: Number($('#llmTemperatureInput').value || 0.2)
    }
  };
}

async function saveKeys() {
  await api('/api/keys', {
    method: 'POST',
    body: JSON.stringify({ keys: collectKeys() })
  });
  $$('.key-form input').forEach(input => {
    input.value = '';
  });
  await refreshKeys();
  showToast('API 키를 저장했습니다.');
}

function collectPromptConfig() {
  return {
    provider: $('#llmProviderSelect').value,
    model: $('#llmModelInput').value.trim(),
    temperature: Number($('#llmTemperatureInput').value || 0.2),
    template: $('#promptTemplateInput').value
  };
}

async function loadPrompt() {
  const json = await api('/api/prompt');
  const config = json.config || {};
  $('#llmProviderSelect').value = config.provider || 'openai';
  $('#llmModelInput').value = config.model || '';
  $('#llmTemperatureInput').value = config.temperature ?? 0.2;
  $('#promptTemplateInput').value = config.template || '';
}

async function savePrompt() {
  const json = await api('/api/prompt', {
    method: 'POST',
    body: JSON.stringify({ config: collectPromptConfig() })
  });
  const config = json.config || {};
  $('#promptTemplateInput').value = config.template || $('#promptTemplateInput').value;
  showToast('키워드 프롬프트를 저장했습니다.');
}

async function refreshCategoryStatus() {
  const json = await api('/api/categories/status');
  state.categoryStatus = json.status;
  renderCategorySource();
}

async function loadCommerceProducts() {
  $('#loadCommerceBtn').disabled = true;
  $('#loadCommerceBtn').textContent = '불러오는 중';
  try {
    const json = await api('/api/commerce/products', {
      method: 'POST',
      body: JSON.stringify({
        statusTypes: getSelectedLoadStatuses(),
        maxPages: Number($('#maxPagesInput').value || 20),
        size: Number($('#apiPageSizeInput').value || 500)
      })
    });
    state.products = json.products;
    state.selectedProducts.clear();
    state.page = 1;
    renderProductTable();
    showToast(`${json.count.toLocaleString()}개 상품을 불러왔습니다.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    $('#loadCommerceBtn').disabled = false;
    $('#loadCommerceBtn').textContent = '커머스API 상품 불러오기';
  }
}

function importManualProducts() {
  const products = parseProducts($('#productInput').value);
  if (!products.length) {
    showToast('붙여넣은 상품 데이터가 없습니다.');
    return;
  }
  state.products = products;
  state.selectedProducts.clear();
  state.page = 1;
  renderProductTable();
  showToast(`${products.length}개 상품을 반영했습니다.`);
}

function selectedProductObjects() {
  const selected = state.selectedProducts;
  return state.products.filter(product => selected.has(productKey(product)));
}

function selectedResultRows() {
  const selected = state.selectedResults;
  return state.rows.filter(row => selected.has(rowKey(row)));
}

function upsertRows(rows) {
  const existing = new Map(state.rows.map(row => [rowKey(row), row]));
  for (const raw of rows) {
    const row = { ...raw };
    if (!$('#categoryChangeCheck').checked) {
      row.categoryCandidates = [];
      row.selectedCategoryId = '';
      row.selectedCategoryName = '';
      row.selectedCategoryPath = '';
    }
    existing.set(rowKey(row), row);
    state.selectedResults.add(rowKey(row));
  }
  state.rows = [...existing.values()];
}

function setProgress(done, total, text) {
  const box = $('#progressBox');
  box.hidden = false;
  $('#progressText').textContent = text;
  $('#progressCount').textContent = total ? `${done.toLocaleString()} / ${total.toLocaleString()}` : '';
  $('#progressBar').style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
}

async function generateBatch(products) {
  const json = await api('/api/keywords/batch', {
    method: 'POST',
    body: JSON.stringify({
      products,
      regenerate: $('#regenerateCheck').checked,
      useSearchAd: $('#searchAdCheck').checked,
      useLLM: $('#useLLMCheck').checked,
      llmProvider: $('#llmProviderSelect').value,
      promptConfig: collectPromptConfig()
    })
  });
  return json.rows || [];
}

async function generateKeywords(products) {
  if (!products.length) {
    showToast('키워드를 생성할 상품을 선택하세요.');
    return;
  }
  $('#generateSelectedBtn').disabled = true;
  $('#generateFilteredBtn').disabled = true;
  activateTab('results');
  setProgress(0, products.length, '생성 준비');
  try {
    if ($('#useLLMCheck').checked) {
      for (let index = 0; index < products.length; index += 1) {
        setProgress(index, products.length, `생성 중: ${products[index].productName}`);
        const rows = await generateBatch([products[index]]);
        upsertRows(rows);
        renderResults();
        setProgress(index + 1, products.length, `완료: ${products[index].productName}`);
      }
    } else {
      setProgress(0, products.length, '로컬 키워드/카테고리 후보 생성 중');
      const rows = await generateBatch(products);
      upsertRows(rows);
      renderResults();
      setProgress(products.length, products.length, '생성 완료');
    }
    showToast(`${products.length.toLocaleString()}개 상품의 키워드/카테고리 후보를 생성했습니다.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    $('#generateSelectedBtn').disabled = false;
    $('#generateFilteredBtn').disabled = false;
  }
}

function categoryOptions(row) {
  const selected = String(row.selectedCategoryId || '');
  const options = (row.categoryCandidates || []).map(item => {
    const label = `${item.path} (${item.id}${item.current ? ', 현재' : ''}${item.llm ? ', AI' : ''})`;
    return `<option value="${escapeHtml(item.id)}" ${String(item.id) === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  });
  if (!options.length) return '<option value="">후보 없음</option>';
  return options.join('');
}

function selectedCategory(row) {
  return (row.categoryCandidates || []).find(item => String(item.id) === String(row.selectedCategoryId || '')) || null;
}

function renderResults() {
  if (!state.rows.length) {
    $('#summary').textContent = '아직 생성된 결과가 없습니다.';
    $('#resultBody').innerHTML = '';
    return;
  }

  $('#summary').textContent = `${state.rows.length.toLocaleString()}개 상품 키워드 생성 완료 / 선택 ${state.selectedResults.size.toLocaleString()}개`;
  $('#resultBody').innerHTML = state.rows.map((row, index) => {
    const key = rowKey(row);
    const checked = state.selectedResults.has(key) ? 'checked' : '';
    const selectedCat = selectedCategory(row);
    return `
      <tr>
        <td class="select-col"><input type="checkbox" data-result-key="${escapeHtml(key)}" ${checked}></td>
        <td class="product-cell">
          <div class="product-title">${escapeHtml(row.productName)}</div>
          <div class="suggested-title">추천: ${escapeHtml(row.suggestedProductName || row.productName || '-')}</div>
          <div class="muted">${escapeHtml(row.originProductNo || row.channelProductNo || '')}</div>
          <div class="muted">현재: ${escapeHtml(row.currentCategoryName || row.categoryName || '-')} ${escapeHtml(row.currentCategoryId || '')}</div>
        </td>
        <td><div class="tag-list">${tagChips(row.keywords, 'keyword', 20)}</div></td>
        <td><div class="tag-list">${tagChips(row.shopTags, 'shop', 10)}</div></td>
        <td>
          <div class="category-option">
            <select class="category-select" data-category-key="${escapeHtml(key)}">${categoryOptions(row)}</select>
            <div class="category-path">${escapeHtml(selectedCat?.path || row.selectedCategoryPath || '-')}</div>
            <div class="category-meta">${escapeHtml(selectedCat ? `선택 ID ${selectedCat.id} / 점수 ${selectedCat.score ?? '-'}` : '카테고리 후보 없음')}</div>
          </div>
        </td>
        <td>
          <span class="pill warn">업로드 전</span>
          <div class="muted">${escapeHtml(row.external?.searchAd || '')}</div>
          <div class="muted">${escapeHtml(row.external?.llm || '')}</div>
        </td>
        <td>
          <div class="row-actions">
            <button data-action="copy-tags" data-index="${index}">#검색어 복사</button>
            <button data-action="copy-keywords" data-index="${index}">후보 복사</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const keys = state.rows.map(rowKey);
  $('#selectResultCheck').checked = keys.length > 0 && keys.every(key => state.selectedResults.has(key));
}

async function applyTags(dryRun) {
  const rows = selectedResultRows();
  if (!rows.length) {
    showToast('업로드할 결과를 선택하세요.');
    return;
  }
  if (!dryRun) {
    const categoryText = $('#uploadCategoryCheck').checked ? '태그와 카테고리' : '태그만';
    const ok = confirm(`${rows.length}개 상품의 ${categoryText}를 실제 업로드합니다.\n변경 전 원상품은 data/backups에 백업됩니다.\n진행할까요?`);
    if (!ok) return;
  }
  const button = dryRun ? $('#dryRunBtn') : $('#uploadSelectedBtn');
  button.disabled = true;
  try {
    const json = await api('/api/commerce/apply-tags', {
      method: 'POST',
      body: JSON.stringify({
        dryRun,
        confirmText: dryRun ? '' : 'UPLOAD',
        applyCategory: $('#uploadCategoryCheck').checked,
        rows
      })
    });
    const success = json.results.filter(item => item.ok).length;
    const fail = json.results.length - success;
    if (!dryRun) {
      const now = new Date().toISOString();
      const byOrigin = new Map(json.results.filter(item => item.ok).map(item => [String(item.originProductNo), item]));
      state.products = state.products.map(product => {
        const result = byOrigin.get(String(product.originProductNo || product.id));
        if (!result) return product;
        const next = { ...product, tagUpdatedAt: now, tagUpdateStatus: 'UPDATED' };
        if (result.newCategoryId) next.categoryId = result.newCategoryId;
        return next;
      });
      renderProductTable();
    }
    showToast(`${dryRun ? '업로드 점검' : '실제 업로드'} 완료: 성공 ${success} / 실패 ${fail}`);
    console.log('apply-tags results', json.results);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

function toCsvValue(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function dateStamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function download(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  if (!state.rows.length) {
    showToast('저장할 결과가 없습니다.');
    return;
  }
  const headers = [
    'originProductNo',
    'channelProductNo',
    'productName',
    'suggestedProductName',
    'currentCategoryId',
    'currentCategoryName',
    'selectedCategoryId',
    'selectedCategoryPath',
    'keywords20',
    'shopTags10',
    'generatedAt'
  ];
  const lines = [headers.join(',')];
  for (const row of state.rows) {
    lines.push([
      row.originProductNo,
      row.channelProductNo,
      row.productName,
      row.suggestedProductName,
      row.currentCategoryId,
      row.currentCategoryName || row.categoryName,
      row.selectedCategoryId,
      row.selectedCategoryPath,
      (row.keywords || []).map(item => item.text).join('|'),
      (row.shopTags || []).map(item => item.text).join('|'),
      row.generatedAt
    ].map(toCsvValue).join(','));
  }
  download(`navertagv2_keywords_${dateStamp()}.csv`, lines.join('\r\n'), 'text/csv;charset=utf-8');
}

function exportQueue() {
  if (!state.rows.length) {
    showToast('내보낼 검증 큐가 없습니다.');
    return;
  }
  const queue = {
    version: 'navertagv2-extension-queue',
    createdAt: new Date().toISOString(),
    rows: state.rows.map(row => ({
      originProductNo: row.originProductNo,
      channelProductNo: row.channelProductNo,
      productName: row.productName,
      suggestedProductName: row.suggestedProductName,
      currentCategoryId: row.currentCategoryId,
      selectedCategoryId: row.selectedCategoryId,
      selectedCategoryPath: row.selectedCategoryPath,
      shopTags: (row.shopTags || []).map(item => item.text),
      keywordCandidates: (row.keywords || []).map(item => item.text)
    }))
  };
  download(`navertagv2_extension_queue_${dateStamp()}.json`, JSON.stringify(queue, null, 2), 'application/json;charset=utf-8');
}

function setSample() {
  $('#productInput').value = [
    '상품번호,상품명,카테고리,카테고리ID,속성,기존태그',
    '1001,접이식 사다리 3단 알루미늄 가정용 미끄럼방지,생활/공구/사다리,50000000,알루미늄|접이식|3단,가정용사다리|접이식사다리',
    '1002,여름 냉감패드 침대패드 퀸 사이즈 아이스 원단,가구/침구/패드,50000000,냉감|퀸|여름,냉감패드|여름패드',
    '1003,스테인리스 식기건조대 2단 주방 싱크대 물빠짐,주방용품/식기건조대,50000000,스테인리스|2단|물빠짐,식기건조대'
  ].join('\n');
}

function bindEvents() {
  $$('.tab').forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
  $('#refreshKeysBtn').addEventListener('click', refreshKeys);
  $('#saveKeysBtn').addEventListener('click', saveKeys);
  $('#savePromptBtn').addEventListener('click', savePrompt);
  $('#loadCommerceBtn').addEventListener('click', loadCommerceProducts);
  $('#sampleBtn').addEventListener('click', setSample);
  $('#manualImportBtn').addEventListener('click', importManualProducts);
  $('#generateSelectedBtn').addEventListener('click', () => generateKeywords(selectedProductObjects()));
  $('#generateFilteredBtn').addEventListener('click', () => generateKeywords(filteredProducts()));
  $('#exportCsvBtn').addEventListener('click', exportCsv);
  $('#exportQueueBtn').addEventListener('click', exportQueue);
  $('#dryRunBtn').addEventListener('click', () => applyTags(true));
  $('#uploadSelectedBtn').addEventListener('click', () => applyTags(false));

  ['productSearchInput', 'statusViewFilter', 'workStatusFilter', 'dateFromInput', 'dateToInput', 'pageSizeSelect'].forEach(id => {
    $(`#${id}`).addEventListener('input', () => {
      state.page = 1;
      renderProductTable();
    });
  });

  $('#prevPageBtn').addEventListener('click', () => {
    state.page -= 1;
    renderProductTable();
  });
  $('#nextPageBtn').addEventListener('click', () => {
    state.page += 1;
    renderProductTable();
  });
  $('#pageNumbers').addEventListener('click', event => {
    const button = event.target.closest('button[data-page]');
    if (!button) return;
    state.page = Number(button.dataset.page);
    renderProductTable();
  });

  $('#selectPageCheck').addEventListener('change', event => {
    const { pageItems } = currentPageProducts();
    for (const product of pageItems) {
      const key = productKey(product);
      if (event.target.checked) state.selectedProducts.add(key);
      else state.selectedProducts.delete(key);
    }
    renderProductTable();
  });

  $('#productBody').addEventListener('change', event => {
    const input = event.target.closest('input[data-product-key]');
    if (!input) return;
    if (input.checked) state.selectedProducts.add(input.dataset.productKey);
    else state.selectedProducts.delete(input.dataset.productKey);
    renderProductTable();
  });

  $('#selectResultCheck').addEventListener('change', event => {
    for (const row of state.rows) {
      const key = rowKey(row);
      if (event.target.checked) state.selectedResults.add(key);
      else state.selectedResults.delete(key);
    }
    renderResults();
  });

  $('#resultBody').addEventListener('change', event => {
    const resultInput = event.target.closest('input[data-result-key]');
    if (resultInput) {
      if (resultInput.checked) state.selectedResults.add(resultInput.dataset.resultKey);
      else state.selectedResults.delete(resultInput.dataset.resultKey);
      renderResults();
      return;
    }

    const categorySelect = event.target.closest('select[data-category-key]');
    if (!categorySelect) return;
    const row = state.rows.find(item => rowKey(item) === categorySelect.dataset.categoryKey);
    if (!row) return;
    const selected = (row.categoryCandidates || []).find(item => String(item.id) === String(categorySelect.value));
    row.selectedCategoryId = selected?.id || '';
    row.selectedCategoryName = selected?.name || '';
    row.selectedCategoryPath = selected?.path || '';
    renderResults();
  });

  $('#resultBody').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = state.rows[Number(button.dataset.index)];
    if (!row) return;
    const values = button.dataset.action === 'copy-tags'
      ? (row.shopTags || []).map(item => item.text)
      : (row.keywords || []).map(item => item.text);
    navigator.clipboard.writeText(values.join('\n'));
    showToast('클립보드에 복사했습니다.');
  });
}

bindEvents();
renderProductTable();
renderResults();
Promise.all([
  refreshKeys(),
  loadPrompt(),
  refreshCategoryStatus()
]).catch(error => showToast(error.message));

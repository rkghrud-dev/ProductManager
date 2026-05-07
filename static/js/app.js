/* ===== Utility ===== */
function toast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
}

function formatNumber(n) {
    return Number(n).toLocaleString('ko-KR');
}

function formatDate(str) {
    if (!str) return '-';
    const d = new Date(str);
    if (isNaN(d)) return str;
    return d.toLocaleDateString('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
}

function sortLabel(key) {
    return { latest: '최신순', oldest: '오래된순', random: '랜덤' }[key] || key;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[ch]));
}

async function api(url, options = {}) {
    try {
        const res = await fetch(url, options);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '요청 실패');
        return data;
    } catch (e) {
        toast(e.message, 'error');
        throw e;
    }
}

/* ===== Upload ===== */
function initUpload() {
    const zone = document.getElementById('drop-zone');
    const input = document.getElementById('file-input');
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
        if (e.target.files.length) uploadFile(e.target.files[0]);
    });

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]);
    });
}

async function uploadFile(file) {
    if (!file.name.match(/\.xlsx?$/i)) {
        toast('Excel 파일(.xlsx)만 업로드 가능합니다', 'error');
        return;
    }

    const zone = document.getElementById('drop-zone');
    const progress = document.getElementById('upload-progress');
    const content = zone.querySelector('.drop-zone-content');
    const status = document.getElementById('upload-status');
    const result = document.getElementById('upload-result');

    content.style.display = 'none';
    progress.style.display = 'block';
    status.textContent = '업로드 중';
    status.className = 'badge badge-warning';

    const fill = document.getElementById('progress-fill');
    const text = document.getElementById('progress-text');

    fill.style.width = '30%';
    text.textContent = `${file.name} 업로드 중...`;

    const formData = new FormData();
    formData.append('file', file);

    try {
        fill.style.width = '60%';
        text.textContent = '서버에서 파싱 중... (대용량 파일은 시간이 걸릴 수 있습니다)';

        const data = await fetch('/api/upload', { method: 'POST', body: formData }).then(r => r.json());

        if (data.error) throw new Error(data.error);

        fill.style.width = '100%';
        text.textContent = '완료!';
        status.textContent = '완료';
        status.className = 'badge badge-success';

        document.getElementById('result-total').textContent = formatNumber(data.total);
        document.getElementById('result-new').textContent = formatNumber(data.new);
        document.getElementById('result-updated').textContent = formatNumber(data.updated);
        document.getElementById('result-skipped').textContent = formatNumber(data.skipped);
        document.getElementById('result-naver-listed').textContent = formatNumber(data.naver_listed || 0);
        document.getElementById('result-naver-dup').textContent = formatNumber(data.naver_duplicates);
        result.style.display = 'block';

        toast(`업로드 완료: 신규 ${data.new}건, 갱신 ${data.updated}건`, 'success');
        loadSuppliers();

        setTimeout(() => {
            content.style.display = 'block';
            progress.style.display = 'none';
        }, 2000);

    } catch (e) {
        fill.style.width = '0%';
        text.textContent = '업로드 실패';
        status.textContent = '실패';
        status.className = 'badge badge-danger';
        toast(e.message, 'error');

        setTimeout(() => {
            content.style.display = 'block';
            progress.style.display = 'none';
        }, 2000);
    }
}

/* ===== Suppliers ===== */
let selectedSuppliers = new Set();

async function loadSuppliers() {
    const grid = document.getElementById('supplier-grid');
    if (!grid) return;

    try {
        const suppliers = await api('/api/suppliers');
        if (!suppliers.length) {
            grid.innerHTML = '<div class="empty-state"><p>등록된 상품이 없습니다. 엑셀을 먼저 업로드해주세요.</p></div>';
            return;
        }

        grid.innerHTML = suppliers.map(s => {
            const isCompleted = s.available_skus === 0;
            const isSelected = selectedSuppliers.has(s.supplier_code);
            const percent = s.total_skus > 0 ? ((s.listed_skus / s.total_skus) * 100) : 0;
            const percentStr = percent.toFixed(1);
            const waveSvg = `<svg viewBox="0 0 120 16" preserveAspectRatio="none"><path d="M0,8 C10,4 20,12 30,8 C40,4 50,12 60,8 C70,4 80,12 90,8 C100,4 110,12 120,8 L120,16 L0,16 Z"/></svg>`;
            return `
                <div class="supplier-item ${isSelected ? 'selected' : ''} ${isCompleted ? 'completed' : ''}"
                     onclick="handleSupplierClick(event, '${s.supplier_code}', this)"
                     data-supplier="${s.supplier_code}">
                    <div class="water-fill" style="height:${percent}%">
                        <div class="wave">${waveSvg}</div>
                        <div class="water-fill-inner"></div>
                    </div>
                    <div class="supplier-checkbox"></div>
                    <div class="supplier-info">
                        <div class="supplier-name">
                            ${s.supplier_code}
                            <span class="supplier-percent">${percentStr}%</span>
                        </div>
                        <div class="supplier-count">
                            <span class="available">${s.available_skus}건 남음</span>
                            / 전체 ${s.total_skus} (완료 ${s.listed_skus})
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        grid.innerHTML = '<div class="empty-state"><p>데이터를 불러올 수 없습니다</p></div>';
    }
}

function handleSupplierClick(event, code, el) {
    const rect = el.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const ripple = document.createElement('div');
    ripple.className = 'water-ripple';
    ripple.style.left = (x - 30) + 'px';
    ripple.style.top = (y - 30) + 'px';
    ripple.style.width = '60px';
    ripple.style.height = '60px';
    el.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);

    toggleSupplier(code, el);
}

function toggleSupplier(code, el) {
    if (selectedSuppliers.has(code)) {
        selectedSuppliers.delete(code);
        el.classList.remove('selected');
    } else {
        selectedSuppliers.add(code);
        el.classList.add('selected');
    }
    updateDownloadButton();
}

function selectAllSuppliers() {
    document.querySelectorAll('.supplier-item').forEach(el => {
        const code = el.dataset.supplier;
        selectedSuppliers.add(code);
        el.classList.add('selected');
    });
    updateDownloadButton();
}

function deselectAllSuppliers() {
    selectedSuppliers.clear();
    document.querySelectorAll('.supplier-item').forEach(el => el.classList.remove('selected'));
    updateDownloadButton();
}

function updateDownloadButton() {
    const btn = document.getElementById('btn-download');
    if (btn) btn.disabled = selectedSuppliers.size === 0;
}

/* ===== Controls ===== */
function onCountChange(sel) {
    const custom = document.getElementById('count-custom');
    custom.style.display = sel.value === 'custom' ? 'block' : 'none';
}

function getSelectedOptions() {
    const sortOrder = document.querySelector('input[name="sort_order"]:checked')?.value || 'latest';
    const countSel = document.getElementById('count-select');
    let count = 5;
    if (countSel.value === 'custom') {
        count = parseInt(document.getElementById('count-custom').value) || 5;
    } else if (countSel.value === 'all') {
        count = 99999;
    } else {
        count = parseInt(countSel.value);
    }
    return { sortOrder, count };
}

/* ===== Preview ===== */
async function previewProducts() {
    if (!selectedSuppliers.size) {
        toast('사업자를 선택해주세요', 'error');
        return;
    }

    const { sortOrder, count } = getSelectedOptions();
    const section = document.getElementById('preview-section');
    const tbody = document.getElementById('preview-tbody');

    try {
        const data = await api('/api/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                suppliers: Array.from(selectedSuppliers),
                sort_order: sortOrder,
                count: count
            })
        });

        document.getElementById('preview-sku-count').textContent = `${data.total_skus} SKU`;
        document.getElementById('preview-row-count').textContent = `${data.total_rows} 행 (CSV)`;

        tbody.innerHTML = data.preview.map(item => `
            <tr>
                <td>
                    ${item.image_url ?
                        `<img class="preview-img" src="${item.image_url}" onerror="this.style.display='none'" alt="">` :
                        '<div class="preview-img" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:10px">No IMG</div>'
                    }
                </td>
                <td style="font-weight:600;color:var(--text-primary)">${item.sku_group}</td>
                <td><span class="badge badge-accent">${item.supplier_code}</span></td>
                <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.product_name}</td>
                <td>${formatNumber(Math.round(item.price))}원</td>
                <td>
                    <div class="option-tags">
                        ${item.options.map(o => `<span class="option-tag">${o.option_code || 'A'}</span>`).join('')}
                    </div>
                </td>
            </tr>
        `).join('');

        section.style.display = 'block';
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });

        document.getElementById('btn-download').disabled = false;
        toast(`미리보기: ${data.total_skus} SKU, ${data.total_rows}행`, 'info');

    } catch (e) {
        console.error(e);
    }
}

/* ===== Download CSV ===== */
async function downloadCSV() {
    if (!selectedSuppliers.size) {
        toast('사업자를 선택해주세요', 'error');
        return;
    }

    const btn = document.getElementById('btn-download');
    btn.disabled = true;
    btn.innerHTML = '<span>처리 중...</span>';

    const { sortOrder, count } = getSelectedOptions();

    try {
        const data = await api('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                suppliers: Array.from(selectedSuppliers),
                sort_order: sortOrder,
                count: count
            })
        });

        const a = document.createElement('a');
        a.href = data.download_url;
        a.download = data.file_name;
        document.body.appendChild(a);
        a.click();
        a.remove();

        toast(`CSV 다운로드 완료: ${data.total_skus} SKU, ${data.total_rows}행`, 'success');

        selectedSuppliers.clear();
        document.querySelectorAll('.supplier-item').forEach(el => el.classList.remove('selected'));
        document.getElementById('preview-section').style.display = 'none';
        loadSuppliers();

    } catch (e) {
        console.error(e);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            CSV 다운로드
        `;
    }
}

/* ===== History ===== */
let currentDetailBatchId = null;

async function loadHistory() {
    const container = document.getElementById('history-list');
    if (!container) return;

    try {
        const history = await api('/api/history');
        if (!history.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    <p>아직 리스팅 이력이 없습니다</p>
                </div>
            `;
            return;
        }

        container.innerHTML = history.map(h => {
            const suppliers = JSON.parse(h.suppliers || '[]').join(', ');
            const uploadCount = Number(h.result_upload_count || 0);
            return `
                <div class="history-item ${h.is_cancelled ? 'cancelled' : ''}">
                    <div class="history-date">${formatDate(h.batch_date)}</div>
                    <div class="history-info">
                        <div class="history-suppliers">${escapeHtml(suppliers)}</div>
                        <div class="history-meta">
                            <span>${sortLabel(h.sort_order)}</span>
                            <span>${h.count_per_supplier === 99999 ? '전체' : h.count_per_supplier + '개씩'}</span>
                            <span>${h.total_skus} SKU</span>
                            <span>${h.total_rows}행</span>
                            ${uploadCount ? `<span style="color:var(--success)">업로드 ${uploadCount}개</span>` : ''}
                            ${h.is_cancelled ? '<span style="color:var(--danger)">취소됨</span>' : ''}
                        </div>
                    </div>
                    <div class="history-actions">
                        <button class="btn btn-sm btn-ghost" onclick="showDetail(${h.id})">상세</button>
                        <button class="btn btn-sm btn-success" data-upload-batch="${h.id}" onclick="openResultUpload(${h.id})">업로드</button>
                        ${!h.is_cancelled ? `
                            <button class="btn btn-sm btn-secondary" onclick="redownload(${h.id})">재다운로드</button>
                            <button class="btn btn-sm btn-danger" onclick="cancelListing(${h.id})">취소</button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        console.error(e);
    }
}

async function showDetail(batchId) {
    const modal = document.getElementById('detail-modal');
    const content = document.getElementById('detail-content');
    modal.style.display = 'flex';

    try {
        const data = await api(`/api/history/${batchId}`);
        const h = data.history;
        const products = data.products;
        const resultUploads = data.result_uploads || [];
        currentDetailBatchId = batchId;

        const skuMap = {};
        products.forEach(p => {
            if (!skuMap[p.sku_group]) skuMap[p.sku_group] = [];
            skuMap[p.sku_group].push(p);
        });

        content.innerHTML = `
            <div class="detail-summary">
                <p><strong>날짜:</strong> ${formatDate(h.batch_date)}</p>
                <p><strong>사업자:</strong> ${escapeHtml(JSON.parse(h.suppliers || '[]').join(', '))}</p>
                <p><strong>정렬:</strong> ${sortLabel(h.sort_order)} / ${h.count_per_supplier === 99999 ? '전체' : h.count_per_supplier + '개씩'}</p>
                <p><strong>파일:</strong> ${escapeHtml(h.file_name)}</p>
            </div>
            <div class="detail-section">
                <div class="detail-section-header">
                    <h4>다운로드 상품</h4>
                    <span class="badge badge-secondary">${Object.keys(skuMap).length} SKU</span>
                </div>
                <div class="result-table-wrap">
                    <table class="preview-table">
                        <thead>
                            <tr>
                                <th>SKU 그룹</th>
                                <th>사업자</th>
                                <th>상품명</th>
                                <th>옵션</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.values(skuMap).map(group => `
                                <tr>
                                    <td style="font-weight:600">${escapeHtml(group[0].sku_group)}</td>
                                    <td><span class="badge badge-accent">${escapeHtml(group[0].supplier_code)}</span></td>
                                    <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(group[0].product_name)}</td>
                                    <td>
                                        <div class="option-tags">
                                            ${group.map(p => `<span class="option-tag">${escapeHtml(p.option_code || 'A')}</span>`).join('')}
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="detail-section">
                <div class="detail-section-header">
                    <h4>업로드 결과</h4>
                    <button class="btn btn-sm btn-success" data-upload-batch="${batchId}" onclick="openResultUpload(${batchId})">업로드</button>
                </div>
                ${renderResultUploads(resultUploads)}
            </div>
        `;

    } catch (e) {
        content.innerHTML = '<p>상세 정보를 불러올 수 없습니다</p>';
    }
}

function renderResultUploads(uploads) {
    if (!uploads.length) {
        return '<div class="empty-state empty-state-sm"><p>업로드된 결과 파일이 없습니다</p></div>';
    }

    return `
        <div class="result-upload-list">
            ${uploads.map(upload => `
                <div class="result-upload-panel">
                    <div class="result-upload-header">
                        <div class="result-upload-file">${escapeHtml(upload.file_name)}</div>
                        <div class="result-upload-meta">
                            <span class="badge badge-success">${escapeHtml(upload.result_type || '후처리 결과')}</span>
                            <span>${formatDate(upload.upload_date)}</span>
                            <span>${escapeHtml(upload.sheet_name || '-')}</span>
                            <span>${formatNumber(upload.row_count || 0)}행</span>
                        </div>
                    </div>
                    ${renderResultTable(upload)}
                </div>
            `).join('')}
        </div>
    `;
}

function renderResultTable(upload) {
    const headers = upload.headers || [];
    const rows = upload.rows || [];
    if (!headers.length) {
        return '<div class="empty-state empty-state-sm"><p>표시할 데이터가 없습니다</p></div>';
    }

    return `
        <div class="result-table-wrap">
            <table class="preview-table result-table">
                <thead>
                    <tr>
                        ${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(row => `
                        <tr>
                            ${headers.map(header => `<td>${escapeHtml(row[header])}</td>`).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function getResultUploadInput() {
    let input = document.getElementById('result-upload-input');
    if (input) return input;

    input = document.createElement('input');
    input.type = 'file';
    input.id = 'result-upload-input';
    input.accept = '.xlsx,.xlsm,.xltx,.xltm';
    input.multiple = true;
    input.hidden = true;
    input.addEventListener('change', () => {
        const batchId = Number(input.dataset.batchId);
        const files = Array.from(input.files || []);
        if (batchId && files.length) uploadListingResults(batchId, files);
    });
    document.body.appendChild(input);
    return input;
}

function openResultUpload(batchId) {
    const input = getResultUploadInput();
    input.dataset.batchId = String(batchId);
    input.value = '';
    input.click();
}

async function uploadListingResults(batchId, files) {
    const invalid = files.find(file => !file.name.match(/\.(xlsx|xlsm|xltx|xltm)$/i));
    if (invalid) {
        toast('Excel 파일(.xlsx)만 업로드 가능합니다', 'error');
        return;
    }

    const buttons = document.querySelectorAll(`[data-upload-batch="${batchId}"]`);
    buttons.forEach(btn => {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = '업로드 중';
    });

    const formData = new FormData();
    files.forEach(file => formData.append('files', file));

    try {
        const res = await fetch(`/api/history/${batchId}/result-upload`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || '업로드 실패');

        const rowCount = (data.uploads || []).reduce((sum, upload) => sum + Number(upload.row_count || 0), 0);
        toast(`결과 업로드 완료: ${data.uploads.length}개 파일, ${formatNumber(rowCount)}행`, 'success');
        await loadHistory();

        const modal = document.getElementById('detail-modal');
        if (modal && modal.style.display === 'flex' && currentDetailBatchId === batchId) {
            await showDetail(batchId);
        }
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        buttons.forEach(btn => {
            btn.disabled = false;
            btn.textContent = btn.dataset.originalText || '업로드';
        });
    }
}

function closeModal(e) {
    if (e.target === e.currentTarget) e.target.style.display = 'none';
}

async function cancelListing(batchId) {
    if (!confirm('이 리스팅을 취소하시겠습니까?\n해당 상품들이 다시 선택 가능해집니다.')) return;

    try {
        await api(`/api/history/${batchId}/cancel`, { method: 'POST' });
        toast('리스팅이 취소되었습니다', 'success');
        loadHistory();
    } catch (e) {
        console.error(e);
    }
}

function redownload(batchId) {
    window.location.href = `/api/history/${batchId}/redownload`;
}

/* ===== Result Data Editor ===== */
let resultUploadOptions = [];
let currentResultUpload = null;
let currentResultRows = [];
let isResultDirty = false;
let visibleResultColumns = new Set();

function cloneRows(rows) {
    return (rows || []).map(row => ({ ...row }));
}

function resultUploadLabel(item) {
    const uploadDate = formatDate(item.upload_date);
    const batchDate = formatDate(item.batch_date);
    const type = item.result_type || '후처리 결과';
    return `${uploadDate} / ${batchDate} 다운로드 / ${type} / ${item.file_name}`;
}

function resultUploadMeta(item) {
    if (!item) return '업로드된 결과 파일이 없습니다';

    let suppliers = [];
    try {
        suppliers = JSON.parse(item.suppliers || '[]');
    } catch (e) {
        suppliers = [];
    }

    const supplierText = suppliers.length > 4
        ? `${suppliers.slice(0, 4).join(', ')} 외 ${suppliers.length - 4}개`
        : suppliers.join(', ');

    return [
        `다운로드 ${formatDate(item.batch_date)}`,
        `업로드 ${formatDate(item.upload_date)}`,
        item.modified_date ? `수정 ${formatDate(item.modified_date)}` : '',
        supplierText,
        `${formatNumber(item.row_count || 0)}행`
    ].filter(Boolean).join(' · ');
}

async function loadResultUploadOptions() {
    const select = document.getElementById('result-upload-select');
    const meta = document.getElementById('result-picker-meta');
    if (!select) return;

    const selected = select.value;

    try {
        resultUploadOptions = await api('/api/result-uploads');
        if (!resultUploadOptions.length) {
            select.innerHTML = '<option value="">업로드 결과가 없습니다</option>';
            if (meta) meta.textContent = '리스팅 이력에서 결과 엑셀을 먼저 업로드하세요';
            document.getElementById('result-editor-card').style.display = 'none';
            return;
        }

        select.innerHTML = `
            <option value="">업로드 결과를 선택하세요</option>
            ${resultUploadOptions.map(item => `
                <option value="${item.id}">${escapeHtml(resultUploadLabel(item))}</option>
            `).join('')}
        `;

        if (selected && resultUploadOptions.some(item => String(item.id) === selected)) {
            select.value = selected;
        }

        const selectedItem = resultUploadOptions.find(item => String(item.id) === select.value);
        if (meta) meta.textContent = resultUploadMeta(selectedItem || resultUploadOptions[0]);

        if (!select.value && resultUploadOptions.length === 1) {
            select.value = String(resultUploadOptions[0].id);
            await loadSelectedResultUpload();
        } else if (select.value) {
            await loadSelectedResultUpload();
        }
    } catch (e) {
        console.error(e);
    }
}

async function loadSelectedResultUpload() {
    const select = document.getElementById('result-upload-select');
    const card = document.getElementById('result-editor-card');
    const meta = document.getElementById('result-picker-meta');
    if (!select || !card) return;

    const uploadId = select.value;
    const selectedItem = resultUploadOptions.find(item => String(item.id) === uploadId);
    if (meta) meta.textContent = resultUploadMeta(selectedItem);

    if (!uploadId) {
        card.style.display = 'none';
        currentResultUpload = null;
        currentResultRows = [];
        setResultDirty(false);
        return;
    }

    try {
        currentResultUpload = await api(`/api/result-uploads/${uploadId}`);
        currentResultRows = cloneRows(currentResultUpload.rows);
        visibleResultColumns = new Set(currentResultUpload.headers || []);
        renderEditableResultUpload(currentResultUpload, false);
        card.style.display = 'block';
    } catch (e) {
        card.style.display = 'none';
    }
}

function renderEditableResultUpload(upload, dirty) {
    const table = document.getElementById('editable-result-table');
    const title = document.getElementById('result-editor-title');
    const subtitle = document.getElementById('result-editor-subtitle');
    const rowCount = document.getElementById('result-row-count');
    const colCount = document.getElementById('result-col-count');
    if (!table || !upload) return;

    const headers = upload.headers || [];
    const rows = currentResultRows;
    const visibleHeaders = headers
        .map((header, index) => ({ header, index }))
        .filter(item => visibleResultColumns.has(item.header));

    title.textContent = upload.file_name || '결과 데이터';
    subtitle.textContent = resultUploadMeta(upload);
    rowCount.textContent = `${formatNumber(rows.length)}행`;
    colCount.textContent = `${formatNumber(visibleHeaders.length)} / ${formatNumber(headers.length)}열`;
    renderResultColumnPicker(headers);

    if (!headers.length) {
        table.innerHTML = '';
        setResultDirty(false);
        return;
    }

    table.innerHTML = `
        <thead>
            <tr>
                <th class="row-number-cell">#</th>
                ${visibleHeaders.map(item => `<th title="${escapeHtml(item.header)}">${escapeHtml(item.header)}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
            ${rows.map((row, rowIndex) => `
                <tr>
                    <td class="row-number-cell">${rowIndex + 1}</td>
                    ${visibleHeaders.map(item => `
                        <td contenteditable="true"
                            spellcheck="false"
                            data-row="${rowIndex}"
                            data-col="${item.index}"
                            oninput="handleResultCellInput(this)"
                            onpaste="handleResultCellPaste(event)">${escapeHtml(row[item.header])}</td>
                    `).join('')}
                </tr>
            `).join('')}
        </tbody>
    `;

    setResultDirty(dirty);
}

function handleResultCellInput(cell) {
    if (!currentResultUpload) return;

    const rowIndex = Number(cell.dataset.row);
    const colIndex = Number(cell.dataset.col);
    const header = currentResultUpload.headers[colIndex];
    if (!header || !currentResultRows[rowIndex]) return;

    currentResultRows[rowIndex][header] = cell.textContent;
    setResultDirty(true);
}

function handleResultCellPaste(event) {
    event.preventDefault();
    const text = (event.clipboardData || window.clipboardData).getData('text');
    document.execCommand('insertText', false, text);
}

function renderResultColumnPicker(headers) {
    const list = document.getElementById('result-column-list');
    if (!list) return;
    const searchValue = document.querySelector('.column-search')?.value || '';

    list.innerHTML = headers.map((header, index) => `
        <label class="column-option" data-column-label="${escapeHtml(header).toLowerCase()}">
            <input type="checkbox"
                   ${visibleResultColumns.has(header) ? 'checked' : ''}
                   onchange="toggleResultColumn(${index}, this.checked)">
            <span>${escapeHtml(header)}</span>
        </label>
    `).join('');
    filterResultColumnOptions(searchValue);
}

function toggleResultColumn(colIndex, checked) {
    if (!currentResultUpload) return;

    const header = currentResultUpload.headers[colIndex];
    if (!header) return;

    if (checked) {
        visibleResultColumns.add(header);
    } else {
        if (visibleResultColumns.size <= 1) {
            toast('최소 1개 칼럼은 선택해야 합니다', 'error');
            renderResultColumnPicker(currentResultUpload.headers || []);
            return;
        }
        visibleResultColumns.delete(header);
    }

    renderEditableResultUpload(currentResultUpload, isResultDirty);
}

function setAllResultColumns(visible) {
    if (!currentResultUpload) return;
    if (visible) {
        visibleResultColumns = new Set(currentResultUpload.headers || []);
    }
    renderEditableResultUpload(currentResultUpload, isResultDirty);
}

function filterResultColumnOptions(query) {
    const lower = String(query || '').trim().toLowerCase();
    document.querySelectorAll('#result-column-list .column-option').forEach(option => {
        const label = option.dataset.columnLabel || '';
        option.style.display = !lower || label.includes(lower) ? 'flex' : 'none';
    });
}

function setResultDirty(dirty) {
    isResultDirty = dirty;
    const saveBtn = document.getElementById('btn-save-result');
    const badge = document.getElementById('result-dirty-badge');
    if (saveBtn) saveBtn.disabled = !dirty;
    if (badge) badge.style.display = dirty ? 'inline-flex' : 'none';
}

function restoreOriginalResultRows() {
    if (!currentResultUpload) return;
    if (!confirm('현재 표를 업로드 당시 원본 데이터로 되돌릴까요?')) return;

    currentResultRows = cloneRows(currentResultUpload.original_rows || currentResultUpload.rows);
    currentResultUpload.rows = cloneRows(currentResultRows);
    renderEditableResultUpload(currentResultUpload, true);
}

async function saveCurrentResultUpload() {
    if (!currentResultUpload) return null;

    const saveBtn = document.getElementById('btn-save-result');
    const originalText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '저장 중';
    }

    try {
        const data = await api(`/api/result-uploads/${currentResultUpload.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: currentResultRows })
        });

        currentResultUpload = data.upload;
        currentResultRows = cloneRows(currentResultUpload.rows);
        setResultDirty(false);
        toast('수정 내용이 저장되었습니다', 'success');
        await loadResultUploadOptions();
        return currentResultUpload;
    } catch (e) {
        return null;
    } finally {
        if (saveBtn) {
            saveBtn.textContent = originalText || '수정 저장';
            saveBtn.disabled = !isResultDirty;
        }
    }
}

function reloadCurrentResultUpload() {
    return restoreOriginalResultRows();
}

async function downloadCurrentResultUpload() {
    if (!currentResultUpload) return;

    if (isResultDirty) {
        const saved = await saveCurrentResultUpload();
        if (!saved) return;
    }

    window.location.href = `/api/result-uploads/${currentResultUpload.id}/download`;
}

/* ===== Dashboard ===== */
let monthlyChart = null;

async function loadDashboard() {
    try {
        const data = await api('/api/dashboard');

        const overall = data.overall;
        const total = overall.total_skus || 0;
        const listed = overall.listed_skus || 0;
        const remaining = total - listed;
        const percent = total > 0 ? ((listed / total) * 100).toFixed(1) : 0;

        setText('stat-total', formatNumber(total));
        setText('stat-listed', formatNumber(listed));
        setText('stat-remaining', formatNumber(remaining));
        setText('stat-percent', `${percent}%`);

        const progressFill = document.getElementById('overall-progress-fill');
        const progressLabel = document.getElementById('overall-progress-label');
        if (progressFill) {
            setTimeout(() => { progressFill.style.width = `${percent}%`; }, 100);
        }
        if (progressLabel) progressLabel.textContent = `${percent}%`;

        renderSupplierProgress(data.by_supplier);
        renderMonthlyChart(data.monthly);
        renderActivity(data.recent);

    } catch (e) {
        console.error(e);
    }
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function renderSupplierProgress(suppliers) {
    const container = document.getElementById('supplier-progress-list');
    if (!container || !suppliers.length) return;

    container.innerHTML = suppliers.map(s => {
        const percent = s.total_skus > 0 ? ((s.listed_skus / s.total_skus) * 100).toFixed(1) : 0;
        const isComplete = parseFloat(percent) >= 100;
        return `
            <div class="sp-item">
                <div class="sp-name">${s.supplier_code}</div>
                <div class="sp-bar-wrap">
                    <div class="sp-bar">
                        <div class="sp-fill ${isComplete ? 'complete' : ''}" style="width:${percent}%"></div>
                    </div>
                </div>
                <div class="sp-stats">
                    ${s.listed_skus}/${s.total_skus}
                    <span class="sp-percent">${percent}%</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderMonthlyChart(monthly) {
    const canvas = document.getElementById('monthly-chart');
    if (!canvas || !monthly.length) return;

    const reversed = [...monthly].reverse();
    const labels = reversed.map(m => m.month);
    const values = reversed.map(m => m.skus);

    if (monthlyChart) monthlyChart.destroy();

    monthlyChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '리스팅 SKU 수',
                data: values,
                backgroundColor: 'rgba(99, 102, 241, 0.6)',
                borderColor: 'rgba(99, 102, 241, 1)',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(51,65,85,0.3)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(51,65,85,0.3)' }
                }
            }
        }
    });
}

function renderActivity(recent) {
    const container = document.getElementById('activity-list');
    if (!container) return;

    if (!recent || !recent.length) {
        container.innerHTML = '<div class="empty-state"><p>활동 내역이 없습니다</p></div>';
        return;
    }

    container.innerHTML = recent.map(r => {
        const suppliers = JSON.parse(r.suppliers || '[]');
        const supplierStr = suppliers.length > 2
            ? `${suppliers[0]} 외 ${suppliers.length - 1}개 사업자`
            : suppliers.join(', ');
        const date = formatDate(r.batch_date).split(' ');
        return `
            <div class="activity-item">
                <div class="activity-dot"></div>
                <div class="activity-date">${date[0] || ''}</div>
                <div>${supplierStr} - ${r.total_skus} SKU, ${r.total_rows}행 다운로드</div>
            </div>
        `;
    }).join('');
}

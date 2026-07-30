document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-layout-controls.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-import.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-quick-products.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'product-variants.css'}));

const credential = {username: 'admin', password: '07931548'};
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const money = value => `${new Intl.NumberFormat('vi-VN').format(value)} ₫`;
let tab = 'dashboard';

function normaliseImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return '';
  return `/${url.replace(/^\.?\//, '')}`;
}

function newProductVariantId() {
  return `variant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validAdminProductVariants(value) {
  return Array.isArray(value) ? value.filter(variant => String(variant?.name || '').trim()) : [];
}

function productVariantRowMarkup(variant = {}) {
  const id = String(variant.id || newProductVariantId());
  return `<div class="product-variant-row" data-variant-id="${escapeHtml(id)}">
    <label>Tên lựa chọn<input data-variant-name required value="${escapeHtml(variant.name || '')}" placeholder="Ví dụ: Hộp 4 bánh"></label>
    <label>Giá bán (VNĐ)<input data-variant-price type="number" min="0" inputmode="numeric" required value="${variant.price ?? ''}" placeholder="750000"></label>
    <label>Mã SKU<input data-variant-sku value="${escapeHtml(variant.sku || '')}" placeholder="AM-2026-04"></label>
    <button type="button" class="remove-product-variant" data-remove-variant aria-label="Xóa lựa chọn này">×</button>
  </div>`;
}

function productVariantsFromEditor(list) {
  const rows = [...list.querySelectorAll('[data-variant-id]')];
  if (rows.length > 20) throw new Error('Mỗi sản phẩm tối đa 20 lựa chọn.');
  const names = new Set();
  const skus = new Set();
  return rows.map(row => {
    const name = String(row.querySelector('[data-variant-name]').value || '').trim().slice(0, 120);
    const price = Number(row.querySelector('[data-variant-price]').value);
    const sku = String(row.querySelector('[data-variant-sku]').value || '').trim().slice(0, 100);
    if (!name || !Number.isFinite(price) || price < 0) throw new Error('Mỗi lựa chọn cần có tên và giá bán hợp lệ.');
    const nameKey = name.toLocaleLowerCase('vi-VN');
    const skuKey = sku.toLocaleLowerCase('vi-VN');
    if (names.has(nameKey)) throw new Error('Tên các lựa chọn không được trùng nhau.');
    if (sku && skus.has(skuKey)) throw new Error('Mã SKU của các lựa chọn không được trùng nhau.');
    names.add(nameKey);
    if (sku) skus.add(skuKey);
    return {id: row.dataset.variantId || newProductVariantId(), name, price: Math.round(price), sku};
  });
}

function bindProductVariantEditor(form) {
  const list = form.querySelector('[data-variant-rows]');
  const addButton = form.querySelector('[data-add-variant]');
  const priceInput = form.elements.price;
  const hint = form.querySelector('[data-variant-price-hint]');
  const originalPrice = priceInput.value;

  const syncPrice = () => {
    const rows = [...list.querySelectorAll('[data-variant-id]')];
    const prices = rows.map(row => Number(row.querySelector('[data-variant-price]').value));
    const hasVariants = rows.length > 0;
    priceInput.readOnly = hasVariants;
    priceInput.classList.toggle('derived-price', hasVariants);
    if (!hasVariants) {
      priceInput.value = originalPrice;
      hint.textContent = 'Dùng giá chung khi sản phẩm không có lựa chọn.';
      return;
    }
    const validPrices = prices.filter(price => Number.isFinite(price) && price >= 0);
    priceInput.value = validPrices.length === prices.length ? Math.min(...validPrices) : '';
    hint.textContent = `Giá từ được lấy tự động theo ${rows.length} lựa chọn.`;
  };

  const bindRow = row => {
    row.querySelector('[data-remove-variant]').onclick = () => {
      row.remove();
      syncPrice();
    };
    row.querySelectorAll('input').forEach(input => input.addEventListener('input', syncPrice));
  };
  list.querySelectorAll('[data-variant-id]').forEach(bindRow);
  addButton.onclick = () => {
    if (list.querySelectorAll('[data-variant-id]').length >= 20) {
      toastAdmin('Mỗi sản phẩm tối đa 20 lựa chọn.');
      return;
    }
    list.insertAdjacentHTML('beforeend', productVariantRowMarkup());
    const row = list.lastElementChild;
    bindRow(row);
    syncPrice();
    row.querySelector('[data-variant-name]').focus();
  };
  syncPrice();
  return () => productVariantsFromEditor(list);
}

function setPreview(target, value, emptyText = 'Chưa chọn ảnh banner') {
  const preview = typeof target === 'string' ? $(target) : target;
  if (!preview) return;

  const url = normaliseImageUrl(value);
  preview.replaceChildren();
  if (!url) {
    preview.classList.add('is-empty');
    preview.textContent = emptyText;
    return;
  }

  preview.classList.remove('is-empty');
  const image = new Image();
  image.alt = 'Xem trước ảnh đã chọn';
  image.src = url;
  image.addEventListener('error', () => {
    preview.classList.add('is-empty');
    preview.textContent = 'Không tải được ảnh. Hãy kiểm tra lại đường dẫn.';
  }, {once: true});
  preview.append(image);
}

function setBusy(button, busy, busyText, idleText) {
  button.disabled = busy;
  button.textContent = busy ? busyText : idleText;
}

async function uploadOfficialImage(file) {
  if (!file) return null;
  return window.uploadAeonImage(file);
}

async function saveShared(key, value) {
  const saved = await aeonStore.set(key, value);
  if (saved) return value;

  // Restore the last confirmed shared state when the server cannot accept a save.
  await aeonStore.pull();
  throw new Error('Không thể lưu vào máy chủ. Vui lòng kiểm tra kết nối rồi thử lại.');
}

async function remoteState() {
  const supabase = window.getAeonSupabase();
  const {data, error} = await supabase.from('aeon_state').select('key,value');
  if (error) throw new Error('Không thể kiểm tra dữ liệu đã lưu trên máy chủ.');
  const state = {};
  (data || []).forEach(row => { state[row.key] = row.value; });
  return state;
}

function sameImage(left, right) {
  return normaliseImageUrl(left) === normaliseImageUrl(right);
}

async function verifyProductImage(productId, expectedImage) {
  if (!expectedImage) return;
  const state = await remoteState();
  const product = (state['aeon-products'] || []).find(item => item.id === productId);
  if (!product || !sameImage(product.image, expectedImage)) {
    throw new Error('Ảnh đã tải lên nhưng chưa được gắn vào sản phẩm. Vui lòng thử lại.');
  }
}

async function saveHeroImage(value) {
  const heroImage = normaliseImageUrl(value);
  let latestUi = {};
  try {
    latestUi = (await remoteState())['aeon-ui'] || {};
  } catch {
    latestUi = aeonStore.ui();
  }
  await saveShared('aeon-ui', {...aeonStore.ui(), ...latestUi, heroImage});
  const confirmed = await remoteState();
  if (!sameImage(confirmed['aeon-ui']?.heroImage, heroImage)) {
    throw new Error('Ảnh banner chưa được lưu trên máy chủ. Vui lòng thử lại.');
  }
  return heroImage;
}

function isAuthed() {
  return aeonStore.isAdminSession();
}

function showApp() {
  const login = $('#loginView');
  const app = $('#adminApp');
  login.hidden = true;
  login.style.display = 'none';
  app.hidden = false;
  app.style.display = 'grid';
  history.replaceState(null, '', 'admin.html#dashboard');
  render();
}

$('#loginForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const username = String(form.get('username')).trim();
  const password = String(form.get('password')).trim();

  if (username === credential.username && password === credential.password) {
    aeonStore.setAdminSession(true);
    showApp();
    return;
  }
  $('#loginError').textContent = 'Tài khoản hoặc mật khẩu chưa đúng.';
});

$('#logout').onclick = () => {
  aeonStore.setAdminSession(false);
  location.reload();
};

document.querySelectorAll('[data-tab]').forEach(button => {
  button.onclick = () => {
    tab = button.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach(item => item.classList.toggle('active', item === button));
    render();
  };
});

function render() {
  const labels = {
    dashboard: 'Tổng quan',
    products: 'Sản phẩm & giá',
    interface: 'Giao diện',
    customers: 'Khách hàng'
  };
  $('#adminTitle').textContent = labels[tab];
  const panel = $('#adminPanel');
  if (tab === 'dashboard') return dashboard(panel);
  if (tab === 'products') return productPanel(panel);
  if (tab === 'interface') {
    interfacePanel(panel);
    assetPanel(panel);
    return layoutPanel(panel);
  }
  return customersPanel(panel);
}

function quickProductRow(product, isNew = false) {
  const id = product.id || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const variants = validAdminProductVariants(product.variants);
  const variantPrices = variants.map(variant => Number(variant.price)).filter(price => Number.isFinite(price) && price >= 0);
  const price = variantPrices.length ? Math.min(...variantPrices) : (product.price ?? '');
  return `<article class="quick-product-row" data-quick-id="${escapeHtml(id)}" data-quick-new="${isNew}">
    <header><div><span class="quick-product-kicker">${isNew ? 'SẢN PHẨM MỚI' : 'CẬP NHẬT NHANH'}</span><strong>${escapeHtml(product.name || 'Sản phẩm mới')}</strong>${variants.length ? `<small>${variants.length} lựa chọn · chỉnh sửa đầy đủ để cập nhật</small>` : ''}</div><div class="quick-row-actions">${isNew ? '<button class="quick-remove" type="button" data-quick-remove aria-label="Bỏ sản phẩm mới">×</button>' : `<button class="quick-detail" type="button" data-quick-detail="${escapeHtml(id)}">Chỉnh sửa đầy đủ</button>`}</div></header>
    <div class="quick-product-fields">
      <label>Tên sản phẩm<input data-quick-name value="${escapeHtml(product.name || '')}" required></label>
      <label>Thương hiệu<select data-quick-brand>${aeonBrandOptions(product.brand)}</select></label>
      <label>${variants.length ? 'Giá từ (VNĐ)' : 'Giá bán (VNĐ)'}<input data-quick-price type="number" min="0" inputmode="numeric" value="${price}" required${variants.length ? ' readonly' : ''}></label>
      <label>Nhãn hiển thị<input data-quick-label value="${escapeHtml(product.label || '')}" placeholder="Ví dụ: Bán chạy"></label>
      <label class="wide">Mô tả ngắn<textarea data-quick-description rows="2" required placeholder="Mô tả hiển thị trên thẻ sản phẩm">${escapeHtml(product.description || '')}</textarea></label>
    </div>
  </article>`;
}

function quickProductValues(list) {
  return [...list.querySelectorAll('[data-quick-id]')].map(row => ({
    id: row.dataset.quickId,
    isNew: row.dataset.quickNew === 'true',
    name: row.querySelector('[data-quick-name]').value,
    brand: row.querySelector('[data-quick-brand]').value,
    price: row.querySelector('[data-quick-price]').value,
    label: row.querySelector('[data-quick-label]').value,
    description: row.querySelector('[data-quick-description]').value
  }));
}

async function saveQuickProducts(rows) {
  const state = await remoteState();
  const products = Array.isArray(state['aeon-products']) ? [...state['aeon-products']] : [];
  const savedIds = [];
  let added = 0;

  rows.forEach((row, index) => {
    const name = cleanTextImport(row.name, 160);
    const description = cleanTextImport(row.description, 500);
    const price = Number(row.price);
    if (!name || !description || !Number.isFinite(price) || price < 0) {
      throw new Error('Mỗi sản phẩm cần có tên, mô tả và giá bán hợp lệ.');
    }
    const position = products.findIndex(product => product.id === row.id);
    if (!row.isNew && position < 0) throw new Error(`Sản phẩm “${name}” đã thay đổi ở phiên khác. Hãy tải lại trang trước khi lưu.`);
    const existing = position >= 0 ? products[position] : null;
    const id = existing?.id || `sp-${Date.now()}-${index}`;
    const existingVariants = validAdminProductVariants(existing?.variants);
    const variantPrices = existingVariants.map(variant => Number(variant.price)).filter(value => Number.isFinite(value) && value >= 0);
    const product = {
      ...existing,
      id,
      name,
      price: variantPrices.length ? Math.min(...variantPrices) : Math.round(price),
      brand: normaliseAeonBrand(row.brand),
      label: cleanTextImport(row.label, 100),
      description,
      image: normaliseImageUrl(existing?.image || ''),
      bg: existing?.bg || '#e9c38b',
      box: existing?.box || '#8f1834'
    };
    if (position >= 0) products[position] = product;
    else {
      products.push(product);
      added += 1;
    }
    savedIds.push(id);
  });

  await saveShared('aeon-products', products);
  const confirmed = await remoteState();
  const persisted = Array.isArray(confirmed['aeon-products']) ? confirmed['aeon-products'] : [];
  if (!savedIds.every(id => persisted.some(product => product.id === id))) {
    throw new Error('Một số thay đổi chưa được lưu trên máy chủ. Vui lòng thử lại.');
  }
  return {saved: savedIds.length, added};
}

function openProductDetailFromDashboard(id) {
  openProductEditor(id, {
    mount: '#dashboardProductEditor',
    onSaved: () => dashboard($('#adminPanel')),
    onDeleted: () => dashboard($('#adminPanel'))
  });
  $('#dashboardProductEditor').scrollIntoView({behavior: 'smooth', block: 'start'});
}

function dashboard(panel) {
  const customers = aeonStore.customers();
  const orders = aeonStore.orders();
  const revenue = orders.reduce((sum, order) => sum + order.total, 0);
  const products = aeonStore.products();
  panel.innerHTML = `
    <div class="stats">
      <article><span>Đơn hàng</span><strong>${orders.length}</strong></article>
      <article><span>Khách hàng</span><strong>${customers.length}</strong></article>
      <article><span>Doanh thu mẫu</span><strong>${money(revenue)}</strong></article>
      <article><span>Sản phẩm</span><strong>${products.length}</strong></article>
    </div>
    <section class="admin-card quick-product-manager" aria-labelledby="quickProductTitle">
      <div class="quick-product-head"><div><p class="eyebrow">QUẢN LÝ NHANH</p><h2 id="quickProductTitle">Sản phẩm ngay trên màn hình chính</h2><p>Thêm hoặc cập nhật tên, giá và mô tả. Ảnh, thành phần và thông tin chi tiết hiện có vẫn được giữ nguyên.</p></div><div class="quick-product-actions"><button class="secondary-button" id="quickAddProduct" type="button">+ Thêm sản phẩm</button><button class="button primary" id="quickSaveProducts" type="button">Lưu thay đổi</button></div></div>
      <div class="quick-product-list" id="quickProductList">${products.length ? products.map(product => quickProductRow(product)).join('') : '<p class="empty-admin" id="quickProductsEmpty">Chưa có sản phẩm. Bấm “Thêm sản phẩm” để bắt đầu.</p>'}</div>
      <p class="quick-product-status" id="quickProductStatus" aria-live="polite">Các thay đổi chỉ được áp dụng khi bạn bấm “Lưu thay đổi”.</p>
      <div class="dashboard-product-editor" id="dashboardProductEditor"></div>
    </section>
    <section class="admin-card">
      <h2>Đơn hàng gần đây</h2>
      ${orders.length ? `<div class="admin-table">${orders.slice(0, 5).map(order => {
        const customer = customers.find(item => item.id === order.customerId) || {};
        return `<div class="table-row"><b>${order.code}</b><span>${escapeHtml(customer.name || '—')}</span><span>${order.createdAt}</span><strong>${money(order.total)}</strong></div>`;
      }).join('')}</div>` : '<p class="empty-admin">Chưa có đơn hàng nào. Đơn từ website sẽ xuất hiện tại đây.</p>'}
    </section>`;

  const list = $('#quickProductList');
  const status = $('#quickProductStatus');
  const bindQuickRow = row => {
    const detail = row.querySelector('[data-quick-detail]');
    if (detail) detail.onclick = () => openProductDetailFromDashboard(detail.dataset.quickDetail);
    const remove = row.querySelector('[data-quick-remove]');
    if (remove) remove.onclick = () => {
      row.remove();
      if (!list.children.length) list.innerHTML = '<p class="empty-admin" id="quickProductsEmpty">Chưa có sản phẩm. Bấm “Thêm sản phẩm” để bắt đầu.</p>';
    };
  };
  list.querySelectorAll('[data-quick-id]').forEach(bindQuickRow);
  $('#quickAddProduct').onclick = () => {
    const empty = $('#quickProductsEmpty');
    if (empty) empty.remove();
    list.insertAdjacentHTML('beforeend', quickProductRow({name: '', price: '', label: '', description: ''}, true));
    const row = list.lastElementChild;
    bindQuickRow(row);
    row.querySelector('[data-quick-name]').focus();
  };
  $('#quickSaveProducts').onclick = async () => {
    const rows = quickProductValues(list);
    if (!rows.length) {
      status.textContent = 'Hãy thêm ít nhất một sản phẩm trước khi lưu.';
      return;
    }
    const button = $('#quickSaveProducts');
    try {
      setBusy(button, true, 'Đang lưu...', 'Lưu thay đổi');
      const result = await saveQuickProducts(rows);
      dashboard(panel);
      toastAdmin(`Đã lưu ${result.saved} sản phẩm${result.added ? `, gồm ${result.added} sản phẩm mới` : ''}.`);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      setBusy(button, false, 'Đang lưu...', 'Lưu thay đổi');
    }
  };
}

const importFileLimit = 15 * 1024 * 1024;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Không thể đọc tệp đã chọn.'));
    reader.readAsDataURL(file);
  });
}

async function analyseProductImport(file) {
  if (!file) throw new Error('Hãy chọn tệp Excel, PDF hoặc ảnh trước.');
  if (file.size > importFileLimit) throw new Error('Tệp phải nhỏ hơn hoặc bằng 15 MB.');
  if (!/\.(xlsx|xls|csv|pdf|png|jpe?g|webp|gif)$/i.test(file.name)) {
    throw new Error('Chỉ hỗ trợ Excel (.xlsx, .xls, .csv), PDF hoặc ảnh PNG/JPG/WEBP/GIF.');
  }
  const response = await fetch('/api/import-products', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: file.name, dataUrl: await readFileAsDataUrl(file)})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Không thể phân tích tệp này.');
  return result;
}

function importedDescription(value) {
  return cleanTextImport(value) || 'Thông tin sản phẩm sẽ được cập nhật.';
}

function cleanTextImport(value, limit = 1000) {
  return String(value ?? '').replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanMultilineImport(value, limit = 1000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit);
}

function productIdentity(value) {
  return cleanTextImport(value, 160)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function importedExistingProduct(candidate, products) {
  const sku = productIdentity(candidate.sku);
  return sku ? products.find(product => productIdentity(product.sku) === sku) : null;
}

async function saveImportedProducts(drafts) {
  const state = await remoteState();
  const products = Array.isArray(state['aeon-products']) ? [...state['aeon-products']] : [];
  const savedIds = [];
  let created = 0;
  let updated = 0;

  drafts.forEach((draft, index) => {
    const name = cleanTextImport(draft.name, 160);
    const description = importedDescription(draft.description);
    const price = Number(draft.price);
    if (!name || !Number.isFinite(price) || price <= 0) throw new Error('Mỗi sản phẩm cần có tên và giá bán lớn hơn 0.');

    const sku = cleanTextImport(draft.sku, 100);
    const position = sku ? products.findIndex(product => productIdentity(product.sku) === productIdentity(sku)) : -1;
    const existing = position >= 0 ? products[position] : null;
    const existingVariants = validAdminProductVariants(existing?.variants);
    const variantPrices = existingVariants.map(variant => Number(variant.price)).filter(value => Number.isFinite(value) && value >= 0);
    const product = {
      ...existing,
      id: existing?.id || `sp-import-${Date.now()}-${index}`,
      name,
      price: variantPrices.length ? Math.min(...variantPrices) : Math.round(price),
      brand: normaliseAeonBrand(draft.brand) || normaliseAeonBrand(existing?.brand),
      description,
      sku,
      label: cleanTextImport(draft.label, 100),
      weight: cleanTextImport(draft.weight, 100),
      ingredients: cleanTextImport(draft.ingredients, 300),
      details: AEONRichText.clean(draft.details || description, 3000),
      image: normaliseImageUrl(draft.image || existing?.image || ''),
      bg: existing?.bg || '#e9c38b',
      box: existing?.box || '#8f1834'
    };
    if (position >= 0) {
      products[position] = product;
      updated += 1;
    } else {
      products.push(product);
      created += 1;
    }
    savedIds.push(product.id);
  });

  await saveShared('aeon-products', products);
  const confirmed = await remoteState();
  const persisted = Array.isArray(confirmed['aeon-products']) ? confirmed['aeon-products'] : [];
  if (!savedIds.every(id => persisted.some(product => product.id === id))) {
    throw new Error('Một số sản phẩm chưa được lưu trên máy chủ. Vui lòng thử lại.');
  }
  return {created, updated};
}

function importWarnings(candidate, existing) {
  const warnings = [...(candidate.warnings || [])];
  if (!Number(candidate.price) || Number(candidate.price) <= 0) warnings.push('Chưa có giá bán hợp lệ.');
  if (existing) warnings.push('Trùng mã sản phẩm: nếu chọn nhập, mục hiện có sẽ được cập nhật.');
  return warnings;
}

function renderImportPreview(target, analysis, products) {
  const candidates = Array.isArray(analysis.candidates) ? analysis.candidates : [];
  const sourceName = analysis.kind === 'excel' ? 'Excel' : analysis.kind === 'pdf' ? 'PDF' : 'Ảnh / OCR';
  const notices = [...(analysis.warnings || [])];
  if (!candidates.length) {
    target.innerHTML = `
      <div class="import-empty" role="status"><strong>Chưa có sản phẩm đủ thông tin để nhập.</strong><p>${escapeHtml(notices.join(' ') || 'Hãy thử tệp rõ nét hơn hoặc kiểm tra bảng giá trong Excel.')}</p>${analysis.textPreview ? `<details><summary>Xem nội dung đã trích xuất</summary><pre>${escapeHtml(analysis.textPreview)}</pre></details>` : ''}</div>`;
    return;
  }

  target.innerHTML = `
    <div class="import-result-head" aria-live="polite">
      <div><span class="import-badge">${sourceName}</span><strong>Đã nhận diện ${candidates.length} sản phẩm nháp</strong><p>Kiểm tra và chỉnh sửa trước khi thêm vào danh mục.</p></div>
      <label class="import-select-all"><input type="checkbox" id="selectAllImports" checked> Chọn tất cả hợp lệ</label>
    </div>
    ${notices.length ? `<div class="import-notices">${notices.map(notice => `<p>• ${escapeHtml(notice)}</p>`).join('')}</div>` : ''}
    <div class="import-candidates">${candidates.map((candidate, index) => {
      const existing = importedExistingProduct(candidate, products);
      const warnings = importWarnings(candidate, existing);
      const canSelect = Boolean(cleanTextImport(candidate.name));
      const selectByDefault = canSelect && Number(candidate.price) > 0 && !existing;
      return `<article class="import-candidate" data-import-index="${index}" data-existing-id="${escapeHtml(existing?.id || '')}">
        <header><label class="import-check"><input type="checkbox" data-import-select ${selectByDefault ? 'checked' : ''} ${canSelect ? '' : 'disabled'}><span>Chọn sản phẩm ${index + 1}</span></label><span class="import-confidence">Độ tin cậy ${Math.max(0, Math.min(100, Number(candidate.confidence) || 0))}%</span></header>
        <div class="import-fields">
          <label>Tên sản phẩm<input data-import-name value="${escapeHtml(candidate.name || '')}" required></label>
          <label>Thương hiệu<select data-import-brand>${aeonBrandOptions(normaliseAeonBrand(candidate.brand) || normaliseAeonBrand(existing?.brand))}</select></label>
          <label>Giá bán (VNĐ)<input data-import-price type="number" min="0" inputmode="numeric" value="${Number(candidate.price) || ''}" required></label>
          <label>Mã sản phẩm<input data-import-sku value="${escapeHtml(candidate.sku || '')}"></label>
          <label class="wide">Mô tả ngắn<textarea data-import-description rows="2">${escapeHtml(candidate.description || '')}</textarea></label>
          <label>Thành phần nổi bật<input data-import-ingredients value="${escapeHtml(candidate.ingredients || '')}" placeholder="Ví dụ: Hạt sen · trứng muối"></label>
          <div class="richtext-field wide"><span class="richtext-label">Thông tin chi tiết</span>${AEONRichText.editorMarkup({name: 'details', value: candidate.details || '', rows: 8, placeholder: 'Kiểm tra lại nội dung OCR trước khi lưu'})}</div>
        </div>
        ${warnings.length ? `<div class="import-row-warnings">${warnings.map(warning => `<p>• ${escapeHtml(warning)}</p>`).join('')}</div>` : ''}
      </article>`;
    }).join('')}</div>
    <div class="import-footer"><p id="importSelectionStatus"></p><button class="button primary" type="button" id="saveImportedProducts">Thêm sản phẩm đã chọn</button></div>
    ${analysis.textPreview ? `<details class="import-source-text"><summary>Xem nội dung đã trích xuất</summary><pre>${escapeHtml(analysis.textPreview)}</pre></details>` : ''}`;

  AEONRichText.bindAll(target);
  const checks = [...target.querySelectorAll('[data-import-select]')];
  const selectableNew = checks.filter(check => !check.disabled && !check.closest('.import-candidate').dataset.existingId);
  const updateSelection = () => {
    const selected = checks.filter(check => check.checked).length;
    $('#importSelectionStatus').textContent = selected ? `Sẵn sàng thêm ${selected} sản phẩm đã chọn.` : 'Hãy chọn ít nhất một sản phẩm hợp lệ.';
    $('#saveImportedProducts').disabled = !selected;
    const selectAll = $('#selectAllImports');
    const selectedNew = selectableNew.filter(check => check.checked).length;
    selectAll.checked = selectableNew.length > 0 && selectedNew === selectableNew.length;
    selectAll.indeterminate = selectedNew > 0 && selectedNew < selectableNew.length;
  };
  checks.forEach(check => { check.onchange = updateSelection; });
  $('#selectAllImports').onchange = event => {
    selectableNew.forEach(check => { check.checked = event.currentTarget.checked; });
    updateSelection();
  };
  updateSelection();

  $('#saveImportedProducts').onclick = async () => {
    const selected = [...target.querySelectorAll('.import-candidate')]
      .filter(card => card.querySelector('[data-import-select]').checked)
      .map(card => {
        const index = Number(card.dataset.importIndex);
        const original = candidates[index] || {};
        return {
          ...original,
          name: card.querySelector('[data-import-name]').value,
          brand: card.querySelector('[data-import-brand]').value,
          price: card.querySelector('[data-import-price]').value,
          sku: card.querySelector('[data-import-sku]').value,
          description: card.querySelector('[data-import-description]').value,
          ingredients: card.querySelector('[data-import-ingredients]').value,
          details: card.querySelector('[data-richtext-input][name="details"]').value
        };
      });
    if (!selected.length) return;
    const button = $('#saveImportedProducts');
    try {
      setBusy(button, true, 'Đang lưu...', 'Thêm sản phẩm đã chọn');
      const saved = await saveImportedProducts(selected);
      productPanel($('#adminPanel'));
      toastAdmin(`Đã thêm ${saved.created} sản phẩm${saved.updated ? ` và cập nhật ${saved.updated} sản phẩm` : ''}.`);
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang lưu...', 'Thêm sản phẩm đã chọn');
    }
  };
}

function productPanel(panel) {
  const products = aeonStore.products();
  panel.innerHTML = `
    <div class="panel-action"><p>Thêm, sửa hoặc xóa sản phẩm. Thay đổi hiển thị ngay tại cửa hàng.</p><div class="panel-action-buttons"><button class="secondary-button" id="importProducts">Nhập từ tệp</button><button class="button primary" id="newProduct">+ Thêm sản phẩm</button></div></div>
    <section class="admin-card import-products" id="productImportPanel" hidden aria-labelledby="productImportTitle">
      <div class="import-intro"><div><p class="eyebrow">NHẬP DANH MỤC</p><h2 id="productImportTitle">Phân tích sản phẩm từ tệp</h2><p>Hỗ trợ Excel (.xlsx, .xls, .csv), PDF và ảnh. Kiểm tra hoặc sửa tên, giá và thành phần trong bản nháp trước khi lưu.</p></div><button class="import-close" type="button" id="closeProductImport" aria-label="Đóng khu vực nhập tệp">×</button></div>
      <form class="import-form" id="productImportForm">
        <label class="import-dropzone" for="importProductFile"><span>Chọn tệp danh mục hoặc báo giá</span><small>Excel, PDF, PNG, JPG, WEBP hoặc GIF · tối đa 15 MB</small><input id="importProductFile" type="file" accept=".xlsx,.xls,.csv,.pdf,image/png,image/jpeg,image/webp,image/gif" required></label>
        <div class="import-actions"><p id="importFileName" aria-live="polite">Chưa chọn tệp.</p><button class="button primary" id="analyseProductFile" type="submit">Phân tích tệp</button></div>
      </form>
      <div class="import-results" id="importResults" aria-live="polite"></div>
    </section>
    <section class="admin-card">
      ${products.length ? `<div class="admin-table">${products.map(product => `<div class="table-row"><span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.description)}</small></span><span><b>${escapeHtml(normaliseAeonBrand(product.brand) || 'Chưa chọn thương hiệu')}</b><small>${escapeHtml(product.label || 'Không có nhãn hiển thị')}</small></span><strong>${money(product.price)}</strong><button class="edit-product" data-id="${product.id}">Chỉnh sửa</button></div>`).join('')}</div>` : '<p class="empty-admin">Chưa có sản phẩm. Hãy thêm sản phẩm đầu tiên.</p>'}
    </section>
    <div id="productEditor"></div>`;
  $('#newProduct').onclick = () => openProductEditor();
  const importPanel = $('#productImportPanel');
  const importResults = $('#importResults');
  $('#importProducts').onclick = () => {
    importPanel.hidden = false;
    $('#importProductFile').focus();
  };
  $('#closeProductImport').onclick = () => { importPanel.hidden = true; };
  $('#importProductFile').onchange = event => {
    const file = event.currentTarget.files[0];
    $('#importFileName').textContent = file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB` : 'Chưa chọn tệp.';
    importResults.replaceChildren();
  };
  $('#productImportForm').onsubmit = async event => {
    event.preventDefault();
    const button = $('#analyseProductFile');
    try {
      setBusy(button, true, 'Đang phân tích...', 'Phân tích tệp');
      const analysis = await analyseProductImport($('#importProductFile').files[0]);
      renderImportPreview(importResults, analysis, aeonStore.products());
    } catch (error) {
      importResults.innerHTML = `<p class="import-error" role="alert">${escapeHtml(error.message)}</p>`;
    } finally {
      setBusy(button, false, 'Đang phân tích...', 'Phân tích tệp');
    }
  };
  document.querySelectorAll('.edit-product').forEach(button => {
    button.onclick = () => openProductEditor(button.dataset.id);
  });
}

function openProductEditor(id, options = {}) {
  const editorMount = typeof options.mount === 'string' ? $(options.mount) : (options.mount || $('#productEditor'));
  if (!editorMount) return;
  const onSaved = options.onSaved || (() => productPanel($('#adminPanel')));
  const onDeleted = options.onDeleted || onSaved;
  const onCancel = options.onCancel || (() => editorMount.replaceChildren());
  const existing = aeonStore.products().find(product => product.id === id) || {
    id: `sp-${Date.now()}`,
    name: '',
    description: '',
    price: '',
    brand: '',
    label: '',
    image: '',
    details: '',
    weight: '',
    ingredients: '',
    sku: '',
    variants: [],
    bg: '#e9c38b',
    box: '#8f1834'
  };
  const editorVariants = validAdminProductVariants(existing.variants);

  let getProductVariants = () => [];
  const saveProduct = async form => {
    const data = Object.fromEntries(new FormData(form));
    data.id = existing.id;
    data.details = AEONRichText.clean(data.details, 3000);
    data.variants = getProductVariants();
    data.price = data.variants.length ? Math.min(...data.variants.map(variant => variant.price)) : Number(data.price);
    if (!Number.isFinite(data.price) || data.price < 0) throw new Error('Giá bán không hợp lệ.');
    data.image = normaliseImageUrl(data.image);
    data.brand = normaliseAeonBrand(data.brand);
    let all = [...aeonStore.products()];
    try {
      const state = await remoteState();
      if (Array.isArray(state['aeon-products'])) all = state['aeon-products'];
    } catch {
      // saveShared will surface a real connectivity error if the following write cannot succeed.
    }
    const position = all.findIndex(product => product.id === data.id);
    const stored = position < 0 ? null : all[position];
    // A stale admin tab must not erase an image uploaded in another tab.
    if (!data.image && stored?.image) data.image = normaliseImageUrl(stored.image);
    if (position < 0) all.push(data);
    else all[position] = {...stored, ...data};
    await saveShared('aeon-products', all);
    await verifyProductImage(data.id, data.image);
    return data;
  };

  editorMount.innerHTML = `
    <section class="admin-card editor">
      <h2>${id ? 'Chỉnh sửa sản phẩm' : 'Sản phẩm mới'}</h2>
      <p>Chọn ảnh để tải lên hoặc dán đường dẫn ảnh online. Bạn cũng có thể dùng ảnh sản phẩm làm banner.</p>
      <form id="productForm">
        <div class="admin-form-grid">
          <label>Tên sản phẩm<input name="name" required value="${escapeHtml(existing.name)}"></label>
          <label>Thương hiệu<select name="brand">${aeonBrandOptions(existing.brand)}</select></label>
          <label>Giá bán (VNĐ)<small data-variant-price-hint></small><input name="price" type="number" min="0" inputmode="numeric" required value="${existing.price ?? ''}" placeholder="Ví dụ: 750000"${editorVariants.length ? ' readonly' : ''}></label>
          <label>Mô tả ngắn<textarea name="description" required rows="2" placeholder="Tóm tắt hiển thị trên thẻ sản phẩm">${escapeHtml(existing.description)}</textarea></label>
          <label>Nhãn hiển thị<input name="label" value="${escapeHtml(existing.label)}"></label>
          <label>Quy cách / khối lượng<input name="weight" value="${escapeHtml(existing.weight || '')}" placeholder="Ví dụ: 4 bánh · 720g"></label>
          <label>Thành phần nổi bật<input name="ingredients" value="${escapeHtml(existing.ingredients || '')}" placeholder="Ví dụ: Hạt sen, trứng muối"></label>
          <label>Mã sản phẩm<input name="sku" value="${escapeHtml(existing.sku || '')}" placeholder="Ví dụ: AM-2026-01"></label>
          <fieldset class="product-variant-editor image-path"><legend>Lựa chọn sản phẩm</legend><p>Một hình có thể đại diện nhiều loại hàng. Khách sẽ chọn loại trước khi thêm vào giỏ.</p><div class="product-variant-rows" data-variant-rows>${editorVariants.map(productVariantRowMarkup).join('')}</div><button class="secondary-button" type="button" data-add-variant>+ Thêm lựa chọn</button></fieldset>
          <div class="richtext-field image-path"><span class="richtext-label">Chi tiết sản phẩm</span>${AEONRichText.editorMarkup({name: 'details', value: existing.details || '', rows: 8, placeholder: 'Thông tin hiển thị trong trang chi tiết'})}</div>
          <label class="image-path">Đường dẫn ảnh<input name="image" value="${escapeHtml(existing.image || '')}" placeholder="https://... hoặc assets/uploads/..."></label>
          <label class="upload-field">Tải ảnh từ máy<input id="productImageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><button class="secondary-button" id="uploadProductImage" type="button">Tải ảnh lên</button></label>
          <label>Màu nền khi chưa có ảnh<input name="bg" type="color" value="${existing.bg}"></label>
          <label>Màu hộp khi chưa có ảnh<input name="box" type="color" value="${existing.box}"></label>
        </div>
        <div class="asset-preview compact" id="productPreview" aria-live="polite"></div>
        <div class="editor-actions">
          <button type="button" class="secondary-button" id="closeProductEditor">Đóng</button>
          <button type="button" class="secondary-button" id="useProductImageAsHero">Dùng ảnh này làm banner</button>
          <button type="submit" class="button primary">Lưu sản phẩm</button>
          ${id ? '<button type="button" class="danger" id="deleteProduct">Xóa sản phẩm</button>' : ''}
        </div>
      </form>
    </section>`;

  const form = $('#productForm');
  AEONRichText.bindAll(form);
  getProductVariants = bindProductVariantEditor(form);
  $('#closeProductEditor').onclick = onCancel;
  setPreview($('#productPreview'), existing.image, 'Chưa chọn ảnh sản phẩm');
  form.elements.image.addEventListener('input', () => setPreview($('#productPreview'), form.elements.image.value, 'Chưa chọn ảnh sản phẩm'));

  $('#uploadProductImage').onclick = async () => {
    const button = $('#uploadProductImage');
    try {
      setBusy(button, true, 'Đang tải...', 'Tải ảnh lên');
      const url = await uploadOfficialImage($('#productImageFile').files[0]);
      if (!url) throw new Error('Hãy chọn ảnh trước khi tải lên.');
      form.elements.image.value = url;
      setPreview($('#productPreview'), url, 'Chưa chọn ảnh sản phẩm');
      if (form.checkValidity()) {
        await saveProduct(form);
        toastAdmin('Ảnh sản phẩm đã được tải lên và đồng bộ.');
      } else {
        toastAdmin('Ảnh đã tải lên. Hoàn thiện thông tin bắt buộc rồi nhấn Lưu sản phẩm.');
      }
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải...', 'Tải ảnh lên');
    }
  };

  $('#useProductImageAsHero').onclick = async () => {
    try {
      const url = normaliseImageUrl(form.elements.image.value);
      if (!url) throw new Error('Hãy chọn hoặc tải ảnh sản phẩm trước.');
      await saveHeroImage(url);
      toastAdmin('Đã dùng ảnh sản phẩm này làm banner và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  form.onsubmit = async event => {
    event.preventDefault();
    try {
      await saveProduct(form);
      onSaved();
      toastAdmin('Đã lưu sản phẩm và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  if (id) {
    $('#deleteProduct').onclick = async () => {
      if (!confirm('Xóa sản phẩm này?')) return;
      try {
        await saveShared('aeon-products', aeonStore.products().filter(product => product.id !== id));
        onDeleted();
        toastAdmin('Đã xóa sản phẩm.');
      } catch (error) {
        toastAdmin(error.message);
      }
    };
  }
}

function interfacePanel(panel) {
  const ui = aeonStore.ui();
  panel.innerHTML = `
    <section class="admin-card editor">
      <p>Những nội dung này xuất hiện ở trang chủ. Dùng xuống dòng để ngắt hàng tiêu đề.</p>
      <form id="uiForm">
        <div class="admin-form-grid one">
          <label>Nhãn chiến dịch<input name="eyebrow" required value="${escapeHtml(ui.eyebrow)}"></label>
          <label>Tiêu đề hero<textarea name="title" required rows="2">${escapeHtml(ui.title)}</textarea></label>
          <label>Giới thiệu hero<textarea name="intro" required rows="3">${escapeHtml(ui.intro)}</textarea></label>
        </div>
        <button class="button primary" type="submit">Lưu giao diện</button>
      </form>
    </section>`;
  $('#uiForm').onsubmit = async event => {
    event.preventDefault();
    try {
      let latestUi = {};
      try {
        latestUi = (await remoteState())['aeon-ui'] || {};
      } catch {
        latestUi = aeonStore.ui();
      }
      await saveShared('aeon-ui', {...aeonStore.ui(), ...latestUi, ...Object.fromEntries(new FormData(event.currentTarget))});
      toastAdmin('Đã lưu nội dung giao diện và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
}

function assetPanel(panel) {
  const ui = aeonStore.ui();
  const sourceImages = [];
  aeonStore.products().forEach(product => {
    const image = normaliseImageUrl(product.image);
    if (image && !sourceImages.some(item => item.image === image)) sourceImages.push({image, name: product.name || 'Ảnh sản phẩm'});
  });

  panel.insertAdjacentHTML('beforeend', `
    <section class="admin-card editor asset-editor">
      <p class="eyebrow">HÌNH ẢNH CHÍNH THỨC</p>
      <h2>Ảnh banner đầu trang</h2>
      <p>Ảnh chỉ được báo thành công sau khi đã lưu vào máy chủ. Chọn ảnh từ máy, dán đường dẫn online, hoặc dùng lại ảnh sản phẩm.</p>
      <form id="assetForm">
        <label>Đường dẫn ảnh banner<input name="heroImage" value="${escapeHtml(ui.heroImage || '')}" placeholder="https://... hoặc assets/uploads/..."></label>
        <label class="upload-field">Tải ảnh banner từ máy<input id="heroImageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"><button class="secondary-button" id="uploadHeroImage" type="button">Tải và lưu banner</button></label>
        ${sourceImages.length ? `<label class="saved-image-picker">Dùng ảnh đã tải lên trong sản phẩm<select id="savedHeroImage"><option value="">Chọn ảnh sản phẩm…</option>${sourceImages.map(item => `<option value="${escapeHtml(item.image)}">${escapeHtml(item.name)}</option>`).join('')}</select></label><button class="secondary-button" id="useSavedHeroImage" type="button">Dùng ảnh đã chọn làm banner</button>` : ''}
        <div class="asset-preview" id="heroPreview" aria-live="polite"></div>
        <div class="editor-actions"><button class="button primary" type="submit">Lưu ảnh banner</button><button class="danger" type="button" id="clearHeroImage">Bỏ ảnh</button></div>
      </form>
    </section>`);

  const form = $('#assetForm');
  setPreview($('#heroPreview'), ui.heroImage);
  form.elements.heroImage.addEventListener('input', () => setPreview($('#heroPreview'), form.elements.heroImage.value));

  $('#uploadHeroImage').onclick = async () => {
    const button = $('#uploadHeroImage');
    try {
      setBusy(button, true, 'Đang tải và lưu...', 'Tải và lưu banner');
      const url = await uploadOfficialImage($('#heroImageFile').files[0]);
      if (!url) throw new Error('Hãy chọn ảnh trước khi tải lên.');
      form.elements.heroImage.value = url;
      await saveHeroImage(url);
      setPreview($('#heroPreview'), url);
      toastAdmin('Đã lưu ảnh banner và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải và lưu...', 'Tải và lưu banner');
    }
  };

  const useSaved = $('#useSavedHeroImage');
  if (useSaved) {
    useSaved.onclick = async () => {
      try {
        const url = normaliseImageUrl($('#savedHeroImage').value);
        if (!url) throw new Error('Hãy chọn một ảnh sản phẩm trước.');
        form.elements.heroImage.value = url;
        await saveHeroImage(url);
        setPreview($('#heroPreview'), url);
        toastAdmin('Đã dùng ảnh sản phẩm làm banner và đồng bộ website.');
      } catch (error) {
        toastAdmin(error.message);
      }
    };
  }

  form.onsubmit = async event => {
    event.preventDefault();
    try {
      const url = await saveHeroImage(form.elements.heroImage.value);
      form.elements.heroImage.value = url;
      setPreview($('#heroPreview'), url);
      toastAdmin('Đã lưu ảnh banner và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  $('#clearHeroImage').onclick = async () => {
    try {
      await saveHeroImage('');
      form.elements.heroImage.value = '';
      setPreview($('#heroPreview'), '');
      toastAdmin('Đã bỏ ảnh banner.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
}

function layoutPanel(panel) {
  const layout = aeonStore.layout();
  const alignOptions = (value, stretch = false) => `
    <option value="left" ${value === 'left' ? 'selected' : ''}>Căn trái</option>
    <option value="center" ${value === 'center' ? 'selected' : ''}>Căn giữa</option>
    <option value="right" ${value === 'right' ? 'selected' : ''}>Căn phải</option>
    ${stretch ? `<option value="stretch" ${value === 'stretch' ? 'selected' : ''}>Toàn chiều rộng</option>` : ''}`;
  panel.insertAdjacentHTML('beforeend', `
    <section class="admin-card editor layout-editor">
      <p class="eyebrow">BỐ CỤC & CHỮ</p>
      <h2>Điều chỉnh hiển thị</h2>
      <p>Thiết lập cỡ chữ và vị trí nút cho từng khu vực. Áp dụng trên website ở cùng trình duyệt.</p>
      <form id="layoutForm">
        <div class="admin-form-grid">
          <label>Cỡ tiêu đề hero <output data-output="heroTitleSize">${layout.heroTitleSize}px</output><input class="layout-range" type="range" name="heroTitleSize" min="42" max="90" step="1" value="${layout.heroTitleSize}"></label>
          <label>Cỡ mô tả hero <output data-output="heroIntroSize">${layout.heroIntroSize}px</output><input class="layout-range" type="range" name="heroIntroSize" min="12" max="22" step="1" value="${layout.heroIntroSize}"></label>
          <label>Vị trí nút hero<select name="heroButtonAlign">${alignOptions(layout.heroButtonAlign)}</select></label>
          <label>Cỡ tên sản phẩm <output data-output="productTitleSize">${layout.productTitleSize}px</output><input class="layout-range" type="range" name="productTitleSize" min="12" max="24" step="1" value="${layout.productTitleSize}"></label>
          <label>Vị trí nút “Xem chi tiết”<select name="productButtonAlign">${alignOptions(layout.productButtonAlign)}</select></label>
          <label>Vị trí nút đặt hàng<select name="checkoutButtonAlign">${alignOptions(layout.checkoutButtonAlign, true)}</select></label>
        </div>
        <div class="editor-actions"><button class="button primary" type="submit">Lưu bố cục</button><button class="danger" type="button" id="resetLayout">Khôi phục mặc định</button></div>
      </form>
    </section>`);
  document.querySelectorAll('.layout-range').forEach(input => {
    input.oninput = () => {
      document.querySelector(`[data-output="${input.name}"]`).textContent = `${input.value}px`;
    };
  });
  $('#layoutForm').onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    ['heroTitleSize', 'heroIntroSize', 'productTitleSize'].forEach(key => {
      values[key] = Number(values[key]);
    });
    try {
      await saveShared('aeon-layout', values);
      toastAdmin('Đã lưu bố cục và cỡ chữ.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
  $('#resetLayout').onclick = async () => {
    try {
      await saveShared('aeon-layout', AEON_DEFAULT_LAYOUT);
      render();
      toastAdmin('Đã khôi phục bố cục mặc định.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
}

function customersPanel(panel) {
  const customers = aeonStore.customers();
  const orders = aeonStore.orders();
  panel.innerHTML = `<section class="admin-card"><h2>Thông tin khách hàng</h2>${customers.length ? `<div class="customer-list">${customers.map(customer => {
    const customerOrders = orders.filter(order => order.customerId === customer.id);
    const total = customerOrders.reduce((sum, order) => sum + order.total, 0);
    return `<article><div><h3>${escapeHtml(customer.name)}</h3><p>${escapeHtml(customer.phone)} · ${escapeHtml(customer.email)}</p><p>${escapeHtml(customer.address)}</p>${customer.message ? `<blockquote>“${escapeHtml(customer.message)}”</blockquote>` : ''}</div><div><b>${customerOrders.length} đơn</b><strong>${money(total)}</strong><small>${customer.createdAt}</small></div></article>`;
  }).join('')}</div>` : '<p class="empty-admin">Chưa có thông tin khách hàng. Thông tin sẽ được lưu sau khi khách gửi form đặt hàng.</p>'}</section>`;
}

function toastAdmin(message) {
  const notice = document.createElement('p');
  notice.className = 'admin-notice';
  notice.textContent = message;
  $('#adminPanel').prepend(notice);
  setTimeout(() => notice.remove(), 3600);
}

window.addEventListener('aeon-store-sync', () => {
  if (isAuthed()) render();
});

if (isAuthed()) {
  aeonStore.setAdminSession(true);
  showApp();
}

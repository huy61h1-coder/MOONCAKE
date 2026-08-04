document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-layout-controls.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-import.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-quick-products.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-quote-files.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-sheet-sync.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-order-pdf.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'product-variants.css'}));
document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href: 'admin-brands.css'}));

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

function productInsertPositionOptions(items, selectedPosition = items.length) {
  if (!items.length) return '<option value="0" selected>1 — Vị trí đầu tiên</option>';
  return Array.from({length: items.length + 1}, (_, index) => {
    const label = index === 0
      ? '1 — Đầu danh sách'
      : index === items.length
        ? `${index + 1} — Cuối danh sách`
        : `${index + 1} — Sau “${items[index - 1].name || 'Sản phẩm chưa đặt tên'}”`;
    return `<option value="${index}"${index === selectedPosition ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
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

const officialImageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

function officialImageMimeType(file) {
  const declaredType = String(file?.type || '').toLowerCase();
  if (officialImageMimeTypes.has(declaredType)) return declaredType;
  const filename = String(file?.name || '').toLowerCase();
  if (/\.svg$/.test(filename)) return 'image/svg+xml';
  if (/\.png$/.test(filename)) return 'image/png';
  if (/\.jpe?g$/.test(filename)) return 'image/jpeg';
  if (/\.webp$/.test(filename)) return 'image/webp';
  if (/\.gif$/.test(filename)) return 'image/gif';
  return '';
}

function readOfficialImageAsDataUrl(file, mimeType) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) return reject(new Error('Không thể đọc tệp ảnh.'));
      resolve('data:' + mimeType + ';base64,' + result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh.'));
    reader.readAsDataURL(file);
  });
}

async function uploadOfficialImage(file) {
  if (!file) return null;
  const mimeType = officialImageMimeType(file);
  if (!mimeType) throw new Error('Chỉ hỗ trợ ảnh PNG, JPG, WEBP, GIF hoặc SVG.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Ảnh phải nhỏ hơn hoặc bằng 10 MB.');

  const dataUrl = await readOfficialImageAsDataUrl(file, mimeType);
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: file.name, dataUrl})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Không thể tải ảnh lên.');
  return normaliseImageUrl(result.url);
}

function normaliseQuoteFileUrl(value, kind) {
  const url = normaliseImageUrl(value);
  if (!url) return '';
  let pathname = '';
  try {
    pathname = new URL(url, location.origin).pathname.toLowerCase();
  } catch {
    throw new Error('Đường dẫn tệp báo giá không hợp lệ.');
  }
  const matches = kind === 'pdf' ? pathname.endsWith('.pdf') : /\.(xlsx|xls)$/.test(pathname);
  if (!matches) throw new Error(kind === 'pdf' ? 'Tệp PDF phải có đuôi .pdf.' : 'Tệp Excel phải có đuôi .xlsx hoặc .xls.');
  return url;
}

function quoteFileKind(file) {
  const filename = String(file?.name || '').toLowerCase();
  if (filename.endsWith('.pdf')) return 'pdf';
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) return 'excel';
  return '';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc tệp báo giá.'));
    reader.readAsDataURL(file);
  });
}

async function uploadQuoteFile(file, expectedKind) {
  if (!file) throw new Error(expectedKind === 'pdf' ? 'Hãy chọn tệp PDF trước.' : 'Hãy chọn tệp Excel trước.');
  const kind = quoteFileKind(file);
  if (kind !== expectedKind) throw new Error(expectedKind === 'pdf' ? 'Chỉ chấp nhận tệp PDF (.pdf).' : 'Chỉ chấp nhận tệp Excel (.xlsx, .xls).');
  if (file.size > 20 * 1024 * 1024) throw new Error('Tệp báo giá phải nhỏ hơn hoặc bằng 20 MB.');

  const response = await fetch('/api/upload-quote', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: file.name, dataUrl: await readFileAsDataUrl(file)})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Không thể tải tệp báo giá lên.');
  return normaliseQuoteFileUrl(result.url, expectedKind);
}

async function saveQuoteFiles(patch = {}) {
  let latestUi = {};
  try {
    latestUi = (await remoteState())['aeon-ui'] || {};
  } catch {
    latestUi = aeonStore.ui();
  }
  const combined = {...aeonStore.ui(), ...latestUi, ...patch};
  const nextUi = {
    ...combined,
    quoteExcelUrl: normaliseQuoteFileUrl(combined.quoteExcelUrl, 'excel'),
    quotePdfUrl: normaliseQuoteFileUrl(combined.quotePdfUrl, 'pdf')
  };
  await saveShared('aeon-ui', nextUi);

  const confirmed = {...AEON_DEFAULT_UI, ...((await remoteState())['aeon-ui'] || {})};
  if (confirmed.quoteExcelUrl !== nextUi.quoteExcelUrl || confirmed.quotePdfUrl !== nextUi.quotePdfUrl) {
    throw new Error('Tệp báo giá chưa được lưu vào cấu hình. Vui lòng thử lại.');
  }
  return confirmed;
}

function setQuoteFileStatus(target, value, label) {
  const element = typeof target === 'string' ? $(target) : target;
  if (!element) return;
  element.replaceChildren();
  if (!value) {
    element.textContent = `Chưa có tệp ${label}.`;
    element.classList.add('is-empty');
    return;
  }
  element.classList.remove('is-empty');
  const link = document.createElement('a');
  link.href = value;
  link.download = '';
  link.textContent = `Tải thử tệp ${label} đang dùng ↗`;
  element.append(link);
}

async function saveShared(key, value) {
  const saved = await aeonStore.set(key, value);
  if (saved) return value;

  // Restore the last confirmed shared state when the server cannot accept a save.
  await aeonStore.pull();
  throw new Error('Không thể lưu vào máy chủ. Vui lòng kiểm tra kết nối rồi thử lại.');
}

async function remoteState() {
  const response = await fetch('/api/state', {cache: 'no-store'});
  if (!response.ok) throw new Error('Không thể kiểm tra dữ liệu đã lưu trên máy chủ.');
  return response.json();
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

function cleanLogoText(value, fallback = '', limit = 40, preserveLines = false) {
  const source = String(value ?? '').replace(/\r\n?/g, '\n');
  const cleaned = preserveLines
    ? source
        .split('\n')
        .slice(0, 2)
        .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    : source.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, limit) || fallback;
}

function normaliseLogoMode(value) {
  return ['text', 'image', 'image-subtitle'].includes(String(value || '')) ? String(value) : AEON_DEFAULT_UI.logoMode;
}

async function saveLogoSettings(patch = {}) {
  let latestUi = {};
  try {
    latestUi = (await remoteState())['aeon-ui'] || {};
  } catch {
    latestUi = aeonStore.ui();
  }

  const combined = {...aeonStore.ui(), ...latestUi, ...patch};
  const nextUi = {
    ...combined,
    logoText: cleanLogoText(combined.logoText, AEON_DEFAULT_UI.logoText, 32),
    logoSubtitle: cleanLogoText(combined.logoSubtitle, '', 80, true),
    logoMode: normaliseLogoMode(combined.logoMode),
    logoImage: normaliseImageUrl(combined.logoImage)
  };
  await saveShared('aeon-ui', nextUi);

  const confirmed = {...AEON_DEFAULT_UI, ...((await remoteState())['aeon-ui'] || {})};
  const isSaved = confirmed.logoText === nextUi.logoText
    && confirmed.logoSubtitle === nextUi.logoSubtitle
    && confirmed.logoMode === nextUi.logoMode
    && sameImage(confirmed.logoImage, nextUi.logoImage);
  if (!isSaved) throw new Error('Thiết lập logo chưa được lưu trên máy chủ. Vui lòng thử lại.');

  renderAeonBrandLogos(confirmed);
  return confirmed;
}

function isAuthed() {
  return aeonStore.isAdminSession();
}

function showApp() {
  const login = $('#loginView');
  const app = $('#adminApp');
  renderAeonBrandLogos(aeonStore.ui());
  login.hidden = true;
  login.style.display = 'none';
  app.hidden = false;
  app.style.display = 'grid';
  history.replaceState(null, '', 'admin.html#dashboard');
  render();
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  const error = $('#loginError');
  const form = new FormData(event.currentTarget);
  const username = String(form.get('username')).trim();
  const password = String(form.get('password'));
  error.textContent = '';
  setBusy(submit, true, 'Đang đăng nhập...', 'Đăng nhập →');
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username, password})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Không thể đăng nhập.');
    aeonStore.setAdminSession(true);
    showApp();
  } catch (loginError) {
    aeonStore.setAdminSession(false);
    error.textContent = loginError.message || 'Tài khoản hoặc mật khẩu chưa đúng.';
  } finally {
    setBusy(submit, false, 'Đang đăng nhập...', 'Đăng nhập →');
  }
});

$('#logout').onclick = async () => {
  await fetch('/api/admin/logout', {method:'POST'}).catch(() => null);
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
    brandSettingsPanel(panel);
    assetPanel(panel);
    return layoutPanel(panel);
  }
  return customersPanel(panel);
}

function quickProductRow(product, isNew = false, positionProducts = []) {
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
      ${isNew ? `<label>Vị trí trong danh sách<select data-quick-position>${productInsertPositionOptions(positionProducts)}</select></label>` : ''}
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
    description: row.querySelector('[data-quick-description]').value,
    insertPosition: row.querySelector('[data-quick-position]')?.value ?? ''
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
      const requestedPosition = Number(row.insertPosition);
      const insertAt = Number.isInteger(requestedPosition)
        ? Math.max(0, Math.min(requestedPosition, products.length))
        : products.length;
      products.splice(insertAt, 0, product);
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
    list.insertAdjacentHTML('beforeend', quickProductRow({name: '', price: '', label: '', description: ''}, true, aeonStore.products()));
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
  const systemId = cleanTextImport(candidate.id, 100);
  if (systemId) {
    const byId = products.find(product => cleanTextImport(product.id, 100) === systemId);
    if (byId) return byId;
  }
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
    const requestedId = cleanTextImport(draft.id, 100);
    const sku = cleanTextImport(draft.sku, 100);
    let position = requestedId ? products.findIndex(product => cleanTextImport(product.id, 100) === requestedId) : -1;
    if (position < 0 && sku) position = products.findIndex(product => productIdentity(product.sku) === productIdentity(sku));
    const existing = position >= 0 ? products[position] : null;
    const existingVariants = validAdminProductVariants(existing?.variants);
    const importedVariants = validAdminProductVariants(draft.variants).map((variant, variantIndex) => ({
      id: cleanTextImport(variant.id, 100) || `variant-${Date.now()}-${index}-${variantIndex}`,
      name: cleanTextImport(variant.name, 120),
      price: Math.round(Number(variant.price)),
      sku: cleanTextImport(variant.sku, 100)
    }));
    const variants = draft.hasVariantColumns ? importedVariants : existingVariants;
    const variantPrices = variants.map(variant => Number(variant.price)).filter(value => Number.isFinite(value) && value >= 0);
    const price = variantPrices.length ? Math.min(...variantPrices) : Number(draft.price);
    if (!name || !Number.isFinite(price) || price <= 0) {
      throw new Error('Mỗi sản phẩm cần có tên và giá bán, hoặc ít nhất một phân loại có giá lớn hơn 0.');
    }
    const product = {
      ...existing,
      id: existing?.id || requestedId || `sp-import-${Date.now()}-${index}`,
      name,
      price: Math.round(price),
      brand: normaliseAeonBrand(draft.brand) || normaliseAeonBrand(existing?.brand),
      description,
      sku,
      label: cleanTextImport(draft.label, 100),
      weight: cleanTextImport(draft.weight, 100),
      ingredients: cleanTextImport(draft.ingredients, 300),
      details: AEONRichText.clean(draft.details || description, 3000),
      image: normaliseImageUrl(draft.image || existing?.image || ''),
      variantLabel: variants.length
        ? cleanTextImport(draft.hasVariantColumns ? draft.variantLabel : existing?.variantLabel, 100) || 'Phân loại'
        : '',
      variants,
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
  const variantPrices = validAdminProductVariants(candidate.variants)
    .map(variant => Number(variant.price))
    .filter(price => Number.isFinite(price) && price > 0);
  if ((!Number(candidate.price) || Number(candidate.price) <= 0) && !variantPrices.length) warnings.push('Chưa có giá bán hoặc giá phân loại hợp lệ.');
  if (existing) warnings.push('Trùng ID hoặc mã sản phẩm: nếu chọn nhập, mục hiện có sẽ được cập nhật.');
  return warnings;
}

function bindImportVariantEditor(card) {
  const list = card.querySelector('[data-import-variant-rows]');
  const addButton = card.querySelector('[data-import-add-variant]');
  const priceInput = card.querySelector('[data-import-price]');
  const originalPrice = priceInput.value;

  const syncPrice = () => {
    const rows = [...list.querySelectorAll('[data-variant-id]')];
    const prices = rows.map(row => Number(row.querySelector('[data-variant-price]').value));
    priceInput.readOnly = rows.length > 0;
    priceInput.classList.toggle('derived-price', rows.length > 0);
    if (!rows.length) {
      if (!priceInput.value) priceInput.value = originalPrice;
      return;
    }
    const validPrices = prices.filter(price => Number.isFinite(price) && price >= 0);
    priceInput.value = validPrices.length === prices.length ? Math.min(...validPrices) : '';
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
      toastAdmin('Mỗi sản phẩm tối đa 20 phân loại.');
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
      const hasValidVariant = validAdminProductVariants(candidate.variants).some(variant => Number(variant.price) > 0);
      const selectByDefault = canSelect && (Number(candidate.price) > 0 || hasValidVariant) && !existing;
      return `<article class="import-candidate" data-import-index="${index}" data-existing-id="${escapeHtml(existing?.id || '')}">
        <header><label class="import-check"><input type="checkbox" data-import-select ${selectByDefault ? 'checked' : ''} ${canSelect ? '' : 'disabled'}><span>Chọn sản phẩm ${index + 1}</span></label><span class="import-confidence">Độ tin cậy ${Math.max(0, Math.min(100, Number(candidate.confidence) || 0))}%</span></header>
        <div class="import-fields">
          <label>Tên sản phẩm<input data-import-name value="${escapeHtml(candidate.name || '')}" required></label>
          <label>Thương hiệu<select data-import-brand>${aeonBrandOptions(normaliseAeonBrand(candidate.brand) || normaliseAeonBrand(existing?.brand))}</select></label>
          <label>Giá bán (VNĐ)<input data-import-price type="number" min="0" inputmode="numeric" value="${Number(candidate.price) || ''}" required></label>
          <label>Mã sản phẩm<input data-import-sku value="${escapeHtml(candidate.sku || '')}"></label>
          <label class="wide">Mô tả ngắn<textarea data-import-description rows="2">${escapeHtml(candidate.description || '')}</textarea></label>
          <label>Thành phần nổi bật<input data-import-ingredients value="${escapeHtml(candidate.ingredients || '')}" placeholder="Ví dụ: Hạt sen · trứng muối"></label>
          <label>Tên nhóm phân loại<input data-import-variant-label value="${escapeHtml(candidate.variantLabel || existing?.variantLabel || '')}" placeholder="Ví dụ: Màu sắc"></label>
          <fieldset class="product-variant-editor import-variant-editor wide"><legend>Giá trị phân loại</legend><p>Mỗi màu sắc, kích thước hoặc hương vị là một dòng riêng.</p><div class="product-variant-rows" data-import-variant-rows>${validAdminProductVariants(candidate.variants).map(productVariantRowMarkup).join('')}</div><button class="secondary-button" type="button" data-import-add-variant>+ Thêm phân loại</button></fieldset>
          <div class="richtext-field wide"><span class="richtext-label">Thông tin chi tiết</span>${AEONRichText.editorMarkup({name: 'details', value: candidate.details || '', rows: 8, placeholder: 'Kiểm tra lại nội dung OCR trước khi lưu'})}</div>
        </div>
        ${warnings.length ? `<div class="import-row-warnings">${warnings.map(warning => `<p>• ${escapeHtml(warning)}</p>`).join('')}</div>` : ''}
      </article>`;
    }).join('')}</div>
    <div class="import-footer"><p id="importSelectionStatus"></p><button class="button primary" type="button" id="saveImportedProducts">Thêm sản phẩm đã chọn</button></div>
    ${analysis.textPreview ? `<details class="import-source-text"><summary>Xem nội dung đã trích xuất</summary><pre>${escapeHtml(analysis.textPreview)}</pre></details>` : ''}`;

  AEONRichText.bindAll(target);
  const importVariantGetters = new Map();
  target.querySelectorAll('.import-candidate').forEach(card => {
    importVariantGetters.set(card, bindImportVariantEditor(card));
  });
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
        const variants = importVariantGetters.get(card)?.() || [];
        const variantLabel = card.querySelector('[data-import-variant-label]').value;
        return {
          ...original,
          name: card.querySelector('[data-import-name]').value,
          brand: card.querySelector('[data-import-brand]').value,
          price: card.querySelector('[data-import-price]').value,
          sku: card.querySelector('[data-import-sku]').value,
          description: card.querySelector('[data-import-description]').value,
          ingredients: card.querySelector('[data-import-ingredients]').value,
          details: card.querySelector('[data-richtext-input][name="details"]').value,
          variantLabel,
          variants,
          hasVariantColumns: Boolean(original.hasVariantColumns || variants.length || cleanTextImport(variantLabel))
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
    <div class="panel-action"><p>Thêm, sửa hoặc xóa sản phẩm. Thay đổi hiển thị ngay tại cửa hàng.</p><div class="panel-action-buttons"><button class="secondary-button" id="downloadCurrentProducts" type="button">Tải danh sách hiện tại</button><button class="secondary-button" id="downloadProductTemplate" type="button">Tải file mẫu</button><button class="secondary-button" id="importProducts" type="button">Tải lên danh sách</button><button class="button primary" id="newProduct">+ Thêm sản phẩm</button></div></div>
    <section class="admin-card import-products" id="productImportPanel" hidden aria-labelledby="productImportTitle">
      <div class="import-intro"><div><p class="eyebrow">NHẬP DANH MỤC</p><h2 id="productImportTitle">Tải lên danh sách sản phẩm</h2><p>Excel có thể chứa nhiều dòng phân loại cho cùng một sản phẩm. Hệ thống sẽ gom theo ID, mã sản phẩm hoặc tên + thương hiệu để bạn kiểm tra trước khi lưu.</p></div><button class="import-close" type="button" id="closeProductImport" aria-label="Đóng khu vực nhập tệp">×</button></div>
      <form class="import-form" id="productImportForm">
        <label class="import-dropzone" for="importProductFile"><span>Chọn tệp danh mục hoặc báo giá</span><small>Excel, PDF, PNG, JPG, WEBP hoặc GIF · tối đa 15 MB</small><input id="importProductFile" type="file" accept=".xlsx,.xls,.csv,.pdf,image/png,image/jpeg,image/webp,image/gif" required></label>
        <div class="import-actions"><p id="importFileName" aria-live="polite">Chưa chọn tệp.</p><div class="panel-action-buttons"><button class="secondary-button" id="downloadProductTemplateInline" type="button">Tải file mẫu</button><button class="button primary" id="analyseProductFile" type="submit">Phân tích tệp</button></div></div>
      </form>
      <div class="import-results" id="importResults" aria-live="polite"></div>
    </section>
    <section class="admin-card">
      ${products.length ? `<div class="admin-table">${products.map(product => `<div class="table-row"><span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.description)}</small></span><span><b>${escapeHtml(normaliseAeonBrand(product.brand) || 'Chưa chọn thương hiệu')}</b><small>${escapeHtml(product.label || 'Không có nhãn hiển thị')}</small></span><strong>${money(product.price)}</strong><button class="edit-product" data-id="${product.id}">Chỉnh sửa</button></div>`).join('')}</div>` : '<p class="empty-admin">Chưa có sản phẩm. Hãy thêm sản phẩm đầu tiên.</p>'}
    </section>
    <div id="productEditor"></div>`;
  $('#newProduct').onclick = () => openProductEditor();
  $('#downloadCurrentProducts').onclick = () => downloadCurrentProducts($('#downloadCurrentProducts'));
  $('#downloadProductTemplate').onclick = () => downloadProductTemplate($('#downloadProductTemplate'));
  const importPanel = $('#productImportPanel');
  const importResults = $('#importResults');
  $('#importProducts').onclick = () => {
    importPanel.hidden = false;
    $('#importProductFile').focus();
  };
  $('#closeProductImport').onclick = () => { importPanel.hidden = true; };
  $('#downloadProductTemplateInline').onclick = () => downloadProductTemplate($('#downloadProductTemplateInline'));
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

async function downloadProductTemplate(button) {
  return downloadProductExcel(button, {
    url: '/api/template/products.xlsx',
    filename: 'mau-nhap-danh-sach-san-pham.xlsx',
    busyText: 'Đang tạo mẫu...',
    idleText: 'Tải file mẫu',
    successText: 'Đã tải file mẫu có hướng dẫn phân loại sản phẩm.',
    errorText: 'Không thể tạo mẫu Excel.'
  });
}

async function downloadCurrentProducts(button) {
  return downloadProductExcel(button, {
    url: '/api/export/products.xlsx',
    filename: 'danh-sach-san-pham-hien-tai.xlsx',
    busyText: 'Đang tạo danh sách...',
    idleText: 'Tải danh sách hiện tại',
    successText: 'Đã tải danh sách sản phẩm hiện tại kèm toàn bộ phân loại.',
    errorText: 'Không thể tạo danh sách sản phẩm Excel.'
  });
}

async function downloadProductExcel(button, options) {
  try {
    setBusy(button, true, options.busyText, options.idleText);
    const response = await fetch(options.url, {cache: 'no-store'});
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || options.errorText);
    }
    const file = await response.blob();
    if (!file.size) throw new Error('Tệp Excel chưa có dữ liệu hợp lệ.');
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = options.filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toastAdmin(options.successText);
  } catch (error) {
    toastAdmin(error.message);
  } finally {
    setBusy(button, false, options.busyText, options.idleText);
  }
}

function openProductEditor(id, options = {}) {
  const editorMount = typeof options.mount === 'string' ? $(options.mount) : (options.mount || $('#productEditor'));
  if (!editorMount) return;
  const onSaved = options.onSaved || (() => productPanel($('#adminPanel')));
  const onDeleted = options.onDeleted || onSaved;
  const onCancel = options.onCancel || (() => editorMount.replaceChildren());
  const currentProducts = aeonStore.products();
  const existing = currentProducts.find(product => product.id === id) || {
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
    variantLabel: '',
    variants: [],
    bg: '#e9c38b',
    box: '#8f1834'
  };
  const editorVariants = validAdminProductVariants(existing.variants);

  let getProductVariants = () => [];
  const saveProduct = async form => {
    const data = Object.fromEntries(new FormData(form));
    const requestedPosition = Number(data.insertPosition);
    delete data.insertPosition;
    data.id = existing.id;
    data.details = AEONRichText.clean(data.details, 3000);
    data.variants = getProductVariants();
    data.variantLabel = data.variants.length ? cleanTextImport(data.variantLabel, 100) || 'Phân loại' : '';
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
    if (position < 0) {
      const insertAt = Number.isInteger(requestedPosition)
        ? Math.max(0, Math.min(requestedPosition, all.length))
        : all.length;
      all.splice(insertAt, 0, data);
    }
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
          ${id ? '' : `<label>Vị trí trong danh sách<select name="insertPosition">${productInsertPositionOptions(currentProducts)}</select><small>Sản phẩm sẽ được chèn đúng vị trí này khi lưu.</small></label>`}
          <label>Giá bán (VNĐ)<small data-variant-price-hint></small><input name="price" type="number" min="0" inputmode="numeric" required value="${existing.price ?? ''}" placeholder="Ví dụ: 750000"${editorVariants.length ? ' readonly' : ''}></label>
          <label>Mô tả ngắn<textarea name="description" required rows="2" placeholder="Tóm tắt hiển thị trên thẻ sản phẩm">${escapeHtml(existing.description)}</textarea></label>
          <label>Nhãn hiển thị<input name="label" value="${escapeHtml(existing.label)}"></label>
          <label>Quy cách / khối lượng<input name="weight" value="${escapeHtml(existing.weight || '')}" placeholder="Ví dụ: 4 bánh · 720g"></label>
          <label>Thành phần nổi bật<input name="ingredients" value="${escapeHtml(existing.ingredients || '')}" placeholder="Ví dụ: Hạt sen, trứng muối"></label>
          <label>Mã sản phẩm<input name="sku" value="${escapeHtml(existing.sku || '')}" placeholder="Ví dụ: AM-2026-01"></label>
          <label class="image-path">Tên nhóm phân loại<input name="variantLabel" value="${escapeHtml(existing.variantLabel || '')}" placeholder="Ví dụ: Màu sắc, Kích thước, Hương vị"><small>Được hiển thị khi sản phẩm có nhiều lựa chọn.</small></label>
          <fieldset class="product-variant-editor image-path"><legend>Phân loại sản phẩm</legend><p>Mỗi màu sắc, kích thước hoặc hương vị có thể có giá và mã SKU riêng.</p><div class="product-variant-rows" data-variant-rows>${editorVariants.map(productVariantRowMarkup).join('')}</div><button class="secondary-button" type="button" data-add-variant>+ Thêm phân loại</button></fieldset>
          <div class="richtext-field image-path"><span class="richtext-label">Chi tiết sản phẩm</span>${AEONRichText.editorMarkup({name: 'details', value: existing.details || '', rows: 8, placeholder: 'Thông tin hiển thị trong trang chi tiết'})}</div>
          <label class="image-path">Đường dẫn ảnh<input name="image" value="${escapeHtml(existing.image || '')}" placeholder="https://... hoặc /assets/uploads/ten-anh.png"></label>
          <div class="upload-field image-path"><label for="productImageFile">Tải ảnh từ máy (lưu tại /assets/uploads)</label><input id="productImageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"><button class="secondary-button" id="uploadProductImage" type="button">Tải ảnh lên</button></div>
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
          <label>Tên logo<input name="logoText" maxlength="32" required value="${escapeHtml(ui.logoText)}" placeholder="Ví dụ: AEON"></label>
          <label>Dòng phụ logo<textarea name="logoSubtitle" maxlength="80" rows="2" placeholder="Ví dụ: BÌNH DƯƠNG&#10;NEW CITY">${escapeHtml(ui.logoSubtitle || '')}</textarea><small>Có thể nhấn Enter để xuống dòng.</small></label>
          <label>Kiểu hiển thị logo<select name="logoMode"><option value="text"${ui.logoMode === 'text' ? ' selected' : ''}>Logo chữ</option><option value="image"${ui.logoMode === 'image' ? ' selected' : ''}>Chỉ dùng ảnh logo</option><option value="image-subtitle"${ui.logoMode === 'image-subtitle' ? ' selected' : ''}>Ảnh logo và dòng phụ</option></select></label>
          <label>Nhãn chiến dịch<input name="eyebrow" required value="${escapeHtml(ui.eyebrow)}"></label>
          <label>Tiêu đề hero<textarea name="title" required rows="2">${escapeHtml(ui.title)}</textarea></label>
          <label>Giới thiệu hero<textarea name="intro" required rows="3">${escapeHtml(ui.intro)}</textarea></label>
          <label>Tiêu đề khu vực ưu đãi<input name="promotionTitle" maxlength="80" required value="${escapeHtml(ui.promotionTitle)}"></label>
          <label>Nội dung ưu đãi mùa trăng<textarea name="promotionText" maxlength="400" required rows="5">${escapeHtml(ui.promotionText)}</textarea><small>Có thể nhấn Enter để xuống dòng; nội dung sẽ hiển thị đúng từng dòng trên trang chủ.</small></label>
        </div>
        <button class="button primary" type="submit">Lưu giao diện</button>
      </form>
    </section>`;
  $('#uiForm').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      let latestUi = {};
      try {
        latestUi = (await remoteState())['aeon-ui'] || {};
      } catch {
        latestUi = aeonStore.ui();
      }
      const nextUi = {
        ...aeonStore.ui(),
        ...latestUi,
        ...values,
        logoText: cleanLogoText(values.logoText, AEON_DEFAULT_UI.logoText, 32),
        logoSubtitle: cleanLogoText(values.logoSubtitle, '', 80, true),
        logoMode: normaliseLogoMode(values.logoMode)
      };
      await saveShared('aeon-ui', nextUi);
      renderAeonBrandLogos(nextUi);
      toastAdmin('Đã lưu nội dung giao diện và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
}

function brandGroupEditorMarkup(group = {}) {
  const brands = (Array.isArray(group.brands) ? group.brands : []).map(brand => brand?.name || brand).filter(Boolean);
  return `<article class="brand-settings-group" data-brand-group data-brand-group-id="${escapeHtml(group.id || '')}">
    <header><label>Tên nhóm thương hiệu<input data-brand-group-name maxlength="100" required value="${escapeHtml(group.name || '')}" placeholder="Ví dụ: Thương hiệu nội địa"></label><button class="danger" type="button" data-remove-brand-group>Xóa nhóm</button></header>
    <label>Danh sách thương hiệu<textarea data-brand-list rows="6" maxlength="12000" placeholder="Mỗi thương hiệu một dòng">${escapeHtml(brands.join('\n'))}</textarea><small>Nhập mỗi thương hiệu trên một dòng. Thương hiệu đang được sản phẩm sử dụng sẽ không bị mất.</small></label>
  </article>`;
}

function brandGroupsFromEditor(form) {
  const rows = [...form.querySelectorAll('[data-brand-group]')];
  if (!rows.length) throw new Error('Cần có ít nhất một nhóm thương hiệu.');
  if (rows.length > 20) throw new Error('Chỉ được tạo tối đa 20 nhóm thương hiệu.');
  const names = new Set();
  const groups = rows.map((row, index) => {
    const name = String(row.querySelector('[data-brand-group-name]').value || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!name) throw new Error('Mỗi nhóm cần có tên.');
    const brands = String(row.querySelector('[data-brand-list]').value || '')
      .split(/\r?\n/)
      .map(value => value.replace(/\s+/g, ' ').trim().slice(0, 120))
      .filter(Boolean)
      .map(brandName => {
        const key = aeonBrandKey(brandName);
        if (names.has(key)) throw new Error(`Thương hiệu "${brandName}" đang bị trùng.`);
        names.add(key);
        return {name: brandName};
      });
    return {
      id: row.dataset.brandGroupId || `brand-group-${Date.now()}-${index + 1}`,
      name,
      brands
    };
  });
  if (names.size > 200) throw new Error('Chỉ được lưu tối đa 200 thương hiệu.');
  return cleanAeonBrandGroups(groups);
}

function brandSettingsPanel(panel) {
  const groups = aeonStore.brands();
  panel.insertAdjacentHTML('beforeend', `
    <section class="admin-card editor brand-settings">
      <p class="eyebrow">DANH MỤC THƯƠNG HIỆU</p>
      <h2>Thêm và quản lý thương hiệu</h2>
      <p>Các thương hiệu đã lưu sẽ xuất hiện trong bộ lọc trang chủ, trình sửa sản phẩm và file nhập Excel.</p>
      <form id="brandSettingsForm">
        <div class="brand-settings-list" data-brand-groups>${groups.map(brandGroupEditorMarkup).join('')}</div>
        <div class="editor-actions"><button class="secondary-button" type="button" id="addBrandGroup">+ Thêm nhóm</button><button class="button primary" type="submit">Lưu thương hiệu</button></div>
      </form>
    </section>`);

  const form = $('#brandSettingsForm');
  const list = form.querySelector('[data-brand-groups]');
  const bindGroup = group => {
    group.querySelector('[data-remove-brand-group]').onclick = () => {
      if (list.querySelectorAll('[data-brand-group]').length <= 1) {
        toastAdmin('Cần giữ lại ít nhất một nhóm thương hiệu.');
        return;
      }
      group.remove();
    };
  };
  list.querySelectorAll('[data-brand-group]').forEach(bindGroup);
  $('#addBrandGroup').onclick = () => {
    if (list.querySelectorAll('[data-brand-group]').length >= 20) {
      toastAdmin('Chỉ được tạo tối đa 20 nhóm thương hiệu.');
      return;
    }
    list.insertAdjacentHTML('beforeend', brandGroupEditorMarkup({
      id: `brand-group-${Date.now()}`,
      name: 'Nhóm thương hiệu mới',
      brands: []
    }));
    const group = list.lastElementChild;
    bindGroup(group);
    group.querySelector('[data-brand-group-name]').focus();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    try {
      const nextGroups = brandGroupsFromEditor(form);
      await saveShared('aeon-brands', nextGroups);
      toastAdmin('Đã lưu danh sách thương hiệu và đồng bộ website.');
      render();
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
    <section class="admin-card editor asset-editor logo-asset-editor">
      <p class="eyebrow">NHẬN DIỆN THƯƠNG HIỆU</p>
      <h2>Ảnh logo</h2>
      <p>Tải logo từ máy hoặc dán đường dẫn ảnh online. Nếu có ảnh logo, hệ thống sẽ dùng ảnh này trên trang bán hàng và trang quản trị.</p>
      <form id="logoAssetForm">
        <label>Đường dẫn ảnh logo<input name="logoImage" value="${escapeHtml(ui.logoImage || '')}" placeholder="https://... hoặc /assets/uploads/logo.png"></label>
        <div class="upload-field"><label for="logoImageFile">Tải ảnh logo từ máy (PNG, JPG, WEBP, GIF hoặc SVG)</label><input id="logoImageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"><button class="secondary-button" id="uploadLogoImage" type="button">Tải và dùng logo</button></div>
        <div class="asset-preview logo-preview" id="logoPreview" aria-live="polite"></div>
        <div class="editor-actions"><button class="button primary" type="submit">Lưu ảnh logo</button><button class="danger" type="button" id="clearLogoImage">Bỏ ảnh logo</button></div>
      </form>
    </section>`);

  const logoForm = $('#logoAssetForm');
  setPreview($('#logoPreview'), ui.logoImage, 'Chưa chọn ảnh logo');
  logoForm.elements.logoImage.addEventListener('input', () => setPreview($('#logoPreview'), logoForm.elements.logoImage.value, 'Chưa chọn ảnh logo'));

  $('#uploadLogoImage').onclick = async () => {
    const button = $('#uploadLogoImage');
    try {
      setBusy(button, true, 'Đang tải và lưu...', 'Tải và dùng logo');
      const url = await uploadOfficialImage($('#logoImageFile').files[0]);
      if (!url) throw new Error('Hãy chọn ảnh logo trước khi tải lên.');
      logoForm.elements.logoImage.value = url;
      const currentMode = normaliseLogoMode(aeonStore.ui().logoMode);
      const saved = await saveLogoSettings({logoImage: url, logoMode: currentMode === 'text' ? 'image' : currentMode});
      logoForm.elements.logoImage.value = saved.logoImage;
      setPreview($('#logoPreview'), saved.logoImage, 'Chưa chọn ảnh logo');
      toastAdmin('Đã lưu ảnh logo và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải và lưu...', 'Tải và dùng logo');
    }
  };

  logoForm.onsubmit = async event => {
    event.preventDefault();
    try {
      const image = normaliseImageUrl(logoForm.elements.logoImage.value);
      const currentMode = normaliseLogoMode(aeonStore.ui().logoMode);
      const saved = await saveLogoSettings({logoImage: image, logoMode: image && currentMode === 'text' ? 'image' : currentMode});
      logoForm.elements.logoImage.value = saved.logoImage;
      setPreview($('#logoPreview'), saved.logoImage, 'Chưa chọn ảnh logo');
      toastAdmin('Đã lưu ảnh logo và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  $('#clearLogoImage').onclick = async () => {
    try {
      await saveLogoSettings({logoImage: ''});
      logoForm.elements.logoImage.value = '';
      setPreview($('#logoPreview'), '', 'Chưa chọn ảnh logo');
      toastAdmin('Đã bỏ ảnh logo. Website sẽ dùng logo chữ.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  panel.insertAdjacentHTML('beforeend', `
    <section class="admin-card editor asset-editor">
      <p class="eyebrow">HÌNH ẢNH CHÍNH THỨC</p>
      <h2>Ảnh banner đầu trang</h2>
      <p>Ảnh chỉ được báo thành công sau khi đã lưu vào máy chủ. Chọn ảnh từ máy, dán đường dẫn online, hoặc dùng lại ảnh sản phẩm.</p>
      <form id="assetForm">
        <label>Đường dẫn ảnh banner<input name="heroImage" value="${escapeHtml(ui.heroImage || '')}" placeholder="https://... hoặc /assets/uploads/ten-banner.png"></label>
        <div class="upload-field"><label for="heroImageFile">Tải ảnh banner từ máy (PNG, JPG, WEBP, GIF hoặc SVG)</label><input id="heroImageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"><button class="secondary-button" id="uploadHeroImage" type="button">Tải và lưu banner</button></div>
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

  panel.insertAdjacentHTML('beforeend', `
    <section class="admin-card editor asset-editor quote-file-editor">
      <p class="eyebrow">FILE BÁO GIÁ</p>
      <h2>Excel và PDF tải xuống</h2>
      <p>Tải lên tối đa một tệp Excel và một tệp PDF. Nút báo giá trên trang chủ sẽ cho khách chọn định dạng đang có.</p>
      <form id="quoteAssetForm">
        <div class="quote-file-grid">
          <section class="quote-file-card">
            <h3>File Excel</h3>
            <label>Đường dẫn tệp Excel<input name="quoteExcelUrl" value="${escapeHtml(ui.quoteExcelUrl || '')}" placeholder="/assets/uploads/quotes/bao-gia.xlsx"></label>
            <div class="upload-field"><label for="quoteExcelFile">Chọn tệp Excel (.xlsx hoặc .xls, tối đa 20 MB)</label><input id="quoteExcelFile" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"><button class="secondary-button" id="uploadQuoteExcel" type="button">Tải Excel lên</button></div>
            <p class="quote-file-status" id="quoteExcelStatus" aria-live="polite"></p>
            <button class="danger quote-clear-file" id="clearQuoteExcel" type="button">Bỏ file Excel</button>
          </section>
          <section class="quote-file-card">
            <h3>File PDF</h3>
            <label>Đường dẫn tệp PDF<input name="quotePdfUrl" value="${escapeHtml(ui.quotePdfUrl || '')}" placeholder="/assets/uploads/quotes/bao-gia.pdf"></label>
            <div class="upload-field"><label for="quotePdfFile">Chọn tệp PDF (.pdf, tối đa 20 MB)</label><input id="quotePdfFile" type="file" accept=".pdf,application/pdf"><button class="secondary-button" id="uploadQuotePdf" type="button">Tải PDF lên</button></div>
            <p class="quote-file-status" id="quotePdfStatus" aria-live="polite"></p>
            <button class="danger quote-clear-file" id="clearQuotePdf" type="button">Bỏ file PDF</button>
          </section>
        </div>
        <button class="button primary" type="submit">Lưu đường dẫn file báo giá</button>
      </form>
    </section>`);

  const quoteForm = $('#quoteAssetForm');
  const syncQuoteForm = saved => {
    quoteForm.elements.quoteExcelUrl.value = saved.quoteExcelUrl || '';
    quoteForm.elements.quotePdfUrl.value = saved.quotePdfUrl || '';
    setQuoteFileStatus($('#quoteExcelStatus'), saved.quoteExcelUrl, 'Excel');
    setQuoteFileStatus($('#quotePdfStatus'), saved.quotePdfUrl, 'PDF');
  };
  syncQuoteForm(ui);

  $('#uploadQuoteExcel').onclick = async () => {
    const button = $('#uploadQuoteExcel');
    try {
      setBusy(button, true, 'Đang tải Excel...', 'Tải Excel lên');
      const url = await uploadQuoteFile($('#quoteExcelFile').files[0], 'excel');
      const saved = await saveQuoteFiles({quoteExcelUrl: url});
      syncQuoteForm(saved);
      toastAdmin('Đã tải và lưu file báo giá Excel.');
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải Excel...', 'Tải Excel lên');
    }
  };

  $('#uploadQuotePdf').onclick = async () => {
    const button = $('#uploadQuotePdf');
    try {
      setBusy(button, true, 'Đang tải PDF...', 'Tải PDF lên');
      const url = await uploadQuoteFile($('#quotePdfFile').files[0], 'pdf');
      const saved = await saveQuoteFiles({quotePdfUrl: url});
      syncQuoteForm(saved);
      toastAdmin('Đã tải và lưu file báo giá PDF.');
    } catch (error) {
      toastAdmin(error.message);
    } finally {
      setBusy(button, false, 'Đang tải PDF...', 'Tải PDF lên');
    }
  };

  quoteForm.onsubmit = async event => {
    event.preventDefault();
    try {
      const saved = await saveQuoteFiles({
        quoteExcelUrl: quoteForm.elements.quoteExcelUrl.value,
        quotePdfUrl: quoteForm.elements.quotePdfUrl.value
      });
      syncQuoteForm(saved);
      toastAdmin('Đã lưu các file báo giá và đồng bộ website.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  $('#clearQuoteExcel').onclick = async () => {
    try {
      syncQuoteForm(await saveQuoteFiles({quoteExcelUrl: ''}));
      toastAdmin('Đã bỏ file báo giá Excel.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };

  $('#clearQuotePdf').onclick = async () => {
    try {
      syncQuoteForm(await saveQuoteFiles({quotePdfUrl: ''}));
      toastAdmin('Đã bỏ file báo giá PDF.');
    } catch (error) {
      toastAdmin(error.message);
    }
  };
}

function formatLayoutBannerRatio(value) {
  const ratio = Number(value) || AEON_DEFAULT_LAYOUT.bannerAspectRatio;
  return `${ratio.toFixed(2).replace(/\.?0+$/, '')}:1`;
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
      <p class="eyebrow">MÀU SẮC, BỐ CỤC & CHỮ</p>
      <h2>Điều chỉnh giao diện</h2>
      <p>Đổi màu chủ đạo, màu nền và kích thước từng khu vực. Các thay đổi cũng có thể chỉnh nhanh ngay trên màn hình chính khi đang đăng nhập.</p>
      <form id="layoutForm">
        <div class="admin-form-grid">
          <label>Màu chủ đạo<input name="accentColor" type="color" value="${layout.accentColor}"></label>
          <label>Màu chủ đạo đậm<input name="accentDarkColor" type="color" value="${layout.accentDarkColor}"></label>
          <label>Màu nền trang<input name="pageBackgroundColor" type="color" value="${layout.pageBackgroundColor}"></label>
          <label>Màu nền khu vực nội dung<input name="sectionBackgroundColor" type="color" value="${layout.sectionBackgroundColor}"></label>
          <label>Màu chữ chính<input name="textColor" type="color" value="${layout.textColor}"></label>
          <label>Cỡ tiêu đề hero <output data-output="heroTitleSize">${layout.heroTitleSize}px</output><input class="layout-range" type="range" name="heroTitleSize" min="10" max="90" step="1" value="${layout.heroTitleSize}"></label>
          <label>Cỡ mô tả hero <output data-output="heroIntroSize">${layout.heroIntroSize}px</output><input class="layout-range" type="range" name="heroIntroSize" min="12" max="22" step="1" value="${layout.heroIntroSize}"></label>
          <label>Tỷ lệ banner desktop (chỉ đổi chiều ngang) <output data-output="bannerAspectRatio">${formatLayoutBannerRatio(layout.bannerAspectRatio)}</output><input class="layout-range" type="range" name="bannerAspectRatio" min="1.5" max="4" step="any" value="${layout.bannerAspectRatio}" data-output-format="ratio"></label>
          <label>Vị trí nút hero<select name="heroButtonAlign">${alignOptions(layout.heroButtonAlign)}</select></label>
          <label>Cỡ tên sản phẩm <output data-output="productTitleSize">${layout.productTitleSize}px</output><input class="layout-range" type="range" name="productTitleSize" min="12" max="24" step="1" value="${layout.productTitleSize}"></label>
          <label>Chiều cao thanh đầu trang <output data-output="headerHeight">${layout.headerHeight}px</output><input class="layout-range" type="range" name="headerHeight" min="10" max="112" step="1" value="${layout.headerHeight}"></label>
          <label>Chiều cao hero <output data-output="heroHeight">${layout.heroHeight ? `${layout.heroHeight}px` : 'Tự động'}</output><input class="layout-range" type="range" name="heroHeight" min="0" max="700" step="10" value="${layout.heroHeight}" data-auto-label="Tự động"></label>
          <label>Khoảng cách đầu/cuối các khu vực <output data-output="sectionSpacing">${layout.sectionSpacing ? `${layout.sectionSpacing}px` : 'Tự động'}</output><input class="layout-range" type="range" name="sectionSpacing" min="0" max="170" step="5" value="${layout.sectionSpacing}" data-auto-label="Tự động"></label>
          <label>Chiều cao ảnh sản phẩm <output data-output="productImageHeight">${layout.productImageHeight ? `${layout.productImageHeight}px` : 'Tự động'}</output><input class="layout-range" type="range" name="productImageHeight" min="0" max="480" step="10" value="${layout.productImageHeight}" data-auto-label="Tự động"></label>
          <label>Số cột sản phẩm trên desktop<select name="productColumns"><option value="0"${Number(layout.productColumns) === 0 ? ' selected' : ''}>Tự động</option><option value="2"${Number(layout.productColumns) === 2 ? ' selected' : ''}>2 cột</option><option value="3"${Number(layout.productColumns) === 3 ? ' selected' : ''}>3 cột</option><option value="4"${Number(layout.productColumns) === 4 ? ' selected' : ''}>4 cột</option></select></label>
          <label>Cỡ logo <output data-output="logoSize">${layout.logoSize}px</output><input class="layout-range" type="range" name="logoSize" min="18" max="48" step="1" value="${layout.logoSize}"></label>
          <label>Vị trí nút “Xem chi tiết”<select name="productButtonAlign">${alignOptions(layout.productButtonAlign)}</select></label>
          <label>Vị trí nút đặt hàng<select name="checkoutButtonAlign">${alignOptions(layout.checkoutButtonAlign, true)}</select></label>
        </div>
        <div class="editor-actions"><button class="button primary" type="submit">Lưu bố cục</button><button class="danger" type="button" id="resetLayout">Khôi phục mặc định</button></div>
      </form>
    </section>`);
  document.querySelectorAll('.layout-range').forEach(input => {
    input.oninput = () => {
      document.querySelector(`[data-output="${input.name}"]`).textContent = input.dataset.outputFormat === 'ratio'
        ? formatLayoutBannerRatio(input.value)
        : (Number(input.value) === 0 && input.dataset.autoLabel ? input.dataset.autoLabel : `${input.value}px`);
    };
  });
  $('#layoutForm').onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    ['heroTitleSize', 'heroIntroSize', 'bannerAspectRatio', 'productTitleSize', 'headerHeight', 'heroHeight', 'sectionSpacing', 'productImageHeight', 'productColumns', 'logoSize'].forEach(key => {
      values[key] = Number(values[key]);
    });
    try {
      await saveShared('aeon-layout', {...layout, ...values});
      toastAdmin('Đã lưu màu sắc, bố cục và kích thước giao diện.');
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

async function downloadCustomerExcel(button) {
  try {
    setBusy(button, true, 'Đang tạo Excel...', 'Xuất Excel');
    const response = await fetch('/api/export/customers.xlsx', {cache: 'no-store'});
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Không thể tạo tệp Excel.');
    }
    const file = await response.blob();
    if (!file.size) throw new Error('Tệp Excel chưa có dữ liệu hợp lệ.');
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'danh-sach-khach-hang.xlsx';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toastAdmin('Đã tải tệp Excel gồm khách hàng và đơn hàng.');
  } catch (error) {
    toastAdmin(error.message);
  } finally {
    setBusy(button, false, 'Đang tạo Excel...', 'Xuất Excel');
  }
}

function customersPanel(panel) {
  const customers = aeonStore.customers();
  const orders = aeonStore.orders();
  const syncedOrders = orders.filter(order => order.googleSheetSync?.status === 'synced').length;
  const failedOrders = orders.filter(order => order.googleSheetSync?.status === 'failed').length;
  const pendingOrders = orders.filter(order => order.googleSheetSync?.status === 'pending').length;
  panel.innerHTML = `<section class="admin-card customer-data-card"><h2>Thông tin khách hàng</h2>${customers.length ? `<div class="customer-list">${customers.map(customer => {
    const customerOrders = orders.filter(order => String(order.customerId) === String(customer.id));
    const total = customerOrders.reduce((sum, order) => sum + order.total, 0);
    const orderMarkup = customerOrders.length ? customerOrders.map(order => {
      const itemCount = (Array.isArray(order.items) ? order.items : []).reduce((sum, item) => sum + Math.max(1, Number(item.qty ?? item.quantity) || 1), 0);
      const productNames = (Array.isArray(order.items) ? order.items : []).slice(0, 2).map(item => escapeHtml(item.name || 'Sản phẩm')).join(' · ');
      const moreProducts = Math.max(0, (Array.isArray(order.items) ? order.items.length : 0) - 2);
      const syncStatus = order.googleSheetSync?.status || 'pending';
      const syncLabel = syncStatus === 'synced' ? 'Đã đồng bộ' : syncStatus === 'failed' ? 'Lỗi đồng bộ' : 'Đang chờ';
      return `<div class="customer-order-card">
        <div class="customer-order-main">
          <div class="customer-order-code"><span>MÃ ĐƠN HÀNG</span><b>${escapeHtml(order.code)}</b><small>${escapeHtml(order.createdAt || '')}</small></div>
          <div class="customer-order-products"><span>${itemCount} sản phẩm</span><p>${productNames || 'Chưa có thông tin sản phẩm'}${moreProducts ? ` · +${moreProducts} sản phẩm khác` : ''}</p></div>
          <div class="customer-order-total"><span>TỔNG THANH TOÁN</span><strong>${money(order.total)}</strong><small class="order-sync-status ${escapeHtml(syncStatus)}">${syncLabel}</small></div>
        </div>
        <a class="order-pdf-button" href="/api/orders/${encodeURIComponent(order.code)}.pdf" download="don-hang-${escapeHtml(order.code)}.pdf" title="Tải PDF đơn hàng ${escapeHtml(order.code)}"><span>PDF</span>Tải đơn hàng <b>↓</b></a>
      </div>`;
    }).join('') : '<p class="customer-no-order">Khách hàng này chưa có đơn hàng.</p>';
    return `<article class="customer-record">
      <header class="customer-record-header">
        <div><span class="customer-label">KHÁCH HÀNG</span><h3>${escapeHtml(customer.name)}</h3><p>${escapeHtml(customer.phone)}${customer.email ? ` · ${escapeHtml(customer.email)}` : ''}</p><p>${escapeHtml(customer.address)}</p>${customer.message ? `<blockquote>“${escapeHtml(customer.message)}”</blockquote>` : ''}</div>
        <div class="customer-record-total"><b>${customerOrders.length} đơn hàng</b><strong>${money(total)}</strong><small>Ghi nhận ${escapeHtml(customer.createdAt || '')}</small></div>
      </header>
      <div class="customer-order-list">${orderMarkup}</div>
    </article>`;
  }).join('')}</div>` : '<p class="empty-admin">Chưa có thông tin khách hàng. Thông tin sẽ được lưu sau khi khách gửi form đặt hàng.</p>'}</section>`;
  const card = panel.querySelector('.admin-card');
  const heading = card.querySelector('h2');
  const action = document.createElement('div');
  action.className = 'panel-action';
  action.innerHTML = '<div><h2>Thông tin khách hàng</h2><p>Xuất Excel tổng hợp hoặc tải PDF đẹp riêng cho từng đơn hàng bên dưới.</p></div><button class="secondary-button" id="downloadCustomerExcel" type="button">Xuất Excel</button>';
  heading.replaceWith(action);
  action.querySelector('#downloadCustomerExcel').onclick = () => downloadCustomerExcel(action.querySelector('#downloadCustomerExcel'));
  panel.insertAdjacentHTML('afterbegin', `
    <section class="admin-card sheet-sync-card">
      <div class="panel-action"><div><p class="eyebrow">GOOGLE SHEET</p><h2>Đồng bộ đơn đặt hàng</h2><p>Đơn vẫn được lưu nội bộ trước, sau đó mới gửi bản sao sang Apps Script.</p></div><a class="secondary-button" href="/google-apps-script-order-sync.gs" download>Tải mã Apps Script</a></div>
      <div class="sheet-sync-stats"><span><b>${syncedOrders}</b> Đã đồng bộ</span><span><b>${pendingOrders}</b> Đang chờ</span><span class="${failedOrders ? 'has-error' : ''}"><b>${failedOrders}</b> Lỗi đồng bộ</span></div>
      <p class="sheet-sync-help">Endpoint được cấu hình bằng biến môi trường <code>GOOGLE_SHEET_WEB_APP_URL</code> trên máy chủ. Deployment phải có hàm <code>doPost</code>, chạy dưới tài khoản của bạn và cho phép truy cập <b>Anyone</b>.</p>
    </section>`);
}

function toastAdmin(message) {
  const notice = document.createElement('p');
  notice.className = 'admin-notice';
  notice.textContent = message;
  $('#adminPanel').prepend(notice);
  setTimeout(() => notice.remove(), 3600);
}

window.addEventListener('aeon-store-sync', () => {
  renderAeonBrandLogos(aeonStore.ui());
  if (isAuthed()) render();
});

renderAeonBrandLogos(aeonStore.ui());
async function initialiseAdminSession() {
  try {
    const response = await fetch('/api/admin/session', {cache:'no-store'});
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.authenticated) {
      aeonStore.setAdminSession(true);
      showApp();
      return;
    }
    aeonStore.setAdminSession(false);
    if (result.configured === false) $('#loginError').textContent = 'Máy chủ chưa cấu hình ADMIN_USERNAME và ADMIN_PASSWORD.';
  } catch {
    aeonStore.setAdminSession(false);
    $('#loginError').textContent = 'Không thể kiểm tra phiên quản trị. Hãy kiểm tra kết nối máy chủ.';
  }
}
initialiseAdminSession();

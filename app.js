let products = [];
let cart = JSON.parse(localStorage.getItem('aeon-mooncake-cart') || '[]');
let lastFocusedElement = null;
let storefrontAdminLastFocus = null;

const $ = selector => document.querySelector(selector);
const fmt = value => `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} ₫`;
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const safeColor = (value, fallback = '#eee5d4') => /^#[0-9a-f]{3,8}$/i.test(String(value || '')) ? value : fallback;
const isStorefrontAdmin = () => aeonStore.isAdminSession();

function normaliseImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return '';
  return `/${url.replace(/^\.?\//, '')}`;
}

function normaliseVariants(value, fallbackPrice) {
  if (!Array.isArray(value)) return [];
  return value.map((variant, index) => {
    const name = String(variant?.name || '').trim();
    if (!name) return null;
    const rawPrice = Number(variant.price);
    const price = Number.isFinite(rawPrice) && rawPrice >= 0 ? Math.round(rawPrice) : fallbackPrice;
    const rawId = String(variant.id || variant.sku || name || index + 1).trim();
    const id = rawId.replace(/\s+/g, '-').slice(0, 100) || `variant-${index + 1}`;
    return {id, name, price, sku: String(variant.sku || '').trim().slice(0, 100)};
  }).filter(Boolean);
}

function normaliseProduct(product) {
  const price = Math.max(0, Number(product.price) || 0);
  return {
    id: String(product.id || ''),
    name: String(product.name || 'Sản phẩm đang cập nhật'),
    price,
    description: String(product.description || ''),
    details: String(product.details || product.description || ''),
    label: String(product.label || ''),
    brand: normaliseAeonBrand(product.brand),
    image: normaliseImageUrl(product.image),
    bg: safeColor(product.bg),
    box: safeColor(product.box, '#8f1834'),
    weight: String(product.weight || ''),
    ingredients: String(product.ingredients || ''),
    sku: String(product.sku || ''),
    variants: normaliseVariants(product.variants, price)
  };
}

function priceLabel(product) {
  if (product.variants?.length) {
    const available = product.variants.map(variant => variant.price).filter(price => price > 0);
    return available.length ? `Từ ${fmt(Math.min(...available))}` : 'Liên hệ';
  }
  return product.price > 0 ? fmt(product.price) : 'Liên hệ';
}

function hasVariants(product) {
  return Array.isArray(product.variants) && product.variants.length > 0;
}

function canOrderProduct(product) {
  return hasVariants(product) ? product.variants.some(variant => variant.price > 0) : product.price > 0;
}

function cartKey(productId, variantId = '') {
  return `${productId}::${variantId || ''}`;
}

function cartLabel(item) {
  return [item.name, item.variantName].filter(Boolean).join(' · ');
}

function cartItemFromProduct(product, variant = null) {
  const variantId = variant?.id || '';
  return {
    id: product.id,
    productId: product.id,
    cartKey: cartKey(product.id, variantId),
    name: product.name,
    price: variant ? variant.price : product.price,
    image: product.image,
    bg: product.bg,
    sku: variant?.sku || product.sku,
    variantId,
    variantName: variant?.name || '',
    variantSku: variant?.sku || ''
  };
}

function promotionFor(subtotal, date = new Date()) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const within = (from, to) => day >= new Date(`${from}T00:00:00`) && day <= new Date(`${to}T23:59:59`);
  if (within('2026-08-03', '2026-08-19') && subtotal >= 1000000) return {rate: .08, label: 'Ưu đãi sớm 8%'};
  if (within('2026-08-20', '2026-09-25')) {
    const rate = subtotal >= 30000001 ? .15 : subtotal >= 15000001 ? .12 : subtotal >= 10000001 ? .10 : subtotal >= 3000000 ? .05 : 0;
    return rate ? {rate, label: `Chiết khấu ${rate * 100}%`} : {rate: 0, label: 'Ưu đãi áp dụng theo giá trị đơn hàng'};
  }
  return {rate: 0, label: 'Ưu đãi áp dụng theo thời gian chương trình'};
}

const grid = $('#productGrid');
const cartItems = $('#cartItems');
const brandDirectory = $('#brandDirectory');
let activeBrand = '';

$('#openCart').innerHTML = '<svg class="cart-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.5L20 8H7.1"></path><circle cx="10" cy="20" r="1"></circle><circle cx="17" cy="20" r="1"></circle></svg><span>Giỏ hàng</span><b id="cartCount">0</b>';
$('.drawer-head h2').textContent = 'Giỏ hàng';
$('.hero .note').textContent = 'Hình ảnh, sản phẩm và giá bán được cập nhật theo thông tin chính thức.';
$('#checkout .note').textContent = 'Chúng tôi sẽ liên hệ xác nhận đơn hàng, ưu đãi và thời gian giao phù hợp.';
$('.cart-total small').textContent = 'Phí giao hàng và ưu đãi sẽ được xác nhận khi tư vấn.';
$('footer p').textContent = '© 2026 AEON Mooncake.';

document.body.insertAdjacentHTML('beforeend', '<button class="mobile-cart-cta" id="mobileCart" aria-label="Mở giỏ hàng"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.5L20 8H7.1"></path><circle cx="10" cy="20" r="1"></circle><circle cx="17" cy="20" r="1"></circle></svg><span>Giỏ hàng</span><b id="mobileCartCount">0</b><i>Xem giỏ →</i></button>');
$('.site-header nav').insertAdjacentHTML('beforeend', '<a href="admin.html">Quản trị</a>');

['product-detail.css', 'hotline.css', 'promotion.css', 'hero-promotion.css', 'catalog-focus.css', 'hero-compact.css', 'admin-layout.css', 'storefront-refine.css', 'mobile-storefront.css', 'official-assets.css', 'product-modal-fix.css', 'product-variants.css', 'storefront-product-ux.css', 'brand-directory.css', 'storefront-admin.css'].forEach(href => {
  document.head.append(Object.assign(document.createElement('link'), {rel: 'stylesheet', href}));
});

document.body.insertAdjacentHTML('beforeend', '<aside class="hotline-widget" aria-label="Tư vấn đặt hàng"><a class="hotline-call" href="tel:0327747337"><span>Hotline tư vấn</span><b>0327 747 337</b></a><a class="zalo-link" href="https://zalo.me/0327747337" target="_blank" rel="noopener noreferrer" aria-label="Nhắn Zalo 0327747337">Zalo</a></aside>');
$('footer').insertAdjacentHTML('beforeend', '<a class="footer-hotline" href="https://zalo.me/0327747337" target="_blank" rel="noopener noreferrer">Tư vấn: 0327 747 337 · Zalo ↗</a>');

$('.benefits').insertAdjacentHTML('afterend', '<section class="promotion-section" id="promotion"><div><p class="eyebrow">ƯU ĐÃI MÙA TRĂNG 2026</p><h2>Ưu đãi càng lớn,<br><em>quà tặng càng trọn.</em></h2><p>Áp dụng theo giá trị hóa đơn trong thời gian chương trình.</p></div><div class="promotion-list"><article><span>03/08 — 19/08</span><h3>Ưu đãi sớm</h3><strong>Giảm 8%</strong><p>Cho hóa đơn từ 1.000.000 ₫</p></article><article><span>20/08 — 25/09</span><h3>Chiết khấu chính thức</h3><p><b>5%</b> từ 3 triệu · <b>10%</b> từ 10 triệu<br><b>12%</b> từ 15 triệu · <b>15%</b> từ 30 triệu</p></article></div><small>Không áp dụng đồng thời ưu đãi thành viên 5% vào ngày 5 & 20 hằng tháng. Phiếu ưu đãi áp dụng cho giỏ quà không rượu.</small></section>');

const compactPromotion = $('#promotion');
const heroCopy = $('.hero-copy');
compactPromotion.className = 'hero-promotion';
compactPromotion.innerHTML = '<span>Ưu đãi mùa trăng</span><p><b>03–19/08: giảm 8%</b> từ 1 triệu &nbsp;·&nbsp; <b>20/08–25/09: giảm 5–15%</b> từ 3 triệu</p>';
heroCopy.insertBefore(compactPromotion, heroCopy.querySelector('.note'));

$('.cart-total').insertAdjacentHTML('beforeend', '<p id="cartPromotion" class="cart-promotion"></p>');
$('#orderForm').insertAdjacentHTML('afterbegin', '<section class="checkout-summary" id="checkoutSummary" aria-live="polite"></section>');

const catalogSection = $('#collection');
const checkoutSection = $('#checkout');
$('.hero').after(catalogSection);
catalogSection.after(checkoutSection);
$('.story').hidden = true;
$('.gift-banner').hidden = true;
$('.how').hidden = true;

const mainNav = document.querySelectorAll('.site-header nav a');
mainNav[0].textContent = 'Sản phẩm';
mainNav[1].href = '#promotion';
mainNav[1].textContent = 'Ưu đãi';
mainNav[2].href = '#checkout';
mainNav[2].textContent = 'Đặt hàng';
const heroSecondaryLink = $('.hero-actions .text-link');
heroSecondaryLink.href = '#promotion';
heroSecondaryLink.textContent = 'Xem ưu đãi';

function renderStorefrontAdminTools() {
  const active = isStorefrontAdmin();
  document.body.classList.toggle('admin-preview', active);
  const existing = $('#storefrontAdminToolbar');
  if (!active) {
    existing?.remove();
    closeStorefrontProductEditor();
    return;
  }
  if (existing) return;

  const toolbarAnchor = catalogSection.querySelector('.brand-directory') || catalogSection.querySelector('.products');
  if (!toolbarAnchor) return;
  toolbarAnchor.insertAdjacentHTML('beforebegin', `<div class="storefront-admin-toolbar" id="storefrontAdminToolbar" aria-label="Chế độ quản trị sản phẩm">
    <div><span class="storefront-admin-status">● Chế độ quản trị</span><small>Bạn đang chỉnh sửa trực tiếp trên trang bán hàng.</small></div>
    <div class="storefront-admin-toolbar-actions"><button type="button" data-storefront-new>+ Thêm sản phẩm</button><a href="admin.html">Quản trị đầy đủ</a><button type="button" class="storefront-admin-logout" data-storefront-logout>Đăng xuất</button></div>
  </div>`);
}

function storefrontProductAdminActions(product) {
  if (!isStorefrontAdmin()) return '';
  return `<div class="storefront-product-admin-actions" aria-label="Thao tác quản trị cho ${escapeHtml(product.name)}">
    <button type="button" data-storefront-edit="${escapeHtml(product.id)}" aria-label="Chỉnh sửa ${escapeHtml(product.name)}">Sửa</button>
    <button type="button" class="storefront-product-delete" data-storefront-delete="${escapeHtml(product.id)}" aria-label="Xóa ${escapeHtml(product.name)}">×</button>
  </div>`;
}

function cleanStorefrontProductText(value, limit = 1000, preserveLines = false) {
  const source = String(value ?? '').replace(/\u0000/g, '');
  const text = preserveLines
    ? source.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    : source.replace(/\s+/g, ' ').trim();
  return text.slice(0, limit);
}

function newStorefrontVariantId() {
  return `variant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function storefrontVariantRowMarkup(variant = {}) {
  const id = String(variant.id || newStorefrontVariantId());
  return `<div class="product-variant-row" data-variant-id="${escapeHtml(id)}"><label>Tên lựa chọn<input data-variant-name required value="${escapeHtml(variant.name || '')}" placeholder="Ví dụ: Hộp 4 bánh"></label><label>Giá bán (VNĐ)<input data-variant-price type="number" min="0" inputmode="numeric" required value="${variant.price ?? ''}" placeholder="750000"></label><label>Mã SKU<input data-variant-sku value="${escapeHtml(variant.sku || '')}" placeholder="AM-2026-04"></label><button type="button" class="remove-product-variant" data-remove-variant aria-label="Xóa lựa chọn này">×</button></div>`;
}

function storefrontVariantsFromEditor(list) {
  const rows = [...list.querySelectorAll('[data-variant-id]')];
  if (rows.length > 20) throw new Error('Mỗi sản phẩm tối đa 20 lựa chọn.');
  const names = new Set();
  const skus = new Set();
  return rows.map(row => {
    const name = cleanStorefrontProductText(row.querySelector('[data-variant-name]').value, 120);
    const price = Number(row.querySelector('[data-variant-price]').value);
    const sku = cleanStorefrontProductText(row.querySelector('[data-variant-sku]').value, 100);
    if (!name || !Number.isFinite(price) || price < 0) throw new Error('Mỗi lựa chọn cần có tên và giá bán hợp lệ.');
    const nameKey = name.toLocaleLowerCase('vi-VN');
    const skuKey = sku.toLocaleLowerCase('vi-VN');
    if (names.has(nameKey)) throw new Error('Tên các lựa chọn không được trùng nhau.');
    if (sku && skus.has(skuKey)) throw new Error('Mã SKU của các lựa chọn không được trùng nhau.');
    names.add(nameKey);
    if (sku) skus.add(skuKey);
    return {id: row.dataset.variantId || newStorefrontVariantId(), name, price: Math.round(price), sku};
  });
}

function bindStorefrontVariantEditor(form) {
  const list = form.querySelector('[data-variant-rows]');
  const addButton = form.querySelector('[data-add-variant]');
  const priceInput = form.elements.price;
  const hint = form.querySelector('[data-variant-price-hint]');
  const originalPrice = priceInput.value;
  const syncPrice = () => {
    const rows = [...list.querySelectorAll('[data-variant-id]')];
    const prices = rows.map(row => Number(row.querySelector('[data-variant-price]').value));
    priceInput.readOnly = rows.length > 0;
    priceInput.classList.toggle('derived-price', rows.length > 0);
    if (!rows.length) {
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
      toast('Mỗi sản phẩm tối đa 20 lựa chọn.');
      return;
    }
    list.insertAdjacentHTML('beforeend', storefrontVariantRowMarkup());
    const row = list.lastElementChild;
    bindRow(row);
    syncPrice();
    row.querySelector('[data-variant-name]').focus();
  };
  syncPrice();
  return () => storefrontVariantsFromEditor(list);
}

function renderStorefrontEditorPreview(preview, value, name = 'Ảnh sản phẩm') {
  const image = normaliseImageUrl(value);
  preview.innerHTML = image
    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" data-image-fallback><span data-image-placeholder hidden>Không thể hiển thị ảnh này.</span>`
    : '<span data-image-placeholder>Chưa chọn ảnh sản phẩm</span>';
  attachImageFallbacks(preview);
}

function readStorefrontImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Không thể đọc ảnh đã chọn.'));
    reader.readAsDataURL(file);
  });
}

async function uploadStorefrontProductImage(file) {
  if (!file) throw new Error('Hãy chọn ảnh trước khi tải lên.');
  if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) throw new Error('Chỉ hỗ trợ ảnh PNG, JPG, WEBP hoặc GIF.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Ảnh phải nhỏ hơn hoặc bằng 10 MB.');
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({filename: file.name, dataUrl: await readStorefrontImageAsDataUrl(file)})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Không thể tải ảnh lên.');
  return normaliseImageUrl(result.url);
}

function productFromStorefrontForm(form, existing = {}, variants = []) {
  const data = Object.fromEntries(new FormData(form));
  const name = cleanStorefrontProductText(data.name, 160);
  const description = cleanStorefrontProductText(data.description, 500);
  const price = variants.length ? Math.min(...variants.map(variant => variant.price)) : Number(data.price);
  if (!name || !description || !Number.isFinite(price) || price < 0) {
    throw new Error('Vui lòng nhập tên, mô tả và giá bán hợp lệ.');
  }
  return {
    ...existing,
    name,
    price: Math.round(price),
    label: cleanStorefrontProductText(data.label, 100),
    brand: normaliseAeonBrand(data.brand),
    description,
    details: AEONRichText.clean(data.details, 3000),
    weight: cleanStorefrontProductText(data.weight, 160),
    ingredients: cleanStorefrontProductText(data.ingredients, 250),
    sku: cleanStorefrontProductText(data.sku, 100),
    variants,
    image: normaliseImageUrl(data.image),
    bg: safeColor(data.bg, safeColor(existing.bg, '#e9c38b')),
    box: safeColor(data.box, safeColor(existing.box, '#8f1834'))
  };
}

async function saveStorefrontProduct(form, existing, getVariants) {
  await aeonStore.pull();
  const all = [...aeonStore.products()];
  const position = existing.id ? all.findIndex(product => product.id === existing.id) : -1;
  if (existing.id && position < 0) throw new Error('Sản phẩm đã thay đổi ở phiên khác. Hãy tải lại trang trước khi lưu.');
  const stored = position >= 0 ? all[position] : {};
  const product = productFromStorefrontForm(form, stored, getVariants());
  product.id = stored.id || existing.id || `sp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (position >= 0) all[position] = product;
  else all.push(product);

  const saved = await aeonStore.set('aeon-products', all);
  if (!saved) {
    await aeonStore.pull();
    throw new Error('Không thể lưu sản phẩm. Vui lòng kiểm tra kết nối rồi thử lại.');
  }
  return {created: position < 0, product};
}

function closeStorefrontProductEditor() {
  const modal = $('#storefrontAdminEditor');
  if (!modal?.classList.contains('show')) return false;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  modal.replaceChildren();
  document.body.classList.remove('storefront-admin-editor-open');
  const focusTarget = storefrontAdminLastFocus;
  storefrontAdminLastFocus = null;
  focusTarget?.focus?.();
  return true;
}

function openStorefrontProductEditor(id) {
  if (!isStorefrontAdmin()) return;
  const found = id ? aeonStore.products().find(product => product.id === id) : null;
  if (id && !found) {
    toast('Không tìm thấy sản phẩm cần chỉnh sửa.');
    return;
  }
  const existing = found ? {...found, variants: normaliseVariants(found.variants, Math.max(0, Number(found.price) || 0))} : {id: '', name: '', price: '', description: '', details: '', label: '', brand: '', image: '', weight: '', ingredients: '', sku: '', variants: [], bg: '#e9c38b', box: '#8f1834'};
  storefrontAdminLastFocus = document.activeElement;
  let modal = $('#storefrontAdminEditor');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'storefrontAdminEditor';
    modal.className = 'storefront-admin-editor';
    modal.setAttribute('aria-hidden', 'true');
    document.body.append(modal);
  }

  modal.innerHTML = `<section class="storefront-admin-editor-card" role="dialog" aria-modal="true" aria-labelledby="storefrontEditorTitle">
    <button type="button" class="storefront-admin-editor-close" data-storefront-admin-close aria-label="Đóng chỉnh sửa sản phẩm">×</button>
    <header><p class="eyebrow">CHỈNH SỬA TRỰC TIẾP</p><h2 id="storefrontEditorTitle">${existing.id ? 'Cập nhật sản phẩm' : 'Thêm sản phẩm mới'}</h2><p>Thay đổi sẽ hiển thị ngay trên trang bán hàng sau khi lưu.</p></header>
    <form id="storefrontProductForm">
      <div class="storefront-admin-form-grid">
        <label>Tên sản phẩm<input name="name" required value="${escapeHtml(existing.name)}"></label>
        <label>Thương hiệu<select name="brand">${aeonBrandOptions(existing.brand)}</select></label>
        <label>Giá bán (VNĐ)<small data-variant-price-hint></small><input name="price" type="number" min="0" inputmode="numeric" required value="${existing.price ?? ''}" placeholder="Ví dụ: 750000"${existing.variants?.length ? ' readonly' : ''}></label>
        <label>Nhãn hiển thị<input name="label" value="${escapeHtml(existing.label || '')}" placeholder="Ví dụ: Bán chạy"></label>
        <label>Quy cách / khối lượng<input name="weight" value="${escapeHtml(existing.weight || '')}" placeholder="Ví dụ: 4 bánh · 720g"></label>
        <label class="wide">Mô tả ngắn<textarea name="description" required rows="2">${escapeHtml(existing.description || '')}</textarea></label>
        <div class="richtext-field wide"><span class="richtext-label">Thông tin chi tiết</span>${AEONRichText.editorMarkup({name: 'details', value: existing.details || '', rows: 8, placeholder: 'Thông tin hiển thị khi khách xem chi tiết'})}</div>
        <label>Thành phần nổi bật<input name="ingredients" value="${escapeHtml(existing.ingredients || '')}"></label>
        <label>Mã sản phẩm<input name="sku" value="${escapeHtml(existing.sku || '')}"></label>
        <fieldset class="product-variant-editor wide"><legend>Lựa chọn sản phẩm</legend><p>Một hình có thể đại diện nhiều loại hàng. Khách sẽ chọn loại trước khi thêm vào giỏ.</p><div class="product-variant-rows" data-variant-rows>${(existing.variants || []).map(storefrontVariantRowMarkup).join('')}</div><button type="button" data-add-variant>+ Thêm lựa chọn</button></fieldset>
        <label class="wide">Đường dẫn ảnh<input name="image" value="${escapeHtml(existing.image || '')}" placeholder="https://... hoặc assets/uploads/..."></label>
        <label class="storefront-admin-upload wide">Tải ảnh từ máy<input data-storefront-image-file type="file" accept="image/png,image/jpeg,image/webp,image/gif"><button type="button" data-storefront-image-upload>Tải ảnh lên</button></label>
        <label>Màu nền khi chưa có ảnh<input name="bg" type="color" value="${safeColor(existing.bg, '#e9c38b')}"></label>
        <label>Màu hộp khi chưa có ảnh<input name="box" type="color" value="${safeColor(existing.box, '#8f1834')}"></label>
      </div>
      <div class="storefront-admin-image-preview" data-storefront-image-preview aria-live="polite"></div>
      <p class="storefront-admin-editor-status" data-storefront-editor-status aria-live="polite"></p>
      <footer><button type="button" class="storefront-admin-cancel" data-storefront-admin-close>Hủy</button><button type="submit" class="button primary">${existing.id ? 'Lưu sản phẩm' : 'Thêm sản phẩm'}</button></footer>
    </form>
  </section>`;

  const form = modal.querySelector('#storefrontProductForm');
  AEONRichText.bindAll(form);
  const getVariants = bindStorefrontVariantEditor(form);
  const preview = modal.querySelector('[data-storefront-image-preview]');
  const status = modal.querySelector('[data-storefront-editor-status]');
  const uploadButton = modal.querySelector('[data-storefront-image-upload]');
  const fileInput = modal.querySelector('[data-storefront-image-file]');
  renderStorefrontEditorPreview(preview, existing.image, existing.name);
  form.elements.image.addEventListener('input', () => renderStorefrontEditorPreview(preview, form.elements.image.value, form.elements.name.value));
  form.elements.name.addEventListener('input', () => renderStorefrontEditorPreview(preview, form.elements.image.value, form.elements.name.value));
  modal.onclick = event => {
    if (event.target === modal || event.target.closest('[data-storefront-admin-close]')) closeStorefrontProductEditor();
  };
  uploadButton.onclick = async () => {
    try {
      status.textContent = '';
      uploadButton.disabled = true;
      uploadButton.textContent = 'Đang tải...';
      const url = await uploadStorefrontProductImage(fileInput.files[0]);
      form.elements.image.value = url;
      renderStorefrontEditorPreview(preview, url, form.elements.name.value);
      status.textContent = 'Ảnh đã tải lên. Bấm nút lưu để áp dụng cho sản phẩm.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      uploadButton.disabled = false;
      uploadButton.textContent = 'Tải ảnh lên';
    }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    try {
      status.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Đang lưu...';
      const result = await saveStorefrontProduct(form, existing, getVariants);
      closeStorefrontProductEditor();
      refreshStorefront();
      toast(result.created ? `Đã thêm ${result.product.name}.` : `Đã cập nhật ${result.product.name}.`);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = existing.id ? 'Lưu sản phẩm' : 'Thêm sản phẩm';
    }
  };
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('storefront-admin-editor-open');
  modal.querySelector('[data-storefront-admin-close]').focus();
}

async function deleteStorefrontProduct(id) {
  if (!isStorefrontAdmin()) return;
  const product = aeonStore.products().find(item => item.id === id);
  if (!product) {
    toast('Sản phẩm này không còn tồn tại.');
    return;
  }
  if (!confirm(`Xóa sản phẩm “${product.name}”?`)) return;
  try {
    await aeonStore.pull();
    const all = aeonStore.products();
    const current = all.find(item => item.id === id);
    if (!current) throw new Error('Sản phẩm đã thay đổi ở phiên khác. Hãy tải lại trang.');
    const saved = await aeonStore.set('aeon-products', all.filter(item => item.id !== id));
    if (!saved) {
      await aeonStore.pull();
      throw new Error('Không thể xóa sản phẩm. Vui lòng thử lại.');
    }
    closeProductDetail();
    refreshStorefront();
    toast(`Đã xóa ${current.name}.`);
  } catch (error) {
    toast(error.message);
  }
}

function applyUi() {
  const ui = aeonStore.ui();
  const hero = $('.hero-copy');
  hero.querySelector('.eyebrow').textContent = ui.eyebrow;
  hero.querySelector('h1').innerHTML = String(ui.title).split('\n').map((text, index) => index ? `<em>${escapeHtml(text)}</em>` : escapeHtml(text)).join('<br>');
  hero.querySelector('.intro').textContent = ui.intro;

  const art = $('.hero-art');
  art.querySelector('img')?.remove();
  let official = art.querySelector('.official-hero');
  if (!official) {
    official = document.createElement('div');
    official.className = 'official-hero';
    art.append(official);
  }
  const heroImage = normaliseImageUrl(ui.heroImage);
  official.innerHTML = heroImage ? `<img src="${escapeHtml(heroImage)}" alt="Hình ảnh bánh Trung Thu AEON" data-image-fallback>` : '<span>Hình ảnh chính thức<br>đang cập nhật</span>';
  attachImageFallbacks(official);
}

function applyLayout() {
  const layout = aeonStore.layout();
  const hero = $('.hero');
  hero.style.setProperty('--admin-hero-title-size', `${Math.min(Math.max(Number(layout.heroTitleSize) || 68, 42), 76)}px`);
  hero.style.setProperty('--admin-hero-intro-size', `${Math.min(Math.max(Number(layout.heroIntroSize) || 15, 12), 22)}px`);
  hero.querySelector('.hero-actions').dataset.buttonAlign = layout.heroButtonAlign;
  grid.style.setProperty('--admin-product-title-size', `${Math.min(Math.max(Number(layout.productTitleSize) || 15, 12), 24)}px`);
  grid.dataset.buttonAlign = layout.productButtonAlign;
  $('.checkout form').dataset.buttonAlign = layout.checkoutButtonAlign;
}

function productImageMarkup(product, className, placeholderClass, placeholderText) {
  if (!product.image) return `<span class="${placeholderClass}" data-image-placeholder>${placeholderText}</span>`;
  return `<img class="${className}" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" data-image-fallback><span class="${placeholderClass}" data-image-placeholder hidden>${placeholderText}</span>`;
}

function attachImageFallbacks(scope = document) {
  scope.querySelectorAll('img[data-image-fallback]').forEach(image => {
    if (image.dataset.fallbackBound) return;
    image.dataset.fallbackBound = 'true';
    image.addEventListener('error', () => {
      image.hidden = true;
      image.parentElement?.querySelector('[data-image-placeholder]')?.removeAttribute('hidden');
    }, {once: true});
  });
}

function renderBrandDirectory() {
  if (!brandDirectory) return;
  activeBrand = normaliseAeonBrand(activeBrand);
  const selectedLabel = activeBrand ? `Đang xem: ${escapeHtml(activeBrand)}` : 'Chọn thương hiệu để lọc sản phẩm';
  brandDirectory.innerHTML = `<div class="brand-directory-head">
    <div><h3>Thương hiệu</h3><p>${selectedLabel}</p></div>
    <button type="button" class="brand-filter-reset${activeBrand ? '' : ' is-active'}" data-brand-filter="" aria-pressed="${activeBrand ? 'false' : 'true'}">Tất cả</button>
  </div>
  <div class="brand-groups">${AEON_BRAND_GROUPS.map(group => `<section class="brand-group"><h4>${escapeHtml(group.name)}</h4><div class="brand-group-list">${group.brands.map(brand => `<button type="button" class="brand-chip${activeBrand === brand.name ? ' is-active' : ''}" data-brand-filter="${escapeHtml(brand.name)}" aria-pressed="${activeBrand === brand.name ? 'true' : 'false'}">${escapeHtml(brand.name)}</button>`).join('')}</div></section>`).join('')}</div>`;
}

function reconcileCart() {
  const byId = new Map(products.map(product => [product.id, product]));
  const next = cart.map(item => {
    const product = byId.get(item.productId || item.id);
    if (!product) return null;
    let variant = null;
    if (hasVariants(product)) {
      variant = product.variants.find(candidate => candidate.id === item.variantId) || (product.variants.length === 1 && !item.variantId ? product.variants[0] : null);
      if (!variant || variant.price <= 0) return null;
    } else if (product.price <= 0) {
      return null;
    }
    return {...cartItemFromProduct(product, variant), qty: Math.max(1, Number(item.qty) || 1)};
  }).filter(Boolean);
  const changed = JSON.stringify(next) !== JSON.stringify(cart);
  cart = next;
  if (changed) saveCart();
}

function renderProducts() {
  products = aeonStore.products().map(normaliseProduct).filter(product => product.id);
  reconcileCart();
  renderBrandDirectory();
  const visibleProducts = activeBrand ? products.filter(product => product.brand === activeBrand) : products;
  grid.dataset.productCount = String(visibleProducts.length);
  grid.classList.toggle('storefront-admin-grid', isStorefrontAdmin());

  if (!visibleProducts.length) {
    const emptyContent = products.length
      ? `<div class="catalog-empty brand-empty"><span>✦</span><h3>Chưa có sản phẩm của ${escapeHtml(activeBrand)}</h3><p>Hãy chọn thương hiệu khác hoặc xem toàn bộ danh mục.</p><button type="button" class="catalog-admin-add" data-brand-filter="">Xem tất cả sản phẩm</button></div>`
      : `<div class="catalog-empty"><span>✦</span><h3>Danh mục đang được cập nhật</h3><p>Hình ảnh, thông tin sản phẩm và giá bán sẽ được bổ sung ngay khi có công bố chính thức.</p>${isStorefrontAdmin() ? '<button type="button" class="catalog-admin-add" data-storefront-new>+ Tạo sản phẩm đầu tiên</button>' : ''}</div>`;
    grid.innerHTML = emptyContent;
    renderCart();
    return;
  }

  grid.innerHTML = visibleProducts.map(product => {
    const variants = hasVariants(product);
    const canOrder = canOrderProduct(product);
    return `<article class="product" data-product-id="${escapeHtml(product.id)}">
      ${storefrontProductAdminActions(product)}
      <button class="product-media product-view" data-view="${escapeHtml(product.id)}" style="--product-bg:${safeColor(product.bg)}" aria-label="Xem chi tiết ${escapeHtml(product.name)}">
        ${product.label ? `<span class="tag">${escapeHtml(product.label)}</span>` : ''}
        ${productImageMarkup(product, 'product-official-image', 'product-image-placeholder', 'Hình ảnh<br>đang cập nhật')}
      </button>
      <div class="product-info">
        ${product.brand ? `<span class="product-brand">${escapeHtml(product.brand)}</span>` : ''}
        <h3>${escapeHtml(product.name)}</h3>
        <div class="product-bottom">
          <span class="price${canOrder ? '' : ' is-contact'}">${priceLabel(product)}</span>
          ${variants ? `<button class="product-choose" data-view="${escapeHtml(product.id)}" aria-label="Chọn phân loại cho ${escapeHtml(product.name)}">Chọn loại</button>` : canOrder ? `<button class="product-add" data-add="${escapeHtml(product.id)}" aria-label="Thêm ${escapeHtml(product.name)} vào giỏ hàng" title="Thêm vào giỏ hàng"><svg class="product-cart-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.5L20 8H7.1"></path><circle cx="10" cy="20" r="1"></circle><circle cx="17" cy="20" r="1"></circle></svg><span class="sr-only">Thêm vào giỏ hàng</span></button>` : '<a class="product-contact" href="tel:0327747337">Liên hệ</a>'}
        </div>
        <button class="view-link" data-view="${escapeHtml(product.id)}">Xem chi tiết <span>→</span></button>
      </div>
    </article>`;
  }).join('');
  attachImageFallbacks(grid);
  renderCart();
}

function saveCart() {
  localStorage.setItem('aeon-mooncake-cart', JSON.stringify(cart));
}

function totals() {
  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.qty * item.price, 0);
  const promo = promotionFor(subtotal);
  const discount = Math.round(subtotal * promo.rate);
  return {count, subtotal, promo, discount, total: subtotal - discount};
}

function cartThumbMarkup(item, className = 'cart-thumb') {
  const style = `style="--swatch:${safeColor(item.bg)}"`;
  return `<div class="${className}" ${style}>${item.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy">` : '✦'}</div>`;
}

function renderCheckoutSummary(summary) {
  const checkoutSummary = $('#checkoutSummary');
  if (!cart.length) {
    checkoutSummary.innerHTML = '<div class="checkout-summary-head"><h3>Đơn hàng của bạn</h3><button type="button" data-checkout-cart>Mở giỏ hàng</button></div><p class="checkout-summary-empty">Bạn chưa chọn sản phẩm. Mở giỏ hàng để bắt đầu.</p>';
    return;
  }

  checkoutSummary.innerHTML = `<div class="checkout-summary-head"><h3>Đơn hàng của bạn (${summary.count})</h3><button type="button" data-checkout-cart>Chỉnh sửa giỏ</button></div>
    ${cart.map(item => `<div class="checkout-summary-item">${cartThumbMarkup(item, 'checkout-summary-thumb')}<div><b>${escapeHtml(item.name)}</b><span>${item.variantName ? `${escapeHtml(item.variantName)} · ` : ''}${item.qty} × ${fmt(item.price)}</span></div><strong>${fmt(item.qty * item.price)}</strong></div>`).join('')}
    <div class="checkout-summary-total"><div><span>Tạm tính</span><b>${fmt(summary.subtotal)}</b></div>${summary.discount ? `<div><span>${escapeHtml(summary.promo.label)}</span><b>−${fmt(summary.discount)}</b></div>` : ''}<div><span>Tổng đơn hàng</span><b>${fmt(summary.total)}</b></div></div>`;
}

function renderCart() {
  const summary = totals();
  $('#cartCount').textContent = summary.count;
  $('#mobileCartCount').textContent = summary.count;
  $('#cartTotal').textContent = fmt(summary.total);
  $('#cartPromotion').innerHTML = summary.promo.rate ? `<b>${escapeHtml(summary.promo.label)}: −${fmt(summary.discount)}</b><span>Tạm tính ${fmt(summary.subtotal)}</span>` : `<span>${escapeHtml(summary.promo.label)}</span>`;
  $('#mobileCart i').textContent = summary.count ? `${fmt(summary.total)} →` : 'Xem giỏ →';

  cartItems.innerHTML = cart.length ? cart.map(item => `<div class="cart-item">${cartThumbMarkup(item)}<div><h3>${escapeHtml(item.name)}</h3>${item.variantName ? `<p class="cart-variant">${escapeHtml(item.variantName)}</p>` : ''}<p>${fmt(item.price)}</p><div class="quantity"><button data-change="${escapeHtml(item.cartKey)}" data-amount="-1" aria-label="Giảm số lượng ${escapeHtml(cartLabel(item))}">−</button><b>${item.qty}</b><button data-change="${escapeHtml(item.cartKey)}" data-amount="1" aria-label="Tăng số lượng ${escapeHtml(cartLabel(item))}">+</button></div><span class="cart-line-total">${fmt(item.qty * item.price)}</span></div><button class="remove" data-remove="${escapeHtml(item.cartKey)}">Xóa</button></div>`).join('') : '<p class="empty-cart">Giỏ hàng của bạn đang trống.<br>Hãy chọn một hộp bánh thật ưng ý.</p>';
  renderCheckoutSummary(summary);
  saveCart();
}

function add(id, quantity = 1, variantId = '') {
  const product = products.find(item => item.id === id);
  if (!product) {
    toast('Giá bán đang cập nhật. Vui lòng liên hệ hotline để được tư vấn.');
    return;
  }
  const variant = hasVariants(product) ? product.variants.find(item => item.id === variantId) : null;
  if (hasVariants(product) && !variant) {
    openProductDetail(id);
    return;
  }
  const cartItem = cartItemFromProduct(product, variant);
  if (cartItem.price <= 0) {
    toast('Giá bán đang cập nhật. Vui lòng liên hệ hotline để được tư vấn.');
    return;
  }
  const existing = cart.find(item => item.cartKey === cartItem.cartKey);
  if (existing) existing.qty += quantity;
  else cart.push({...cartItem, qty: quantity});
  renderCart();
  const name = cartLabel(cartItem);
  toast(quantity > 1 ? `Đã thêm ${quantity} hộp ${name} vào giỏ hàng` : `Đã thêm ${name} vào giỏ hàng`);
}

function closeProductDetail() {
  const modal = $('#productDetail');
  if (!modal?.classList.contains('show')) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  lastFocusedElement?.focus?.();
}

function updateDetailVariantSelection(product, variantId) {
  const modal = $('#productDetail');
  const variant = product.variants.find(item => item.id === variantId);
  if (!modal || !variant) return;
  modal.dataset.variantId = variant.id;
  modal.querySelectorAll('[data-detail-variant]').forEach(button => {
    const selected = button.dataset.detailVariant === variant.id;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('#detailPrice').textContent = variant.price > 0 ? fmt(variant.price) : 'Liên hệ';
  const sku = $('#detailSku');
  if (sku) {
    const text = variant.sku ? `Mã sản phẩm: ${variant.sku}` : (product.sku ? `Mã sản phẩm: ${product.sku}` : '');
    sku.textContent = text;
    sku.hidden = !text;
  }
  const status = $('#detailVariantStatus');
  if (status) status.textContent = `Đã chọn: ${variant.name}`;
  const addButton = $('#detailAdd');
  if (addButton) {
    addButton.disabled = variant.price <= 0;
    addButton.innerHTML = variant.price > 0 ? 'Thêm vào giỏ <span>→</span>' : 'Giá đang cập nhật';
  }
}

function openProductDetail(id) {
  const product = products.find(item => item.id === id);
  if (!product) return;
  lastFocusedElement = document.activeElement;
  let modal = $('#productDetail');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'productDetail';
    modal.className = 'product-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = '<div class="product-modal-card" role="dialog" aria-modal="true" aria-label="Chi tiết sản phẩm"><button class="modal-close" aria-label="Đóng">×</button><div id="productDetailBody"></div></div>';
    document.body.append(modal);
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('.modal-close')) closeProductDetail();
    });
  }

  const variants = hasVariants(product);
  const canOrder = canOrderProduct(product);
  const detailText = product.details || product.description || 'Thông tin chi tiết đang được cập nhật.';
  const detailHtml = AEONRichText.render(detailText);
  $('#productDetailBody').innerHTML = `<div class="detail-art" style="--product-bg:${safeColor(product.bg)}">${productImageMarkup(product, 'detail-official-image', 'detail-image-placeholder', 'Hình ảnh chính thức<br>đang cập nhật')}</div>
    <div class="detail-copy">${product.brand ? `<p class="detail-brand">${escapeHtml(product.brand)}</p>` : ''}${product.label ? `<p class="eyebrow">${escapeHtml(product.label)}</p>` : ''}<h2>${escapeHtml(product.name)}</h2><p class="detail-price" id="detailPrice">${priceLabel(product)}</p>${variants ? `<section class="detail-variant-picker" aria-labelledby="detailVariantLabel"><div class="detail-variant-head"><span id="detailVariantLabel">Chọn phân loại</span><b id="detailVariantStatus">Vui lòng chọn một loại</b></div><div class="detail-variant-options" role="group" aria-label="Phân loại sản phẩm">${product.variants.map(variant => `<button type="button" data-detail-variant="${escapeHtml(variant.id)}" aria-pressed="false"><span>${escapeHtml(variant.name)}</span><strong>${variant.price > 0 ? fmt(variant.price) : 'Liên hệ'}</strong></button>`).join('')}</div></section>` : ''}<p class="detail-meta" id="detailSku"${product.sku ? '' : ' hidden'}>${product.sku ? `Mã sản phẩm: ${escapeHtml(product.sku)}` : ''}</p><p class="detail-description">${escapeHtml(detailText)}</p><dl><div><dt>Quy cách</dt><dd>${escapeHtml(product.weight || 'Thông tin đang cập nhật')}</dd></div><div><dt>Thành phần nổi bật</dt><dd>${escapeHtml(product.ingredients || 'Thông tin đang cập nhật')}</dd></div></dl><div class="detail-actions">${variants ? `<button class="button primary" data-detail-add="${escapeHtml(product.id)}" id="detailAdd" disabled>Chọn phân loại</button><button class="quantity-button" data-detail-qty="-1" aria-label="Giảm số lượng">−</button><b id="detailQty">1</b><button class="quantity-button" data-detail-qty="1" aria-label="Tăng số lượng">+</button>` : canOrder ? `<button class="button primary" data-detail-add="${escapeHtml(product.id)}" id="detailAdd">Thêm vào giỏ <span>→</span></button><button class="quantity-button" data-detail-qty="-1" aria-label="Giảm số lượng">−</button><b id="detailQty">1</b><button class="quantity-button" data-detail-qty="1" aria-label="Tăng số lượng">+</button>` : '<a class="button primary" href="tel:0327747337">Liên hệ tư vấn <span>→</span></a>'}</div></div>`;
  const detailDescription = $('#productDetailBody').querySelector('.detail-description');
  detailDescription.outerHTML = '<div class="detail-description richtext-output">' + detailHtml + '</div>';
  modal.dataset.id = id;
  modal.dataset.qty = '1';
  modal.dataset.variantId = '';
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  attachImageFallbacks($('#productDetailBody'));
  modal.querySelector('.modal-close').focus();
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}

function toggleCart(force) {
  const drawer = $('#cartDrawer');
  const overlay = $('#overlay');
  const open = force ?? !drawer.classList.contains('open');
  drawer.classList.toggle('open', open);
  overlay.classList.toggle('show', open);
  drawer.setAttribute('aria-hidden', String(!open));
  if (open) $('#closeCart').focus();
}

document.addEventListener('click', event => {
  const brandFilter = event.target.closest('[data-brand-filter]');
  if (brandFilter) {
    activeBrand = normaliseAeonBrand(brandFilter.dataset.brandFilter);
    renderProducts();
    return;
  }

  const adminNew = event.target.closest('[data-storefront-new]');
  if (adminNew) {
    openStorefrontProductEditor();
    return;
  }

  const adminEdit = event.target.closest('[data-storefront-edit]');
  if (adminEdit) {
    openStorefrontProductEditor(adminEdit.dataset.storefrontEdit);
    return;
  }

  const adminDelete = event.target.closest('[data-storefront-delete]');
  if (adminDelete) {
    deleteStorefrontProduct(adminDelete.dataset.storefrontDelete);
    return;
  }

  if (event.target.closest('[data-storefront-logout]')) {
    aeonStore.setAdminSession(false);
    renderStorefrontAdminTools();
    renderProducts();
    toast('Đã tắt chế độ quản trị.');
    return;
  }

  const view = event.target.closest('[data-view]');
  if (view) {
    openProductDetail(view.dataset.view);
    return;
  }

  const detailQty = event.target.closest('[data-detail-qty]');
  if (detailQty) {
    const modal = $('#productDetail');
    modal.dataset.qty = String(Math.max(1, Number(modal.dataset.qty) + Number(detailQty.dataset.detailQty)));
    $('#detailQty').textContent = modal.dataset.qty;
    return;
  }

  const detailVariant = event.target.closest('[data-detail-variant]');
  if (detailVariant) {
    const modal = $('#productDetail');
    const product = products.find(item => item.id === modal?.dataset.id);
    if (product) updateDetailVariantSelection(product, detailVariant.dataset.detailVariant);
    return;
  }

  const detailAdd = event.target.closest('[data-detail-add]');
  if (detailAdd) {
    const modal = $('#productDetail');
    add(detailAdd.dataset.detailAdd, Number(modal.dataset.qty), modal.dataset.variantId);
    closeProductDetail();
    return;
  }

  const addButton = event.target.closest('[data-add]');
  if (addButton) {
    add(addButton.dataset.add);
    return;
  }

  const change = event.target.closest('[data-change]');
  if (change) {
    const item = cart.find(cartItem => cartItem.cartKey === change.dataset.change);
    if (item) {
      item.qty += Number(change.dataset.amount);
      if (item.qty < 1) cart = cart.filter(cartItem => cartItem.cartKey !== item.cartKey);
      renderCart();
    }
    return;
  }

  const remove = event.target.closest('[data-remove]');
  if (remove) {
    cart = cart.filter(item => item.cartKey !== remove.dataset.remove);
    renderCart();
    return;
  }

  if (event.target.closest('[data-checkout-cart]')) toggleCart(true);
});

$('#openCart').onclick = () => toggleCart(true);
$('#closeCart').onclick = () => toggleCart(false);
$('#overlay').onclick = () => toggleCart(false);
$('#goCheckout').onclick = () => {
  toggleCart(false);
  $('#checkout').scrollIntoView({behavior: 'smooth'});
};
$('#mobileCart').onclick = () => toggleCart(true);
$('.menu-toggle').onclick = event => {
  const nav = $('nav');
  nav.classList.toggle('show');
  event.currentTarget.setAttribute('aria-expanded', String(nav.classList.contains('show')));
};

$('#orderForm').addEventListener('submit', event => {
  event.preventDefault();
  const error = $('#formError');
  if (!cart.length) {
    error.textContent = 'Vui lòng thêm ít nhất một sản phẩm vào giỏ trước khi đặt hàng.';
    return;
  }
  if (!event.currentTarget.checkValidity()) {
    error.textContent = 'Vui lòng hoàn thiện các thông tin bắt buộc.';
    event.currentTarget.reportValidity();
    return;
  }

  error.textContent = '';
  const summary = totals();
  const form = new FormData(event.currentTarget);
  const name = String(form.get('name') || 'Quý khách');
  const code = `AM${String(Date.now()).slice(-6)}`;
  const customer = {
    id: Date.now(),
    name,
    phone: form.get('phone'),
    email: form.get('email'),
    address: form.get('address'),
    message: form.get('message'),
    createdAt: new Date().toLocaleString('vi-VN')
  };
  const order = {
    code,
    customerId: customer.id,
    items: cart,
    subtotal: summary.subtotal,
    discount: summary.discount,
    promotion: summary.promo.label,
    total: summary.total,
    createdAt: customer.createdAt
  };
  aeonStore.set('aeon-customers', [customer, ...aeonStore.customers()]);
  aeonStore.set('aeon-orders', [order, ...aeonStore.orders()]);
  $('#successText').innerHTML = `Cảm ơn <b>${escapeHtml(name)}</b>. Đơn hàng <b>${code}</b> đã được ghi nhận${summary.discount ? ` với ưu đãi <b>${escapeHtml(summary.promo.label)}</b> (−${fmt(summary.discount)})` : ''}. Chúng tôi sẽ sớm liên hệ để xác nhận.`;
  $('#successModal').classList.add('show');
  cart = [];
  renderCart();
  event.currentTarget.reset();
});

['#closeSuccess', '#doneOrder'].forEach(selector => {
  $(selector).onclick = () => $('#successModal').classList.remove('show');
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (closeStorefrontProductEditor()) return;
  toggleCart(false);
  $('#successModal').classList.remove('show');
  closeProductDetail();
});

const refreshStorefront = () => {
  renderStorefrontAdminTools();
  applyUi();
  renderProducts();
  applyLayout();
};

window.addEventListener('storage', event => {
  if (['aeon-layout', 'aeon-products', 'aeon-ui', 'aeon-admin'].includes(event.key)) refreshStorefront();
});
window.addEventListener('aeon-store-sync', refreshStorefront);

refreshStorefront();
setInterval(() => aeonStore.pull(), 5000);

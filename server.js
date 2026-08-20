const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {analyseProductFile, kindFromFile} = require('./product-import');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8080);
const root = path.resolve(process.cwd());
const uploadDir = path.join(root, 'assets', 'uploads');
const quoteUploadDir = path.join(uploadDir, 'quotes');
const statePath = path.join(root, '.aeon-store.json');
const seedStatePath = path.join(root, '.aeon-store.seed.json');
const maxUploadBytes = 10 * 1024 * 1024;
const maxImportBytes = 15 * 1024 * 1024;
const maxQuoteUploadBytes = 20 * 1024 * 1024;
const adminUsername = String(process.env.ADMIN_USERNAME || '').trim();
const adminPassword = String(process.env.ADMIN_PASSWORD || '');
const googleSheetWebAppUrl = String(process.env.GOOGLE_SHEET_WEB_APP_URL || '').trim();
const adminSessionCookie = 'aeon_admin_session';
const adminSessionTtlSeconds = 12 * 60 * 60;
const adminSessions = new Map();
const adminAccountsStateKey = 'aeon-admin-users';
const adminPermissionDefinitions = [
  {id:'products', label:'Sản phẩm & giá'},
  {id:'interface', label:'Nội dung, giao diện & banner'},
  {id:'quotes', label:'File báo giá'},
  {id:'brands', label:'Thương hiệu'},
  {id:'customers', label:'Khách hàng & đơn hàng'}
];
const adminPermissionIds = new Set(adminPermissionDefinitions.map(item => item.id));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.pdf':'application/pdf','.csv':'text/csv; charset=utf-8','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.xls':'application/vnd.ms-excel'};
const imageExtensions = {'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/svg+xml':'.svg'};
const uploadImageTypes = new Set(Object.keys(imageExtensions));
fs.mkdirSync(uploadDir, {recursive:true});
fs.mkdirSync(quoteUploadDir, {recursive:true});

function json(response, status, body) { response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); response.end(JSON.stringify(body)); }
function readBody(request, maxBytes = maxUploadBytes) { return new Promise((resolve, reject) => { let size = 0; const chunks = []; const maxRequestBytes = Math.ceil(maxBytes * 1.38) + 65536; request.on('data', chunk => { size += chunk.length; if (size > maxRequestBytes) { reject(new Error(`Tệp vượt quá dung lượng cho phép (${Math.round(maxBytes / 1024 / 1024)} MB).`)); request.destroy(); return; } chunks.push(chunk); }); request.on('end', () => resolve(Buffer.concat(chunks))); request.on('error', reject); }); }

function configuredAdmin() {
  return Boolean(adminUsername && adminPassword);
}

function secureTextEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''), 'utf8');
  const rightBuffer = Buffer.from(String(right ?? ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function adminUsernameMatches(value) {
  return secureTextEqual(
    String(value ?? '').trim().toLocaleLowerCase('vi-VN'),
    adminUsername.toLocaleLowerCase('vi-VN')
  );
}

function normaliseSubAdminUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

function cleanSubAdminDisplayName(value, fallback = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback;
}

function cleanSubAdminPermissions(value) {
  const input = Array.isArray(value) ? value : [];
  return [...new Set(input.map(item => String(item ?? '').trim()).filter(item => adminPermissionIds.has(item)))];
}

function ownerPrincipal() {
  return {
    accountId: 'owner',
    username: adminUsername,
    displayName: 'Quản trị chính',
    isOwner: true,
    permissions: [...adminPermissionIds]
  };
}

function publicAdminPrincipal(principal) {
  if (!principal) return null;
  return {
    username: principal.username,
    displayName: principal.displayName,
    isOwner: Boolean(principal.isOwner),
    permissions: [...new Set(principal.permissions || [])]
  };
}

function hashSubAdminPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifySubAdminPassword(password, encoded) {
  const [algorithm, saltText, hashText] = String(encoded || '').split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, 'base64url');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltText, 'base64url'), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function subAdminAccounts(state) {
  return Array.isArray(state?.[adminAccountsStateKey]) ? state[adminAccountsStateKey] : [];
}

function publicSubAdminAccount(account) {
  return {
    id: String(account?.id || ''),
    username: String(account?.username || ''),
    displayName: cleanSubAdminDisplayName(account?.displayName, String(account?.username || '')),
    permissions: cleanSubAdminPermissions(account?.permissions),
    active: account?.active !== false,
    createdAt: String(account?.createdAt || ''),
    updatedAt: String(account?.updatedAt || ''),
    isOwner: false
  };
}

function accountDirectory(state) {
  return [
    {...ownerPrincipal(), id:'owner', active:true, createdAt:'', updatedAt:''},
    ...subAdminAccounts(state).map(publicSubAdminAccount)
  ];
}

function requestCookies(request) {
  return String(request.headers.cookie || '').split(';').reduce((cookies, pair) => {
    const separator = pair.indexOf('=');
    if (separator < 0) return cookies;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function adminSession(request) {
  const token = requestCookies(request)[adminSessionCookie] || '';
  const session = adminSessions.get(token);
  if (!token || !session) return null;
  if (session.expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + adminSessionTtlSeconds * 1000;
  adminSessions.set(token, session);
  return {token, principal: publicAdminPrincipal(session)};
}

function adminSessionToken(request) {
  return adminSession(request)?.token || '';
}

function adminPrincipal(request) {
  return adminSession(request)?.principal || null;
}

function isAdminRequest(request) {
  return Boolean(adminPrincipal(request));
}

function principalHasPermission(principal, permission) {
  return Boolean(principal && (principal.isOwner || principal.permissions.includes(permission)));
}

function adminCookie(request, token, maxAge = adminSessionTtlSeconds) {
  const forwardedProtocol = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const secure = forwardedProtocol === 'https' ? '; Secure' : '';
  return `${adminSessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function requireAdmin(request, response) {
  if (isAdminRequest(request)) return true;
  json(response, 401, {error:'Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.'});
  return false;
}

function requirePermission(request, response, permission) {
  const principal = adminPrincipal(request);
  if (!principal) {
    json(response, 401, {error:'Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.'});
    return null;
  }
  if (!principalHasPermission(principal, permission)) {
    json(response, 403, {error:`Tài khoản chưa được cấp quyền “${adminPermissionDefinitions.find(item => item.id === permission)?.label || permission}”.`});
    return null;
  }
  return principal;
}

function requireOwner(request, response) {
  const principal = adminPrincipal(request);
  if (!principal) {
    json(response, 401, {error:'Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.'});
    return null;
  }
  if (!principal.isOwner) {
    json(response, 403, {error:'Chỉ tài khoản quản trị chính mới được quản lý tài khoản và phân quyền.'});
    return null;
  }
  return principal;
}
function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    try {
      return JSON.parse(fs.readFileSync(seedStatePath, 'utf8'));
    } catch {
      return {};
    }
  }
}
function writeState(state) { const temporary = `${statePath}.tmp`; fs.writeFileSync(temporary, JSON.stringify(state, null, 2)); fs.renameSync(temporary, statePath); }

function publicStorefrontState(state) {
  const visible = {};
  ['aeon-products', 'aeon-ui', 'aeon-layout', 'aeon-brands'].forEach(key => {
    if (Object.hasOwn(state || {}, key)) visible[key] = state[key];
  });
  return visible;
}

function stateForRequest(request) {
  const state = readState();
  const visible = publicStorefrontState(state);
  const principal = adminPrincipal(request);
  if (principalHasPermission(principal, 'customers')) {
    ['aeon-customers', 'aeon-orders'].forEach(key => {
      if (Object.hasOwn(state, key)) visible[key] = state[key];
    });
  }
  return visible;
}

function valuesMatch(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.hasOwn(right, key) && valuesMatch(left[key], right[key]));
}

function quoteFileOnlyUiChange(previous, next) {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return false;
  const allowedKeys = new Set(['quoteExcelUrl', 'quotePdfUrl']);
  const previousUi = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
  const keys = new Set([...Object.keys(previousUi), ...Object.keys(next)]);
  return [...keys].every(key => allowedKeys.has(key) || valuesMatch(previousUi[key], next[key]));
}

function revokeSubAdminSessions(accountId) {
  for (const [token, session] of adminSessions.entries()) {
    if (session.accountId === accountId) adminSessions.delete(token);
  }
}

function escapeHtmlAttribute(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
}

function requestOrigin(request) {
  const forwardedProtocol = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const protocol = forwardedProtocol === 'https' ? 'https' : 'http';
  const hostHeader = String(request.headers['x-forwarded-host'] || request.headers.host || `127.0.0.1:${port}`).split(',')[0].trim();
  try {
    return new URL(`${protocol}://${hostHeader}`).origin;
  } catch {
    return `http://127.0.0.1:${port}`;
  }
}

function socialPreviewVersion(imagePath) {
  if (imagePath.startsWith('/')) {
    const localPath = path.resolve(root, `.${imagePath}`);
    if (localPath.startsWith(`${root}${path.sep}`)) {
      try { return Math.round(fs.statSync(localPath).mtimeMs).toString(36); }
      catch { /* Use the image path below when the local file has not been created yet. */ }
    }
  }
  return crypto.createHash('sha1').update(imagePath).digest('hex').slice(0, 12);
}

function currentHeroImage(state) {
  const configuredImage = String(state?.['aeon-ui']?.heroImage || '').trim();
  return /^(?:https?:\/\/|\/)/i.test(configuredImage) ? configuredImage : '/assets/mooncake-hero.png';
}

function versionedHeroImage(imagePath) {
  try {
    const imageUrl = new URL(imagePath, 'http://aeon.local');
    imageUrl.searchParams.set('v', socialPreviewVersion(imagePath));
    return /^https?:\/\//i.test(imagePath) ? imageUrl.href : `${imageUrl.pathname}${imageUrl.search}`;
  } catch {
    return imagePath;
  }
}

function socialPreviewMeta(request, state) {
  const ui = state?.['aeon-ui'] || {};
  const heroImage = versionedHeroImage(currentHeroImage(state));
  let imageUrl;
  try {
    imageUrl = new URL(heroImage, requestOrigin(request));
  } catch {
    return '';
  }
  const titleText = String(ui.title || 'Trọn vị đoàn viên').replace(/\s+/g, ' ').trim();
  const title = `AEON Mooncake 2026 | ${titleText}`;
  const description = String(ui.intro || 'Bộ sưu tập bánh Trung Thu AEON 2026 — món quà trọn vẹn cho mùa đoàn viên.').replace(/\s+/g, ' ').trim();
  const pageUrl = `${requestOrigin(request)}/`;
  return `<meta property="og:type" content="website" />\n  <meta property="og:locale" content="vi_VN" />\n  <meta property="og:title" content="${escapeHtmlAttribute(title)}" />\n  <meta property="og:description" content="${escapeHtmlAttribute(description)}" />\n  <meta property="og:url" content="${escapeHtmlAttribute(pageUrl)}" />\n  <meta property="og:image" content="${escapeHtmlAttribute(imageUrl.href)}" />\n  <meta property="og:image:secure_url" content="${escapeHtmlAttribute(imageUrl.href)}" />\n  <meta property="og:image:alt" content="${escapeHtmlAttribute(title)}" />\n  <meta name="twitter:card" content="summary_large_image" />\n  <meta name="twitter:title" content="${escapeHtmlAttribute(title)}" />\n  <meta name="twitter:description" content="${escapeHtmlAttribute(description)}" />\n  <meta name="twitter:image" content="${escapeHtmlAttribute(imageUrl.href)}" />`;
}

function publicStoreStateMarkup(state) {
  const publicState = {};
  ['aeon-products', 'aeon-ui', 'aeon-layout', 'aeon-brands'].forEach(key => {
    if (Object.hasOwn(state, key)) publicState[key] = state[key];
  });
  const encoded = JSON.stringify(publicState)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<script id="aeon-public-state" type="application/json">${encoded}</script>`;
}

function layoutNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function layoutColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function initialLayoutStyle(state) {
  const layout = state?.['aeon-layout'] || {};
  const headerHeight = layoutNumber(layout.headerHeight, 10, 112, 82);
  const heroHeight = layoutNumber(layout.heroHeight, 0, 700, 0);
  const sectionSpacing = layoutNumber(layout.sectionSpacing, 0, 170, 0);
  const productImageHeight = layoutNumber(layout.productImageHeight, 0, 480, 0);
  const productColumns = layoutNumber(layout.productColumns, 0, 6, 0);
  const productColumnsMobile = layoutNumber(layout.productColumnsMobile, 0, 2, 0);
  const heroTitleSize = layoutNumber(layout.heroTitleSize, 10, 90, 68);
  const heroIntroSize = layoutNumber(layout.heroIntroSize, 12, 22, 15);
  const productTitleSize = layoutNumber(layout.productTitleSize, 12, 24, 15);
  const logoSize = layoutNumber(layout.logoSize, 18, 48, 25);
  const bannerRatio = layoutNumber(layout.bannerAspectRatio, 1.5, 4, 21 / 9);
  const desktopColumns = [1, 2, 3, 4, 5, 6].includes(productColumns)
    ? `.products:not([data-product-count="1"]):not([data-product-count="2"]){grid-template-columns:repeat(${productColumns},minmax(0,1fr))!important}`
    : '';
  const mobileColumns = [1, 2].includes(productColumnsMobile)
    ? `.products:not([data-product-count="1"]){grid-template-columns:${productColumnsMobile === 1 ? 'minmax(0,1fr)' : 'repeat(2,minmax(0,1fr))'}!important}`
    : '';
  const fontFamily = ({
    'be-vietnam-pro': "'Be Vietnam Pro',sans-serif",
    'playfair-display': "'Playfair Display',Georgia,serif",
    arial: 'Arial,Helvetica,sans-serif',
    georgia: "Georgia,'Times New Roman',serif"
  })[String(layout.fontFamily || '')] || '';
  const fontRule = fontFamily ? `body,body button,body input,body textarea,body select,body h1,body h2,body h3,body h4,body h5,body h6{font-family:${fontFamily}!important}` : '';
  const sectionRule = sectionSpacing ? `.collection,.checkout{padding-top:${sectionSpacing}px!important;padding-bottom:${sectionSpacing}px!important}` : '';
  const mediaRule = productImageHeight ? `.product-media{height:${productImageHeight}px!important;aspect-ratio:auto!important}` : '';
  const heroHeightRule = heroHeight ? `.hero{min-height:${heroHeight}px!important}` : '';
  const mobileHeader = Math.min(84, Math.max(10, headerHeight * .75));
  return `<style id="aeon-initial-layout">body.storefront-loading>*{visibility:hidden!important}:root{--red:${layoutColor(layout.accentColor, '#a9163a')};--wine:${layoutColor(layout.accentDarkColor, '#71162b')};--cream:${layoutColor(layout.pageBackgroundColor, '#fbf8f1')};--paper:${layoutColor(layout.sectionBackgroundColor, '#f2ede2')};--ink:${layoutColor(layout.textColor, '#242224')};--admin-header-height:${headerHeight}px;--admin-hero-height:${heroHeight}px;--admin-section-spacing:${sectionSpacing}px;--admin-product-media-height:${productImageHeight}px;--admin-logo-size:${logoSize}px;--admin-hero-title-size:${heroTitleSize}px;--admin-hero-intro-size:${heroIntroSize}px;--admin-product-title-size:${productTitleSize}px;--admin-mobile-hero-title-size:${Math.max(10, heroTitleSize * .8)}px;--admin-mobile-product-title-size:${Math.max(12, productTitleSize * .9)}px;--admin-mobile-single-product-title-size:${Math.max(13, productTitleSize * .94)}px;--admin-mobile-compact-product-title-size:${Math.max(10, productTitleSize * .78)}px;--admin-banner-ratio:${bannerRatio};--admin-banner-width-desktop:${520 * bannerRatio / (21 / 9)}px}${fontRule}${heroHeightRule}${sectionRule}${mediaRule}@media(min-width:761px){.site-header{height:${headerHeight}px!important}.site-header nav{top:${headerHeight}px!important}.brand{font-size:${logoSize}px!important}.hero h1{font-size:${heroTitleSize}px!important}.hero .intro{font-size:${heroIntroSize}px!important}.product-info h3{font-size:${productTitleSize}px!important}${desktopColumns}}@media(max-width:760px){.site-header{height:${mobileHeader}px!important}.site-header nav{top:${mobileHeader}px!important}.brand{font-size:${logoSize * .88}px!important}.hero h1{font-size:${Math.max(10, heroTitleSize * .8)}px!important}.hero .intro{font-size:${heroIntroSize}px!important}.product-info h3{font-size:${Math.max(12, productTitleSize * .9)}px!important}${mobileColumns}}</style>`;
}

function storefrontHtml(request) {
  const state = readState();
  const template = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const heroImage = escapeHtmlAttribute(versionedHeroImage(currentHeroImage(state)));
  return template
    .replace(/<!-- SOCIAL_PREVIEW_START -->[\s\S]*?<!-- SOCIAL_PREVIEW_END -->/, socialPreviewMeta(request, state))
    .replace('<!-- PUBLIC_STORE_STATE -->', publicStoreStateMarkup(state))
    .replace('<!-- INITIAL_LAYOUT -->', initialLayoutStyle(state))
    .replace('src="assets/mooncake-hero.png"', `src="${heroImage}"`);
}

function spreadsheetText(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n');
  return /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
}

function spreadsheetNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function worksheetFromRows(headers, rows, widths) {
  const values = [headers, ...rows.map(row => headers.map(header => row[header] ?? ''))];
  const worksheet = XLSX.utils.aoa_to_sheet(values);
  worksheet['!cols'] = widths.map(width => ({wch: width}));
  worksheet['!autofilter'] = {ref: 'A1:' + XLSX.utils.encode_col(headers.length - 1) + Math.max(values.length, 2)};
  return worksheet;
}

function customerWorkbook(state) {
  const customers = Array.isArray(state['aeon-customers']) ? state['aeon-customers'] : [];
  const orders = Array.isArray(state['aeon-orders']) ? state['aeon-orders'] : [];
  const customerById = new Map(customers.map(customer => [String(customer?.id ?? ''), customer]));
  const customerHeaders = ['STT', 'Mã khách hàng', 'Họ và tên', 'Điện thoại', 'Email', 'Địa chỉ', 'Lời nhắn', 'Số đơn hàng', 'Tổng chi tiêu (VNĐ)', 'Ngày ghi nhận'];
  const customerRows = customers.map((customer, index) => {
    const customerId = String(customer?.id ?? '');
    const relatedOrders = orders.filter(order => String(order?.customerId ?? '') === customerId);
    return {
      'STT': index + 1,
      'Mã khách hàng': spreadsheetText(customerId),
      'Họ và tên': spreadsheetText(customer?.name),
      'Điện thoại': spreadsheetText(customer?.phone),
      'Email': spreadsheetText(customer?.email),
      'Địa chỉ': spreadsheetText(customer?.address),
      'Lời nhắn': spreadsheetText(customer?.message),
      'Số đơn hàng': relatedOrders.length,
      'Tổng chi tiêu (VNĐ)': relatedOrders.reduce((total, order) => total + spreadsheetNumber(order?.total), 0),
      'Ngày ghi nhận': spreadsheetText(customer?.createdAt)
    };
  });

  const orderHeaders = ['Thời gian nhận', 'Mã đơn hàng', 'Mã khách hàng', 'Họ và tên', 'Số điện thoại', 'Email', 'Địa chỉ', 'Lời nhắn', 'Sản phẩm, mã sản phẩm, số lượng', 'Đơn giá (VNĐ)', 'Thành tiền (VNĐ)', 'Tổng thanh toán (VNĐ)', 'Ưu đãi'];
  const orderRows = orders.map(order => {
    const customer = customerById.get(String(order?.customerId ?? '')) || {};
    const items = Array.isArray(order?.items) ? order.items : [];
    const products = items.map(item => {
      const name = spreadsheetText(item?.name || 'Sản phẩm');
      const variant = spreadsheetText(item?.variantName || item?.variantLabel || item?.variant || '');
      const productCode = spreadsheetText(item?.variantSku || item?.sku || item?.id || '');
      const quantity = Math.max(1, spreadsheetNumber(item?.quantity ?? item?.qty ?? 1));
      return name + (variant ? ' – ' + variant : '') + (productCode ? ' | Mã: ' + productCode : '') + ' | SL: ' + quantity;
    }).join('\n');
    const unitPrices = items.map(item => spreadsheetNumber(item?.unitPrice ?? item?.price)).join('\n');
    const lineTotals = items.map(item => {
      const quantity = Math.max(1, spreadsheetNumber(item?.quantity ?? item?.qty ?? 1));
      return quantity * spreadsheetNumber(item?.unitPrice ?? item?.price);
    }).join('\n');
    const promotion = spreadsheetText(order?.promotion);
    const discount = spreadsheetNumber(order?.discount);
    return {
      'Thời gian nhận': spreadsheetText(order?.createdAt),
      'Mã đơn hàng': spreadsheetText(order?.code),
      'Mã khách hàng': spreadsheetText(order?.customerId),
      'Họ và tên': spreadsheetText(customer?.name),
      'Số điện thoại': spreadsheetText(customer?.phone),
      'Email': spreadsheetText(customer?.email),
      'Địa chỉ': spreadsheetText(customer?.address),
      'Lời nhắn': spreadsheetText(customer?.message),
      'Sản phẩm, mã sản phẩm, số lượng': products,
      'Đơn giá (VNĐ)': unitPrices,
      'Thành tiền (VNĐ)': lineTotals,
      'Tổng thanh toán (VNĐ)': spreadsheetNumber(order?.total),
      'Ưu đãi': promotion + (discount ? (promotion ? ' – ' : '') + 'Giảm ' + discount + ' VNĐ' : '')
    };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheetFromRows(customerHeaders, customerRows, [7, 18, 24, 16, 28, 38, 36, 13, 20, 22]), 'Khách hàng');
  XLSX.utils.book_append_sheet(workbook, worksheetFromRows(orderHeaders, orderRows, [22, 18, 18, 24, 16, 28, 38, 36, 58, 22, 22, 22, 30]), 'Đơn hàng');
  return XLSX.write(workbook, {type: 'buffer', bookType: 'xlsx', compression: true});
}

const pdfRegularFont = [
  path.join(root, 'assets', 'fonts', 'NotoSans-Regular.ttf'),
  'C:\\Windows\\Fonts\\arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
].find(fontPath => fs.existsSync(fontPath)) || 'Helvetica';
const pdfBoldFont = [
  path.join(root, 'assets', 'fonts', 'NotoSans-Bold.ttf'),
  'C:\\Windows\\Fonts\\arialbd.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
].find(fontPath => fs.existsSync(fontPath)) || 'Helvetica-Bold';
const pdfMoney = new Intl.NumberFormat('vi-VN');

function cleanPdfText(value, limit = 1000) {
  return String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, limit);
}

function formatPdfMoney(value) {
  return `${pdfMoney.format(Math.max(0, Math.round(Number(value) || 0)))} đ`;
}

function directGoogleDriveImage(value) {
  const url = String(value || '').trim();
  const match = /^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)/i.exec(url);
  return match ? `https://drive.google.com/uc?export=view&id=${encodeURIComponent(match[1])}` : url;
}

async function orderImageBuffer(value) {
  const source = String(value || '').trim();
  if (!source) return null;
  if (source.startsWith('/')) {
    const imagePath = path.resolve(root, `.${source}`);
    if (imagePath === root || !imagePath.startsWith(`${root}${path.sep}`)) return null;
    if (!/\.(?:png|jpe?g)$/i.test(imagePath)) return null;
    try {
      const content = await fs.promises.readFile(imagePath);
      return content.length <= 5 * 1024 * 1024 ? content : null;
    } catch {
      return null;
    }
  }
  if (!/^https?:\/\//i.test(source)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const remote = await fetch(directGoogleDriveImage(source), {signal:controller.signal, redirect:'follow'});
    clearTimeout(timer);
    if (!remote.ok) return null;
    const contentType = String(remote.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('image/png') && !contentType.includes('image/jpeg')) return null;
    const content = Buffer.from(await remote.arrayBuffer());
    return content.length <= 5 * 1024 * 1024 ? content : null;
  } catch {
    return null;
  }
}

async function orderPdfBuffer(state, requestedCode) {
  const orders = Array.isArray(state['aeon-orders']) ? state['aeon-orders'] : [];
  const customers = Array.isArray(state['aeon-customers']) ? state['aeon-customers'] : [];
  const order = orders.find(entry => String(entry?.code || '') === String(requestedCode || ''));
  if (!order) {
    const error = new Error('Không tìm thấy đơn hàng.');
    error.statusCode = 404;
    throw error;
  }
  const customer = customers.find(entry => String(entry?.id ?? '') === String(order?.customerId ?? '')) || {};
  const items = Array.isArray(order.items) ? order.items.slice(0, 60) : [];
  const ui = state['aeon-ui'] && typeof state['aeon-ui'] === 'object' ? state['aeon-ui'] : {};
  const layout = state['aeon-layout'] && typeof state['aeon-layout'] === 'object' ? state['aeon-layout'] : {};
  const accent = /^#[0-9a-f]{6}$/i.test(layout.accentColor || '') ? layout.accentColor : '#d72d58';
  const dark = /^#[0-9a-f]{6}$/i.test(layout.accentDarkColor || '') ? layout.accentDarkColor : '#9f1739';
  const [logoImage, ...itemImages] = await Promise.all([
    orderImageBuffer(ui.logoImage),
    ...items.map(item => orderImageBuffer(item?.image))
  ]);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: {top:0, right:0, bottom:0, left:0},
      bufferPages: true,
      info: {
        Title: `Đơn hàng ${cleanPdfText(order.code, 80)}`,
        Author: 'AEON Mooncake 2026',
        Subject: 'Phiếu xác nhận đơn hàng'
      }
    });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 44;
    const contentWidth = pageWidth - margin * 2;
    const paper = '#fbf8f2';
    const line = '#ddd4c7';
    const ink = '#242224';
    const muted = '#706b68';

    const font = (bold = false, size = 10, color = ink) => {
      doc.font(bold ? pdfBoldFont : pdfRegularFont).fontSize(size).fillColor(color);
      return doc;
    };
    const drawPageHeader = continuation => {
      doc.rect(0, 0, pageWidth, 8).fill(accent);
      if (logoImage) {
        try {
          doc.image(logoImage, margin, 28, {fit:[112, 36], align:'left', valign:'center'});
        } catch {
          font(true, 24, accent).text('AEON', margin, 31);
        }
      } else {
        font(true, 24, accent).text(cleanPdfText(ui.logoText || 'AEON', 30), margin, 31);
      }
      font(false, 7.5, muted).text(cleanPdfText(ui.logoSubtitle || 'MOONCAKE 2026', 70).replace(/\n+/g, ' · '), margin, 71, {width:190});
      font(true, 15, ink).text(continuation ? 'CHI TIẾT ĐƠN HÀNG' : 'PHIẾU XÁC NHẬN ĐƠN HÀNG', 285, 31, {width:266, align:'right'});
      font(false, 8.5, muted).text(`Mã đơn: ${cleanPdfText(order.code, 80)}\nThời gian: ${cleanPdfText(order.createdAt || customer.createdAt || '', 100)}`, 285, 54, {width:266, align:'right', lineGap:3});
      doc.moveTo(margin, 91).lineTo(pageWidth - margin, 91).lineWidth(.7).strokeColor(line).stroke();
      return 112;
    };
    const field = (label, value, x, y, width, options = {}) => {
      font(true, 7.3, dark).text(label.toUpperCase(), x, y, {width, characterSpacing:.5});
      font(false, options.size || 10, ink).text(cleanPdfText(value || '—', options.limit || 500), x, y + 13, {
        width,
        height:options.height || 28,
        ellipsis:true,
        lineGap:2
      });
    };
    const drawItemsHeading = y => {
      doc.roundedRect(margin, y, contentWidth, 30, 5).fill(dark);
      font(true, 8.5, '#ffffff').text('SẢN PHẨM', margin + 14, y + 10, {width:330});
      font(true, 8.5, '#ffffff').text('THÀNH TIỀN', pageWidth - margin - 126, y + 10, {width:112, align:'right'});
      return y + 30;
    };
    const drawPlaceholder = (item, x, y, size) => {
      const color = /^#[0-9a-f]{6}$/i.test(item?.bg || '') ? item.bg : '#efe2d2';
      doc.roundedRect(x, y, size, size, 4).fill(color);
      font(true, 17, dark).text(cleanPdfText(item?.name || 'SP', 1).toUpperCase(), x, y + 17, {width:size, align:'center'});
    };

    let y = drawPageHeader(false);
    const hasMessage = Boolean(cleanPdfText(customer.message, 500));
    const customerHeight = hasMessage ? 174 : 143;
    doc.roundedRect(margin, y, contentWidth, customerHeight, 8).fill(paper).strokeColor(line).lineWidth(.7).stroke();
    font(true, 12.5, ink).text('Thông tin nhận hàng', margin + 17, y + 16);
    field('Họ và tên', customer.name, margin + 17, y + 43, 225);
    field('Số điện thoại', customer.phone, margin + 270, y + 43, 220);
    field('Email', customer.email, margin + 17, y + 81, 225);
    field('Địa chỉ giao hàng', customer.address, margin + 270, y + 81, 220, {height:42});
    if (hasMessage) field('Lời nhắn', customer.message, margin + 17, y + 119, 473, {height:38});
    y += customerHeight + 18;

    font(true, 15, ink).text(`Đơn hàng của bạn (${items.reduce((sum, item) => sum + Math.max(1, Number(item?.quantity ?? item?.qty) || 1), 0)})`, margin, y);
    font(false, 8.5, muted).text('Đơn giá và thành tiền được thể hiện bằng Việt Nam đồng.', margin + 274, y + 5, {width:233, align:'right'});
    y = drawItemsHeading(y + 27);

    items.forEach((item, index) => {
      const rowHeight = 78;
      if (y + rowHeight > pageHeight - 118) {
        doc.addPage();
        y = drawPageHeader(true);
        y = drawItemsHeading(y);
      }
      const imageX = margin + 10;
      const imageY = y + 11;
      const imageSize = 56;
      const image = itemImages[index];
      if (image) {
        doc.roundedRect(imageX, imageY, imageSize, imageSize, 4).fill('#f1e7d8');
        try {
          doc.image(image, imageX, imageY, {fit:[imageSize, imageSize], align:'center', valign:'center'});
        } catch {
          drawPlaceholder(item, imageX, imageY, imageSize);
        }
      } else {
        drawPlaceholder(item, imageX, imageY, imageSize);
      }
      const quantity = Math.max(1, Math.round(Number(item?.quantity ?? item?.qty) || 1));
      const price = Math.max(0, Math.round(Number(item?.unitPrice ?? item?.price) || 0));
      const variant = cleanPdfText(item?.variantName || item?.variantLabel || item?.variant || '', 120);
      const sku = cleanPdfText(item?.variantSku || item?.sku || item?.id || '', 100);
      const textX = margin + 79;
      font(true, 10.5, ink).text(cleanPdfText(item?.name || 'Sản phẩm', 220), textX, y + 12, {width:292, height:28, ellipsis:true});
      font(false, 8.2, muted).text([variant, sku ? `Mã: ${sku}` : ''].filter(Boolean).join(' · ') || 'Sản phẩm AEON Mooncake', textX, y + 40, {width:292, height:15, ellipsis:true});
      font(false, 9, muted).text(`${quantity} × ${formatPdfMoney(price)}`, textX, y + 57, {width:200});
      font(true, 10.5, ink).text(formatPdfMoney(quantity * price), pageWidth - margin - 126, y + 31, {width:112, align:'right'});
      doc.moveTo(margin, y + rowHeight).lineTo(pageWidth - margin, y + rowHeight).lineWidth(.6).strokeColor(line).stroke();
      y += rowHeight;
    });

    if (!items.length) {
      font(false, 10, muted).text('Đơn hàng chưa có sản phẩm.', margin + 14, y + 18);
      y += 55;
    }
    if (y + 137 > pageHeight - 60) {
      doc.addPage();
      y = drawPageHeader(true);
    }
    const summaryHeight = order.discount ? 113 : 91;
    doc.roundedRect(margin, y + 18, contentWidth, summaryHeight, 8).fill(paper).strokeColor(line).lineWidth(.7).stroke();
    const summaryX = pageWidth - margin - 232;
    font(false, 9.5, muted).text('Tạm tính', summaryX, y + 34, {width:105});
    font(true, 10, ink).text(formatPdfMoney(order.subtotal), summaryX + 108, y + 34, {width:110, align:'right'});
    let totalY = y + 58;
    if (order.discount) {
      font(false, 9.5, accent).text(cleanPdfText(order.promotion || 'Ưu đãi', 120), summaryX, y + 58, {width:150, height:18, ellipsis:true});
      font(true, 10, accent).text(`-${formatPdfMoney(order.discount)}`, summaryX + 108, y + 58, {width:110, align:'right'});
      totalY = y + 82;
    }
    doc.moveTo(summaryX, totalY - 8).lineTo(summaryX + 218, totalY - 8).strokeColor(line).stroke();
    font(true, 12.5, ink).text('Tổng thanh toán', summaryX, totalY, {width:120});
    font(true, 13, dark).text(formatPdfMoney(order.total), summaryX + 108, totalY, {width:110, align:'right'});
    font(true, 8, dark).text('XÁC NHẬN ĐƠN HÀNG', margin + 17, y + 36);
    font(false, 8.5, muted).text('Đơn hàng sẽ được nhân viên liên hệ để xác nhận thời gian giao nhận và hình thức thanh toán.', margin + 17, y + 55, {width:230, lineGap:3});
    font(true, 9, dark).text('Hotline: 0327 747 337', margin + 17, y + summaryHeight - 7);

    const pageRange = doc.bufferedPageRange();
    for (let pageIndex = 0; pageIndex < pageRange.count; pageIndex += 1) {
      doc.switchToPage(pageRange.start + pageIndex);
      doc.moveTo(margin, pageHeight - 41).lineTo(pageWidth - margin, pageHeight - 41).lineWidth(.5).strokeColor(line).stroke();
      font(false, 7.5, muted).text('AEON Mooncake 2026 · Trọn vị đoàn viên', margin, pageHeight - 30, {width:300});
      font(false, 7.5, muted).text(`Trang ${pageIndex + 1}/${pageRange.count}`, pageWidth - margin - 100, pageHeight - 30, {width:100, align:'right'});
    }
    doc.end();
  });
}

const productWorkbookHeaders = [
  'ID hệ thống',
  'Tên sản phẩm',
  'Giá bán',
  'Thương hiệu',
  'Mã sản phẩm',
  'Nhãn hiển thị',
  'Quy cách / khối lượng',
  'Thành phần',
  'Mô tả',
  'Chi tiết sản phẩm',
  'Ảnh (URL)',
  'Tên phân loại',
  'Giá trị phân loại',
  'Mã phân loại',
  'Giá phân loại',
  'Ảnh phân loại (URL)'
];

const productWorkbookWidths = [20, 38, 16, 26, 20, 18, 24, 38, 46, 58, 46, 20, 24, 20, 18, 46];

function productWorkbookRow(product, variant = null) {
  return {
    'ID hệ thống': spreadsheetText(product?.id),
    'Tên sản phẩm': spreadsheetText(product?.name),
    'Giá bán': spreadsheetNumber(product?.price),
    'Thương hiệu': spreadsheetText(product?.brand),
    'Mã sản phẩm': spreadsheetText(product?.sku),
    'Nhãn hiển thị': spreadsheetText(product?.label),
    'Quy cách / khối lượng': spreadsheetText(product?.weight),
    'Thành phần': spreadsheetText(product?.ingredients),
    'Mô tả': spreadsheetText(product?.description),
    'Chi tiết sản phẩm': spreadsheetText(product?.details),
    'Ảnh (URL)': spreadsheetText(product?.image),
    'Tên phân loại': spreadsheetText(product?.variantLabel || (variant ? 'Phân loại' : '')),
    'Giá trị phân loại': spreadsheetText(variant?.name),
    'Mã phân loại': spreadsheetText(variant?.sku),
    'Giá phân loại': variant ? spreadsheetNumber(variant.price) : '',
    'Ảnh phân loại (URL)': spreadsheetText(variant?.image)
  };
}

function productWorkbookRows(products) {
  return products.flatMap(product => {
    const variants = Array.isArray(product?.variants)
      ? product.variants.filter(variant => String(variant?.name || '').trim())
      : [];
    return variants.length
      ? variants.map(variant => productWorkbookRow(product, variant))
      : [productWorkbookRow(product)];
  });
}

function productWorkbookGuide() {
  const guideHeaders = ['Cột', 'Yêu cầu', 'Ví dụ'];
  const guideRows = [
    {'Cột': 'ID hệ thống', 'Yêu cầu': 'Giữ nguyên khi cập nhật danh sách đã tải xuống; để trống khi tạo sản phẩm mới', 'Ví dụ': 'sp-2026-01'},
    {'Cột': 'Tên sản phẩm', 'Yêu cầu': 'Bắt buộc; lặp lại trên các dòng phân loại của cùng sản phẩm', 'Ví dụ': 'Hộp quà Trung Thu sắc màu'},
    {'Cột': 'Giá bán', 'Yêu cầu': 'Giá chung khi không có phân loại; nếu có phân loại, hệ thống lấy giá thấp nhất', 'Ví dụ': '350000'},
    {'Cột': 'Thương hiệu', 'Yêu cầu': 'Chọn đúng tên thương hiệu trong hệ thống nếu có', 'Ví dụ': 'Kinh Đô'},
    {'Cột': 'Mã sản phẩm', 'Yêu cầu': 'Nên có và phải giống nhau trên các dòng phân loại của cùng sản phẩm', 'Ví dụ': 'AM-2026-01'},
    {'Cột': 'Nhãn hiển thị', 'Yêu cầu': 'Không bắt buộc', 'Ví dụ': 'Bán chạy'},
    {'Cột': 'Quy cách / khối lượng', 'Yêu cầu': 'Không bắt buộc', 'Ví dụ': '4 bánh · 720g'},
    {'Cột': 'Thành phần', 'Yêu cầu': 'Không bắt buộc', 'Ví dụ': 'Hạt sen · trứng muối'},
    {'Cột': 'Mô tả', 'Yêu cầu': 'Không bắt buộc', 'Ví dụ': 'Hộp quà phù hợp để biếu tặng.'},
    {'Cột': 'Chi tiết sản phẩm', 'Yêu cầu': 'Không bắt buộc; hỗ trợ nội dung nhiều dòng', 'Ví dụ': 'Thông tin chi tiết về sản phẩm'},
    {'Cột': 'Ảnh (URL)', 'Yêu cầu': 'Không bắt buộc; dùng link ảnh hoặc đường dẫn /assets/uploads/...', 'Ví dụ': 'https://example.com/mooncake.jpg'},
    {'Cột': 'Tên phân loại', 'Yêu cầu': 'Tên nhóm lựa chọn; lặp lại trên các dòng của cùng sản phẩm', 'Ví dụ': 'Màu sắc'},
    {'Cột': 'Giá trị phân loại', 'Yêu cầu': 'Mỗi lựa chọn nằm trên một dòng riêng', 'Ví dụ': 'Đỏ'},
    {'Cột': 'Mã phân loại', 'Yêu cầu': 'Không bắt buộc nhưng không được trùng trong cùng sản phẩm', 'Ví dụ': 'AM-2026-01-RED'},
    {'Cột': 'Giá phân loại', 'Yêu cầu': 'Bắt buộc khi có Giá trị phân loại', 'Ví dụ': '350000'},
    {'Cột': 'Ảnh phân loại (URL)', 'Yêu cầu': 'Không bắt buộc; để trống sẽ dùng Ảnh (URL) của sản phẩm', 'Ví dụ': 'https://example.com/mooncake-red.jpg'}
  ];
  return worksheetFromRows(guideHeaders, guideRows, [28, 72, 52]);
}

function productImportTemplateWorkbook() {
  const worksheet = worksheetFromRows(productWorkbookHeaders, [{}], productWorkbookWidths);
  worksheet['!freeze'] = {xSplit: 0, ySplit: 1};

  const exampleProduct = {
    id: '',
    name: 'Hộp quà Trung Thu sắc màu',
    price: 350000,
    brand: 'Kinh Đô',
    sku: 'AM-2026-01',
    label: 'Bán chạy',
    weight: '4 bánh · 720g',
    ingredients: 'Hạt sen · trứng muối',
    description: 'Hộp quà có nhiều màu để khách lựa chọn.',
    details: 'Chọn màu phù hợp trước khi thêm vào giỏ hàng.',
    image: 'https://example.com/mooncake.jpg',
    variantLabel: 'Màu sắc',
    variants: [
      {name:'Đỏ', sku:'AM-2026-01-RED', price:350000},
      {name:'Xanh', sku:'AM-2026-01-BLUE', price:360000},
      {name:'Vàng', sku:'AM-2026-01-YELLOW', price:350000}
    ]
  };
  const example = worksheetFromRows(productWorkbookHeaders, productWorkbookRows([exampleProduct]), productWorkbookWidths);
  example['!freeze'] = {xSplit: 0, ySplit: 1};

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Danh mục');
  XLSX.utils.book_append_sheet(workbook, example, 'Ví dụ');
  XLSX.utils.book_append_sheet(workbook, productWorkbookGuide(), 'Hướng dẫn');
  return XLSX.write(workbook, {type: 'buffer', bookType: 'xlsx', compression: true});
}

function productCatalogWorkbook(state) {
  const products = Array.isArray(state['aeon-products']) ? state['aeon-products'] : [];
  const worksheet = worksheetFromRows(productWorkbookHeaders, productWorkbookRows(products), productWorkbookWidths);
  worksheet['!freeze'] = {xSplit: 0, ySplit: 1};
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Danh mục');
  XLSX.utils.book_append_sheet(workbook, productWorkbookGuide(), 'Hướng dẫn');
  return XLSX.write(workbook, {type: 'buffer', bookType: 'xlsx', compression: true});
}

function isValidUploadedImage(mimeType, buffer) {
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const gif = buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
  const webp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if (mimeType === 'image/png') return png;
  if (mimeType === 'image/jpeg') return jpeg;
  if (mimeType === 'image/gif') return gif;
  if (mimeType === 'image/webp') return webp;
  if (mimeType !== 'image/svg+xml') return false;
  const svg = buffer.toString('utf8');
  return /<svg[\s>]/i.test(svg) && !/<(?:script|foreignObject)\b|\son[a-z]+\s*=|(?:href|xlink:href)\s*=\s*[\"']?\s*(?:javascript:|data:)/i.test(svg);
}

function dataUrlBuffer(dataUrl) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Tệp tải lên không hợp lệ.');
  return {mimeType: match[1].toLowerCase(), buffer: Buffer.from(match[2], 'base64')};
}

function isValidImportFile(kind, filename, buffer) {
  if (!buffer.length) return false;
  if (kind === 'pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (kind === 'image') {
    const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const gif = buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
    const webp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    return png || jpeg || gif || webp;
  }
  if (kind === 'excel') {
    const extension = path.extname(filename).toLowerCase();
    if (extension === '.csv') return !buffer.subarray(0, 512).includes(0);
    const zip = buffer.subarray(0, 2).toString('ascii') === 'PK';
    const ole = buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    return zip || ole;
  }
  return false;
}

function quoteFileKind(filename) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  if (extension === '.pdf') return 'pdf';
  if (extension === '.xlsx' || extension === '.xls') return 'excel';
  return '';
}

function isValidQuoteFile(kind, filename, buffer) {
  if (!buffer.length) return false;
  if (kind === 'pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (kind !== 'excel') return false;

  const extension = path.extname(filename).toLowerCase();
  const zip = buffer.subarray(0, 2).toString('ascii') === 'PK';
  const ole = buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if ((extension === '.xlsx' && !zip) || (extension === '.xls' && !ole)) return false;
  try {
    XLSX.read(buffer, {type:'buffer', dense:true});
    return true;
  } catch {
    return false;
  }
}

function sheetText(value, limit = 500) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, limit);
  return /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
}

function sheetMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function googleSheetOrderPayload(input = {}) {
  const customer = input.customer && typeof input.customer === 'object' ? input.customer : {};
  const order = input.order && typeof input.order === 'object' ? input.order : {};
  const items = Array.isArray(order.items) ? order.items.slice(0, 50).map(item => {
    const quantity = Math.max(1, Math.min(999, Math.round(Number(item?.quantity ?? item?.qty) || 1)));
    const unitPrice = sheetMoney(item?.unitPrice ?? item?.price);
    return {
    name: sheetText(item?.name || 'Sản phẩm', 180),
    variant: sheetText(item?.variantName || item?.variantLabel || item?.variant || '', 120),
    sku: sheetText(item?.variantSku || item?.sku || '', 100),
    code: sheetText(item?.variantSku || item?.sku || item?.id || '', 100),
    quantity,
    price: unitPrice,
    unitPrice,
    lineTotal: quantity * unitPrice
    };
  }) : [];
  const orderCode = sheetText(order.code, 40);
  const customerName = sheetText(customer.name, 160);
  const phone = sheetText(customer.phone, 40);
  if (!orderCode || !customerName || !phone || !items.length) throw new Error('Dữ liệu khách hàng hoặc đơn hàng chưa đầy đủ để gửi Google Sheet.');

  const createdAt = sheetText(order.createdAt || customer.createdAt, 80) || new Date().toISOString();
  const customerId = sheetText(customer.id, 80);
  const safeCustomer = {
    id: customerId,
    name: customerName,
    phone,
    email: sheetText(customer.email, 180),
    address: sheetText(customer.address, 500),
    message: sheetText(customer.message, 500),
    createdAt
  };
  const safeOrder = {
    code: orderCode,
    customerId,
    items,
    subtotal: sheetMoney(order.subtotal),
    discount: sheetMoney(order.discount),
    promotion: sheetText(order.promotion, 180),
    total: sheetMoney(order.total),
    createdAt
  };
  const itemsText = items.map(item => `${item.name}${item.variant ? ` – ${item.variant}` : ''}${item.code ? ` | Mã: ${item.code}` : ''} | SL: ${item.quantity}`).join('\n');
  const unitPricesText = items.map(item => String(item.unitPrice)).join('\n');
  const lineTotalsText = items.map(item => String(item.lineTotal)).join('\n');
  const promotionText = safeOrder.promotion + (safeOrder.discount ? `${safeOrder.promotion ? ' – ' : ''}Giảm ${safeOrder.discount} VNĐ` : '');
  return {
    event: 'new_order',
    source: 'AEON Mooncake 2026',
    submittedAt: new Date().toISOString(),
    orderCode,
    customerId,
    customerName,
    phone,
    email: safeCustomer.email,
    address: safeCustomer.address,
    message: safeCustomer.message,
    itemsText,
    unitPricesText,
    lineTotalsText,
    itemsJson: JSON.stringify(items),
    subtotal: safeOrder.subtotal,
    discount: safeOrder.discount,
    promotion: safeOrder.promotion,
    promotionText,
    total: safeOrder.total,
    createdAt,
    customer: safeCustomer,
    order: safeOrder
  };
}

async function sendOrderToGoogleSheet(payload) {
  if (!googleSheetWebAppUrl) throw new Error('Máy chủ chưa cấu hình GOOGLE_SHEET_WEB_APP_URL.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(googleSheetWebAppUrl, {
      method: 'POST',
      headers: {'Content-Type':'application/json; charset=utf-8'},
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller.signal
    });
    const text = await response.text();
    const finalUrl = String(response.url || '');
    const loginRequired = /accounts\.google\.com|ServiceLogin/i.test(finalUrl + '\n' + text.slice(0, 1000));
    if (loginRequired) throw new Error('Apps Script đang yêu cầu đăng nhập Google. Hãy triển khai Web App với quyền truy cập Anyone.');
    if (!response.ok) throw new Error(`Google Apps Script phản hồi HTTP ${response.status}.`);
    if (/<title>\s*(?:Lỗi|Error)\s*<\/title>|Không tìm thấy hàm tập lệnh|class=["']errorMessage["']/i.test(text)) {
      const plainText = text
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
      throw new Error(plainText.slice(0, 300) || 'Google Apps Script trả về trang lỗi.');
    }

    let result = null;
    try { result = JSON.parse(text); } catch { result = {message:text.slice(0, 300)}; }
    if (result && (result.ok === false || String(result.status || '').toLowerCase() === 'error')) {
      throw new Error(sheetText(result.message || result.error || 'Google Sheet từ chối dữ liệu.', 300));
    }
    return {ok:true, status:response.status, result};
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Google Apps Script phản hồi quá chậm.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

http.createServer(async (request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname); }
  catch { response.writeHead(400); return response.end('Bad request'); }

  if (request.method === 'GET' && pathname === '/api/admin/session') {
    const principal = adminPrincipal(request);
    return json(response, 200, {authenticated:Boolean(principal), configured:configuredAdmin(), user:publicAdminPrincipal(principal)});
  }
  if (request.method === 'POST' && pathname === '/api/admin/login') {
    if (!configuredAdmin()) return json(response, 503, {error:'Máy chủ chưa cấu hình ADMIN_USERNAME và ADMIN_PASSWORD.'});
    try {
      const {username, password} = JSON.parse((await readBody(request, 32 * 1024)).toString('utf8'));
      let principal = null;
      if (adminUsernameMatches(username) && secureTextEqual(password, adminPassword)) {
        principal = ownerPrincipal();
      } else {
        const account = subAdminAccounts(readState()).find(item => (
          item?.active !== false
          && secureTextEqual(normaliseSubAdminUsername(item?.username), normaliseSubAdminUsername(username))
        ));
        if (account && verifySubAdminPassword(password, account.passwordHash)) {
          principal = {
            accountId: String(account.id),
            username: normaliseSubAdminUsername(account.username),
            displayName: cleanSubAdminDisplayName(account.displayName, account.username),
            isOwner: false,
            permissions: cleanSubAdminPermissions(account.permissions)
          };
        }
      }
      if (!principal) {
        return json(response, 401, {error:'Tài khoản hoặc mật khẩu chưa đúng.'});
      }
      const token = crypto.randomBytes(32).toString('base64url');
      adminSessions.set(token, {...principal, expiresAt: Date.now() + adminSessionTtlSeconds * 1000});
      response.writeHead(200, {
        'Content-Type':'application/json; charset=utf-8',
        'Cache-Control':'no-store',
        'Set-Cookie':adminCookie(request, token)
      });
      return response.end(JSON.stringify({ok:true, user:publicAdminPrincipal(principal)}));
    } catch (error) {
      return json(response, 400, {error:error.message || 'Không thể đăng nhập.'});
    }
  }
  if (request.method === 'POST' && pathname === '/api/admin/logout') {
    const token = adminSessionToken(request);
    if (token) adminSessions.delete(token);
    response.writeHead(200, {
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store',
      'Set-Cookie':adminCookie(request, '', 0)
    });
    return response.end(JSON.stringify({ok:true}));
  }

  if (request.method === 'GET' && pathname === '/api/admin/accounts') {
    if (!requireOwner(request, response)) return;
    return json(response, 200, {permissions:adminPermissionDefinitions, accounts:accountDirectory(readState())});
  }
  if (request.method === 'POST' && pathname === '/api/admin/accounts') {
    if (!requireOwner(request, response)) return;
    try {
      const payload = JSON.parse((await readBody(request, 32 * 1024)).toString('utf8'));
      const action = String(payload?.action || '').trim();
      const state = readState();
      const accounts = subAdminAccounts(state).map(account => ({...account}));
      const now = new Date().toISOString();

      if (action === 'create') {
        const username = normaliseSubAdminUsername(payload.username);
        const displayName = cleanSubAdminDisplayName(payload.displayName, username);
        const password = String(payload.password || '');
        const permissions = cleanSubAdminPermissions(payload.permissions);
        if (!/^[a-z0-9._-]{3,40}$/.test(username)) return json(response, 400, {error:'Tài khoản chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang (3–40 ký tự).'});
        if (adminUsernameMatches(username) || accounts.some(account => normaliseSubAdminUsername(account.username) === username)) return json(response, 409, {error:'Tên tài khoản này đã tồn tại.'});
        if (password.length < 8 || password.length > 128) return json(response, 400, {error:'Mật khẩu tài khoản con cần từ 8 đến 128 ký tự.'});
        if (!permissions.length) return json(response, 400, {error:'Hãy cấp ít nhất một quyền sử dụng cho tài khoản con.'});
        const account = {
          id: `sub-${crypto.randomBytes(12).toString('hex')}`,
          username,
          displayName,
          passwordHash: hashSubAdminPassword(password),
          permissions,
          active: true,
          createdAt: now,
          updatedAt: now
        };
        accounts.push(account);
        state[adminAccountsStateKey] = accounts;
        writeState(state);
        return json(response, 201, {ok:true, account:publicSubAdminAccount(account)});
      }

      if (action === 'update') {
        const accountId = String(payload.id || '');
        const index = accounts.findIndex(account => String(account.id) === accountId);
        if (index < 0) return json(response, 404, {error:'Không tìm thấy tài khoản con.'});
        const account = accounts[index];
        const displayName = cleanSubAdminDisplayName(payload.displayName, account.displayName || account.username);
        const permissions = cleanSubAdminPermissions(payload.permissions);
        const password = String(payload.password || '');
        if (!permissions.length) return json(response, 400, {error:'Hãy cấp ít nhất một quyền sử dụng cho tài khoản con.'});
        if (password && (password.length < 8 || password.length > 128)) return json(response, 400, {error:'Mật khẩu mới cần từ 8 đến 128 ký tự.'});
        const updated = {
          ...account,
          displayName,
          permissions,
          active: payload.active !== false,
          updatedAt: now
        };
        if (password) updated.passwordHash = hashSubAdminPassword(password);
        accounts[index] = updated;
        state[adminAccountsStateKey] = accounts;
        writeState(state);
        revokeSubAdminSessions(accountId);
        return json(response, 200, {ok:true, account:publicSubAdminAccount(updated)});
      }

      return json(response, 400, {error:'Thao tác tài khoản không hợp lệ.'});
    } catch (error) {
      return json(response, 400, {error:error.message || 'Không thể lưu tài khoản.'});
    }
  }

  if (request.method === 'GET' && pathname === '/api/state') return json(response, 200, stateForRequest(request));
  if (request.method === 'GET' && pathname === '/api/export/customers.xlsx') {
    if (!requirePermission(request, response, 'customers')) return;
    try {
      const workbook = customerWorkbook(readState());
      response.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="danh-sach-khach-hang.xlsx"',
        'Content-Length': workbook.length,
        'Cache-Control': 'no-store'
      });
      return response.end(workbook);
    } catch (error) {
      return json(response, 500, {error: error.message || 'Không thể tạo tệp Excel.'});
    }
  }
  const orderPdfMatch = request.method === 'GET' ? /^\/api\/orders\/([^/]+)\.pdf$/i.exec(pathname) : null;
  if (orderPdfMatch) {
    if (!requirePermission(request, response, 'customers')) return;
    try {
      const orderCode = orderPdfMatch[1];
      const pdf = await orderPdfBuffer(readState(), orderCode);
      const safeCode = String(orderCode).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'don-hang';
      response.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="don-hang-${safeCode}.pdf"`,
        'Content-Length': pdf.length,
        'Cache-Control': 'no-store'
      });
      return response.end(pdf);
    } catch (error) {
      return json(response, error.statusCode || 500, {error:error.message || 'Không thể tạo PDF đơn hàng.'});
    }
  }
  if (request.method === 'GET' && pathname === '/api/template/products.xlsx') {
    try {
      const workbook = productImportTemplateWorkbook();
      response.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': "attachment; filename=\"product-import-template.xlsx\"; filename*=UTF-8''mau-nhap-danh-sach-san-pham.xlsx",
        'Content-Length': workbook.length,
        'Cache-Control': 'no-store'
      });
      return response.end(workbook);
    } catch (error) {
      return json(response, 500, {error: error.message || 'Không thể tạo mẫu Excel.'});
    }
  }
  if (request.method === 'GET' && pathname === '/api/export/products.xlsx') {
    try {
      const workbook = productCatalogWorkbook(readState());
      response.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': "attachment; filename=\"product-list.xlsx\"; filename*=UTF-8''danh-sach-san-pham-hien-tai.xlsx",
        'Content-Length': workbook.length,
        'Cache-Control': 'no-store'
      });
      return response.end(workbook);
    } catch (error) {
      return json(response, 500, {error: error.message || 'Không thể tạo danh sách sản phẩm Excel.'});
    }
  }
  if (request.method === 'POST' && pathname === '/api/state') {
    try {
      const {key, value} = JSON.parse((await readBody(request)).toString('utf8'));
      const allowedKeys = new Set(['aeon-products','aeon-ui','aeon-layout','aeon-brands','aeon-customers','aeon-orders']);
      if (!allowedKeys.has(key)) return json(response, 400, {error:'Không thể lưu loại dữ liệu này.'});
      const state = readState();
      if (key === 'aeon-products' && !requirePermission(request, response, 'products')) return;
      if (key === 'aeon-layout' && !requirePermission(request, response, 'interface')) return;
      if (key === 'aeon-brands' && !requirePermission(request, response, 'brands')) return;
      if (key === 'aeon-ui') {
        const principal = adminPrincipal(request);
        if (!principal) {
          json(response, 401, {error:'Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.'});
          return;
        }
        if (!principalHasPermission(principal, 'interface')) {
          if (!principalHasPermission(principal, 'quotes')) {
            json(response, 403, {error:'Tài khoản chưa được cấp quyền nội dung giao diện hoặc file báo giá.'});
            return;
          }
          if (!quoteFileOnlyUiChange(state[key], value)) {
            json(response, 403, {error:'Tài khoản này chỉ được phép thay đổi file báo giá.'});
            return;
          }
        }
      }
      state[key] = value;
      writeState(state);
      return json(response, 200, {ok:true});
    } catch (error) { return json(response, 400, {error:error.message || 'Không thể lưu dữ liệu.'}); }
  }

  if (request.method === 'POST' && pathname === '/api/google-sheet/orders') {
    try {
      const body = JSON.parse((await readBody(request, 256 * 1024)).toString('utf8'));
      const payload = googleSheetOrderPayload(body);
      const result = await sendOrderToGoogleSheet(payload);
      return json(response, 200, {ok:true, orderCode:payload.orderCode, googleSheet:result});
    } catch (error) {
      return json(response, 502, {ok:false, error:error.message || 'Không thể đồng bộ đơn hàng sang Google Sheet.'});
    }
  }

  if (request.method === 'POST' && pathname === '/api/upload') {
    const principal = adminPrincipal(request);
    if (!principal) {
      json(response, 401, {error:'Phiên quản trị đã hết hạn. Vui lòng đăng nhập lại.'});
      return;
    }
    if (!principalHasPermission(principal, 'products') && !principalHasPermission(principal, 'interface')) {
      json(response, 403, {error:'Tài khoản chưa được cấp quyền tải ảnh sản phẩm hoặc giao diện.'});
      return;
    }
    try {
      const body = JSON.parse((await readBody(request)).toString('utf8'));
      const match = /^data:(image\/(?:png|jpeg|webp|gif)|image\/svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl || '');
      if (!match || !uploadImageTypes.has(match?.[1])) return json(response, 400, {error:'Chỉ hỗ trợ ảnh PNG, JPG, WEBP, GIF hoặc SVG.'});
      const content = Buffer.from(match[2], 'base64');
      if (!content.length || content.length > maxUploadBytes) return json(response, 413, {error:'Ảnh phải nhỏ hơn hoặc bằng 10 MB.'});
      if (!isValidUploadedImage(match[1], content)) return json(response, 400, {error:'Tệp ảnh không hợp lệ hoặc không an toàn.'});
      const requestedName = path.basename(String(body.filename || 'image'));
      const base = path.basename(requestedName, path.extname(requestedName)).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'image';
      const filename = `${Date.now()}-${base}${imageExtensions[match[1]]}`;
      fs.writeFileSync(path.join(uploadDir, filename), content, {flag:'wx'});
      return json(response, 201, {url:`/assets/uploads/${filename}`});
    } catch (error) { return json(response, 400, {error:error.message || 'Không thể tải ảnh lên.'}); }
  }

  if (request.method === 'POST' && pathname === '/api/upload-quote') {
    if (!requirePermission(request, response, 'quotes')) return;
    try {
      const body = JSON.parse((await readBody(request, maxQuoteUploadBytes)).toString('utf8'));
      const filename = path.basename(String(body.filename || 'bao-gia'));
      const {buffer} = dataUrlBuffer(body.dataUrl);
      if (buffer.length > maxQuoteUploadBytes) return json(response, 413, {error:'Tệp báo giá phải nhỏ hơn hoặc bằng 20 MB.'});

      const kind = quoteFileKind(filename);
      if (!kind) return json(response, 400, {error:'Chỉ hỗ trợ tệp Excel (.xlsx, .xls) hoặc PDF (.pdf).'});
      if (!isValidQuoteFile(kind, filename, buffer)) return json(response, 400, {error:'Tệp báo giá không đúng định dạng hoặc đã bị hỏng.'});

      const extension = path.extname(filename).toLowerCase();
      const base = path.basename(filename, extension).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'bao-gia';
      const storedFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}${extension}`;
      fs.writeFileSync(path.join(quoteUploadDir, storedFilename), buffer, {flag:'wx'});
      return json(response, 201, {url:`/assets/uploads/quotes/${storedFilename}`, kind, filename:storedFilename});
    } catch (error) {
      return json(response, 400, {error:error.message || 'Không thể tải tệp báo giá lên.'});
    }
  }

  if (request.method === 'POST' && pathname === '/api/import-products') {
    if (!requirePermission(request, response, 'products')) return;
    try {
      const body = JSON.parse((await readBody(request, maxImportBytes)).toString('utf8'));
      const filename = path.basename(String(body.filename || 'catalogue'));
      const {mimeType, buffer} = dataUrlBuffer(body.dataUrl);
      if (buffer.length > maxImportBytes) return json(response, 413, {error:'Tệp phải nhỏ hơn hoặc bằng 15 MB.'});
      const kind = kindFromFile(filename, mimeType);
      if (!kind || !isValidImportFile(kind, filename, buffer)) return json(response, 400, {error:'Tệp không đúng định dạng được hỗ trợ.'});
      const analysis = await analyseProductFile({filename, mimeType, buffer});
      return json(response, 200, {ok:true, filename, ...analysis});
    } catch (error) {
      return json(response, 400, {error:error.message || 'Không thể phân tích tệp này.'});
    }
  }

  const requested = pathname === '/' ? '/index.html' : pathname;
  if (requested === '/.aeon-store.json' || requested.startsWith('/.aeon-store.json.')) { response.writeHead(403); return response.end('Forbidden'); }
  const filePath = path.resolve(root, `.${requested}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) { response.writeHead(403); return response.end('Forbidden'); }
  if (request.method === 'GET' && requested === '/index.html') {
    try {
      const content = storefrontHtml(request);
      response.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      return response.end(content);
    } catch {
      response.writeHead(500, {'Content-Type':'text/plain; charset=utf-8'});
      return response.end('Server error');
    }
  }
  fs.readFile(filePath, (error, content) => {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500, {'Content-Type':'text/plain; charset=utf-8'}); return response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error'); }
    response.writeHead(200, {'Content-Type':types[path.extname(filePath).toLowerCase()] || 'application/octet-stream','Cache-Control':'no-store'});
    response.end(content);
  });
}).listen(port, host, () => console.log(`AEON Mooncake is available on http://${host}:${port}`));

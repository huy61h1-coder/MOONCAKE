const AEON_DEFAULT_PRODUCTS = [];
const AEON_BRAND_GROUPS = [
  {
    id: 'imported',
    name: 'Thương hiệu nhập khẩu',
    brands: [
      {name: 'Mei-Xin (Hong Kong)', aliases: ['Mei-Xin']},
      {name: 'Tai Thong (Malaysia)', aliases: ['Tai Thong']}
    ]
  },
  {
    id: 'hotel-restaurant',
    name: 'Khách sạn & Nhà hàng',
    brands: [
      {name: 'Sheraton'}, {name: 'Maison'}, {name: 'Davidoff'}, {name: 'Hoàng Yến Group'},
      {name: 'Nikko'}, {name: 'Sofitel'}, {name: 'Hilton'}
    ]
  },
  {
    id: 'local',
    name: 'Thương hiệu nội địa',
    brands: [
      {name: 'Kinh Đô'}, {name: 'Hữu Nghị'}, {name: 'Thành Long'}, {name: 'Bảo Ngọc'},
      {name: 'Savoure'}, {name: 'Hy Lâm Môn'}, {name: 'Momi'}, {name: 'Đại Phát'},
      {name: 'Phúc Long'}, {name: 'Sweethome'}, {name: 'Bibica'}, {name: 'Bakes'}
    ]
  }
];

function cleanAeonBrandGroups(value) {
  const source = Array.isArray(value) && value.length ? value : AEON_BRAND_GROUPS;
  const groupIds = new Set();
  const brandKeys = new Set();
  return source.slice(0, 20).map((group, groupIndex) => {
    const name = String(group?.name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!name) return null;
    const baseId = String(group?.id || name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || `group-${groupIndex + 1}`;
    let id = baseId;
    let suffix = 2;
    while (groupIds.has(id)) id = `${baseId}-${suffix++}`;
    groupIds.add(id);

    const brands = (Array.isArray(group?.brands) ? group.brands : []).slice(0, 200).map(brand => {
      const brandName = String(brand?.name ?? brand ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const key = aeonBrandKey(brandName);
      if (!brandName || !key || brandKeys.has(key)) return null;
      brandKeys.add(key);
      const aliases = Array.isArray(brand?.aliases)
        ? brand.aliases.map(alias => String(alias || '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 12)
        : [];
      return {name: brandName, ...(aliases.length ? {aliases} : {})};
    }).filter(Boolean);
    return {id, name, brands};
  }).filter(Boolean);
}

function aeonBrandGroups() {
  return typeof aeonStore === 'object' && aeonStore?.brands
    ? aeonStore.brands()
    : cleanAeonBrandGroups(AEON_BRAND_GROUPS);
}

function aeonBrands() {
  return aeonBrandGroups().flatMap(group => group.brands.map(brand => ({
    ...brand,
    groupId: group.id,
    groupName: group.name
  })));
}

function aeonBrandHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function aeonBrandKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '');
}

function normaliseAeonBrand(value) {
  const key = aeonBrandKey(value);
  if (!key) return '';
  const matched = aeonBrands().find(brand => [brand.name, ...(brand.aliases || [])].some(alias => aeonBrandKey(alias) === key));
  return matched?.name || String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function aeonBrandOptions(selectedBrand = '') {
  const selected = normaliseAeonBrand(selectedBrand);
  return `<option value="">Chưa chọn thương hiệu</option>${aeonBrandGroups().map(group => `<optgroup label="${aeonBrandHtml(group.name)}">${group.brands.map(brand => `<option value="${aeonBrandHtml(brand.name)}"${brand.name === selected ? ' selected' : ''}>${aeonBrandHtml(brand.name)}</option>`).join('')}</optgroup>`).join('')}`;
}

const AEON_DEFAULT_UI = {
  eyebrow: 'MÙA TRĂNG 2026',
  title: 'Trọn vị\nđoàn viên',
  intro: 'Tuyển chọn hương vị tinh tế trong những hộp quà thanh lịch, để mỗi khoảnh khắc sum vầy đều thật đáng nhớ.',
  promotionTitle: 'Ưu đãi mùa trăng',
  promotionText: '03–19/08: giảm 8% từ 1 triệu · 20/08–25/09: giảm 5–15% từ 3 triệu',
  collectionTitle: 'Danh mục\nđang cập nhật.',
  collectionNote: 'Sản phẩm, giá bán và hình ảnh sẽ được công bố chính thức trong thời gian tới.',
  heroImage: '',
  logoText: 'AEON',
  logoSubtitle: 'MOONCAKE 2026',
  logoImage: '',
  logoMode: 'text',
  quoteExcelUrl: '/assets/downloads/bao-gia-banh-trung-thu-aeon-2026.xlsx',
  quotePdfUrl: ''
};

function normaliseAeonLogoImage(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return '';
  return `/${url.replace(/^\.?\//, '')}`;
}

function aeonLogoSettings(ui = {}) {
  const text = String(ui.logoText ?? AEON_DEFAULT_UI.logoText).replace(/\s+/g, ' ').trim().slice(0, 32) || AEON_DEFAULT_UI.logoText;
  const subtitle = String(ui.logoSubtitle ?? AEON_DEFAULT_UI.logoSubtitle)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .slice(0, 2)
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 80);
  const mode = ['text', 'image', 'image-subtitle'].includes(String(ui.logoMode || '')) ? String(ui.logoMode) : AEON_DEFAULT_UI.logoMode;
  return {
    text,
    subtitle,
    mode,
    image: normaliseAeonLogoImage(ui.logoImage),
    ariaLabel: [text, subtitle.replace(/\n+/g, ' ')].filter(Boolean).join(' ')
  };
}

function renderAeonBrandLogos(ui = {}, root = document) {
  const settings = aeonLogoSettings(ui);
  if (!root?.querySelectorAll) return settings;

  root.querySelectorAll('.brand').forEach(brand => {
    const renderText = () => {
      brand.replaceChildren();
      brand.classList.remove('has-brand-image', 'has-brand-subtitle', 'has-multiline-subtitle');
      const text = document.createElement('span');
      text.className = 'brand-text';
      text.textContent = settings.text;
      brand.append(text);
      if (settings.subtitle) {
        const subtitle = document.createElement('small');
        subtitle.className = 'brand-subtitle';
        subtitle.textContent = settings.subtitle;
        brand.append(subtitle);
        brand.classList.toggle('has-multiline-subtitle', settings.subtitle.includes('\n'));
      }
    };

    brand.dataset.logoMode = settings.mode;
    brand.setAttribute('aria-label', settings.ariaLabel || 'Trang chủ');
    const shouldShowImage = settings.image && settings.mode !== 'text';
    if (!shouldShowImage) {
      renderText();
      return;
    }

    brand.replaceChildren();
    brand.classList.add('has-brand-image');
    const image = document.createElement('img');
    image.className = 'brand-logo-image';
    image.src = settings.image;
    image.alt = '';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      if (image.parentElement === brand) renderText();
    }, {once: true});
    brand.append(image);

    if (settings.mode === 'image-subtitle' && settings.subtitle) {
      brand.classList.add('has-brand-subtitle');
      brand.classList.toggle('has-multiline-subtitle', settings.subtitle.includes('\n'));
      const subtitle = document.createElement('small');
      subtitle.className = 'brand-subtitle';
      subtitle.textContent = settings.subtitle;
      brand.append(subtitle);
    } else {
      brand.classList.remove('has-brand-subtitle', 'has-multiline-subtitle');
    }
  });
  return settings;
}

const AEON_DEFAULT_LAYOUT = {
  heroTitleSize: 68,
  heroIntroSize: 15,
  bannerAspectRatio: 21 / 9,
  heroButtonAlign: 'left',
  productTitleSize: 15,
  productButtonAlign: 'left',
  checkoutButtonAlign: 'stretch',
  accentColor: '#a9163a',
  accentDarkColor: '#71162b',
  pageBackgroundColor: '#fbf8f1',
  sectionBackgroundColor: '#f2ede2',
  textColor: '#242224',
  headerHeight: 82,
  heroHeight: 0,
  sectionSpacing: 0,
  productImageHeight: 0,
  productColumns: 0,
  logoSize: 25
};

const sharedKeys = ['aeon-products', 'aeon-ui', 'aeon-layout', 'aeon-brands', 'aeon-customers', 'aeon-orders'];
const canSync = () => location.protocol === 'http:' || location.protocol === 'https:';

const aeonStore = {
  writing: new Set(),
  lastWriteAt: Object.create(null),

  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },

  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    if (!sharedKeys.includes(key)) return Promise.resolve(true);

    this.lastWriteAt[key] = Date.now();
    return this.push(key, value);
  },

  isAdminSession() {
    try {
      return sessionStorage.getItem('aeon-admin') === 'true' || localStorage.getItem('aeon-admin') === 'true';
    } catch {
      return false;
    }
  },

  setAdminSession(active) {
    try {
      if (active) {
        sessionStorage.setItem('aeon-admin', 'true');
        localStorage.setItem('aeon-admin', 'true');
      } else {
        sessionStorage.removeItem('aeon-admin');
        localStorage.removeItem('aeon-admin');
      }
    } catch {
      // The admin interface will stay unavailable if browser storage is disabled.
    }
  },

  products() {
    return this.get('aeon-products', AEON_DEFAULT_PRODUCTS);
  },

  ui() {
    return {...AEON_DEFAULT_UI, ...this.get('aeon-ui', {})};
  },

  layout() {
    return {...AEON_DEFAULT_LAYOUT, ...this.get('aeon-layout', {})};
  },

  brands() {
    const configured = cleanAeonBrandGroups(this.get('aeon-brands', AEON_BRAND_GROUPS));
    const known = new Set(configured.flatMap(group => group.brands.map(brand => aeonBrandKey(brand.name))));
    const used = this.products()
      .map(product => String(product?.brand || '').replace(/\s+/g, ' ').trim().slice(0, 120))
      .filter(brand => brand && !known.has(aeonBrandKey(brand)));
    if (!used.length) return configured;

    const groups = configured.map(group => ({...group, brands: group.brands.map(brand => ({...brand}))}));
    let other = groups.find(group => group.id === 'other');
    if (!other) {
      other = {id: 'other', name: 'Thương hiệu khác', brands: []};
      groups.push(other);
    }
    used.forEach(name => {
      const key = aeonBrandKey(name);
      if (!key || known.has(key)) return;
      known.add(key);
      other.brands.push({name});
    });
    return groups;
  },

  customers() {
    return this.get('aeon-customers', []);
  },

  orders() {
    return this.get('aeon-orders', []);
  },

  async push(key, value) {
    if (!canSync()) return false;

    this.writing.add(key);
    try {
      const response = await fetch('/api/state', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({key, value})
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Không thể lưu dữ liệu.');
      }
      return true;
    } catch (error) {
      console.warn('AEON store sync failed:', error);
      window.dispatchEvent(new CustomEvent('aeon-store-error', {
        detail: {key, message: error.message || 'Không thể lưu dữ liệu.'}
      }));
      return false;
    } finally {
      this.writing.delete(key);
    }
  },

  async pull() {
    if (!canSync()) return false;

    const startedAt = Date.now();
    try {
      const response = await fetch('/api/state', {cache: 'no-store'});
      if (!response.ok) return false;

      const state = await response.json();
      const available = sharedKeys.filter(key => Object.prototype.hasOwnProperty.call(state, key));
      if (!available.length) {
        sharedKeys.forEach(key => {
          const raw = localStorage.getItem(key);
          if (raw !== null) this.push(key, JSON.parse(raw));
        });
        return true;
      }

      available.forEach(key => {
        // Do not let a slower GET overwrite a just-saved local change.
        if (this.writing.has(key) || (this.lastWriteAt[key] || 0) > startedAt) return;
        localStorage.setItem(key, JSON.stringify(state[key]));
      });
      window.dispatchEvent(new Event('aeon-store-sync'));
      return true;
    } catch (error) {
      console.warn('AEON store refresh failed:', error);
      return false;
    }
  }
};

const sampleProductIds = ['doan-vien', 'nguyet-sac', 'thu-nguyet', 'kim-nguyet', 'an-nhien', 'trang-vien'];
const savedProducts = aeonStore.get('aeon-products', null);
if (Array.isArray(savedProducts) && savedProducts.length === sampleProductIds.length && savedProducts.every(product => sampleProductIds.includes(product.id))) {
  localStorage.removeItem('aeon-products');
}

aeonStore.pull();

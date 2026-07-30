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

const AEON_BRANDS = AEON_BRAND_GROUPS.flatMap(group => group.brands.map(brand => ({
  ...brand,
  groupId: group.id,
  groupName: group.name
})));

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
  const matched = AEON_BRANDS.find(brand => [brand.name, ...(brand.aliases || [])].some(alias => aeonBrandKey(alias) === key));
  return matched?.name || '';
}

function aeonBrandOptions(selectedBrand = '') {
  const selected = normaliseAeonBrand(selectedBrand);
  return `<option value="">Chưa chọn thương hiệu</option>${AEON_BRAND_GROUPS.map(group => `<optgroup label="${group.name}">${group.brands.map(brand => `<option value="${brand.name}"${brand.name === selected ? ' selected' : ''}>${brand.name}</option>`).join('')}</optgroup>`).join('')}`;
}

const AEON_DEFAULT_UI = {
  eyebrow: 'MÙA TRĂNG 2026',
  title: 'Trọn vị\nđoàn viên',
  intro: 'Tuyển chọn hương vị tinh tế trong những hộp quà thanh lịch, để mỗi khoảnh khắc sum vầy đều thật đáng nhớ.',
  collectionTitle: 'Danh mục\nđang cập nhật.',
  collectionNote: 'Sản phẩm, giá bán và hình ảnh sẽ được công bố chính thức trong thời gian tới.',
  heroImage: ''
};

const AEON_DEFAULT_LAYOUT = {
  heroTitleSize: 68,
  heroIntroSize: 15,
  heroButtonAlign: 'left',
  productTitleSize: 15,
  productButtonAlign: 'left',
  checkoutButtonAlign: 'stretch'
};

const sharedKeys = ['aeon-products', 'aeon-ui', 'aeon-layout', 'aeon-customers', 'aeon-orders'];
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

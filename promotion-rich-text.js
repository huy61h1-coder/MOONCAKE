(function () {
  const MAX_LENGTH = 6000;
  const FONT_FACES = {
    'be vietnam pro': 'Be Vietnam Pro',
    'playfair display': 'Playfair Display',
    arial: 'Arial',
    georgia: 'Georgia'
  };
  const ALLOWED_TAGS = new Set(['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'span', 'font']);
  const BLOCKED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'link', 'meta']);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function normaliseFontFace(value) {
    const key = String(value ?? '')
      .replace(/["']/g, '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    return FONT_FACES[key] || '';
  }

  function normaliseColor(value) {
    const source = String(value ?? '').trim();
    if (/^#[\da-f]{3}$/i.test(source) || /^#[\da-f]{6}$/i.test(source)) return source.toLowerCase();
    const rgb = source.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
    if (!rgb) return '';
    const parts = rgb.slice(1).map(part => Number(part));
    if (parts.some(part => part < 0 || part > 255)) return '';
    return `#${parts.map(part => part.toString(16).padStart(2, '0')).join('')}`;
  }

  function safeStyle(value) {
    const result = [];
    String(value ?? '').split(';').forEach(rule => {
      const divider = rule.indexOf(':');
      if (divider < 0) return;
      const property = rule.slice(0, divider).trim().toLowerCase();
      const raw = rule.slice(divider + 1).trim();
      if (property === 'font-family') {
        const font = normaliseFontFace(raw);
        if (font) result.push(`font-family:${font}`);
      }
      if (property === 'font-size') {
        const size = Number.parseFloat(raw);
        if (Number.isFinite(size) && size >= 9 && size <= 30) result.push(`font-size:${Math.round(size)}px`);
      }
      if (property === 'color') {
        const color = normaliseColor(raw);
        if (color) result.push(`color:${color}`);
      }
      if (property === 'font-weight' && /^(?:normal|bold|[4-8]00)$/i.test(raw)) result.push(`font-weight:${raw.toLowerCase()}`);
      if (property === 'font-style' && /^(?:normal|italic)$/i.test(raw)) result.push(`font-style:${raw.toLowerCase()}`);
      if (property === 'text-decoration' && /^(?:none|underline)$/i.test(raw)) result.push(`text-decoration:${raw.toLowerCase()}`);
      if (property === 'text-align' && /^(?:left|center|right|justify)$/i.test(raw)) result.push(`text-align:${raw.toLowerCase()}`);
    });
    return result.join(';');
  }

  function sourceHtml(value) {
    const source = String(value ?? '').replace(/\r\n?/g, '\n').trim();
    if (!source) return '';
    return /<\/?[a-z][^>]*>/i.test(source)
      ? source
      : escapeHtml(source).replace(/\n/g, '<br>');
  }

  function clean(value, limit = MAX_LENGTH) {
    const parser = new DOMParser();
    const documentRoot = parser.parseFromString(`<div>${sourceHtml(value)}</div>`, 'text/html').body.firstElementChild;
    const output = document.createElement('div');

    function appendCleanChildren(from, to) {
      [...from.childNodes].forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          to.append(document.createTextNode(node.textContent || ''));
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const tag = node.tagName.toLowerCase();
        if (BLOCKED_TAGS.has(tag)) return;
        if (!ALLOWED_TAGS.has(tag)) {
          appendCleanChildren(node, to);
          return;
        }
        const element = document.createElement(tag);
        const style = safeStyle(node.getAttribute('style'));
        if (style) element.setAttribute('style', style);
        if (tag === 'font') {
          const face = normaliseFontFace(node.getAttribute('face'));
          const color = normaliseColor(node.getAttribute('color'));
          const size = Number.parseInt(node.getAttribute('size'), 10);
          if (face) element.setAttribute('face', face);
          if (color) element.setAttribute('color', color);
          if (Number.isInteger(size) && size >= 1 && size <= 7) element.setAttribute('size', String(size));
        }
        appendCleanChildren(node, element);
        to.append(element);
      });
    }

    appendCleanChildren(documentRoot, output);
    const result = output.innerHTML.replace(/(?:<br>){4,}/gi, '<br><br><br>').trim();
    const max = Math.max(1, Number(limit) || MAX_LENGTH);
    if (result.length <= max) return result;
    return escapeHtml((output.textContent || '').slice(0, max)).replace(/\n/g, '<br>');
  }

  function render(target, value) {
    if (!target) return;
    target.innerHTML = clean(value);
  }

  function editorMarkup(options = {}) {
    const name = escapeHtml(options.name || 'promotionText');
    const value = clean(options.value || '', Number(options.limit) || MAX_LENGTH);
    return `<div class="promotion-richtext-editor" data-promotion-richtext>
      <div class="promotion-richtext-toolbar" role="toolbar" aria-label="Định dạng nội dung chiết khấu">
        <button type="button" data-promotion-action="bold" title="In đậm" aria-label="In đậm"><b>B</b></button>
        <button type="button" data-promotion-action="italic" title="In nghiêng" aria-label="In nghiêng"><i>I</i></button>
        <button type="button" data-promotion-action="underline" title="Gạch chân" aria-label="Gạch chân"><u>U</u></button>
        <span class="promotion-toolbar-divider" aria-hidden="true"></span>
        <button type="button" data-promotion-action="bullet" title="Danh sách dấu đầu dòng" aria-label="Danh sách dấu đầu dòng">•</button>
        <button type="button" data-promotion-action="ordered" title="Danh sách đánh số" aria-label="Danh sách đánh số">1.</button>
        <button type="button" data-promotion-action="left" title="Căn trái" aria-label="Căn trái">≡</button>
        <button type="button" data-promotion-action="center" title="Căn giữa" aria-label="Căn giữa">≡</button>
        <button type="button" data-promotion-action="right" title="Căn phải" aria-label="Căn phải">≡</button>
        <span class="promotion-toolbar-divider" aria-hidden="true"></span>
        <label class="sr-only" for="${name}-font">Font chữ</label>
        <select id="${name}-font" data-promotion-font aria-label="Font chữ">
          <option value="be-vietnam-pro">Be Vietnam Pro</option>
          <option value="playfair-display">Playfair Display</option>
          <option value="arial">Arial</option>
          <option value="georgia">Georgia</option>
        </select>
        <label class="sr-only" for="${name}-size">Cỡ chữ</label>
        <select id="${name}-size" data-promotion-size aria-label="Cỡ chữ">
          <option value="2">12px</option>
          <option value="3" selected>14px</option>
          <option value="4">16px</option>
          <option value="5">18px</option>
          <option value="6">20px</option>
        </select>
        <label class="promotion-color-picker" title="Màu chữ">Màu<input type="color" value="#a9163a" data-promotion-color aria-label="Màu chữ"></label>
        <button type="button" data-promotion-action="clear" title="Xóa định dạng" aria-label="Xóa định dạng">Tx</button>
      </div>
      <div class="promotion-richtext-canvas" data-promotion-canvas contenteditable="true" role="textbox" aria-multiline="true" aria-label="Nội dung ưu đãi mùa trăng">${value}</div>
      <textarea hidden name="${name}" data-promotion-rich-input>${escapeHtml(value)}</textarea>
      <p class="promotion-richtext-help">Bôi đen phần cần định dạng. Nhấn Enter để xuống dòng; nội dung được tự động lọc an toàn trước khi lưu.</p>
    </div>`;
  }

  function bind(editor) {
    if (!editor || editor.dataset.promotionRichtextBound) return;
    const canvas = editor.querySelector('[data-promotion-canvas]');
    const input = editor.querySelector('[data-promotion-rich-input]');
    const toolbar = editor.querySelector('[data-promotion-richtext-toolbar]');
    if (!canvas || !input || !toolbar) return;
    editor.dataset.promotionRichtextBound = 'true';
    let savedRange = null;

    const saveRange = () => {
      const selection = window.getSelection();
      if (!selection?.rangeCount || !canvas.contains(selection.anchorNode)) return;
      savedRange = selection.getRangeAt(0).cloneRange();
    };
    const restoreRange = () => {
      if (!savedRange) return;
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRange);
    };
    const sync = () => {
      input.value = clean(canvas.innerHTML, MAX_LENGTH);
    };
    const command = (name, value = null) => {
      canvas.focus();
      restoreRange();
      document.execCommand(name, false, value);
      sync();
      saveRange();
    };

    canvas.addEventListener('input', () => {
      sync();
      saveRange();
    });
    canvas.addEventListener('keyup', saveRange);
    canvas.addEventListener('mouseup', saveRange);
    canvas.addEventListener('focus', saveRange);
    canvas.addEventListener('paste', event => {
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain') || '';
      document.execCommand('insertText', false, text);
      sync();
      saveRange();
    });
    toolbar.addEventListener('pointerdown', event => {
      if (event.target.closest('button, select, input')) saveRange();
    });
    toolbar.addEventListener('mousedown', event => {
      if (event.target.closest('button')) event.preventDefault();
    });
    toolbar.addEventListener('click', event => {
      const button = event.target.closest('[data-promotion-action]');
      if (!button) return;
      const action = button.dataset.promotionAction;
      const actions = {
        bold: () => command('bold'),
        italic: () => command('italic'),
        underline: () => command('underline'),
        bullet: () => command('insertUnorderedList'),
        ordered: () => command('insertOrderedList'),
        left: () => command('justifyLeft'),
        center: () => command('justifyCenter'),
        right: () => command('justifyRight'),
        clear: () => command('removeFormat')
      };
      actions[action]?.();
    });
    toolbar.querySelector('[data-promotion-font]')?.addEventListener('change', event => {
      const faces = {
        'be-vietnam-pro': 'Be Vietnam Pro',
        'playfair-display': 'Playfair Display',
        arial: 'Arial',
        georgia: 'Georgia'
      };
      command('fontName', faces[event.currentTarget.value] || 'Be Vietnam Pro');
    });
    toolbar.querySelector('[data-promotion-size]')?.addEventListener('change', event => command('fontSize', event.currentTarget.value));
    toolbar.querySelector('[data-promotion-color]')?.addEventListener('input', event => command('foreColor', event.currentTarget.value));
    sync();
  }

  function bindAll(scope = document) {
    scope.querySelectorAll?.('[data-promotion-richtext]').forEach(bind);
  }

  window.AEONPromotionRichText = {clean, render, editorMarkup, bind, bindAll};
}());

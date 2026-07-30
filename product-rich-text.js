(function () {
  const MAX_LENGTH = 3000;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[char]);
  }

  function clean(value, limit = MAX_LENGTH) {
    return String(value ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()
      .slice(0, limit);
  }

  function renderInline(value) {
    let result = escapeHtml(value);
    result = result.replace(/\*\*([^*\n][\s\S]*?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return result;
  }

  function render(value) {
    const lines = clean(value).split('\n');
    const blocks = [];
    let paragraph = [];
    let listType = '';
    let listItems = [];

    const flushParagraph = () => {
      const visibleLines = paragraph.filter(line => line.trim());
      if (visibleLines.length) blocks.push('<p>' + visibleLines.map(renderInline).join('<br>') + '</p>');
      paragraph = [];
    };
    const flushList = () => {
      if (listType && listItems.length) {
        blocks.push('<' + listType + '>' + listItems.map(item => '<li>' + renderInline(item) + '</li>').join('') + '</' + listType + '>');
      }
      listType = '';
      listItems = [];
    };
    const addListItem = (type, item) => {
      flushParagraph();
      if (listType && listType !== type) flushList();
      listType = type;
      listItems.push(item);
    };

    lines.forEach(line => {
      const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
      const bullet = line.match(/^\s*(?:[-•])\s+(.+)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);

      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(5, heading[1].length + 2);
        blocks.push('<h' + level + '>' + renderInline(heading[2]) + '</h' + level + '>');
      } else if (bullet) {
        addListItem('ul', bullet[1]);
      } else if (numbered) {
        addListItem('ol', numbered[1]);
      } else if (!line.trim()) {
        flushParagraph();
        flushList();
      } else {
        flushList();
        paragraph.push(line);
      }
    });

    flushParagraph();
    flushList();
    return blocks.join('') || '<p>Thông tin chi tiết đang được cập nhật.</p>';
  }

  function emitInput(textarea) {
    textarea.dispatchEvent(new Event('input', {bubbles: true}));
  }

  function replaceRange(textarea, start, end, replacement, selectStart, selectEnd) {
    textarea.value = textarea.value.slice(0, start) + replacement + textarea.value.slice(end);
    textarea.focus();
    textarea.setSelectionRange(selectStart, selectEnd);
    emitInput(textarea);
  }

  function wrapSelection(textarea, before, after, fallback) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || fallback;
    replaceRange(
      textarea,
      start,
      end,
      before + selected + after,
      start + before.length,
      start + before.length + selected.length
    );
  }

  function selectedLineRange(textarea) {
    const value = textarea.value;
    const start = value.lastIndexOf('\n', Math.max(0, textarea.selectionStart - 1)) + 1;
    const nextBreak = value.indexOf('\n', textarea.selectionEnd);
    const end = nextBreak < 0 ? value.length : nextBreak;
    return {start, end, value: value.slice(start, end)};
  }

  function prefixSelectedLines(textarea, prefix, matcher) {
    const range = selectedLineRange(textarea);
    const lines = range.value.split('\n');
    const nonEmpty = lines.filter(line => line.trim());
    const shouldRemove = nonEmpty.length && nonEmpty.every(line => matcher.test(line));
    const replacement = lines.map(line => {
      if (!line.trim()) return line;
      return shouldRemove ? line.replace(matcher, '') : prefix + line.trimStart();
    }).join('\n');
    replaceRange(textarea, range.start, range.end, replacement, range.start, range.start + replacement.length);
  }

  function numberSelectedLines(textarea) {
    const range = selectedLineRange(textarea);
    const lines = range.value.split('\n');
    const nonEmpty = lines.filter(line => line.trim());
    const matcher = /^\s*\d+[.)]\s+/;
    const shouldRemove = nonEmpty.length && nonEmpty.every(line => matcher.test(line));
    let count = 1;
    const replacement = lines.map(line => {
      if (!line.trim()) return line;
      if (shouldRemove) return line.replace(matcher, '');
      return (count++) + '. ' + line.trimStart();
    }).join('\n');
    replaceRange(textarea, range.start, range.end, replacement, range.start, range.start + replacement.length);
  }

  function runAction(textarea, action) {
    if (action === 'bold') wrapSelection(textarea, '**', '**', 'nội dung in đậm');
    if (action === 'italic') wrapSelection(textarea, '*', '*', 'nội dung in nghiêng');
    if (action === 'heading') prefixSelectedLines(textarea, '# ', /^\s*#{1,3}\s+/);
    if (action === 'bullet') prefixSelectedLines(textarea, '- ', /^\s*(?:[-•])\s+/);
    if (action === 'ordered') numberSelectedLines(textarea);
  }

  function editorMarkup(options = {}) {
    const name = String(options.name || 'details');
    const value = clean(options.value || '', Number(options.limit) || MAX_LENGTH);
    const rows = Math.max(5, Number(options.rows) || 8);
    const placeholder = String(options.placeholder || 'Nhập thông tin hiển thị khi khách xem chi tiết');
    return '<div class="richtext-editor" data-richtext>' +
      '<div class="richtext-toolbar" role="toolbar" aria-label="Định dạng nội dung">' +
      '<button type="button" data-richtext-action="bold" aria-label="In đậm" title="In đậm"><b>B</b></button>' +
      '<button type="button" data-richtext-action="italic" aria-label="In nghiêng" title="In nghiêng"><i>I</i></button>' +
      '<button type="button" data-richtext-action="heading" aria-label="Tiêu đề" title="Tiêu đề">T</button>' +
      '<button type="button" data-richtext-action="bullet" aria-label="Danh sách dấu đầu dòng" title="Danh sách dấu đầu dòng">•</button>' +
      '<button type="button" data-richtext-action="ordered" aria-label="Danh sách đánh số" title="Danh sách đánh số">1.</button>' +
      '</div>' +
      '<textarea data-richtext-input name="' + escapeHtml(name) + '" rows="' + rows + '" maxlength="' + MAX_LENGTH + '" placeholder="' + escapeHtml(placeholder) + '">' + escapeHtml(value) + '</textarea>' +
      '<p class="richtext-help">Enter để xuống dòng · Bôi đen nội dung rồi chọn nút định dạng.</p>' +
      '<div class="richtext-preview"><span>Xem trước</span><div data-richtext-preview></div></div>' +
      '</div>';
  }

  function bind(editor) {
    if (!editor || editor.dataset.richtextBound) return;
    const textarea = editor.querySelector('[data-richtext-input]');
    const preview = editor.querySelector('[data-richtext-preview]');
    if (!textarea || !preview) return;
    editor.dataset.richtextBound = 'true';

    const updatePreview = () => {
      preview.innerHTML = render(textarea.value);
    };
    editor.querySelector('[data-richtext-toolbar]')?.addEventListener('mousedown', event => {
      if (event.target.closest('[data-richtext-action]')) event.preventDefault();
    });
    editor.querySelector('[data-richtext-toolbar]')?.addEventListener('click', event => {
      const button = event.target.closest('[data-richtext-action]');
      if (!button) return;
      runAction(textarea, button.dataset.richtextAction);
      updatePreview();
    });
    textarea.addEventListener('input', updatePreview);
    updatePreview();
  }

  function bindAll(scope = document) {
    scope.querySelectorAll('[data-richtext]').forEach(bind);
  }

  window.AEONRichText = {clean, render, editorMarkup, bind, bindAll};
}());

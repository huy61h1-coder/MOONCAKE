const XLSX = require('xlsx');
const {PDFParse} = require('pdf-parse');
const {createWorker, PSM} = require('tesseract.js');
const vietnameseData = require('@tesseract.js-data/vie');

const MAX_CANDIDATES = 100;
const MAX_TEXT_LENGTH = 45000;
const MAX_PDF_PAGES = 3;

let ocrQueue = Promise.resolve();

function cleanText(value, limit = 800) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, limit);
}

function normaliseKey(value) {
  return cleanText(value, 120)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tidyName(value) {
  return cleanText(value, 160)
    .replace(/^(?:sản phẩm|san pham|tên sản phẩm|ten san pham|tên|ten|product|hộp bánh|hop banh)\s*[:\-–—]+\s*/i, '')
    .replace(/^[•·\-–—\d.)\s]+/, '')
    .replace(/\s*(?:(?:giá|gia)(?:\s*(?:bán|ban))?|price)\s*[:\-–—]*\s*$/i, '')
    .trim();
}

function parsePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const source = cleanText(value, 120)
    .toLowerCase()
    .replace(/\u00a0/g, ' ')
    .replace(/([.,])\s+(?=\d{3}\b)/g, '$1');
  if (!source) return null;

  const million = source.match(/(\d+(?:[.,]\d+)?)\s*(?:triệu|tr|million|m)\b/i);
  if (million) return Math.round(Number(million[1].replace(',', '.')) * 1000000);

  const thousand = source.match(/(\d+(?:[.,]\d+)?)\s*(?:nghìn|ngàn|k)\b/i);
  if (thousand) return Math.round(Number(thousand[1].replace(',', '.')) * 1000);

  const numeric = source.match(/\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?|\d{4,}/);
  if (!numeric) return null;
  const digits = numeric[0].replace(/\D/g, '');
  const price = Number(digits);
  return Number.isFinite(price) && price >= 1000 ? price : null;
}

function priceFromLine(line) {
  const source = cleanText(line, 180);
  const priceHint = /(?:giá(?:\s*bán)?|price|vnd|vnđ|₫|\bđ\b|triệu|\btr\b|nghìn|ngàn|\bk\b)/i.test(source);
  const groupedAmount = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?/.test(source)
    || (/(?:^|\s)\d{1,3}(?:\s\d{3})+(?:\s|$)/.test(source) && !/\d{2,3}\s*g\b|\b(?:x|×)\s*\d+/i.test(source));
  const compactNumber = source.replace(/[^\d]/g, '');
  const looksLikePhone = /^\+?\d(?:[\s.-]?\d){8,10}$/.test(source.trim())
    || (compactNumber.length >= 9 && compactNumber.length <= 11 && !groupedAmount && !priceHint);
  const amount = parsePrice(source);
  if (!amount || looksLikePhone) return null;
  return priceHint || groupedAmount || (compactNumber.length <= 8 && amount >= 100000) ? amount : null;
}

const OCR_BRAND_ALIASES = [
  {name: 'Mei-Xin (Hong Kong)', aliases: ['mei xin']},
  {name: 'Tai Thong (Malaysia)', aliases: ['tai thong']},
  {name: 'Sheraton', aliases: ['sheraton']},
  {name: 'Maison', aliases: ['maison', 'maison mooncake']},
  {name: 'Davidoff', aliases: ['davidoff']},
  {name: 'Hoàng Yến Group', aliases: ['hoang yen group', 'hoang yen']},
  {name: 'Nikko', aliases: ['nikko']},
  {name: 'Sofitel', aliases: ['sofitel']},
  {name: 'Hilton', aliases: ['hilton']},
  {name: 'Kinh Đô', aliases: ['kinh do']},
  {name: 'Hữu Nghị', aliases: ['huu nghi']},
  {name: 'Thành Long', aliases: ['thanh long']},
  {name: 'Bảo Ngọc', aliases: ['bao ngoc']},
  {name: 'Savoure', aliases: ['savoure']},
  {name: 'Hy Lâm Môn', aliases: ['hy lam mon']},
  {name: 'Momi', aliases: ['momi']},
  {name: 'Đại Phát', aliases: ['dai phat']},
  {name: 'Phúc Long', aliases: ['phuc long']},
  {name: 'Sweethome', aliases: ['sweethome']},
  {name: 'Bibica', aliases: ['bibica']},
  {name: 'Bakes', aliases: ['bakes']}
];

function stripListMarker(value) {
  return cleanText(value, 260)
    .replace(/^[\s•·°●○◦▪▫*—–-]+/, '')
    .replace(/^\s*\d{1,2}[.)]\s+/, '')
    .replace(/^[sS]\s+(?=[A-ZÀ-ỸĐ])/u, '')
    .trim();
}

function isMostlyUppercase(value) {
  const letters = String(value || '').match(/[A-Za-zÀ-ỹ]/g) || [];
  if (letters.length < 3) return false;
  const uppercase = letters.filter(letter => letter === letter.toUpperCase() && letter !== letter.toLowerCase()).length;
  return uppercase / letters.length >= .56;
}

function isBulletLine(value) {
  return /^[\s•·●○◦▪▫*—–-]/.test(String(value || '')) || /^\s*\d{1,2}[.)]\s+/.test(String(value || ''));
}

function isSectionLine(value) {
  const key = normaliseKey(value);
  return /(?:hop banh gom|bao gom|thanh phan|gia ban|da bao gom|vat|moon cake collection|aeon exclusive)/.test(key);
}

function titleScore(value) {
  const line = stripListMarker(value);
  if (!line || isBulletLine(value) || isSectionLine(line) || priceFromLine(line)) return -100;
  const key = normaliseKey(line);
  if (!key || /^(?:maison|aeon|exclusive|moon cake collection)$/.test(key)) return -100;

  let score = line.length >= 6 && line.length <= 180 ? 1 : 0;
  if (/(?:hop banh|banh trung thu|mooncake|moon cake)/.test(key)) score += 12;
  if (isMostlyUppercase(line)) score += 2;
  if (/\d{2,3}\s*g|\bx\s*\d+/i.test(line)) score += 2;
  return score;
}

function titleBlock(lines, startIndex, priceIndex) {
  const parts = [stripListMarker(lines[startIndex])];
  for (let offset = 1; offset <= 2; offset += 1) {
    const index = startIndex + offset;
    const next = stripListMarker(lines[index]);
    if (index >= priceIndex || !next || isSectionLine(next) || isBulletLine(lines[index]) || priceFromLine(next)) break;
    if (titleScore(next) < 4 && !isMostlyUppercase(next)) break;
    parts.push(next);
  }
  return repairCommonTitleText(parts.join(' '));
}

function repairCommonTitleText(value) {
  return cleanText(value, 160)
    .replace(/H\p{L}P\s+B\p{L}NH\s+TRUNG\s+TH\p{L}/giu, 'HỘP BÁNH TRUNG THU')
    .replace(/\bL\p{L}I\s+CU\p{L}N\b/giu, 'LÔI CUỐN');
}

function findTitleBeforePrice(lines, priceIndex) {
  let best = null;
  const start = Math.max(0, priceIndex - 30);
  for (let index = start; index < priceIndex; index += 1) {
    const score = titleScore(lines[index]);
    if (score < 7) continue;
    const name = titleBlock(lines, index, priceIndex);
    const ranking = score - ((priceIndex - index) * .04);
    if (!best || ranking > best.ranking) best = {index, name, score, ranking};
  }
  return best;
}

function looksLikeContentItem(raw, item) {
  if (isBulletLine(raw)) return true;
  if (/^\d{1,2}\s/.test(item)) return true;
  return /\b\d{1,3}\s*(?:g|ml)\b/i.test(item);
}

function contentItemsAfterMarker(lines, marker, priceIndex) {
  const items = [];
  for (let index = marker + 1; index < priceIndex && items.length < 12; index += 1) {
    const raw = lines[index];
    const item = stripListMarker(raw);
    if (!item || priceFromLine(item)) break;
    if (isSectionLine(item) || /^(?:da bao gom|vat)$/i.test(normaliseKey(item))) {
      if (items.length) break;
      continue;
    }
    if (looksLikeContentItem(raw, item)) {
      items.push(item);
      continue;
    }
    if (items.length) break;
  }
  return items;
}

function extractContents(lines, titleIndex, priceIndex) {
  let best = {items: [], distance: Number.POSITIVE_INFINITY};
  for (let marker = 0; marker < priceIndex; marker += 1) {
    if (!/(?:hop banh gom|bao gom|thanh phan)/.test(normaliseKey(lines[marker]))) continue;
    const items = contentItemsAfterMarker(lines, marker, priceIndex);
    const distance = Math.abs(marker - titleIndex);
    if (items.length > best.items.length || (items.length === best.items.length && distance < best.distance)) {
      best = {items, distance};
    }
  }
  return best.items;
}

function detectBrand(lines) {
  const haystack = normaliseKey(lines.join(' '));
  for (const brand of OCR_BRAND_ALIASES) {
    if (brand.aliases.some(alias => haystack.includes(normaliseKey(alias)))) return brand.name;
  }
  return '';
}

function weightFromTitle(title) {
  const match = String(title || '').match(/(\d{2,3})\s*g\s*(?:x|×)\s*(\d+)/i);
  return match ? (match[2] + ' bánh · ' + match[1] + 'g') : '';
}

function structuredCandidatesFromText(lines, sourceKind) {
  const candidates = [];
  const brand = detectBrand(lines);

  lines.forEach((line, priceIndex) => {
    const price = priceFromLine(line);
    if (!price || candidates.length >= MAX_CANDIDATES) return;
    const title = findTitleBeforePrice(lines, priceIndex);
    if (!title?.name) return;

    const contents = extractContents(lines, title.index, priceIndex);
    const details = contents.length ? ('HỘP BÁNH GỒM:\n' + contents.map(item => '• ' + item).join('\n')) : '';
    const description = contents.length
      ? cleanText('Hộp bánh gồm: ' + contents.join(' · '), 500)
      : cleanText(title.name, 500);
    const duplicate = candidates.some(candidate => normaliseKey(candidate.name) === normaliseKey(title.name) && candidate.price === price);
    if (duplicate) return;

    const warnings = [];
    if (!brand) warnings.push('Chưa nhận diện được thương hiệu; hãy chọn lại trong bản nháp.');
    if (!contents.length) warnings.push('Chưa tách được danh sách thành phần; hãy kiểm tra thông tin chi tiết.');
    if (sourceKind === 'image' && contents.length) warnings.push('OCR đã tách danh sách thành phần; hãy đối chiếu lại các định lượng nhỏ trên ảnh trước khi lưu.');
    candidates.push({
      name: title.name,
      price,
      description,
      sku: '',
      brand,
      label: '',
      weight: weightFromTitle(title.name),
      ingredients: cleanText(contents.join(' · '), 300),
      details,
      image: '',
      confidence: Math.min(96, 82 + (title.score >= 12 ? 7 : 0) + (brand ? 3 : 0) + (contents.length ? 4 : 0) - (sourceKind === 'image' ? 3 : 0)),
      warnings,
      source: sourceKind
    });
  });

  return candidates;
}

function guessDescription(lines, priceIndex, name) {
  const nearby = lines
    .slice(Math.max(0, priceIndex - 2), Math.min(lines.length, priceIndex + 3))
    .filter((line, index, nearbyLines) => line !== name && !priceFromLine(line) && line.length > 4 && nearbyLines.indexOf(line) === index)
    .slice(0, 2)
    .join(' · ');
  return cleanText(nearby, 380);
}

function candidatesFromText(sourceText, sourceKind) {
  const lines = cleanText(sourceText, MAX_TEXT_LENGTH)
    .split(/\r?\n/)
    .map(line => cleanText(line, 260))
    .filter(line => line.length > 1);
  const structured = structuredCandidatesFromText(lines, sourceKind);
  if (structured.length) return structured;
  const candidates = [];

  lines.forEach((line, index) => {
    const price = priceFromLine(line);
    if (!price || candidates.length >= MAX_CANDIDATES) return;

    const withoutPrice = line
      .replace(/(?:(?:giá|gia)(?:\s*(?:bán|ban))?|price)\s*[:\-–—]?/ig, '')
      .replace(/(?:\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?|\d{4,})(?:\s*(?:vnđ|vnd|đ|₫|triệu|tr|nghìn|ngàn|k))?/ig, '')
      .replace(/[|•·,:;\-–—]+/g, ' ')
      .trim();

    let name = tidyName(withoutPrice);
    let guessed = false;
    if (name.length < 3 || /^(?:đã bao gồm|bao gồm|vat|giá)$/i.test(name)) {
      for (let offset = 1; offset <= 4; offset += 1) {
        const previous = lines[index - offset];
        if (!previous || priceFromLine(previous) || previous.length < 3) continue;
        const possible = tidyName(previous);
        if (possible.length >= 3 && possible.length <= 160) {
          name = possible;
          guessed = true;
          break;
        }
      }
    }
    if (name.length < 3 || name.length > 160) return;

    const description = guessDescription(lines, index, name);
    const duplicate = candidates.some(candidate => normaliseKey(candidate.name) === normaliseKey(name) && candidate.price === price);
    if (duplicate) return;

    candidates.push({
      name,
      price,
      description,
      sku: '',
      brand: detectBrand(lines),
      label: '',
      weight: '',
      ingredients: '',
      details: description,
      image: '',
      confidence: guessed ? 64 : 78,
      warnings: [guessed ? 'Tên sản phẩm được suy đoán từ dòng gần giá bán.' : 'Hãy kiểm tra lại tên và giá trước khi nhập.'],
      source: sourceKind
    });
  });

  return candidates;
}

function headerField(value) {
  const key = normaliseKey(value);
  if (!key) return '';
  if (/(^| )(ten san pham|san pham|product name|product|item name|ten)( |$)/.test(key)) return 'name';
  if (/(^| )(gia ban|don gia|gia|price|unit price|vnd|vnđ)( |$)/.test(key)) return 'price';
  if (/(mo ta|description|details|noi dung|thong tin)/.test(key)) return 'description';
  if (/(ma san pham|ma sp|sku|product code|code)/.test(key)) return 'sku';
  if (/(thuong hieu|brand|nhan hang)/.test(key)) return 'brand';
  if (/(nhan|label|collection|bo suu tap)/.test(key)) return 'label';
  if (/(quy cach|khoi luong|trong luong|weight|net weight)/.test(key)) return 'weight';
  if (/(thanh phan|ingredients|nguyen lieu)/.test(key)) return 'ingredients';
  if (/(hinh anh|anh|image|image url|url anh)/.test(key)) return 'image';
  return '';
}

function findHeaderRow(rows) {
  let best = {index: -1, fields: [], score: 0};
  rows.slice(0, 12).forEach((row, index) => {
    const fields = (Array.isArray(row) ? row : []).map(headerField);
    const unique = new Set(fields.filter(Boolean));
    const score = unique.size + (unique.has('name') ? 3 : 0) + (unique.has('price') ? 3 : 0);
    if (score > best.score) best = {index, fields, score};
  });
  return best.score >= 4 && best.fields.includes('name') ? best : null;
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleDateString('vi-VN');
  return cleanText(value, 500);
}

function isInstructionSheet(sheetName) {
  const key = normaliseKey(sheetName);
  return /^(?:huong dan|huong dan su dung|read me|instructions?|ghi chu|notes?)$/.test(key);
}

function candidatesFromSpreadsheet(buffer, filename = '') {
  const isCsv = /\.csv$/i.test(filename);
  const source = isCsv ? buffer.toString('utf8').replace(/^\uFEFF/, '') : buffer;
  const workbook = XLSX.read(source, {type: isCsv ? 'string' : 'buffer', cellDates: true, raw: false});
  const candidates = [];
  const warnings = [];

  workbook.SheetNames.slice(0, 10).forEach(sheetName => {
    if (candidates.length >= MAX_CANDIDATES) return;
    if (isInstructionSheet(sheetName)) return;
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {header: 1, defval: '', raw: false, blankrows: false});
    const header = findHeaderRow(rows);
    if (!header) {
      warnings.push(`Không tìm thấy cột Tên sản phẩm/Giá ở sheet “${sheetName}”.`);
      return;
    }

    rows.slice(header.index + 1).forEach(row => {
      if (candidates.length >= MAX_CANDIDATES || !Array.isArray(row)) return;
      const record = {};
      header.fields.forEach((field, column) => {
        if (field && !record[field]) record[field] = cellText(row[column]);
      });
      const name = tidyName(record.name);
      const price = parsePrice(record.price);
      const hasValues = Object.values(record).some(Boolean);
      if (!hasValues || !name) return;

      const rowWarnings = [];
      if (!price) rowWarnings.push('Chưa nhận diện được giá bán. Hãy nhập giá trước khi lưu.');
      candidates.push({
        name,
        price: price || 0,
        description: cleanText(record.description || '', 500),
        sku: cleanText(record.sku || '', 100),
        brand: cleanText(record.brand || '', 100),
        label: cleanText(record.label || '', 100),
        weight: cleanText(record.weight || '', 100),
        ingredients: cleanText(record.ingredients || '', 300),
        details: cleanText(record.description || '', 800),
        image: cleanText(record.image || '', 600),
        confidence: price ? 96 : 74,
        warnings: rowWarnings,
        source: 'excel'
      });
    });
  });

  return {candidates, warnings};
}

function imageDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return null;

  // PNG: the image dimensions are stored directly in the IHDR header.
  if (buffer.length >= 24
    && buffer[0] === 0x89
    && buffer.toString('ascii', 1, 4) === 'PNG'
    && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
  }

  // JPEG: scan for a Start Of Frame marker, which contains width and height.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return {width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3)};
      }
      offset += length;
    }
  }

  return null;
}

function uniqueOcrText(texts) {
  const seen = new Set();
  const lines = [];
  texts.forEach(text => {
    String(text || '').split(/\r?\n/).forEach(raw => {
      const line = cleanText(raw, 320);
      const key = normaliseKey(line);
      if (!key || seen.has(key)) return;
      seen.add(key);
      lines.push(line);
    });
  });
  return cleanText(lines.join('\n'), MAX_TEXT_LENGTH);
}

function needsMarketingOcr(text) {
  const lines = cleanText(text, MAX_TEXT_LENGTH)
    .split(/\r?\n/)
    .map(line => cleanText(line, 260))
    .filter(Boolean);
  return !lines.some(priceFromLine) || !lines.some(line => titleScore(line) >= 7);
}

function rectangleFromRatio(dimensions, {left, top, width, height}) {
  if (!dimensions?.width || !dimensions?.height) return null;
  const x = Math.max(0, Math.floor(dimensions.width * left));
  const y = Math.max(0, Math.floor(dimensions.height * top));
  const right = Math.min(dimensions.width, Math.ceil(dimensions.width * (left + width)));
  const bottom = Math.min(dimensions.height, Math.ceil(dimensions.height * (top + height)));
  if (right - x < 20 || bottom - y < 20) return null;
  return {left: x, top: y, width: right - x, height: bottom - y};
}

function recogniseImage(buffer) {
  const work = async () => {
    const worker = await createWorker(vietnameseData.code, 1, {
      langPath: vietnameseData.langPath,
      gzip: vietnameseData.gzip,
      cacheMethod: 'none'
    });
    try {
      const recognise = async (mode, rectangle = null) => {
        await worker.setParameters({tessedit_pageseg_mode: mode});
        const result = await worker.recognize(buffer, rectangle ? {rectangle} : {});
        return result.data.text || '';
      };

      // Posters usually combine a large product photo with small information blocks.
      // Start with the complete artwork, then inspect the right-side information panel
      // only when the first pass does not find both a sellable title and a price.
      const texts = [await recognise(PSM.AUTO)];
      const dimensions = imageDimensions(buffer);
      if (needsMarketingOcr(texts[0]) && dimensions) {
        const informationPanel = rectangleFromRatio(dimensions, {
          left: .50, top: .10, width: .50, height: .84
        });
        if (informationPanel) texts.push(await recognise(PSM.SPARSE_TEXT, informationPanel));

        const merged = uniqueOcrText(texts);
        if (!merged.split(/\r?\n/).some(priceFromLine)) {
          const pricePanel = rectangleFromRatio(dimensions, {
            left: .50, top: .68, width: .50, height: .27
          });
          if (pricePanel) texts.push(await recognise(PSM.SINGLE_BLOCK, pricePanel));
        }
      }
      return uniqueOcrText(texts);
    } finally {
      await worker.terminate();
    }
  };
  const queued = ocrQueue.then(work, work);
  ocrQueue = queued.catch(() => undefined);
  return queued;
}

async function textFromPdf(buffer) {
  const parser = new PDFParse({data: new Uint8Array(buffer)});
  try {
    const result = await parser.getText({first: MAX_PDF_PAGES});
    let text = cleanText(result.text, MAX_TEXT_LENGTH);
    let usedOcr = false;
    if (text.replace(/\s/g, '').length < 20) {
      const screenshots = await parser.getScreenshot({first: Math.min(MAX_PDF_PAGES, 2), desiredWidth: 1500, imageDataUrl: false, imageBuffer: true});
      const pages = screenshots.pages || [];
      const pageText = [];
      for (const page of pages) {
        if (page.data?.length) pageText.push(await recogniseImage(page.data));
      }
      text = cleanText(pageText.join('\n'), MAX_TEXT_LENGTH);
      usedOcr = true;
    }
    return {text, usedOcr};
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function kindFromFile(filename, mimeType) {
  const extension = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (['xlsx', 'xls', 'csv'].includes(extension) || /(?:spreadsheet|excel|csv)/i.test(mimeType || '')) return 'excel';
  if (extension === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension) || /^image\/(?:png|jpeg|webp|gif)$/i.test(mimeType || '')) return 'image';
  return '';
}

async function analyseProductFile({filename, mimeType, buffer}) {
  const kind = kindFromFile(filename, mimeType);
  if (!kind) throw new Error('Chỉ hỗ trợ Excel (.xlsx, .xls, .csv), PDF hoặc ảnh PNG/JPG/WEBP/GIF.');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Tệp tải lên không hợp lệ.');

  if (kind === 'excel') {
    const result = candidatesFromSpreadsheet(buffer, filename);
    return {
      kind,
      candidates: result.candidates,
      warnings: result.warnings,
      textPreview: '',
      usedOcr: false
    };
  }

  const result = kind === 'pdf'
    ? await textFromPdf(buffer)
    : {text: await recogniseImage(buffer), usedOcr: true};
  const candidates = candidatesFromText(result.text, kind);
  const warnings = [];
  if (result.usedOcr) warnings.push('Dữ liệu được nhận diện từ ảnh/OCR. Hãy kiểm tra cẩn thận trước khi nhập.');
  if (!candidates.length) warnings.push('Chưa tách được sản phẩm có giá bán. Bạn có thể thử file rõ nét hơn hoặc dùng Excel.');
  return {
    kind,
    candidates,
    warnings,
    textPreview: cleanText(result.text, 2500),
    usedOcr: result.usedOcr
  };
}

module.exports = {analyseProductFile, kindFromFile};

/*
 * Dán mã này vào Apps Script gắn với Google Sheet nhận đơn hàng.
 * Sau đó triển khai Web App: Execute as Me, Who has access: Anyone.
 */

const ORDER_SHEET_NAME = 'Dữ liệu khách hàng';
const ORDER_HEADERS = [
  'Thời gian nhận',
  'Mã đơn hàng',
  'Mã khách hàng',
  'Họ và tên',
  'Số điện thoại',
  'Email',
  'Địa chỉ',
  'Lời nhắn',
  'Sản phẩm, mã sản phẩm, số lượng',
  'Đơn giá (VNĐ)',
  'Thành tiền (VNĐ)',
  'Tổng thanh toán (VNĐ)',
  'Ưu đãi'
];

function doGet() {
  return jsonOutput_({ok: true, service: 'AEON Mooncake order sync'});
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const data = requestData_(e);
    const orderCode = safeCell_(data.orderCode || (data.order && data.order.code));
    const customerName = safeCell_(data.customerName || (data.customer && data.customer.name));
    const phone = safeCell_(data.phone || (data.customer && data.customer.phone));
    if (!orderCode || !customerName || !phone) throw new Error('Thiếu mã đơn hàng, tên khách hàng hoặc số điện thoại.');

    const sheet = orderSheet_();
    ensureHeaders_(sheet);

    if (orderExists_(sheet, orderCode)) {
      return jsonOutput_({ok: true, duplicate: true, orderCode: orderCode});
    }

    const items = orderItems_(data);
    sheet.appendRow([
      new Date(),
      orderCode,
      safeCell_(data.customerId || (data.customer && data.customer.id)),
      customerName,
      phone,
      safeCell_(data.email || (data.customer && data.customer.email)),
      safeCell_(data.address || (data.customer && data.customer.address)),
      safeCell_(data.message || (data.customer && data.customer.message)),
      safeCell_(data.itemsText || items.map(function(item) {
        const code = item.code || item.sku || '';
        const quantity = item.quantity || item.qty || 1;
        return item.name + (item.variant ? ' – ' + item.variant : '') + (code ? ' | Mã: ' + code : '') + ' | SL: ' + quantity;
      }).join('\n')),
      safeCell_(data.unitPricesText || items.map(function(item) {
        return safeNumber_(item.unitPrice == null ? item.price : item.unitPrice);
      }).join('\n')),
      safeCell_(data.lineTotalsText || items.map(function(item) {
        const quantity = safeNumber_(item.quantity || item.qty || 1);
        const unitPrice = safeNumber_(item.unitPrice == null ? item.price : item.unitPrice);
        return safeNumber_(item.lineTotal == null ? quantity * unitPrice : item.lineTotal);
      }).join('\n')),
      safeNumber_(data.total || (data.order && data.order.total)),
      safeCell_(data.promotionText || data.promotion || (data.order && data.order.promotion))
    ]);
    const row = sheet.getLastRow();
    sheet.getRange(row, 1, 1, ORDER_HEADERS.length).setVerticalAlignment('top').setWrap(true);

    return jsonOutput_({ok: true, orderCode: orderCode, row: row});
  } catch (error) {
    return jsonOutput_({ok: false, status: 'error', message: String(error && error.message || error)});
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function requestData_(e) {
  const contents = e && e.postData && e.postData.contents ? e.postData.contents : '';
  if (contents) {
    try { return JSON.parse(contents); } catch (ignored) {}
  }
  const parameters = e && e.parameter ? e.parameter : {};
  if (parameters.payload) {
    try { return JSON.parse(parameters.payload); } catch (ignored) {}
  }
  return parameters;
}

function orderSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Apps Script cần được gắn với Google Sheet nhận dữ liệu.');
  return spreadsheet.getSheetByName(ORDER_SHEET_NAME) || spreadsheet.insertSheet(ORDER_SHEET_NAME);
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) sheet.appendRow(ORDER_HEADERS);
  const headerRange = sheet.getRange(1, 1, 1, ORDER_HEADERS.length);
  headerRange.setValues([ORDER_HEADERS]).setFontWeight('bold').setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, ORDER_HEADERS.length, 150);
  sheet.setColumnWidth(4, 210);
  sheet.setColumnWidth(7, 300);
  sheet.setColumnWidth(8, 260);
  sheet.setColumnWidth(9, 440);
  sheet.setColumnWidth(13, 240);
}

function orderExists_(sheet, orderCode) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  return sheet.getRange(2, 2, lastRow - 1, 1).getDisplayValues().some(function(row) {
    return String(row[0]) === String(orderCode);
  });
}

function orderItems_(data) {
  if (data.order && Array.isArray(data.order.items)) return data.order.items;
  if (Array.isArray(data.items)) return data.items;
  if (data.itemsJson) {
    try { return JSON.parse(data.itemsJson); } catch (ignored) {}
  }
  return [];
}

function safeCell_(value) {
  const text = String(value == null ? '' : value).trim();
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function safeNumber_(value) {
  const number = Number(value);
  return isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function jsonOutput_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

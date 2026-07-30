const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {analyseProductFile, kindFromFile} = require('./product-import');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8080);
const root = path.resolve(process.cwd());
const uploadDir = path.join(root, 'assets', 'uploads');
const statePath = path.join(root, '.aeon-store.json');
const maxUploadBytes = 10 * 1024 * 1024;
const maxImportBytes = 15 * 1024 * 1024;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.pdf':'application/pdf','.csv':'text/csv; charset=utf-8','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.xls':'application/vnd.ms-excel'};
const imageExtensions = {'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif'};
fs.mkdirSync(uploadDir, {recursive:true});

function json(response, status, body) { response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); response.end(JSON.stringify(body)); }
function readBody(request, maxBytes = maxUploadBytes) { return new Promise((resolve, reject) => { let size = 0; const chunks = []; const maxRequestBytes = Math.ceil(maxBytes * 1.38) + 65536; request.on('data', chunk => { size += chunk.length; if (size > maxRequestBytes) { reject(new Error(`Tệp vượt quá dung lượng cho phép (${Math.round(maxBytes / 1024 / 1024)} MB).`)); request.destroy(); return; } chunks.push(chunk); }); request.on('end', () => resolve(Buffer.concat(chunks))); request.on('error', reject); }); }
function readState() { try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return {}; } }
function writeState(state) { const temporary = `${statePath}.tmp`; fs.writeFileSync(temporary, JSON.stringify(state, null, 2)); fs.renameSync(temporary, statePath); }

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

http.createServer(async (request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname); }
  catch { response.writeHead(400); return response.end('Bad request'); }

  if (request.method === 'GET' && pathname === '/api/state') return json(response, 200, readState());
  if (request.method === 'POST' && pathname === '/api/state') {
    try {
      const {key, value} = JSON.parse((await readBody(request)).toString('utf8'));
      const allowedKeys = new Set(['aeon-products','aeon-ui','aeon-layout','aeon-customers','aeon-orders']);
      if (!allowedKeys.has(key)) return json(response, 400, {error:'Không thể lưu loại dữ liệu này.'});
      const state = readState(); state[key] = value; writeState(state); return json(response, 200, {ok:true});
    } catch (error) { return json(response, 400, {error:error.message || 'Không thể lưu dữ liệu.'}); }
  }

  if (request.method === 'POST' && pathname === '/api/upload') {
    try {
      const body = JSON.parse((await readBody(request)).toString('utf8'));
      const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl || '');
      if (!match) return json(response, 400, {error:'Chỉ hỗ trợ ảnh PNG, JPG, WEBP hoặc GIF.'});
      const content = Buffer.from(match[2], 'base64');
      if (!content.length || content.length > maxUploadBytes) return json(response, 413, {error:'Ảnh phải nhỏ hơn hoặc bằng 10 MB.'});
      const requestedName = path.basename(String(body.filename || 'image'));
      const base = path.basename(requestedName, path.extname(requestedName)).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'image';
      const filename = `${Date.now()}-${base}${imageExtensions[match[1]]}`;
      fs.writeFileSync(path.join(uploadDir, filename), content, {flag:'wx'});
      return json(response, 201, {url:`/assets/uploads/${filename}`});
    } catch (error) { return json(response, 400, {error:error.message || 'Không thể tải ảnh lên.'}); }
  }

  if (request.method === 'POST' && pathname === '/api/import-products') {
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
  fs.readFile(filePath, (error, content) => {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500, {'Content-Type':'text/plain; charset=utf-8'}); return response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error'); }
    response.writeHead(200, {'Content-Type':types[path.extname(filePath).toLowerCase()] || 'application/octet-stream','Cache-Control':'no-store'});
    response.end(content);
  });
}).listen(port, host, () => console.log(`AEON Mooncake is available on http://${host}:${port}`));

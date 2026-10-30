'use strict';
// 로컬 서버: 설정 화면(input.html), OBS 오버레이(output.html), 설정/이미지 API, 오버레이로 채팅을 보내는 웹소켓.
// 이 PC 안에서만 접근할 수 있게 127.0.0.1에서만 열고, Host/Origin 검사로 다른 사이트의 접근을 막습니다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Store } = require('./store');
const { ChatHub } = require('./chat-hub');
const Lite = require('../../public/lib/common');
const APP = require('./app-info');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function hostName(hostHeader) {
  const h = String(hostHeader || '');
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

function looksLikeImage(name, buf) {
  const ext = name.split('.').pop().toLowerCase();
  const head = buf.subarray(0, 16);
  if (ext === 'png') return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === 'jpg' || ext === 'jpeg') return head[0] === 0xff && head[1] === 0xd8;
  if (ext === 'gif') return head.subarray(0, 3).toString('latin1') === 'GIF';
  if (ext === 'webp') return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
  if (ext === 'svg') return /<svg[\s>]/i.test(buf.toString('utf8')) && !/<script|javascript:|\son\w+\s*=|<foreignObject/i.test(buf.toString('utf8'));
  return false;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers || {}));
  res.end(body);
}
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
const sendText = (res, status, text) => send(res, status, text, { 'Content-Type': 'text/plain; charset=utf-8' });

async function startServer(options = {}) {
  if (!options.dataDir) throw new Error('dataDir이 필요합니다.');
  const store = new Store(options.dataDir).init();
  const hub = new ChatHub({ chatOptions: options.chatOptions });
  const clients = new Set();
  let actualPort = 0;

  function broadcast(obj) {
    const text = JSON.stringify(obj);
    for (const ws of clients) if (ws.readyState === 1) ws.send(text);
  }
  hub.on('chat', (ev) => broadcast({ type: 'chat', msg: ev }));
  hub.on('status', (s) => broadcast({ type: 'status', status: s }));

  // 탐색기에서 이미지를 다른 폴더로 옮긴 경우 명령어가 가리키는 경로를 자동으로 고치고, 오버레이에도 알립니다.
  function relink() {
    if (store.relinkCommands()) broadcast({ type: 'config', config: store.config });
  }

  function state(req) {
    const host = req.headers.host;
    relink();
    return {
      app: APP.ID,
      config: store.config,
      images: store.listImages(),
      folders: store.listFolders(),
      status: hub.status,
      recent: hub.recent.slice(-10),
      dataDir: store.dataDir,
      urls: { overlay: `http://${host}/output.html` },
      canOpenFolder: typeof options.openFolder === 'function'
    };
  }

  async function api(req, res, url) {
    const p = url.pathname;
    if (p === '/api/state' && req.method === 'GET') return sendJson(res, 200, state(req));

    if (p === '/api/config' && req.method === 'PUT') {
      let body;
      try { body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8')); } catch (e) { return sendJson(res, e.status || 400, { error: '설정 형식이 올바르지 않습니다.' }); }
      const cfg = store.save(body);
      hub.apply(cfg);
      broadcast({ type: 'config', config: cfg });
      return sendJson(res, 200, cfg);
    }

    if (p === '/api/images' && req.method === 'POST') {
      const name = String(url.searchParams.get('name') || '');
      const tag = String(url.searchParams.get('tag') || '');
      let buf;
      try { buf = await readBody(req, MAX_IMAGE_BYTES); } catch (e) { return sendJson(res, e.status || 400, { error: '이미지가 너무 큽니다 (5MB까지).' }); }
      if (!Lite.IMAGE_FILE_RE.test(name) || !Lite.validSegment(name)) return sendJson(res, 400, { error: '파일 이름에는 / \\ : * ? " < > | 를 쓸 수 없고, png, jpg, gif, webp, svg 형식이어야 합니다.' });
      if (Lite.splitTag(tag) === null) return sendJson(res, 400, { error: '태그 이름이 올바르지 않습니다. 폴더 이름에는 / \\ : * ? " < > | 를 쓸 수 없고, 3단계까지 만들 수 있습니다.' });
      if (!buf.length || !looksLikeImage(name, buf)) return sendJson(res, 400, { error: '이미지 파일이 아니거나 안전하지 않은 내용이 들어 있습니다.' });
      const saved = store.saveImage(name, buf, tag);
      return sendJson(res, 200, { path: saved, images: store.listImages(), folders: store.listFolders() });
    }

    // 이미지의 태그(폴더) 바꾸기: 파일을 옮기고 새 경로를 돌려줍니다. (명령어 연결은 화면에서 새 경로로 바꿉니다.)
    if (p === '/api/images/move' && req.method === 'POST') {
      let body;
      try { body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')); } catch { return sendJson(res, 400, { error: '요청 형식이 올바르지 않습니다.' }); }
      try {
        const moved = store.moveImage(String(body.path || ''), String(body.tag || ''));
        return sendJson(res, 200, { path: moved, images: store.listImages(), folders: store.listFolders() });
      } catch (e) { return sendJson(res, 400, { error: e.message }); }
    }

    if (p.startsWith('/api/images/') && req.method === 'DELETE') {
      let name;
      try { name = decodeURIComponent(p.slice('/api/images/'.length)); } catch { return sendJson(res, 400, { error: '잘못된 파일 이름입니다.' }); }
      try { store.deleteImage(name); } catch (e) { return sendJson(res, 400, { error: e.message }); }
      return sendJson(res, 200, { images: store.listImages(), folders: store.listFolders() });
    }

    // OBS 스크립트가 OBS를 끌 때 앱도 같이 끄기 위한 종료 요청 (같은 PC에서, 전용 헤더가 있을 때만 허용됨)
    if (p === '/api/quit' && req.method === 'POST') {
      sendJson(res, 200, { ok: true });
      if (typeof options.onQuit === 'function') setTimeout(() => options.onQuit(), 100);
      return;
    }

    if (p === '/api/open-data-folder' && req.method === 'POST') {
      if (typeof options.openFolder !== 'function') return sendJson(res, 200, { opened: false, dataDir: store.dataDir });
      await options.openFolder(store.dataDir);
      return sendJson(res, 200, { opened: true });
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  function serveFile(req, res, file, extraHeaders) {
    fs.readFile(file, (err, data) => {
      if (err) return sendText(res, 404, 'not found');
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      send(res, 200, req.method === 'HEAD' ? '' : data, Object.assign({ 'Content-Type': type }, extraHeaders || {}));
    });
  }

  async function handle(req, res) {
    if (!ALLOWED_HOSTS.has(hostName(req.headers.host))) return sendText(res, 403, 'forbidden host');
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try { ok = new URL(origin).host === req.headers.host; } catch { ok = false; }
        if (!ok) return sendText(res, 403, 'forbidden origin');
      }
      if (p.startsWith('/api/') && req.headers['x-requested-with'] !== 'app') return sendText(res, 403, 'missing header');
    }

    if (p === '/') { res.writeHead(302, { Location: '/input.html' }); return res.end(); }
    if (p.startsWith('/api/')) return api(req, res, url);

    if (p.startsWith('/images/')) {
      let name;
      try { name = decodeURIComponent(p.slice('/images/'.length)); } catch { return sendText(res, 400, 'bad request'); }
      const file = store.imagePath(name);
      if (!file) return sendText(res, 404, 'not found');
      // 업로드된 SVG 안의 스크립트가 실행되지 않도록 샌드박스
      return serveFile(req, res, file, { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'method not allowed');
    if (p === '/input.html' || p === '/output.html' || p.startsWith('/lib/')) {
      const file = path.normalize(path.join(PUBLIC, p));
      if (!file.startsWith(path.join(PUBLIC, path.sep))) return sendText(res, 403, 'forbidden');
      return serveFile(req, res, file);
    }
    return sendText(res, 404, 'not found');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => { console.error('[server]', e); if (!res.headersSent) sendText(res, 500, 'server error'); });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    let ok = false;
    try {
      const u = new URL(req.url, 'http://localhost');
      const originOk = !req.headers.origin || new URL(req.headers.origin).host === req.headers.host;
      ok = u.pathname === '/ws' && ALLOWED_HOSTS.has(hostName(req.headers.host)) && originOk;
    } catch { ok = false; }
    if (!ok) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
      ws.send(JSON.stringify({ type: 'config', config: store.config }));
      ws.send(JSON.stringify({ type: 'status', status: hub.status }));
      ws.send(JSON.stringify({ type: 'recent', list: hub.recent.slice(-10) }));
    });
  });

  // 기본 포트가 사용 중이면 다음 번호를 시도
  const host = options.host || '127.0.0.1';
  const basePort = options.port === undefined ? 3939 : options.port;
  async function listen(port) {
    return new Promise((resolve, reject) => {
      const onError = (e) => { server.removeListener('listening', onListening); reject(e); };
      const onListening = () => { server.removeListener('error', onError); resolve(); };
      server.once('error', onError); server.once('listening', onListening);
      server.listen(port, host);
    });
  }
  let lastErr;
  for (let i = 0; i < (basePort === 0 ? 1 : 20); i++) {
    try { await listen(basePort === 0 ? 0 : basePort + i); lastErr = null; break; }
    catch (e) { lastErr = e; if (e.code !== 'EADDRINUSE') break; }
  }
  if (lastErr) throw lastErr;
  actualPort = server.address().port;

  store.relinkCommands();
  hub.apply(store.config); // 저장된 채널이 있으면 바로 접속 시작

  // 실행 상태 파일: 5초마다 갱신해서, OBS 스크립트가 "지금 켜져 있는지"를 파일만 읽고 알 수 있게 함
  const runtimeFile = path.join(store.dataDir, 'runtime.json');
  const startedAt = Math.floor(Date.now() / 1000);
  function writeRuntime() {
    try {
      fs.writeFileSync(runtimeFile, JSON.stringify({ app: APP.ID, port: actualPort, pid: process.pid, startedAt, updatedAt: Math.floor(Date.now() / 1000) }));
    } catch { /* 쓸 수 없으면 건너뜀 */ }
  }
  writeRuntime();
  const runtimeTimer = setInterval(writeRuntime, 5000);
  runtimeTimer.unref();

  return {
    server, store, hub, port: actualPort,
    url: `http://localhost:${actualPort}`,
    close: async () => {
      clearInterval(runtimeTimer);
      try { fs.unlinkSync(runtimeFile); } catch { /* 이미 없음 */ }
      hub.stop();
      for (const ws of clients) ws.terminate();
      const closed = new Promise((r) => server.close(r));
      if (server.closeAllConnections) server.closeAllConnections();
      await closed;
    }
  };
}

module.exports = { startServer };

'use strict';
// 새 버전 확인: 버전 비교, GitHub 응답 읽기, 서버에서의 주기적 확인과 끄기를 시험합니다. (가짜 GitHub 서버 사용)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const U = require('../src/server/update-check');
const { startServer } = require('../src/server/server');

async function waitFor(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 15)); }
  throw new Error('시간 안에 조건이 맞지 않았습니다');
}
const H = { 'X-Requested-With': 'app' };

test('버전 비교: 숫자로 비교한다 (0.4.10은 0.4.9보다 새 버전)', () => {
  assert.ok(U.compareVersions('0.4.10', '0.4.9') > 0);
  assert.ok(U.compareVersions('v0.5.0', '0.4.99') > 0);
  assert.ok(U.compareVersions('1.0.0', '0.99.99') > 0);
  assert.equal(U.compareVersions('v0.4.8', '0.4.8'), 0);
  assert.ok(U.compareVersions('0.4.7', '0.4.8') < 0);
  assert.equal(U.compareVersions('abc', '0.4.8'), null);
  assert.equal(U.compareVersions(null, undefined), null);
  assert.deepEqual(U.parseVersion('v1.2.3-beta'), [1, 2, 3]);
});

test('GitHub 응답 읽기: 초안, 사전 릴리스, 이상한 응답은 무시하고 안내 주소는 이 저장소의 Release로 제한한다', () => {
  const ok = U.parseLatest({ tag_name: 'v0.4.9', html_url: U.RELEASES_URL + '/tag/v0.4.9' });
  assert.deepEqual(ok, { latest: '0.4.9', url: U.RELEASES_URL + '/tag/v0.4.9' });
  assert.equal(U.parseLatest({ tag_name: 'v0.4.9', draft: true }), null);
  assert.equal(U.parseLatest({ tag_name: 'v0.4.9', prerelease: true }), null);
  assert.equal(U.parseLatest({ tag_name: '최신' }), null);
  assert.equal(U.parseLatest(null), null);
  assert.equal(U.parseLatest('x'), null);
  assert.equal(U.parseLatest({ tag_name: 'v0.4.9', html_url: 'https://evil.example/download' }).url, U.RELEASES_URL, '다른 주소는 쓰지 않는다');
  assert.equal(U.parseLatest({ tag_name: 'v0.4.9', html_url: U.RELEASES_URL + '/x" onclick="a' }).url, U.RELEASES_URL);
  assert.ok(U.DEFAULT_API.startsWith('https://api.github.com/repos/rakuri357/ChzzkCCP/'), '확인하는 저장소');
});

function fakeGithub(tag, opts = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, ua: req.headers['user-agent'], cookie: req.headers.cookie, auth: req.headers.authorization });
    if (opts.status) { res.writeHead(opts.status); res.end('{}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tag_name: tag, html_url: U.RELEASES_URL + '/tag/' + tag }));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ hits, api: `http://127.0.0.1:${server.address().port}/repos/x/releases/latest`, close: () => new Promise((c) => { server.close(c); if (server.closeAllConnections) server.closeAllConnections(); }) })));
}

test('최신 릴리스 조회: 새 버전이면 newer, 같거나 오래되면 아니고, 실패하면 던진다', async (t) => {
  const gh = await fakeGithub('v0.4.9'); t.after(gh.close);
  const r = await U.checkLatest({ apiUrl: gh.api, current: '0.4.8' });
  assert.deepEqual({ latest: r.latest, newer: r.newer, current: r.current }, { latest: '0.4.9', newer: true, current: '0.4.8' });
  assert.equal((await U.checkLatest({ apiUrl: gh.api, current: '0.4.9' })).newer, false);
  assert.equal((await U.checkLatest({ apiUrl: gh.api, current: '0.5.0' })).newer, false);
  assert.ok(/ChzzkChatConPlus\/0\.4\.8/.test(gh.hits[0].ua), '앱 이름과 버전만 알린다');
  assert.equal(gh.hits[0].cookie, undefined);
  assert.equal(gh.hits[0].auth, undefined);
  const bad = await fakeGithub('v0.4.9', { status: 500 }); t.after(bad.close);
  await assert.rejects(U.checkLatest({ apiUrl: bad.api, current: '0.4.8' }));
  await assert.rejects(U.checkLatest({ apiUrl: 'http://127.0.0.1:1/x', current: '0.4.8', timeoutMs: 500 }));
});

async function startWith(t, gh, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const app = await startServer(Object.assign({ dataDir: dir, port: 0, appVersion: '0.4.8', updateApiUrl: gh.api, updateFirstDelayMs: 20, updateIntervalMs: 100000 }, extra));
  t.after(() => app.close());
  return app;
}
const getState = async (app) => JSON.parse(await (await fetch(`http://127.0.0.1:${app.port}/api/state`, { headers: H })).text());

test('앱을 켜면 새 버전을 확인해서 상태와 설정 창에 알린다', async (t) => {
  const gh = await fakeGithub('v0.4.9'); t.after(gh.close);
  const app = await startWith(t, gh);
  const got = [];
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  await waitFor(() => got.find((m) => m.type === 'update'));
  const u = got.find((m) => m.type === 'update').update;
  assert.equal(u.latest, '0.4.9'); assert.equal(u.newer, true); assert.equal(u.current, '0.4.8');
  const st = await getState(app);
  assert.equal(st.update.latest, '0.4.9');
  assert.equal(st.version, '0.4.8');
  ws.close();
});

test('새 버전 알림을 끄면 GitHub에 요청하지 않고, 다시 켜면 바로 확인한다', async (t) => {
  const gh = await fakeGithub('v0.4.9'); t.after(gh.close);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd2-'));
  const first = await startServer({ dataDir: dir, port: 0, appVersion: '0.4.8', updateApiUrl: gh.api, updateFirstDelayMs: 1000000 });
  const st0 = await getState(first);
  const put = (cfg) => fetch(`http://127.0.0.1:${first.port}/api/config`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
  await put({ ...st0.config, ui: { ...st0.config.ui, updateCheck: false } });
  await first.close();
  const app = await startServer({ dataDir: dir, port: 0, appVersion: '0.4.8', updateApiUrl: gh.api, updateFirstDelayMs: 20 });
  t.after(() => app.close());
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(gh.hits.length, 0, '꺼 두면 요청하지 않는다');
  assert.equal((await getState(app)).update, null);
  const st = await getState(app);
  await put2(app, { ...st.config, ui: { ...st.config.ui, updateCheck: true } });
  await waitFor(() => gh.hits.length === 1);
  async function put2(a, cfg) { return fetch(`http://127.0.0.1:${a.port}/api/config`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }); }
});

test('확인에 실패해도 앱은 평소처럼 동작한다', async (t) => {
  const bad = await fakeGithub('v0.4.9', { status: 500 }); t.after(bad.close);
  const app = await startWith(t, bad);
  await waitFor(() => bad.hits.length >= 1);
  const st = await getState(app);
  assert.equal(st.update, null);
  assert.equal(st.app, 'chzzkchatconplus');
});

test('설정: 새 버전 알림은 기본으로 켜져 있고, 다시 알리지 않기로 한 버전은 숫자와 점만 저장한다', () => {
  const L = require('../public/lib/common');
  assert.equal(L.normalizeConfig(null).ui.updateCheck, true);
  assert.equal(L.normalizeConfig({ ui: { updateCheck: false } }).ui.updateCheck, false);
  assert.equal(L.normalizeConfig(null).ui.updateDismissed, '');
  assert.equal(L.normalizeConfig({ ui: { updateDismissed: '0.4.9' } }).ui.updateDismissed, '0.4.9');
  assert.equal(L.normalizeConfig({ ui: { updateDismissed: '<b>0.4.9</b>' } }).ui.updateDismissed, '0.4.9');
});

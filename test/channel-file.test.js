'use strict';
// 채널 정보(주소, 채팅창 열쇠)를 config.json과 따로 channel.json에 저장하는지, 예전 설정을 안전하게 옮기는지, 오버레이에는 보내지 않는지 시험합니다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { Store } = require('../src/server/store');
const { startServer } = require('../src/server/server');
const L = require('../public/lib/common');

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const CH = '0123456789abcdef0123456789abcdef';
const H = { 'X-Requested-With': 'app' };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

test('저장: 채널 정보는 channel.json에, 나머지 설정은 config.json에 저장한다', () => {
  const dir = tmp('chf1-');
  const store = new Store(dir).init();
  assert.ok(!fs.existsSync(path.join(dir, 'channel.json')), '채널 정보가 비어 있으면 파일을 만들지 않는다');
  store.save({ channel: { url: `https://chzzk.naver.com/chat/${KEY}` }, overlay: { fontSize: 30 } });
  assert.deepEqual(read(dir, 'channel.json'), { url: `https://chzzk.naver.com/chat/${KEY}`, channelId: '', chatKey: KEY });
  const cfg = read(dir, 'config.json');
  assert.ok(!('channel' in cfg), 'config.json에는 채널 정보가 없다');
  assert.ok(!JSON.stringify(cfg).includes(KEY), '열쇠가 config.json 어디에도 없다');
  assert.equal(cfg.overlay.fontSize, 30);
  // 다시 읽으면 합쳐진다
  const again = new Store(dir).init();
  assert.equal(again.config.channel.chatKey, KEY);
  assert.equal(again.config.overlay.fontSize, 30);
});

test('이전: 예전 config.json 안의 채널 정보를 channel.json으로 옮기고 옛 파일에서 지운다', () => {
  const dir = tmp('chf2-');
  fs.mkdirSync(dir, { recursive: true });
  const old = L.normalizeConfig({ channel: { url: `https://chzzk.naver.com/${CH}` }, overlay: { fontSize: 33 } });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(old, null, 2));   // 예전 모양: channel이 config.json 안에 있음
  assert.ok('channel' in read(dir, 'config.json'));
  const store = new Store(dir).init();
  assert.equal(store.config.channel.channelId, CH, '메모리에서는 그대로 쓸 수 있다');
  assert.equal(read(dir, 'channel.json').channelId, CH);
  assert.ok(!('channel' in read(dir, 'config.json')), '옛 파일에서는 지운다');
  assert.equal(read(dir, 'config.json').overlay.fontSize, 33, '다른 설정은 그대로');
  // 두 번째로 켜도 그대로
  const again = new Store(dir).init();
  assert.equal(again.config.channel.channelId, CH);
});

test('이전: 채널 정보가 비어 있으면 channel.json을 만들지 않고, channel.json이 이미 있으면 덮어쓰지 않는다', () => {
  const dir = tmp('chf3-');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ ...L.normalizeConfig(null), channel: { url: '', channelId: '', chatKey: '' } }));
  new Store(dir).init();
  assert.ok(!fs.existsSync(path.join(dir, 'channel.json')));
  const dir2 = tmp('chf4-');
  fs.writeFileSync(path.join(dir2, 'channel.json'), JSON.stringify({ url: `https://chzzk.naver.com/${CH}`, channelId: CH, chatKey: '' }));
  fs.writeFileSync(path.join(dir2, 'config.json'), JSON.stringify({ ...L.normalizeConfig(null), channel: { url: 'https://chzzk.naver.com/chat/' + KEY, channelId: '', chatKey: KEY } }));
  const store = new Store(dir2).init();
  assert.equal(store.config.channel.channelId, CH, '이미 있는 channel.json이 우선');
  assert.equal(read(dir2, 'channel.json').channelId, CH, '덮어쓰지 않음');
  assert.ok(!JSON.stringify(read(dir2, 'config.json')).includes(KEY), '옛 파일의 열쇠는 지운다');
});

test('config.json을 지워도 채널 정보는 남고, channel.json이 깨져도 앱은 시작한다', () => {
  const dir = tmp('chf5-');
  new Store(dir).init().save({ channel: { url: `https://chzzk.naver.com/${CH}` } });
  fs.rmSync(path.join(dir, 'config.json'));
  const store = new Store(dir).init();
  assert.equal(store.config.channel.channelId, CH, '설정만 처음으로 되돌려도 채널은 유지');
  fs.writeFileSync(path.join(dir, 'channel.json'), '{깨짐');
  const broken = new Store(dir).init();
  assert.equal(broken.config.channel.channelId, '');
  assert.ok(broken.config.overlay.fontSize > 0, '나머지 설정은 정상');
});

test('저장 중간에 멈춰도 정보를 잃지 않는다: 임시 파일을 쓴 뒤 교체한다', () => {
  const dir = tmp('chf6-');
  const store = new Store(dir).init();
  store.save({ channel: { url: `https://chzzk.naver.com/${CH}` } });
  assert.ok(!fs.existsSync(path.join(dir, 'channel.json.tmp')) && !fs.existsSync(path.join(dir, 'config.json.tmp')), '임시 파일이 남지 않는다');
});

test('publicConfig: 오버레이에 보내는 설정에서는 채널 정보가 빠진다 (원본은 바뀌지 않음)', () => {
  const cfg = L.normalizeConfig({ channel: { url: `https://chzzk.naver.com/chat/${KEY}` } });
  const pub = L.publicConfig(cfg);
  assert.deepEqual(pub.channel, { url: '', channelId: '', chatKey: '' });
  assert.ok(!JSON.stringify(pub).includes(KEY));
  assert.equal(cfg.channel.chatKey, KEY);
  assert.equal(pub.overlay.fontSize, cfg.overlay.fontSize);
});

test('앱: 오버레이용 주소와 웹소켓에는 채널 정보가 없고, 설정 창용에는 있다', async (t) => {
  const dir = tmp('chf7-');
  const app = await startServer({ dataDir: dir, port: 0, updateFirstDelayMs: 1e9, chatOptions: { apiBase: 'http://127.0.0.1:1', commApiBase: 'http://127.0.0.1:1', retryBaseSec: 30, watchMs: 0 } });
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}`;
  const st = await (await fetch(base + '/api/state')).json();
  await fetch(base + '/api/config', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...st.config, channel: { url: `https://chzzk.naver.com/chat/${KEY}` } }) });
  const forSettings = await (await fetch(base + '/api/state')).text();
  const forOverlay = await (await fetch(base + '/api/state?overlay=1')).text();
  assert.ok(forSettings.includes(KEY), '설정 창은 주소를 보여야 한다');
  assert.ok(!forOverlay.includes(KEY), '오버레이용에는 열쇠가 없다');
  assert.ok(!forOverlay.includes('chzzk.naver.com'), '오버레이용에는 주소도 없다');
  const got = [];
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
  ws.on('message', (d) => got.push(d.toString()));
  await new Promise((r) => ws.on('open', r));
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(got.some((m) => JSON.parse(m).type === 'config'));
  assert.ok(!got.join('').includes(KEY), '웹소켓으로 보내는 설정에도 열쇠가 없다');
  ws.close();
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'channel.json'), 'utf8')).chatKey === KEY);
});

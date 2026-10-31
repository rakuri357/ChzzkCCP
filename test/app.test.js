'use strict';
// 서버 전체 흐름: 가짜 치지직 서버 ←(앱이 접속)→ 서버 ←(웹소켓)→ 오버레이/설정 화면, 그리고 설정/이미지 API와 보안.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { startServer } = require('../src/server/server');
const { startFakeChzzk, WIDGET_KEY } = require('./fake-chzzk');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error('waitFor 시간 초과'); await sleep(25); }
}
const CH = '0123456789abcdef0123456789abcdef';  // 시험용 가짜 채널 ID
const H = { 'X-Requested-With': 'app' };
// ---------- 시험 도구 ----------
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
const upload = (port, name, tag) => req(port, 'POST', '/api/images?name=' + encodeURIComponent(name) + (tag === undefined ? '' : '&tag=' + encodeURIComponent(tag)),
  { headers: { ...H, 'Content-Type': 'application/octet-stream' }, body: PNG });
const getState = async (port) => JSON.parse((await req(port, 'GET', '/api/state')).text);
const json = (r) => JSON.parse(r.text);



function req(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      const c = []; res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(c).toString(), buf: Buffer.concat(c) }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const putConfig = (port, cfg) => req(port, 'PUT', '/api/config', { headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });

test('첫 실행은 빈 상태로 시작하고, 설정 저장, 치지직 접속과 채팅 전달이 된다', async (t) => {
  const fake = await startFakeChzzk();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));
  const app = await startServer({ dataDir: dir, port: 0, chatOptions: { apiBase: fake.base, commApiBase: fake.base, wsUrl: fake.wsUrl, handshakeMs: 800, retryBaseSec: 0.1 } });
  t.after(async () => { await app.close(); await fake.close(); });

  // 첫 실행: 샘플 이미지도 명령어도 없음
  assert.ok(fs.existsSync(path.join(dir, 'config.json')));
  assert.deepEqual(fs.readdirSync(path.join(dir, 'images')), []);
  const st0 = JSON.parse((await req(app.port, 'GET', '/api/state')).text);
  assert.deepEqual(st0.config.commands, []);
  assert.deepEqual(st0.images, []);
  assert.equal(st0.status.state, 'no-channel');
  assert.ok(st0.urls.overlay.endsWith('/output.html'));
  assert.equal(st0.config.overlay.imageHeight, '3em');
  assert.equal(st0.config.ui.autoCommand, true);
  // 채팅콘은 사용자가 직접 추가
  await upload(app.port, '감사.png', '');
  st0.config.commands = [{ triggers: ['~감사'], image: '감사.png', height: '', match: 'anywhere' }];

  // 오버레이/설정 화면 역할의 웹소켓 클라이언트
  const got = [];
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  await waitFor(() => got.find((m) => m.type === 'config') && got.find((m) => m.type === 'status'));

  // 채널 링크 저장 → 자동 접속
  const saved = await putConfig(app.port, { ...st0.config, channel: { url: `https://chzzk.naver.com/${CH}` }, hidden: { commands: ['!목록'], prefixes: [] } });
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).channel.channelId, CH);
  await waitFor(() => got.some((m) => m.type === 'status' && m.status.state === 'connected'));
  assert.equal(got.filter((m) => m.type === 'config').length, 2, '저장하면 오버레이에 새 설정이 전달됨');

  fake.emit({ msg: '안녕 ~감사', nick: '시청자' });
  const chat = await waitFor(() => got.find((m) => m.type === 'chat'));
  assert.equal(chat.msg.content, '안녕 ~감사');
  assert.equal(chat.msg.nickname, '시청자');
  assert.equal(chat.msg.subscriber, null, '구독 정보가 없는 채팅');
  // 구독자의 채팅: 구독 개월 수와 티어가 오버레이까지 전달됨
  fake.emit({ msg: '구독자입니다', nick: '구독자', uid: 'sub1', profile: { userIdHash: 'sub1', nickname: '구독자', userRoleCode: 'common_user', streamingProperty: { subscription: { accumulativeMonth: 7, tier: 1, badge: { imageUrl: 'https://ssl.pstatic.net/s.png' } } } } });
  const subChat = await waitFor(() => got.find((m) => m.type === 'chat' && m.msg.nickname === '구독자'));
  assert.deepEqual(subChat.msg.subscriber, { months: 7, tier: 1 });
  // 권한 설정은 저장되고 오버레이에 전달되는 설정에도 들어 있음
  const permSaved = JSON.parse((await putConfig(app.port, { ...JSON.parse(saved.text), permissions: { imageAccess: 'subscribers', tagAccess: 'all' } })).text);
  assert.equal(permSaved.permissions.imageAccess, 'subscribers');
  await waitFor(() => got.some((m) => m.type === 'config' && m.config.permissions.imageAccess === 'subscribers'));

  // 같은 설정을 다시 저장해도(스타일만 변경) 치지직에 다시 접속하지 않음
  const before = fake.state.connects.length;
  const cfg2 = JSON.parse(saved.text); cfg2.overlay.fontSize = 33;
  await putConfig(app.port, cfg2);
  await sleep(300);
  assert.equal(fake.state.connects.length, before);

  // 연결이 끊기면 상태가 알려지고 자동 복구
  fake.dropAll();
  await waitFor(() => got.some((m) => m.type === 'status' && m.status.state === 'retry'));
  await waitFor(() => got.filter((m) => m.type === 'status' && m.status.state === 'connected').length >= 2);
  ws.close();
});

test('이미지 올리기/지우기와 화면 파일 제공, 위험한 입력 차단', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app2-'));
  const app = await startServer({ dataDir: dir, port: 0 });
  t.after(() => app.close());
  const p = app.port;
  const up = (name, buf) => req(p, 'POST', '/api/images?name=' + encodeURIComponent(name), { headers: { ...H, 'Content-Type': 'application/octet-stream' }, body: buf });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);

  assert.equal((await up('식은땀.png', png)).status, 200);
  const dup = JSON.parse((await up('식은땀.png', png)).text);
  assert.equal(dup.path, '식은땀 (2).png', '같은 이름이면 번호를 붙임');
  assert.equal((await up('fake.png', Buffer.from('<html>'))).status, 400);
  assert.equal((await up('../evil.png', png)).status, 400);
  assert.equal((await up('a/b.png', png)).status, 400);
  assert.equal((await up('evil.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))).status, 400);
  assert.equal((await up('ok.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'))).status, 200);

  const img = await req(p, 'GET', '/images/' + encodeURIComponent('식은땀.png'));
  assert.equal(img.status, 200);
  assert.ok(String(img.headers['content-security-policy']).includes('sandbox'));
  assert.equal((await req(p, 'GET', '/images/..%2Fconfig.json')).status, 404);

  const del = await req(p, 'DELETE', '/api/images/' + encodeURIComponent('식은땀 (2).png'), { headers: H });
  assert.ok(!JSON.parse(del.text).images.some((i) => i.path === '식은땀 (2).png'));

  // 화면 파일
  for (const f of ['/input.html', '/output.html', '/lib/bbcode.js', '/lib/common.js', '/lib/overlay.js', '/lib/input.js']) {
    assert.equal((await req(p, 'GET', f)).status, 200, f);
  }
  assert.equal((await req(p, 'GET', '/samples/' + encodeURIComponent('감사.svg'))).status, 404);
  assert.equal((await req(p, 'GET', '/lib/../../package.json')).status, 404);
  assert.equal((await req(p, 'GET', '/src/server/server.js')).status, 404);
});

test('보안: 다른 사이트/호스트의 접근과 헤더 없는 쓰기 차단', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app3-'));
  const app = await startServer({ dataDir: dir, port: 0 });
  t.after(() => app.close());
  const p = app.port;
  assert.equal((await req(p, 'GET', '/api/state', { headers: { Host: 'evil.example.com' } })).status, 403);
  assert.equal((await req(p, 'PUT', '/api/config', { headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403, '헤더 없음');
  assert.equal((await req(p, 'PUT', '/api/config', { headers: { ...H, Origin: 'https://evil.example.com' }, body: '{}' })).status, 403, '다른 Origin');
  assert.equal((await req(p, 'PUT', '/api/config', { headers: { ...H, 'Content-Type': 'application/json' }, body: 'not json' })).status, 400);

  // 다른 사이트에서 웹소켓으로 붙으려는 시도
  const bad = new WebSocket(`ws://127.0.0.1:${p}/ws`, { headers: { Origin: 'https://evil.example.com' } });
  const closed = await new Promise((r) => { bad.on('error', () => r('error')); bad.on('open', () => r('open')); });
  assert.equal(closed, 'error');
});

test('이상한 설정 값은 안전한 값으로 저장된다', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app4-'));
  const app = await startServer({ dataDir: dir, port: 0 });
  t.after(() => app.close());
  const r = await putConfig(app.port, { overlay: { fontSize: 99999, textColor: 'red;x' }, commands: [{ trigger: 'a b', image: 'x.png' }], advanced: { apiBase: 'javascript:1' } });
  const cfg = JSON.parse(r.text);
  assert.equal(cfg.overlay.fontSize, 120);
  assert.equal(cfg.overlay.textColor, '#ffffff');
  assert.deepEqual(cfg.commands, []);
  assert.equal(cfg.advanced.apiBase, '');
});

test('사용 중인 포트면 다음 포트로', async (t) => {
  const a = await startServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'app5-')), port: 38999 });
  const b = await startServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'app6-')), port: 38999 });
  t.after(async () => { await a.close(); await b.close(); });
  assert.equal(a.port, 38999);
  assert.equal(b.port, 39000);
});

test('스튜디오의 채팅창 주소를 넣으면 위젯 키로 접속하고, 방송이 바뀌어 채팅 채널이 달라져도 자동으로 따라간다', async (t) => {
  const fake = await startFakeChzzk();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app9-'));
  const app = await startServer({ dataDir: dir, port: 0, chatOptions: { apiBase: fake.base, commApiBase: fake.base, wsUrl: fake.wsUrl, handshakeMs: 800, retryBaseSec: 0.1, watchMs: 60 } });
  t.after(async () => { await app.close(); await fake.close(); });
  const got = [];
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.on('open', r));
  const st = JSON.parse((await req(app.port, 'GET', '/api/state')).text);
  const saved = JSON.parse((await putConfig(app.port, { ...st.config, channel: { url: `https://chzzk.naver.com/chat/${WIDGET_KEY}` } })).text);
  assert.equal(saved.channel.chatKey, WIDGET_KEY);
  assert.equal(saved.channel.channelId, '');
  await waitFor(() => got.find((m) => m.type === 'status' && m.status.state === 'connected'));
  assert.equal(fake.state.liveStatusCalls, 0);
  fake.emit({ msg: '방송 전' });
  await waitFor(() => got.find((m) => m.type === 'chat' && m.msg.content === '방송 전'));

  fake.setChatChannel('N9live');   // 방송 시작
  await waitFor(() => fake.state.connects.some((c) => c.cid === 'N9live'));
  await waitFor(() => fake.state.sockets.size === 1);
  fake.emit({ msg: '방송 중' });
  await waitFor(() => got.find((m) => m.type === 'chat' && m.msg.content === '방송 중'));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.equal(cfg.channel.chatKey, WIDGET_KEY);
  ws.close();
});

test('OBS 연동: 실행 상태 파일(runtime.json)과 종료 요청', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app7-'));
  let quitCalled = 0;
  const app = await startServer({ dataDir: dir, port: 0, onQuit: () => { quitCalled++; } });
  t.after(() => app.close());
  const rt = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf8'));
  assert.equal(rt.app, 'chzzkchatconplus');
  assert.equal(rt.port, app.port);
  assert.ok(Math.abs(rt.updatedAt - Math.floor(Date.now() / 1000)) <= 2, '갱신 시각은 초 단위 epoch');
  const st = JSON.parse((await req(app.port, 'GET', '/api/state')).text);
  assert.equal(st.app, 'chzzkchatconplus');

  // 헤더 없는 종료 요청(다른 사이트의 시도 등)은 거절
  assert.equal((await req(app.port, 'POST', '/api/quit')).status, 403);
  assert.equal(quitCalled, 0);
  assert.equal((await req(app.port, 'POST', '/api/quit', { headers: H })).status, 200);
  await waitFor(() => quitCalled === 1);

  await app.close();
  assert.ok(!fs.existsSync(path.join(dir, 'runtime.json')), '종료하면 상태 파일은 지워짐');
});

test('OBS 연동: mirrorDir이 있으면 한글 없는 고정 위치에도 상태 파일 사본을 쓰고, 종료하면 지운다', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app8-'));
  const mirror = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'app8m-')), 'bridge');
  const app = await startServer({ dataDir: dir, port: 0, mirrorDir: mirror });
  t.after(() => app.close());
  const a = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf8'));
  const b = JSON.parse(fs.readFileSync(path.join(mirror, 'runtime.json'), 'utf8'));
  assert.deepEqual(b, a);
  assert.equal(b.port, app.port);
  await app.close();
  assert.ok(!fs.existsSync(path.join(mirror, 'runtime.json')), '종료하면 사본도 지워짐');

  // 다른 앱이 덮어쓴 사본은 지우지 않는다
  const app2 = await startServer({ dataDir: dir, port: 0, mirrorDir: mirror });
  fs.writeFileSync(path.join(mirror, 'runtime.json'), JSON.stringify({ app: 'chzzkchatconplus', port: 1, pid: -1, startedAt: 1, updatedAt: 1 }));
  await app2.close();
  assert.ok(fs.existsSync(path.join(mirror, 'runtime.json')));
});

test('태그: 태그를 지정해 올리면 폴더가 생기고, 목록과 화면 주소에 반영된다', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag1-'));
  const app = await startServer({ dataDir: dir, port: 0 });
  t.after(() => app.close());
  const r = json(await upload(app.port, '기쁨.png', '표정/웃음'));
  assert.equal(r.path, '표정/웃음/기쁨.png');
  assert.ok(fs.existsSync(path.join(dir, 'images', '표정', '웃음', '기쁨.png')));
  assert.deepEqual(r.folders, ['표정', '표정/웃음']);

  const st = await getState(app.port);
  const item = st.images.find((i) => i.path === '표정/웃음/기쁨.png');
  assert.equal(item.name, '기쁨.png');
  assert.equal(item.tag, '표정/웃음');
  await upload(app.port, '무태그.png', '');
  assert.ok((await getState(app.port)).images.find((i) => i.path === '무태그.png' && i.tag === ''), '폴더 밖 이미지는 태그 없음');

  // 폴더 안 이미지도 오버레이가 쓰는 주소로 받을 수 있음
  const img = await req(app.port, 'GET', '/images/' + ['표정', '웃음', '기쁨.png'].map(encodeURIComponent).join('/'));
  assert.equal(img.status, 200);
  assert.ok(String(img.headers['content-security-policy']).includes('sandbox'));

  // 같은 폴더에 같은 이름이면 번호, 다른 폴더면 같은 이름 가능
  assert.equal(json(await upload(app.port, '기쁨.png', '표정/웃음')).path, '표정/웃음/기쁨 (2).png');
  assert.equal(json(await upload(app.port, '기쁨.png', '반응')).path, '반응/기쁨.png');
});

test('태그: 올바르지 않은 태그와 폴더 이름은 거절한다', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag2-'));
  const app = await startServer({ dataDir: dir, port: 0 });
  t.after(() => app.close());
  for (const bad of ['../evil', 'a/../b', '/abs', 'a\\b', 'a:b', '.hidden', 'a/b/c/d', 'a//b', ' ', 'x'.repeat(61)]) {
    if (bad === ' ') continue; // 공백만 있으면 태그 없음과 같음
    assert.equal((await upload(app.port, 'a.png', bad)).status, 400, '태그 거절: ' + bad);
  }
  assert.equal((await upload(app.port, 'a.png', 'a/b/c')).status, 200, '3단계까지는 허용');
  assert.equal((await upload(app.port, '../a.png', '')).status, 400);
  assert.ok(!fs.existsSync(path.join(dir, 'evil')) && !fs.existsSync(path.join(dir, 'images', '..', 'evil')));
});

test('태그: 이미지를 다른 태그로 옮기면 비게 된 폴더는 정리된다', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag3-'));
  const app = await startServer({ dataDir: dir, port: 0 });
  t.after(() => app.close());
  await upload(app.port, '하나.png', '옛태그/하위');
  const move = (p, tag) => req(app.port, 'POST', '/api/images/move', { headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p, tag }) });

  const r = json(await move('옛태그/하위/하나.png', '새태그'));
  assert.equal(r.path, '새태그/하나.png');
  assert.deepEqual(r.folders, ['새태그'], '비게 된 옛 폴더(옛태그/하위, 옛태그)는 지워짐');
  assert.ok(fs.existsSync(path.join(dir, 'images', '새태그', '하나.png')));

  // 이름이 겹치면 번호를 붙여서 옮김
  await upload(app.port, '하나.png', '');
  assert.equal(json(await move('하나.png', '새태그')).path, '새태그/하나 (2).png');
  // 같은 태그로 옮기면 그대로
  assert.equal(json(await move('새태그/하나.png', '새태그')).path, '새태그/하나.png');
  // 태그 없음으로 옮기기
  assert.equal(json(await move('새태그/하나.png', '')).path, '하나.png');
  // 없는 파일 / 올바르지 않은 경로 / 올바르지 않은 태그
  assert.equal((await move('없는/파일.png', '새태그')).status, 400);
  assert.equal((await move('../config.json', '새태그')).status, 400);
  assert.equal((await move('하나.png', '../밖')).status, 400);
});

test('태그: 폴더 안 이미지를 지우면 빈 폴더도 정리된다', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag4-'));
  const app = await startServer({ dataDir: dir, port: 0 });
  t.after(() => app.close());
  await upload(app.port, '삭제.png', '임시/하위');
  const del = await req(app.port, 'DELETE', '/api/images/' + encodeURIComponent('임시/하위/삭제.png'), { headers: H });
  assert.equal(del.status, 200);
  assert.deepEqual(json(del).folders, []);
  assert.ok(!fs.existsSync(path.join(dir, 'images', '임시')));
  assert.equal((await req(app.port, 'DELETE', '/api/images/' + encodeURIComponent('../config.json'), { headers: H })).status, 400);
  assert.ok(fs.existsSync(path.join(dir, 'config.json')), '바깥 파일은 지워지지 않음');
});

test('태그: 폴더 밖을 가리키는 주소와 심볼릭 링크는 막는다', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag5-'));
  const app = await startServer({ dataDir: dir, port: 0 });
  t.after(() => app.close());
  for (const bad of ['..%2Fconfig.json', '%2e%2e/config.json', encodeURIComponent('표정') + '/..%2F..%2Fconfig.json', '..%5Cconfig.json', '%00', 'a%2F..%2F..%2Fconfig.json']) {
    assert.equal((await req(app.port, 'GET', '/images/' + bad)).status, 404, bad);
  }
  // 바깥 파일을 가리키는 심볼릭 링크는 목록에도, 제공에도 나오지 않음
  const outside = path.join(dir, 'secret.png');
  fs.writeFileSync(outside, PNG);
  try { fs.symlinkSync(outside, path.join(dir, 'images', '링크.png')); fs.symlinkSync(dir, path.join(dir, 'images', '폴더링크')); } catch { return; }
  const st = await getState(app.port);
  assert.ok(!st.images.some((i) => i.name === '링크.png'), '링크 파일은 목록에 없음');
  assert.ok(!st.folders.includes('폴더링크'));
  assert.equal((await req(app.port, 'GET', '/images/' + encodeURIComponent('링크.png'))).status, 404);
});

test('태그: 탐색기에서 옮긴 이미지는 같은 이름이 한 곳에만 있을 때 자동으로 다시 연결된다', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag6-'));
  const app = await startServer({ dataDir: dir, port: 0 });
  t.after(() => app.close());
  await upload(app.port, '감사.png', '');
  const base = (await getState(app.port)).config;
  const st0 = { config: json(await putConfig(app.port, { ...base, commands: [{ triggers: ['~감사'], image: '감사.png', height: '', match: 'anywhere' }] })) };
  assert.equal(st0.config.commands[0].image, '감사.png');
  // 탐색기에서 감사.png를 표정 폴더로 옮김
  fs.mkdirSync(path.join(dir, 'images', '표정'));
  fs.renameSync(path.join(dir, 'images', '감사.png'), path.join(dir, 'images', '표정', '감사.png'));
  const st1 = await getState(app.port);
  assert.equal(st1.config.commands[0].image, '표정/감사.png', '새 위치로 자동 연결');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).commands[0].image, '표정/감사.png', '설정 파일에도 저장');

  // 같은 이름이 두 곳에 있으면 어느 쪽인지 알 수 없으므로 연결하지 않음
  const imgs = path.join(dir, 'images');
  fs.mkdirSync(path.join(imgs, '반응')); fs.mkdirSync(path.join(imgs, '기타'));
  fs.copyFileSync(path.join(imgs, '표정', '감사.png'), path.join(imgs, '반응', '감사.png'));
  fs.renameSync(path.join(imgs, '표정', '감사.png'), path.join(imgs, '기타', '감사.png'));
  const st2 = await getState(app.port);
  assert.equal(st2.config.commands[0].image, '표정/감사.png', '후보가 둘이면 그대로 둠 (파일 없음으로 표시됨)');
  assert.ok(!st2.images.some((i) => i.path === '표정/감사.png'));

  // 한 곳이 사라져 후보가 하나가 되면 그때 연결
  fs.unlinkSync(path.join(imgs, '기타', '감사.png'));
  const st3 = await getState(app.port);
  assert.equal(st3.config.commands[0].image, '반응/감사.png');

  // 이름이 다른 파일은 연결하지 않음
  fs.renameSync(path.join(imgs, '반응', '감사.png'), path.join(imgs, '반응', '다른이름.png'));
  const st4 = await getState(app.port);
  assert.equal(st4.config.commands[0].image, '반응/감사.png');
});

test('태그: 중첩 폴더의 명령어와 오버레이 전달', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag7-'));
  const app = await startServer({ dataDir: dir, port: 0 });
  t.after(() => app.close());
  await upload(app.port, '기쁨.png', '표정/웃음');
  const st = await getState(app.port);
  const cfg = { ...st.config, commands: [{ triggers: ['~기쁨'], image: '표정/웃음/기쁨.png', height: '2.4em', match: 'anywhere' }] };
  const saved = json(await putConfig(app.port, cfg));
  assert.equal(saved.commands[0].image, '표정/웃음/기쁨.png');
  // 이미지 경로가 올바르지 않은 명령어는 저장되지 않음
  const bad = json(await putConfig(app.port, { ...st.config, commands: [{ triggers: ['~x'], image: '../config.json' }, { triggers: ['~y'], image: 'a/b/c/d/e.png' }] }));
  assert.deepEqual(bad.commands, []);
});

test('앱 이름과 폴더 이름 상수', () => {
  const APP = require('../src/server/app-info');
  assert.equal(APP.NAME, 'ChzzkChatConPlus');
  assert.equal(APP.ID, 'chzzkchatconplus');
  assert.equal(APP.DATA_DIR, 'chzzkchatconplus-data');
  assert.deepEqual(APP.LEGACY_DATA_DIRS, ['chzzk-overlay-data']);
});

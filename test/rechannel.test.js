'use strict';
// 방송이 시작되거나 끝나서 채팅 채널이 바뀌어도 새 채팅방으로 자동으로 다시 접속하는지, 채팅창 주소(위젯 키)로도 접속되는지 시험합니다.
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const ChzzkChat = require('../src/server/chzzk-chat');
const { startFakeChzzk, WIDGET_KEY } = require('./fake-chzzk');

const CH = '0123456789abcdef0123456789abcdef';
async function waitFor(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await new Promise((r) => setTimeout(r, 15)); }
  throw new Error('시간 안에 조건이 맞지 않았습니다');
}

function connect(fake, extra) {
  const chats = [], statuses = [];
  const client = new ChzzkChat(Object.assign({
    apiBase: fake.base, commApiBase: fake.base, wsUrl: fake.wsUrl, WebSocketImpl: WebSocket,
    handshakeMs: 800, retryBaseSec: 0.1, watchMs: 60,
    onChat: (c) => chats.push(c), onStatus: (s) => statuses.push(s)
  }, extra));
  client.start();
  return { client, chats, statuses };
}

test('채널 ID로 접속한 뒤 방송이 시작되어 채팅 채널이 바뀌면 새 채팅방으로 다시 접속한다', async (t) => {
  const fake = await startFakeChzzk({ status: 'CLOSE' });
  const { client, chats, statuses } = connect(fake, { channelId: CH });
  t.after(async () => { client.stop(); await fake.close(); });
  await waitFor(() => statuses.some((s) => s.state === 'connected'));
  fake.emit({ msg: '방송 전 채팅' });
  await waitFor(() => chats.length === 1);

  fake.setChatChannel('N2new', 'OPEN');   // 방송 시작: 채팅 채널이 새로 만들어짐
  await waitFor(() => fake.state.connects.some((c) => c.cid === 'N2new'));
  await waitFor(() => statuses.filter((s) => s.state === 'connected').length >= 2);
  fake.emit({ msg: '방송 후 채팅' });
  await waitFor(() => chats.length === 2);
  assert.equal(chats[1].content, '방송 후 채팅');
  assert.ok(statuses.some((s) => s.state === 'connecting' && /새 채팅방/.test(s.detail.step || '')), '다시 연결한다는 안내가 나온다');
  assert.equal(client.liveStatus, 'OPEN');
});

test('채팅창 주소(위젯 키)로도 접속하고, 채팅 채널이 바뀌면 따라간다', async (t) => {
  const fake = await startFakeChzzk();
  const { client, chats, statuses } = connect(fake, { sourceKey: WIDGET_KEY });
  t.after(async () => { client.stop(); await fake.close(); });
  await waitFor(() => statuses.some((s) => s.state === 'connected'));
  assert.equal(fake.state.liveStatusCalls, 0, '채널 ID 조회는 하지 않는다');
  assert.ok(fake.state.sourceCalls >= 1);
  fake.emit({ msg: '첫 방송' });
  await waitFor(() => chats.length === 1);

  fake.setChatChannel('N3next');
  await waitFor(() => fake.state.connects.some((c) => c.cid === 'N3next'));
  await waitFor(() => statuses.filter((s) => s.state === 'connected').length >= 2);
  fake.emit({ msg: '다음 방송' });
  await waitFor(() => chats.length === 2);
  assert.equal(chats[1].content, '다음 방송');
});

test('채팅 채널이 그대로면 다시 접속하지 않는다', async (t) => {
  const fake = await startFakeChzzk();
  const { client, statuses } = connect(fake, { channelId: CH });
  t.after(async () => { client.stop(); await fake.close(); });
  await waitFor(() => statuses.some((s) => s.state === 'connected'));
  await new Promise((r) => setTimeout(r, 400));   // 확인이 여러 번 지나가도
  assert.equal(fake.state.connects.length, 1);
  assert.ok(fake.state.liveStatusCalls >= 3, '주기적으로 확인은 한다');
});

test('주기적 확인이 실패해도 지금 연결과 채팅은 끊기지 않는다', async (t) => {
  const fake = await startFakeChzzk({ sourceHttp: 0 });
  const { client, chats, statuses } = connect(fake, { sourceKey: WIDGET_KEY });
  t.after(async () => { client.stop(); await fake.close(); });
  await waitFor(() => statuses.some((s) => s.state === 'connected'));
  const before = fake.state.connects.length;
  // 이후의 확인 요청이 모두 서버 오류가 되도록 바꿉니다. (옵션 객체를 직접 바꿀 수 없으므로 서버를 막는 대신 가짜 주소로 바꿉니다.)
  client.o.apiBase = 'http://127.0.0.1:1';
  await new Promise((r) => setTimeout(r, 300));
  fake.emit({ msg: '확인이 실패하는 동안의 채팅' });
  await waitFor(() => chats.length === 1);
  assert.equal(fake.state.connects.length, before, '다시 접속하지 않는다');
  assert.ok(!statuses.some((s) => s.state === 'retry'), '연결 실패로 표시하지 않는다');
});

test('잘못된 채팅창 주소는 알아보기 쉬운 안내와 함께 재시도한다', async (t) => {
  const fake = await startFakeChzzk();
  const { client, statuses } = connect(fake, { sourceKey: 'f'.repeat(32) });
  t.after(async () => { client.stop(); await fake.close(); });
  await waitFor(() => statuses.some((s) => s.state === 'retry'));
  const r = statuses.find((s) => s.state === 'retry');
  assert.equal(r.detail.kind, 'http');
  assert.ok(/채팅창/.test(r.detail.message + r.detail.hint));
});

test('주기적 확인을 끄면(watchMs 0) 다시 확인하지 않는다', async (t) => {
  const fake = await startFakeChzzk();
  const { client, statuses } = connect(fake, { channelId: CH, watchMs: 0 });
  t.after(async () => { client.stop(); await fake.close(); });
  await waitFor(() => statuses.some((s) => s.state === 'connected'));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fake.state.liveStatusCalls, 1);
});

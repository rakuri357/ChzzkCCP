'use strict';
// 진단 정보: 문제를 알려 줄 때 필요한 정보는 담고, 채널 주소, 채팅창 열쇠, 닉네임, 채팅 내용, 사용자 이름은 담지 않는지 시험합니다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildDiagnostics, maskPath, maskText } = require('../src/server/diagnostics');
const { startServer } = require('../src/server/server');
const { startFakeChzzk, WIDGET_KEY } = require('./fake-chzzk');
const L = require('../public/lib/common');

const H = { 'X-Requested-With': 'app' };
async function waitFor(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await new Promise((r) => setTimeout(r, 15)); }
  throw new Error('시간 안에 조건이 맞지 않았습니다');
}

test('경로의 사용자 이름과 32자리 값은 가린다', () => {
  assert.equal(maskPath('C:\\Users\\sk_ro\\OneDrive\\Desktop\\새 폴더\\data'), 'C:\\Users\\<사용자>\\OneDrive\\Desktop\\새 폴더\\data');
  assert.equal(maskPath('c:/users/홍길동/x'), 'c:/users/<사용자>/x');
  assert.equal(maskPath('/home/alice/app'), '/home/<사용자>/app');
  assert.equal(maskPath('D:\\ChzzkChatConPlus\\data'), 'D:\\ChzzkChatConPlus\\data', '사용자 폴더가 아니면 그대로');
  assert.equal(maskText('주소 https://chzzk.naver.com/chat/c3b04de1935458cebc71c9d72c3fbe3a 실패'), '주소 https://chzzk.naver.com/chat/<32자리 값 가림> 실패');
});

function sample(extra) {
  const config = L.normalizeConfig({
    channel: { url: `https://chzzk.naver.com/chat/${WIDGET_KEY}` },
    commands: [{ triggers: ['~감사'], image: '감사.png' }, { triggers: [], image: '빈.png' }],
    bbcode: { tags: { blink: { enabled: false }, rainbow: { access: 'subscribers' }, wave: { names: ['wave'] } } }
  });
  return Object.assign({ app: 'ChzzkChatConPlus', version: '0.4.8', versions: { electron: '32.0.0', chrome: '128', node: '20' },
    platform: 'win32', release: '10.0.19045', arch: 'x64', dataDir: 'C:\\Users\\sk_ro\\Desktop\\chzzkchatconplus-data', port: 3939,
    status: { state: 'retry', detail: { kind: 'http', message: '채팅창 정보 요청이 실패했습니다 (HTTP 404).', hint: '확인하십시오.' } },
    history: [{ time: 1000, state: 'connecting', kind: '', message: '' }, { time: 2000, state: 'retry', kind: 'http', message: `실패 ${WIDGET_KEY}` }],
    config, images: 5, folders: 2, bridge: { launcher: true }, update: { latest: '0.4.9', newer: true }, now: 5000 }, extra);
}

test('진단 정보에는 버전, 환경, 연결 상태, 설정 요약이 들어간다', () => {
  const t = buildDiagnostics(sample());
  for (const s of ['앱 버전: 0.4.8', 'Electron 32.0.0', 'win32 10.0.19045 (x64)', '앱 주소 포트: 3939', '입력 방식: 스튜디오 채팅창 주소', '상태: retry',
    '마지막 오류: 채팅창 정보 요청이 실패했습니다 (HTTP 404).', '이미지 5개, 명령어가 있는 채팅콘 1개, 태그 2개', '꺼 둔 태그 1개', '이름을 바꾼 태그 1개', '태그별 권한 1개',
    '고정 위치 바로가기(한글 경로 대비): 예', '최신 0.4.9 (새 버전 있음)']) assert.ok(t.includes(s), '빠짐: ' + s + '\n' + t);
});

test('진단 정보에는 채널 주소, 채팅창 열쇠, 사용자 이름이 들어가지 않는다', () => {
  const t = buildDiagnostics(sample());
  assert.ok(!t.includes(WIDGET_KEY), '열쇠가 그대로 들어 있음');
  assert.ok(!t.includes('chzzk.naver.com'), '주소가 들어 있음');
  assert.ok(!t.includes('sk_ro'), '사용자 이름이 들어 있음');
  assert.ok(t.includes('<사용자>'));
  const none = buildDiagnostics(sample({ config: L.normalizeConfig(null), history: [], status: { state: 'no-channel' } }));
  assert.ok(none.includes('입력 방식: 입력 없음'));
});

test('앱의 /api/diagnostics: 연결 기록이 들어 있고, 채널 정보와 채팅 내용은 없다', async (t) => {
  const fake = await startFakeChzzk();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
  const app = await startServer({ dataDir: dir, port: 0, appVersion: '9.9.9', updateFirstDelayMs: 1e9, chatOptions: { apiBase: fake.base, commApiBase: fake.base, wsUrl: fake.wsUrl, handshakeMs: 800, retryBaseSec: 0.1, watchMs: 0 } });
  t.after(async () => { await app.close(); await fake.close(); });
  const st = JSON.parse(await (await fetch(`http://127.0.0.1:${app.port}/api/state`, { headers: H })).text());
  await fetch(`http://127.0.0.1:${app.port}/api/config`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...st.config, channel: { url: `https://chzzk.naver.com/chat/${WIDGET_KEY}` } }) });
  await waitFor(() => fake.state.sockets.size === 1);
  fake.emit({ msg: '비밀스러운 채팅 내용', nick: '비밀닉네임' });
  await new Promise((r) => setTimeout(r, 150));
  const r = JSON.parse(await (await fetch(`http://127.0.0.1:${app.port}/api/diagnostics`, { headers: H })).text());
  assert.ok(r.text.includes('앱 버전: 9.9.9'));
  assert.ok(r.text.includes('상태: connected'));
  assert.ok(/최근 연결 기록/.test(r.text) && /connecting/.test(r.text) && /connected/.test(r.text));
  for (const secret of [WIDGET_KEY, '비밀스러운 채팅 내용', '비밀닉네임', 'chzzk.naver.com']) assert.ok(!r.text.includes(secret), '들어 있으면 안 됨: ' + secret);
});

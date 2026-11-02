'use strict';
// OBS가 켜져 있는지 확인하는 부분과, 창을 숨겨 둔 동안 OBS가 꺼지면 앱을 끄는 판단의 시험 (윈도우 없이 가짜 결과로 확인)
const test = require('node:test');
const assert = require('node:assert');
const g = require('../src/main/obs-guard');

const RUNNING = '"obs64.exe","12345","Console","1","250,000 K"\r\n';
const NONE = '정보: 지정한 조건에 맞는 실행 중인 작업이 없습니다.\r\n';

test('tasklist 결과에서 OBS 실행 여부를 읽는다', () => {
  assert.equal(g.parseTasklist(RUNNING), true);
  assert.equal(g.parseTasklist('"OBS64.EXE","1"'), true, '대소문자 구분 없음');
  assert.equal(g.parseTasklist('"obs32.exe","1"'), true);
  assert.equal(g.parseTasklist(NONE), false);
  assert.equal(g.parseTasklist('INFO: No tasks are running which match the specified criteria.'), false);
  assert.equal(g.parseTasklist('"notobs64.exe","1"'), false, '이름이 비슷한 다른 프로그램은 아님');
  assert.equal(g.parseTasklist(''), false);
  assert.equal(g.parseTasklist(null), false);
});

test('즉시 확인: OBS가 있으면 true, 없거나 확인에 실패하면 false, 윈도우가 아니면 false', () => {
  const ask = (out) => (cmd, args) => { assert.equal(cmd, 'tasklist'); return args.some((a) => /obs64\.exe/.test(a)) ? out : NONE; };
  assert.equal(g.isObsRunningSync({ platform: 'win32', execFileSync: ask(RUNNING) }), true);
  assert.equal(g.isObsRunningSync({ platform: 'win32', execFileSync: ask(NONE) }), false);
  assert.equal(g.isObsRunningSync({ platform: 'win32', execFileSync: () => { throw new Error('실패'); } }), false);
  assert.equal(g.isObsRunningSync({ platform: 'linux', execFileSync: () => { throw new Error('호출되면 안 됨'); } }), false);
});

test('기다리지 않는 확인도 같은 결과를 낸다', async () => {
  const fake = (out) => (cmd, args, o, cb) => cb(null, args.some((a) => /obs64\.exe/.test(a)) ? out : NONE);
  assert.equal(await g.isObsRunning({ platform: 'win32', execFile: fake(RUNNING) }), true);
  assert.equal(await g.isObsRunning({ platform: 'win32', execFile: fake(NONE) }), false);
  assert.equal(await g.isObsRunning({ platform: 'win32', execFile: (c, a, o, cb) => cb(new Error('실패')) }), false);
  assert.equal(await g.isObsRunning({ platform: 'darwin', execFile: () => { throw new Error('호출되면 안 됨'); } }), false);
});

function makeGuard(state) {
  const timers = { handles: 0, setInterval() { timers.handles++; return timers.handles; }, clearInterval() { timers.handles--; } };
  const calls = { gone: 0 };
  const guard = g.createGuard({
    intervalMs: 10, timers,
    isHidden: () => state.hidden,
    isRunning: async () => state.obs,
    onGone: () => { calls.gone++; }
  });
  return { guard, calls, timers };
}

test('숨겨 둔 동안 OBS가 꺼지면 앱을 끈다 (한 번만)', async () => {
  const s = { hidden: true, obs: true };
  const { guard, calls, timers } = makeGuard(s);
  guard.start(); guard.start();
  assert.equal(timers.handles, 1, '지켜보기는 한 번만 시작');
  await guard.tick();
  assert.equal(calls.gone, 0, 'OBS가 켜져 있으면 끄지 않음');
  s.obs = false;
  await guard.tick();
  assert.equal(calls.gone, 1);
  assert.equal(timers.handles, 0, '끈 뒤에는 지켜보기를 멈춤');
  await guard.tick();
  assert.equal(calls.gone, 1, '다시 끄지 않음');
});

test('설정 창이 보이는 동안에는 OBS가 꺼져도 앱을 끄지 않는다', async () => {
  const s = { hidden: false, obs: false };
  const { guard, calls } = makeGuard(s);
  guard.start();
  await guard.tick();
  assert.equal(calls.gone, 0);
  s.hidden = true;     // 창을 다시 숨기면 그때부터 끈다
  await guard.tick();
  assert.equal(calls.gone, 1);
});

test('확인하는 사이에 창이 다시 열렸으면 끄지 않는다', async () => {
  const s = { hidden: true, obs: true };
  const calls = { gone: 0 };
  const guard = g.createGuard({
    timers: { setInterval: () => 1, clearInterval() {} },
    isHidden: () => s.hidden,
    isRunning: async () => { s.hidden = false; return false; },   // 확인 도중 사용자가 창을 열었음
    onGone: () => { calls.gone++; }
  });
  guard.start();
  await guard.tick();
  assert.equal(calls.gone, 0);
});

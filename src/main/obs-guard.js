'use strict';
// OBS가 켜져 있는지 확인하는 부분. 윈도우의 프로세스 목록(tasklist)에서 OBS Studio의 실행 파일 이름만 찾습니다.
// (다른 프로그램의 내용은 읽지 않습니다. 확인에 실패하면 "꺼져 있음"으로 보고, 평소처럼 앱을 끕니다.)
const { execFile, execFileSync } = require('child_process');

const OBS_EXES = ['obs64.exe', 'obs32.exe'];

/** tasklist /FO CSV 출력에서 OBS가 보이는지 */
function parseTasklist(text) {
  const t = String(text || '').toLowerCase();
  return OBS_EXES.some((name) => t.includes('"' + name + '"'));
}

function tasklistArgs(name) { return ['/FI', 'IMAGENAME eq ' + name, '/FO', 'CSV', '/NH']; }

/** 지금 OBS가 켜져 있는지 (바로 확인, 창을 닫는 순간에 씁니다) */
function isObsRunningSync(opts = {}) {
  if ((opts.platform || process.platform) !== 'win32') return false;
  const run = opts.execFileSync || execFileSync;
  try {
    return OBS_EXES.some((name) => parseTasklist(run('tasklist', tasklistArgs(name), { windowsHide: true, timeout: 3000, encoding: 'utf8' })));
  } catch { return false; }
}

/** 같은 확인을 기다리지 않고 합니다. (숨겨 둔 동안 주기적으로 확인할 때 씁니다.) */
function isObsRunning(opts = {}) {
  if ((opts.platform || process.platform) !== 'win32') return Promise.resolve(false);
  const run = opts.execFile || execFile;
  const ask = (name) => new Promise((resolve) => {
    try {
      run('tasklist', tasklistArgs(name), { windowsHide: true, timeout: 3000, encoding: 'utf8' }, (err, out) => resolve(!err && parseTasklist(out)));
    } catch { resolve(false); }
  });
  return Promise.all(OBS_EXES.map(ask)).then((r) => r.some(Boolean));
}

/**
 * 창을 숨겨 둔 동안 OBS가 꺼졌는지 지켜보다가, 꺼지면 onGone을 한 번 부릅니다.
 * 설정 창이 다시 열려 있는 동안(isHidden이 false)에는 OBS가 꺼져도 앱을 끄지 않습니다.
 */
function createGuard(o) {
  const intervalMs = o.intervalMs || 20000;
  const timers = o.timers || { setInterval, clearInterval };
  let handle = null, busy = false;
  async function tick() {
    if (!handle || busy) return;   // 지켜보는 중이 아니면 아무것도 하지 않음
    busy = true;
    try {
      if (!o.isHidden()) return;                 // 창이 보이면 끄지 않음
      if (await o.isRunning()) return;           // OBS가 아직 켜져 있음
      if (!o.isHidden()) return;                 // 확인하는 사이에 창이 다시 열렸으면 끄지 않음
      stop();
      o.onGone();
    } finally { busy = false; }
  }
  function start() { if (!handle) handle = timers.setInterval(tick, intervalMs); }
  function stop() { if (handle) { timers.clearInterval(handle); handle = null; } }
  return { start, stop, tick, get running() { return !!handle; } };
}

module.exports = { OBS_EXES, parseTasklist, isObsRunning, isObsRunningSync, createGuard };

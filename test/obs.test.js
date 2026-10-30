'use strict';
// OBS 스크립트(Lua) 시험. Lua가 설치되어 있지 않으면 건너뜁니다.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const lua = ['lua5.1', 'lua', 'luajit'].find((c) => spawnSync(c, ['-v']).status === 0);
const root = path.join(__dirname, '..');

test('OBS 스크립트: 시작/대기/새로고침/종료 순서 (가짜 OBS 환경)', { skip: !lua && 'Lua가 설치되어 있지 않습니다' }, () => {
  const r = spawnSync(lua, [path.join(__dirname, 'obs_harness.lua'), path.join(root, 'obs', 'chzzkchatconplus-obs.lua')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('ALL OK'));
  assert.ok(!r.stdout.includes('FAIL'));
});

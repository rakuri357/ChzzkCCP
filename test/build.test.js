'use strict';
// 배포 설정 시험: 포터블 exe와 폴더형(압축을 푼 상태)을 함께 만들고, 릴리스에 올리는지 확인합니다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('빌드 설정: 포터블 exe와 폴더형을 함께 만들고, 언어팩은 한국어와 영어만 남긴다', () => {
  const targets = pkg.build.win.target.map((t) => t.target);
  assert.ok(targets.includes('portable') && targets.includes('dir'));
  assert.deepEqual(pkg.build.electronLanguages, ['ko', 'en-US']);
});

test('릴리스 워크플로: zip 안에 앱, OBS 스크립트, 사용법, 해시가 들어가고, 바깥 해시는 zip을 포함한다', () => {
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const copyAt = yml.indexOf('dist/ChzzkChatConPlus/');
  const innerSumAt = yml.indexOf('cd dist/ChzzkChatConPlus && sha256sum');
  const zipAt = yml.indexOf('-windows.zip');
  const outerSumAt = yml.indexOf('cd release && sha256sum');
  assert.ok(copyAt > 0 && innerSumAt > copyAt, 'lua와 사용법을 폴더에 넣은 뒤 안쪽 해시를 만든다');
  assert.ok(zipAt > innerSumAt, '안쪽 해시까지 만든 뒤에 zip으로 묶는다');
  assert.ok(outerSumAt > zipAt, 'zip을 만든 뒤에 바깥 해시를 만든다');
  assert.ok(/sha256sum ChzzkChatConPlus\.exe chzzkchatconplus-obs\.lua USAGE-ko\.txt/.test(yml));
  assert.ok(yml.includes('cp obs/chzzkchatconplus-obs.lua release/') && yml.includes('cp docs/USAGE-ko.txt release/'), '낱개 파일도 Release에 남긴다');
});

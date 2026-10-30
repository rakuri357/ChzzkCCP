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

test('릴리스 워크플로: 폴더형 zip을 만들어 해시 파일보다 먼저 모은다', () => {
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const zipAt = yml.indexOf('win-unpacked.zip');
  const sumAt = yml.indexOf('sha256sum');
  assert.ok(zipAt > 0 && sumAt > zipAt, 'zip이 SHA256SUMS에 포함되도록 먼저 만들어야 한다');
});

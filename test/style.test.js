'use strict';
// 사용자가 보는 한국어 문구는 합니다체(요청은 ~하십시오)로 통일합니다. 해요체 어미가 다시 들어오면 알려 줍니다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
function walk(dir, out = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const files = [
  ...walk(path.join(root, 'src')), ...walk(path.join(root, 'public')), ...walk(path.join(root, 'obs')),
  path.join(root, 'docs', 'USAGE-ko.txt'), path.join(root, 'README.md'), path.join(root, 'CHANGELOG.md'), path.join(root, '.github', 'release-body.md')
].filter((f) => /\.(js|html|css|txt|md|lua)$/.test(f) && !f.endsWith(path.join('lib', 'bbcode.js')));

const HAEYO = /[가-힣]*요(?=[\s.!?,:;)\]"'…\\]|$)/g;
const ALLOWED_WORDS = new Set(['필요', '중요', '주요', '개요', '수요', '요']);
// 시청자가 쓰는 채팅을 흉내 낸 예시 문장은 해요체 그대로 둡니다. (안내문이 아님)
const ALLOWED_LINES = [/'안녕하세요 '/];

test('화면, 서버, 안내 문서의 문구에 해요체가 남아 있지 않다', () => {
  const bad = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (ALLOWED_LINES.some((re) => re.test(line))) return;
      const hits = (line.match(HAEYO) || []).filter((w) => !ALLOWED_WORDS.has(w));
      if (hits.length) bad.push(`${path.relative(root, f)}:${i + 1} ${hits.join(', ')}`);
    });
  }
  assert.deepEqual(bad, [], '해요체가 남아 있습니다:\n' + bad.join('\n'));
});

test('요청하는 말은 "~해 주세요"가 아니라 "~하십시오"로 쓴다', () => {
  const bad = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (ALLOWED_LINES.some((re) => re.test(line))) return;
      if (/주세요|하세요|보세요|두세요|마세요/.test(line)) bad.push(`${path.relative(root, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

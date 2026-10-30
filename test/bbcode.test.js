'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const BB = require('../public/lib/bbcode');

const ALL = Object.keys(BB.TAG_DEFS);
const plain = (s, o) => BB.toPlainText(BB.parse(s, Object.assign({ allowedTags: ALL }, o)));
const dom = (s, o) => {
  const d = new JSDOM('<body></body>').window.document;
  const box = d.createElement('div');
  box.appendChild(BB.render(s, d, Object.assign({ allowedTags: ALL }, o)));
  return box;
};

test('기본 태그가 요소로 바뀐다', () => {
  const box = dom('[b]굵게[/b] [color=red]빨강[/color]');
  assert.equal(box.querySelector('.bb-b').textContent, '굵게');
  assert.equal(box.querySelector('.bb-color').style.color, 'red');
});

test('허용되지 않은 태그는 글자 그대로', () => {
  const box = dom('[blink]깜빡[/blink]', { allowedTags: ['b'] });
  assert.equal(box.textContent, '[blink]깜빡[/blink]');
  assert.equal(box.querySelector('.bb-blink'), null);
});

test('모르는 태그, 잘못된 색, 스크립트 흉내는 글자 그대로', () => {
  assert.equal(dom('[script]alert(1)[/script]').textContent, '[script]alert(1)[/script]');
  assert.equal(dom('[color=javascript:alert(1)]x[/color]').querySelector('.bb-color'), null);
  assert.equal(dom('[color=red;background:url(x)]x[/color]').querySelector('.bb-color'), null);
});

test('HTML 문자열은 요소가 되지 않는다', () => {
  const box = dom('<img src=x onerror=alert(1)> <b>x</b> [b]<i>y</i>[/b]');
  assert.equal(box.querySelectorAll('img').length, 0);
  assert.equal(box.querySelectorAll('i').length, 0);
  assert.ok(box.textContent.includes('<img src=x onerror=alert(1)>'));
});

test('닫히지 않은 태그는 글자로 남고 내용은 유지', () => {
  assert.equal(plain('[b]안녕 [i]반가워'), '[b]안녕 [i]반가워');
  assert.equal(plain('안녕[/b]'), '안녕[/b]');
});

test('엇갈린 태그 처리', () => {
  const nodes = BB.parse('[b]a[i]b[/b]c[/i]');
  assert.equal(nodes[0].type, 'tag'); // [b]...[/b]는 정상적으로 닫히고
  assert.equal(nodes[0].name, 'b');
  assert.equal(BB.toPlainText(nodes), 'a[i]bc[/i]'); // 짝이 안 맞는 [i]와 [/i]는 글자로 남음
});

test('중첩 깊이 한도', () => {
  const s = '[b][i][u][s][b]깊다[/b][/s][/u][/i][/b]';
  const box = dom(s, { limits: { maxDepth: 3 } });
  assert.equal(box.querySelectorAll('.bb').length, 3);
  assert.ok(box.textContent.includes('[b]'));
});

test('움직이는 효과 개수 한도', () => {
  const box = dom('[blink]1[/blink][shake]2[/shake][rainbow]3[/rainbow]', { limits: { maxEffects: 2 } });
  assert.equal(box.querySelectorAll('.bb-blink, .bb-shake, .bb-rainbow').length, 2);
  assert.ok(box.textContent.includes('[rainbow]3[/rainbow]'));
});

test('효과 한도 0이면 효과 태그는 전부 글자', () => {
  const box = dom('[marquee]x[/marquee]', { limits: { maxEffects: 0 } });
  assert.equal(box.querySelector('.bb-marquee'), null);
});

test('글자 크기는 한도 안으로 고정', () => {
  assert.equal(dom('[size=999]x[/size]').querySelector('.bb-size').style.fontSize, '200%'); // 한도로 고정
  assert.equal(dom('[size=1000]x[/size]').querySelector('.bb-size'), null); // 4자리는 형식 오류 → 글자 그대로
  const clamp = dom('[size=300]x[/size]', { limits: { maxSize: 200 } });
  assert.equal(clamp.querySelector('.bb-size').style.fontSize, '200%');
  const small = dom('[size=10]x[/size]', { limits: { minSize: 70 } });
  assert.equal(small.querySelector('.bb-size').style.fontSize, '70%');
});

test('최대 글자 수에서 잘림', () => {
  assert.equal(plain('a'.repeat(1000), { limits: { maxLength: 50 } }).length, 50);
});

test('이미지 명령어가 글자를 대체한다', () => {
  const cmds = { '~감사': { src: '/images/thanks.svg', alt: '~감사', height: '2.4em' } };
  const box = dom('고마워요 ~감사 정말', { commands: cmds });
  const img = box.querySelector('img.cmd-img');
  assert.equal(img.getAttribute('src'), '/images/thanks.svg');
  assert.equal(img.style.height, '2.4em');
  assert.equal(box.textContent, '고마워요  정말');
});

test('서식 안에서도 명령어가 이미지가 된다', () => {
  const cmds = { '~감사': { src: '/images/a.svg' } };
  const box = dom('[blink]~감사[/blink]', { commands: cmds });
  assert.ok(box.querySelector('.bb-blink img.cmd-img'));
});

test('긴 명령어가 짧은 명령어보다 우선', () => {
  const cmds = { '~감': { src: '/images/a.svg' }, '~감사': { src: '/images/b.svg' } };
  const box = dom('~감사', { commands: cmds });
  assert.equal(box.querySelector('img').getAttribute('src'), '/images/b.svg');
});

test('이미지 개수 한도를 넘으면 글자로 남는다', () => {
  const cmds = { '~a': { src: '/images/a.svg' } };
  const box = dom('~a~a~a~a', { commands: cmds, limits: { maxImages: 2 } });
  assert.equal(box.querySelectorAll('img').length, 2);
  assert.equal(box.textContent, '~a~a');
});

test('위험한 이미지 주소는 이미지가 되지 않는다', () => {
  for (const src of ['javascript:alert(1)', '//evil.example/x.png', 'http://insecure/x.png', 'data:image/svg+xml,<svg/>']) {
    const box = dom('~x', { commands: { '~x': { src } } });
    assert.equal(box.querySelectorAll('img').length, 0, src);
  }
});

test('치지직 이모티콘은 이벤트에 있을 때만 이미지', () => {
  const emojis = { d_47: 'https://ssl.pstatic.net/static/nng/glive/icon/b_07.gif?type=f60_60' };
  const box = dom('hi {:d_47:} {:nope:}', { emojis });
  assert.equal(box.querySelectorAll('img.cc-emoji').length, 1);
  assert.ok(box.textContent.includes('{:nope:}'));
  const bad = dom('{:x:}', { emojis: { x: 'javascript:alert(1)' } });
  assert.equal(bad.querySelectorAll('img').length, 0);
});

test('명령어 이미지 높이는 형식 검증', () => {
  const box = dom('~x', { commands: { '~x': { src: '/images/a.svg', height: '1px;background:red' } } });
  assert.equal(box.querySelector('img').style.height, '');
});

test('마퀴는 안쪽 요소로 감싼다', () => {
  const box = dom('[marquee]흘러[/marquee]');
  assert.equal(box.querySelector('.bb-marquee > .bb-marquee-inner').textContent, '흘러');
});

test('대문자 태그와 공백 없는 인자', () => {
  assert.ok(dom('[B]x[/B]').querySelector('.bb-b'));
  assert.equal(dom('[color=#FF0000]x[/color]').querySelector('.bb-color').style.color, 'rgb(255, 0, 0)');
});

test('열리지 못한 태그의 닫는 태그가 바깥 태그를 닫지 않는다', () => {
  const box = dom('[color=red]a [color=bad]b[/color] c[/color]');
  const el = box.querySelector('.bb-color');
  assert.equal(el.style.color, 'red');
  assert.equal(el.textContent, 'a [color=bad]b[/color] c');
});

test('형식이 틀린 여는 태그가 뒤의 정상 태그를 망치지 않는다', () => {
  const box = dom('[b=1]x [b]y[/b]');
  assert.equal(box.querySelector('.bb-b').textContent, 'y');
  assert.ok(box.textContent.startsWith('[b=1]x '));
});

test('폴더형 버전의 images/ 상대 경로는 허용하고, 경로 이동은 막는다', () => {
  const ok = dom('~x', { commands: { '~x': { src: 'images/%EC%8B%9D%EC%9D%80%EB%95%80.gif' } } });
  assert.equal(ok.querySelectorAll('img').length, 1);
  for (const src of ['images/../secret.png', 'images\\..\\x.png', 'other/x.png', 'file:///etc/passwd']) {
    assert.equal(dom('~x', { commands: { '~x': { src } } }).querySelectorAll('img').length, 0, src);
  }
});

// ---------- 태그 이름(별칭) ----------
test('태그 이름을 한글로 바꿔 쓸 수 있다 ([무지개]…[/무지개])', () => {
  const box = dom('[무지개]글자[/무지개]', { aliases: { 무지개: 'rainbow' } });
  assert.equal(box.querySelector('.bb-rainbow').textContent, '글자');
});

test('별칭을 지정하면 그 이름만 쓸 수 있다 (기본 영문 이름은 목록에 넣어야 동작)', () => {
  assert.equal(dom('[rainbow]x[/rainbow]', { aliases: { 무지개: 'rainbow' } }).querySelector('.bb-rainbow'), null);
  assert.ok(dom('[rainbow]x[/rainbow]', { aliases: { 무지개: 'rainbow', rainbow: 'rainbow' } }).querySelector('.bb-rainbow'));
});

test('별칭이 가리키는 태그가 허용 목록에 없으면 꾸미지 않는다', () => {
  const box = dom('[무지개]x[/무지개]', { aliases: { 무지개: 'rainbow' }, allowedTags: ['b'] });
  assert.equal(box.querySelector('.bb-rainbow'), null);
  assert.equal(box.textContent, '[무지개]x[/무지개]');
});

test('인자가 있는 태그도 한글 이름으로: [색=red], [크기=150]', () => {
  const al = { 색: 'color', 크기: 'size' };
  assert.equal(dom('[색=red]x[/색]', { aliases: al }).querySelector('.bb-color').style.color, 'red');
  assert.equal(dom('[크기=150]x[/크기]', { aliases: al }).querySelector('.bb-size').style.fontSize, '150%');
});

test('일상 글자와 겹치는 [숫자]나 모르는 이름은 글자 그대로', () => {
  assert.equal(dom('[1] [2023] [ㅋㅋ] [무지개]', { aliases: { 무지개2: 'rainbow' } }).textContent, '[1] [2023] [ㅋㅋ] [무지개]');
});

test('짝이 이름만 달라도(별칭/기본) 같은 태그면 닫힌다', () => {
  const box = dom('[무지개]x[/rainbow]', { aliases: { 무지개: 'rainbow', rainbow: 'rainbow' } });
  assert.equal(box.querySelector('.bb-rainbow').textContent, 'x');
});

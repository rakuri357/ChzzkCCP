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

test('닫는 태그가 없으면 메시지 끝까지 적용된다', () => {
  const box = dom('[b]안녕 [i]반가워');
  assert.equal(box.querySelector('.bb-b').textContent, '안녕 반가워');
  assert.equal(box.querySelector('.bb-b .bb-i').textContent, '반가워');
  assert.equal(box.textContent, '안녕 반가워');
});

test('닫는 태그만 있으면 글자로 남는다', () => {
  assert.equal(plain('안녕[/b]'), '안녕[/b]');
});

test('닫는 태그를 쓰면 그 범위까지만 적용되고, 섞어 써도 된다', () => {
  const box = dom('[b]굵게[/b] 보통 [color=red]빨강');
  assert.equal(box.querySelector('.bb-b').textContent, '굵게');
  assert.equal(box.querySelector('.bb-color').textContent, '빨강');
  assert.equal(box.textContent, '굵게 보통 빨강');
});

test('형식이 틀리거나 한도를 넘은 태그는 닫는 태그가 없어도 글자 그대로', () => {
  assert.equal(dom('[color=bad]x').textContent, '[color=bad]x');
  assert.equal(dom('[blink]x', { limits: { maxEffects: 0 } }).textContent, '[blink]x');
});

test('엇갈린 태그 처리', () => {
  const nodes = BB.parse('[b]a[i]b[/b]c[/i]');
  assert.equal(nodes[0].type, 'tag'); // [b]...[/b]는 정상적으로 닫히고
  assert.equal(nodes[0].name, 'b');
  assert.equal(BB.toPlainText(nodes), 'abc[/i]'); // [/b]를 만나면 안쪽 [i]도 함께 끝나고, 남은 [/i]는 글자로 남음
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

test('채팅콘 명령어가 글자를 대체한다', () => {
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

// ---------- 기본 이름, 한글 색, 새 태그 ----------
test('기본 이름: 영문, 단축, 한글 모두 쓸 수 있다', () => {
  for (const [tag, names] of Object.entries({ b: ['b', '굵게'], rainbow: ['rainbow', 'rb', '무지개'], wave: ['wave', 'wv', '물결', '파도'], pulse: ['pulse', 'pl', '맥박', '펄스'], size: ['size', 'sz', '크기'], color: ['color', 'cl', '색'] })) {
    for (const n of names) {
      const arg = tag === 'color' ? '=red' : tag === 'size' ? '=150' : '';
      assert.ok(dom('[' + n + arg + ']x[/' + n + ']').querySelector('.bb-' + tag), n);
    }
  }
});

test('기본 이름은 서로 겹치지 않는다', () => {
  const seen = {};
  for (const [tag, def] of Object.entries(BB.TAG_DEFS)) for (const n of def.names) { assert.ok(!seen[n], n); seen[n] = tag; }
});

test('색 이름을 한글로: [색=빨강], 초록과 녹색 모두', () => {
  assert.equal(dom('[색=빨강]x').querySelector('.bb-color').style.color, 'red');
  assert.equal(dom('[색=초록]x').querySelector('.bb-color').style.color, 'green');
  assert.equal(dom('[색=녹색]x').querySelector('.bb-color').style.color, 'green');
  assert.equal(dom('[색=하늘색]x').querySelector('.bb-color').style.color, 'skyblue');
  assert.equal(dom('[색=없는색]x').querySelector('.bb-color'), null);
});

test('한글 색 이름이 영어 색 24개를 모두 덮는다', () => {
  const targets = new Set();
  for (const k of ['빨강', '주황', '노랑', '초록', '연두', '청록', '아쿠아', '파랑', '남색', '보라', '자주', '마젠타', '분홍', '하양', '검정', '회색', '금색', '하늘', '토마토', '산호', '틸', '갈색', '은색']) {
    const el = dom('[색=' + k + ']x').querySelector('.bb-color');
    assert.ok(el, k);
    targets.add(el.style.color);
  }
  assert.equal(targets.size, 23); // gray와 grey는 같은 회색으로 처리
});

test('배경색, 테두리', () => {
  assert.equal(dom('[bg=yellow]x').querySelector('.bb-bg').style.backgroundColor, 'yellow');
  assert.equal(dom('[배경=노랑]x').querySelector('.bb-bg').style.backgroundColor, 'yellow');
  assert.equal(dom('[outline=red]x').querySelector('.bb-outline').style.getPropertyValue('--ol'), 'red');
  assert.equal(dom('[외곽]x').querySelector('.bb-outline').style.getPropertyValue('--ol'), '#000000');
  assert.equal(dom('[bg]x').querySelector('.bb-bg'), null);
});

test('그라데이션: 색 둘은 그라데이션, 하나면 단색, 셋 이상이나 틀린 색은 글자', () => {
  const two = dom('[grad=red,blue]x').querySelector('.bb-grad');
  assert.ok(two.classList.contains('bb-grad2'));
  assert.equal(two.style.getPropertyValue('--g1'), 'red');
  assert.equal(two.style.getPropertyValue('--g2'), 'blue');
  const one = dom('[그라=빨강]x').querySelector('.bb-grad');
  assert.equal(one.style.color, 'red');
  assert.ok(!one.classList.contains('bb-grad2'));
  assert.equal(dom('[grad=red,blue,green]x').querySelector('.bb-grad'), null);
  assert.equal(dom('[grad=red,nope]x').querySelector('.bb-grad'), null);
  assert.equal(dom('[grad]x').querySelector('.bb-grad'), null);
  assert.ok(dom('[grad=#ff0000,#0000ff]x').querySelector('.bb-grad2'));
});

test('물결과 타자기는 글자마다 나뉘고, 타자기는 3초 안에 끝난다', () => {
  const w = dom('[wave]abc[/wave]');
  assert.deepEqual([...w.querySelectorAll('.bb-wave .bb-c')].map((e) => e.textContent), ['a', 'b', 'c']);
  assert.equal(w.textContent, 'abc');
  const t = dom('[type]' + 'a'.repeat(100) + '[/type]');
  const cs = [...t.querySelectorAll('.bb-type .bb-c')];
  assert.equal(cs.length, 100);
  assert.ok(parseFloat(cs[99].style.animationDelay) <= 3);
  assert.equal(cs[0].style.animationDelay, '0.00s');
});

test('회전, 두근두근은 움직이는 효과 한도에 걸린다', () => {
  const box = dom('[spin]a[/spin][pulse]b[/pulse][wave]c[/wave][type]d[/type]');
  assert.equal(box.querySelectorAll('.bb-spin, .bb-pulse, .bb-wave').length, 3);
  assert.equal(box.querySelector('.bb-type'), null);
  assert.ok(box.textContent.includes('[type]d'));
});

test('태그 순서: 정적인 태그가 위, 움직이는 태그가 아래', () => {
  const defs = Object.values(BB.TAG_DEFS);
  const firstMoving = defs.findIndex((d) => d.effect);
  assert.ok(firstMoving > 0);
  assert.ok(defs.slice(0, firstMoving).every((d) => !d.effect));
  assert.ok(defs.slice(firstMoving).every((d) => d.effect));
});

// ---------- 태그 36개와 이름, 글자별 효과, 권한 없는 부분 숨기기 ----------
const fs = require('fs');
const path = require('path');

test('태그는 36개이고, 이름(영문, 단축, 한글)은 서로 겹치지 않는다', () => {
  const names = {};
  for (const [canon, def] of Object.entries(BB.TAG_DEFS)) {
    assert.ok(def.names.length >= 2 && def.names.length <= 6, canon);
    for (const n of def.names) { assert.ok(/^[A-Za-z0-9_가-힣]{1,12}$/.test(n), n); assert.ok(!(n in names), n + ' 중복'); names[n] = canon; }
  }
  assert.equal(Object.keys(BB.TAG_DEFS).length, 36);
});

test('추가한 한글 이름도 같은 태그로 동작한다 ([빛], [윤], [출렁], [두근] 등)', () => {
  const cases = { 빛: 'glow', 테두리: 'outline', 그라데이션: 'grad', 반짝반짝: 'twinkle', 윤: 'shine', 광: 'shine', 휴: 'hue', 불: 'fire', 글리치: 'glitch', 추: 'swing', 빙글: 'spin', 출렁: 'wave', 바운스: 'bounce', 두근: 'beat', 타닥: 'type', 마퀴: 'marquee' };
  for (const [name, canon] of Object.entries(cases)) {
    const arg = canon === 'grad' ? '=red,blue' : '';
    assert.ok(dom('[' + name + arg + ']x[/' + name + ']').querySelector('.bb-' + canon), name);
  }
  assert.ok(dom('[반짝]x[/반짝]').querySelector('.bb-glow'), '예전 이름도 그대로');
  assert.ok(dom('[물결]x[/물결]').querySelector('.bb-wave'), '예전 이름도 그대로');
  assert.ok(dom('[두근두근]x').querySelector('.bb-beat') === null, '태그 표시 이름은 태그 이름이 아니다');
});

test('새 태그가 모두 요소로 바뀌고 움직이는 효과 한도에 걸린다', () => {
  for (const canon of Object.keys(BB.TAG_DEFS)) {
    const def = BB.TAG_DEFS[canon];
    const arg = def.arg === 'color' ? '=red' : def.arg === 'colors' ? '=red,blue' : def.arg === 'size' ? '=150' : '';
    const box = dom('[' + canon + arg + ']글자[/' + canon + ']');
    assert.ok(box.querySelector('.bb-' + canon), canon);
    assert.equal(box.textContent, '글자', canon);
  }
  const moving = Object.keys(BB.TAG_DEFS).filter((c) => BB.TAG_DEFS[c].effect);
  assert.equal(moving.length, 26);
  const many = dom(moving.slice(0, 5).map((c) => '[' + c + ']x[/' + c + ']').join(''));
  assert.equal(many.querySelectorAll('.bb').length, 3, '움직이는 효과는 기본 3개까지');
});

test('네온은 색을 정할 수 있고 생략하면 기본 색이 들어간다', () => {
  assert.equal(dom('[neon=blue]x').querySelector('.bb-neon').style.getPropertyValue('--c'), 'blue');
  assert.equal(dom('[nn]x').querySelector('.bb-neon').style.getPropertyValue('--c'), '#ff2bd6');
  assert.equal(dom('[nn=zzz]x').querySelector('.bb-neon'), null, '틀린 색은 글자 그대로');
});

test('글자마다 움직이는 효과: 통통, 젤리, 파티는 순서대로, 별빛은 무작위로 시작한다', () => {
  for (const canon of ['bounce', 'jelly', 'party']) {
    const cs = [...dom('[' + canon + ']abcd[/' + canon + ']').querySelectorAll('.bb-' + canon + ' .bb-c')];
    assert.deepEqual(cs.map((c) => c.textContent), ['a', 'b', 'c', 'd'], canon);
    const delays = cs.map((c) => parseFloat(c.style.animationDelay));
    assert.ok(delays.every((d, i) => i === 0 || d > delays[i - 1]), canon + ' 순서대로');
  }
  const tw = [...dom('[twinkle]' + 'a'.repeat(30) + '[/twinkle]').querySelectorAll('.bb-twinkle .bb-c')];
  assert.equal(tw.length, 30);
  assert.ok(new Set(tw.map((c) => c.style.animationDelay)).size > 5, '시작 시간이 글자마다 다르다');
  assert.ok(tw.every((c) => parseFloat(c.style.animationDuration) >= 1.8 && parseFloat(c.style.animationDuration) <= 3.4));
});

test('스타일: 움직이는 태그와 꾸미는 태그마다 bbcode.css에 모양이 있다', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'bbcode.css'), 'utf8');
  for (const [canon, def] of Object.entries(BB.TAG_DEFS)) {
    if (def.effect || ['b', 'i', 'u', 's', 'glow', 'bg', 'outline', 'grad'].includes(canon)) assert.ok(css.includes('.bb-' + canon), canon + ' 스타일 없음');
  }
});

test('권한 없는 태그 숨기기(deniedTags): 태그 글자만 지우고 안의 글자는 남긴다', () => {
  const nodes = BB.parse('[rainbow]안녕[/rainbow] [rb]반가워', { allowedTags: ['b'], deniedTags: ['rainbow'] });
  assert.equal(BB.toPlainText(nodes), '안녕 반가워');
  assert.equal(nodes.stripped, 3);
  assert.equal(BB.parse('[b]x[/b]', { allowedTags: ['b'], deniedTags: [] }).stripped, 0);
  assert.equal(BB.toPlainText(BB.parse('[blink]x[/blink]', { allowedTags: ['b'], deniedTags: ['rainbow'] })), '[blink]x[/blink]', '허용도 거절도 아닌 태그는 글자 그대로');
});

test('권한 없는 명령어 숨기기: 글자만 지우고 이미지 개수는 쓰지 않는다', () => {
  const cmds = { '~모두': { src: '/images/a.png' }, '~구독': { denied: true } };
  const nodes = BB.parse('~구독 ~구독 ~모두 ~모두', { commands: cmds, limits: { maxImages: 2 } });
  assert.equal(nodes.stripped, 2);
  assert.equal(nodes.filter((n) => n.type === 'image').length, 2);
  assert.equal(BB.isBlank(BB.parse('~구독 ', { commands: cmds })), true);
  assert.equal(BB.isBlank(BB.parse('~구독 ~모두', { commands: cmds })), false);
  assert.equal(BB.isBlank(BB.parse('안녕', {})), false);
});

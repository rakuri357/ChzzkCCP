'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');
const { Store } = require('../src/server/store');
const { collect, renderHtml, exportPage, copyName } = require('../src/server/export-page');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
  const store = new Store(dir).init();
  store.saveImage('감사.png', PNG, '표정');
  store.saveImage('웃음.png', PNG, '표정/웃음');
  store.saveImage('구독.png', PNG, '');
  store.saveImage('비밀.png', PNG, '');
  store.saveImage('주인.png', PNG, '');
  store.save({
    commands: [
      { triggers: ['~감사', '~땡큐'], image: '표정/감사.png' },
      { triggers: ['~웃음'], image: '표정/웃음/웃음.png' },
      { triggers: ['~구독'], image: '구독.png', access: 'subscribers' },
      { triggers: ['~비밀'], image: '비밀.png', access: 'staff' },
      { triggers: ['~없는파일'], image: '없음.png' }
    ],
    bbcode: { tags: { rainbow: { access: 'subscribers' }, shake: { access: 'staff' }, blink: { enabled: false } } }
  });
  return store;
}

test('내보내기: 시청자가 쓸 수 있는 명령어만 담고, 구독자 전용은 표시한다', () => {
  const store = makeStore();
  const d = collect(store.config, store.listImages());
  const byImage = Object.fromEntries(d.commands.map((c) => [c.image, c]));
  assert.deepEqual(Object.keys(byImage).sort(), ['구독.png', '표정/감사.png', '표정/웃음/웃음.png'].sort());
  assert.equal(byImage['구독.png'].subscriber, true);
  assert.equal(byImage['표정/감사.png'].subscriber, false);
  assert.deepEqual(byImage['표정/감사.png'].triggers, ['~감사', '~땡큐']);
  assert.equal(byImage['표정/웃음/웃음.png'].tag, '표정/웃음');
  assert.equal(byImage['표정/감사.png'].src, 'images/' + encodeURIComponent('표정') + '/' + encodeURIComponent('감사.png'));
});

test('내보내기: BBCode는 시청자에게 허용되고 켜진 태그만, 이름과 예시를 담는다', () => {
  const store = makeStore();
  const d = collect(store.config, store.listImages());
  const labels = d.bbtags.map((t) => t.label);
  assert.ok(labels.includes('굵게'));
  assert.ok(!labels.includes('흔들림'), '운영진 전용은 뺀다');
  assert.ok(!labels.includes('깜빡임'), '꺼진 태그는 뺀다');
  const rainbow = d.bbtags.find((t) => t.label === '무지개');
  assert.equal(rainbow.subscriber, true);
  assert.deepEqual(rainbow.names, ['rainbow', 'rb', '무지개']);
  assert.equal(rainbow.copy, 'rb');
  assert.equal(rainbow.text, '무지개');
  assert.equal(d.aliases.rb, 'rainbow');
  const off = store.config;
  off.bbcode.enabled = false;
  assert.deepEqual(collect(off, store.listImages()).bbtags, []);
});

test('내보내기: viewer-page 폴더에 index.html과 사용하는 이미지만 복사한다', () => {
  const store = makeStore();
  const r = exportPage(store);
  assert.equal(r.commands, 3);
  assert.equal(r.images, 3);
  const html = fs.readFileSync(path.join(r.dir, 'index.html'), 'utf8');
  assert.ok(html.includes('<title>명령어 목록</title>'));
  assert.ok(fs.existsSync(path.join(r.dir, 'images', '표정', '감사.png')));
  assert.ok(fs.existsSync(path.join(r.dir, 'images', '표정', '웃음', '웃음.png')));
  assert.ok(!fs.existsSync(path.join(r.dir, 'images', '비밀.png')), '운영진 전용 이미지는 복사하지 않는다');
  // 다시 내보내면 지난 내용은 지우고 새로 만든다
  fs.writeFileSync(path.join(r.dir, '옛날.txt'), 'x');
  exportPage(store);
  assert.ok(!fs.existsSync(path.join(r.dir, '옛날.txt')));
});

test('내보내기: 데이터가 HTML로 해석되지 않는다', () => {
  const html = renderHtml({ commands: [{ image: 'a.png', src: 'images/a.png', tag: '', name: 'a.png', triggers: ['~</script><img src=x onerror=alert(1)>'], subscriber: false }], bbtags: [], limits: {} });
  assert.equal(html.split('</script>').length - 1, 3, '데이터 안의 </script>가 스크립트를 끝내지 못한다');
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  assert.equal(dom.window.document.querySelectorAll('img[onerror]').length, 0);
  assert.ok(dom.window.document.querySelector('.chip').textContent.includes('</script>'));
});

// ---------- 페이지 동작 ----------
function openPage() {
  const store = makeStore();
  const d = collect(store.config, store.listImages());
  const copied = [];
  const dom = new JSDOM(renderHtml(d), {
    runScripts: 'dangerously',
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } });
    }
  });
  return { doc: dom.window.document, win: dom.window, copied };
}
const visible = (doc) => [...doc.querySelectorAll('.card')].filter((c) => !c.hidden).map((c) => c.querySelector('.chip').textContent);

test('페이지: 격자와 태그 버튼이 나오고, 구독자 전용이 표시된다', () => {
  const { doc } = openPage();
  assert.equal(doc.querySelectorAll('.card').length, 3);
  assert.equal(doc.getElementById('count').textContent, '3개');
  const labels = [...doc.querySelectorAll('#tags button')].map((b) => b.textContent);
  assert.deepEqual(labels, ['전체', '표정', '표정/웃음']);
  assert.equal(doc.querySelectorAll('.sub').length, 1);
  assert.equal(doc.getElementById('bbsec').hidden, false);
  assert.ok(doc.getElementById('bbnote').textContent.includes('빨강'));
});

test('페이지: 명령어와 태그로 검색한다 (이미지 이름은 대상이 아니다)', () => {
  const { doc, win } = openPage();
  const q = doc.getElementById('q');
  const type = (v) => { q.value = v; q.dispatchEvent(new win.Event('input')); };
  type('땡큐'); assert.deepEqual(visible(doc), ['~감사']);
  type('표정'); assert.equal(visible(doc).length, 2, '태그 이름으로 그 태그의 이미지를 찾는다');
  type('웃음.png'); assert.equal(visible(doc).length, 0, '이미지 이름은 검색하지 않는다');
  assert.equal(doc.getElementById('empty').hidden, false);
  type(''); assert.equal(visible(doc).length, 3);
});

test('페이지: 태그 버튼은 하위 태그까지 걸러 준다', () => {
  const { doc, win } = openPage();
  const btn = (t) => [...doc.querySelectorAll('#tags button')].find((b) => b.textContent === t);
  btn('표정').dispatchEvent(new win.Event('click'));
  assert.equal(visible(doc).length, 2);
  btn('표정/웃음').dispatchEvent(new win.Event('click'));
  assert.deepEqual(visible(doc), ['~웃음']);
  assert.equal(btn('표정/웃음').getAttribute('aria-pressed'), 'true');
  btn('전체').dispatchEvent(new win.Event('click'));
  assert.equal(visible(doc).length, 3);
});

test('페이지: 이미지를 누르면 첫 명령어가, 칩을 누르면 그 명령어가 복사된다', async () => {
  const { doc, win, copied } = openPage();
  const card = [...doc.querySelectorAll('.card')].find((c) => c.querySelector('.chip').textContent === '~감사');
  card.querySelector('.thumb').dispatchEvent(new win.Event('click'));
  card.querySelectorAll('.chip')[1].dispatchEvent(new win.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(copied, ['~감사', '~땡큐']);
  assert.ok(doc.getElementById('toast').textContent.includes('복사했습니다'));
});

test('페이지: 터치 화면에서는 이미지를 누르면 명령어 창이 열린다', () => {
  const store = makeStore();
  const dom = new JSDOM(renderHtml(collect(store.config, store.listImages())), {
    runScripts: 'dangerously',
    beforeParse(w) { w.matchMedia = (q) => ({ matches: q.includes('hover: none'), media: q }); }
  });
  const doc = dom.window.document;
  doc.querySelector('.thumb').dispatchEvent(new dom.window.Event('click'));
  assert.ok(doc.getElementById('sheetbg').classList.contains('open'));
  assert.ok(doc.querySelectorAll('#sheet .chip').length >= 1);
  doc.querySelector('#sheet .close').dispatchEvent(new dom.window.Event('click'));
  assert.ok(!doc.getElementById('sheetbg').classList.contains('open'));
});

test('페이지: 보여 줄 명령어가 없으면 안내만 나온다', () => {
  const dom = new JSDOM(renderHtml({ commands: [], bbtags: [], limits: {} }), { runScripts: 'dangerously' });
  const doc = dom.window.document;
  assert.equal(doc.getElementById('empty').hidden, false);
  assert.equal(doc.getElementById('empty').textContent, '표시할 명령어가 없습니다.');
  assert.equal(doc.getElementById('tags').hidden, true);
});

test('복사할 이름: 영문 이름 중 가장 짧은 것, 영문이 없으면 남은 이름 중 가장 짧은 것', () => {
  assert.equal(copyName(['rainbow', 'rb', '무지개']), 'rb');
  assert.equal(copyName(['b', '굵게']), 'b');
  assert.equal(copyName(['wave', 'wv', '물결', '파도']), 'wv');
  assert.equal(copyName(['굵게', '진하게']), '굵게');
  assert.equal(copyName(['color', '색', 'cl']), 'cl');
  assert.equal(copyName(['bg', 'ab']), 'bg', '길이가 같으면 앞선 이름');
});

test('BBCode 태그 순서: 정적인 태그가 위, 움직이는 태그가 아래', () => {
  const store = makeStore();
  const effects = collect(store.config, store.listImages()).bbtags.map((t) => t.effect);
  assert.equal(effects.indexOf(true) > 0, true);
  assert.equal(effects.slice(effects.indexOf(true)).every(Boolean), true, '움직임 태그가 모두 아래쪽에 모여 있다');
});

// ---------- BBCode 표 ----------
function rowOf(doc, label) { return [...doc.querySelectorAll('.bbrow')].find((r) => r.querySelector('.bbname').firstChild.textContent === label); }
const click = (win, el) => el.dispatchEvent(new win.Event('click', { bubbles: true }));

test('페이지: BBCode 줄을 누르면 영문 이름 중 가장 짧은 이름의 여는 태그가 복사된다', async () => {
  const { doc, win, copied } = openPage();
  click(win, rowOf(doc, '굵게'));
  click(win, rowOf(doc, '무지개'));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(copied, ['[b]', '[rb]']);
  assert.ok(doc.getElementById('toast').textContent.includes('[rb]'));
});

test('페이지: 색과 크기는 눌러서 복사할 때마다 값이 들어가고, 한도 안의 값이다', async () => {
  const { doc, win, copied } = openPage();
  for (let i = 0; i < 20; i++) { click(win, rowOf(doc, '글자 색')); click(win, rowOf(doc, '글자 크기')); click(win, rowOf(doc, '그라데이션')); click(win, rowOf(doc, '배경색')); }
  await new Promise((r) => setTimeout(r, 10));
  const colors = copied.filter((t) => t.startsWith('[cl='));
  const sizes = copied.filter((t) => t.startsWith('[sz='));
  const grads = copied.filter((t) => t.startsWith('[gr='));
  const bgs = copied.filter((t) => t.startsWith('[bg='));
  assert.equal(colors.length, 20);
  assert.ok(colors.every((t) => /^\[cl=[a-z]+\]$/.test(t)));
  assert.ok(new Set(colors).size > 1, '누를 때마다 값이 바뀐다');
  assert.ok(sizes.every((t) => { const n = Number(/=(\d+)\]/.exec(t)[1]); return n >= 70 && n <= 200 && n % 10 === 0; }));
  assert.ok(grads.every((t) => { const m = /^\[gr=([a-z]+),([a-z]+)\]$/.exec(t); return m && m[1] !== m[2]; }));
  assert.ok(bgs.every((t) => /^\[bg=(yellow|lime|pink|skyblue|cyan|gold|coral|orange)\]$/.test(t)));
});

test('페이지: BBCode 샘플이 실제로 꾸며져 보이고, 움직임은 올렸을 때만 켜진다', () => {
  const { doc, win } = openPage();
  assert.ok(rowOf(doc, '굵게').querySelector('.sample .bb-b'));
  assert.ok(rowOf(doc, '무지개').querySelector('.sample .bb-rainbow'));
  assert.ok(rowOf(doc, '물결').querySelector('.sample .bb-wave .bb-c'));
  assert.ok(rowOf(doc, '글자 색').querySelector('.sample .bb-color').style.color);
  assert.equal(rowOf(doc, '굵게').querySelector('.bbsample code').textContent, '[b]굵게[/b]');
  const row = rowOf(doc, '물결');
  assert.ok(!row.querySelector('.sample').classList.contains('play'));
  row.dispatchEvent(new win.Event('mouseenter'));
  assert.ok(row.querySelector('.sample').classList.contains('play'));
  row.dispatchEvent(new win.Event('mouseleave'));
  assert.ok(!row.querySelector('.sample').classList.contains('play'));
});

test('페이지: 소제목은 BBCode (글자 꾸미기)이고, 이름은 눌리는 버튼이 아니라 줄 전체가 버튼이다', () => {
  const { doc } = openPage();
  assert.equal(doc.querySelector('#bbsec h2').textContent, 'BBCode (글자 꾸미기)');
  assert.ok(doc.querySelectorAll('.bbrow').length >= 10);
  assert.ok([...doc.querySelectorAll('.bbrow')].every((r) => r.tagName === 'BUTTON'));
  assert.equal(doc.querySelectorAll('.bbrow button').length, 0);
});

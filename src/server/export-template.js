'use strict';
// 시청자용 명령어 페이지(index.html)의 틀입니다. 서버 없이 열리는 한 파일이고, 데이터는 /*DATA*/ 자리에 JSON으로 들어갑니다.
// 화면의 글자는 모두 textContent로만 넣습니다. (데이터가 HTML로 해석되지 않습니다.)
module.exports = String.raw`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>명령어 목록</title>
<style>
/*BBCSS*/
:root {
  --bg: #f5f6fb; --card: #ffffff; --ink: #1c2033; --muted: #666d85; --line: #dfe2ee;
  --accent: #4a56e2; --accent-soft: #e9ebff; --thumb: #eceef6; --shadow: 0 1px 3px rgba(20, 24, 50, .12);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #14161f; --card: #1d2030; --ink: #eceffa; --muted: #98a0bb; --line: #30354b;
    --accent: #9aa4ff; --accent-soft: #2a2f55; --thumb: #262a3e; --shadow: 0 1px 3px rgba(0, 0, 0, .5);
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--ink); word-break: keep-all; overflow-wrap: anywhere; font: 15px/1.55 'Pretendard', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 20px 16px 64px; }
.bar { padding: 12px 0 10px; }
.search { width: 100%; padding: 11px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--ink); font: inherit; }
.search:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.tags button { border: 1px solid var(--line); background: var(--card); color: var(--ink); border-radius: 999px; padding: 4px 13px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.tags button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.count { margin: 8px 2px 0; color: var(--muted); font-size: 13px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 10px; margin-top: 8px; }
.card { position: relative; aspect-ratio: 1; border-radius: 14px; background: var(--card); box-shadow: var(--shadow); overflow: hidden; }
.card[hidden] { display: none; }
.thumb { display: block; width: 100%; height: 100%; padding: 10px; border: 0; background: var(--thumb); cursor: pointer; }
.thumb img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.thumb:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; }
.sub { position: absolute; top: 6px; left: 6px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 1px 8px; pointer-events: none; }
.tip { position: absolute; inset: 0; display: none; flex-direction: column; justify-content: flex-end; gap: 6px; padding: 8px; background: linear-gradient(to top, rgba(10, 12, 28, .92) 55%, rgba(10, 12, 28, .55)); color: #fff; overflow: auto; pointer-events: none; }
@media (hover: hover) {
  .card:hover .tip { display: flex; }
}
.card:has(:focus-visible) .tip { display: flex; } /* 키보드로 이동할 때 */
@media (hover: none) { .tip { display: none !important; } } /* 터치 화면은 눌러서 여는 창을 씁니다 */
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.tip .chip { pointer-events: auto; }
.chip { border: 0; border-radius: 999px; background: #ffffff; color: #1c2033; font: inherit; font-size: 13px; font-weight: 700; padding: 2px 10px; cursor: pointer; }
.chip:hover { background: var(--accent-soft); }
.tagtext { font-size: 12px; opacity: .85; }
.empty { margin: 36px 0; text-align: center; color: var(--muted); }
h2 { font-size: 17px; margin: 40px 0 6px; }
.lead { margin: 0 0 12px; color: var(--muted); font-size: 14px; }
.bblist { display: grid; gap: 8px; }
.bbrow { display: grid; grid-template-columns: 150px minmax(0, 1fr) minmax(0, 1.3fr); gap: 6px 14px; align-items: center; width: 100%; text-align: left; font: inherit; color: inherit; background: var(--card); border: 0; border-radius: 12px; padding: 10px 14px; box-shadow: var(--shadow); cursor: pointer; }
.bbrow:hover { outline: 2px solid var(--accent-soft); }
.bbrow:focus-visible { outline: 3px solid var(--accent); }
.bbname { font-weight: 700; }
.badge { display: inline-block; margin-left: 6px; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 0 7px; background: var(--accent-soft); color: var(--accent); vertical-align: 1px; }
code { font: 13px ui-monospace, Menlo, Consolas, monospace; background: var(--accent-soft); color: var(--ink); border-radius: 6px; padding: 1px 6px; overflow-wrap: anywhere; }
.bbsample { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; min-width: 0; }
.sample { font-size: 18px; line-height: 1.5; }
/* 움직이는 태그는 마우스를 올리거나 눌렀을 때만 움직입니다. (평소에는 멈춘 모양) */
.sample:not(.play) .bb, .sample:not(.play) .bb-c, .sample:not(.play) .bb-marquee-inner { animation: none !important; }
.sample:not(.play) .bb-type .bb-c { opacity: 1; }
.sample:not(.play) .bb-marquee-inner { padding-left: 0; }
.note { color: var(--muted); font-size: 13px; margin: 10px 2px 0; }
@media (max-width: 640px) { .bbrow { grid-template-columns: 1fr; } }
.sheetbg { position: fixed; inset: 0; z-index: 20; display: none; align-items: flex-end; justify-content: center; background: rgba(10, 12, 28, .55); }
.sheetbg.open { display: flex; }
.sheet { width: min(480px, 100%); background: var(--card); border-radius: 18px 18px 0 0; padding: 16px 16px 24px; box-shadow: 0 -4px 24px rgba(0, 0, 0, .3); }
.sheet img { display: block; width: 120px; height: 120px; object-fit: contain; margin: 0 auto 10px; background: var(--thumb); border-radius: 12px; padding: 8px; }
.sheet .chips { justify-content: center; }
.sheet .chip { font-size: 16px; padding: 6px 16px; background: var(--accent); color: #fff; }
.sheet .tagtext { display: block; text-align: center; margin-top: 10px; color: var(--muted); }
.sheet .close { display: block; margin: 14px auto 0; border: 1px solid var(--line); background: none; color: var(--ink); border-radius: 999px; padding: 5px 20px; font: inherit; cursor: pointer; }
.toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); width: max-content; max-width: calc(100vw - 32px); text-align: center; z-index: 30; background: #1c2033; color: #fff; padding: 9px 18px; border-radius: 999px; font-size: 14px; font-weight: 600; opacity: 0; pointer-events: none; transition: opacity .2s; }
.toast.show { opacity: 1; }
</style>
</head>
<body>
<main>
  <div class="bar">
    <input id="q" class="search" type="search" placeholder="명령어나 태그로 찾기" aria-label="명령어나 태그로 찾기" autocomplete="off">
    <div id="tags" class="tags" hidden></div>
    <div id="count" class="count" aria-live="polite"></div>
  </div>
  <div id="grid" class="grid"></div>
  <p id="empty" class="empty" hidden></p>
  <section id="bbsec" hidden>
    <h2>BBCode (글자 꾸미기)</h2>
    <p class="lead">채팅에 <code>[태그]글자[/태그]</code>처럼 쓰면 꾸며집니다. 닫는 태그는 생략할 수 있고, 그러면 메시지 끝까지 적용됩니다.<br>줄을 누르면 태그가 복사됩니다. 색과 크기는 누를 때마다 값이 바뀌고, 움직이는 태그는 마우스를 올리거나 누르면 움직입니다.</p>
    <div id="bb" class="bblist"></div>
    <p id="bbnote" class="note"></p>
  </section>
</main>
<div id="sheetbg" class="sheetbg" role="dialog" aria-modal="true" aria-label="명령어">
  <div class="sheet" id="sheet"></div>
</div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script id="data" type="application/json">/*DATA*/</script>
<script>/*BBJS*/</script>
<script>
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('data').textContent);
  var items = data.commands || [];
  var $ = function (id) { return document.getElementById(id); };
  var touch = window.matchMedia && window.matchMedia('(hover: none)').matches;
  var state = { q: '', tag: '' };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------- 복사 ----------
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1600);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  function copy(text) {
    function done(ok) { toast(ok ? '복사했습니다: ' + text : '복사하지 못했습니다. 직접 입력하십시오: ' + text); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
    } else {
      done(fallbackCopy(text));
    }
  }

  // ---------- 명령어 격자 ----------
  function chipsFor(item) {
    var box = el('div', 'chips');
    item.triggers.forEach(function (t) {
      var b = el('button', 'chip', t);
      b.type = 'button';
      b.addEventListener('click', function (e) { e.stopPropagation(); copy(t); });
      box.appendChild(b);
    });
    return box;
  }

  var cards = items.map(function (item) {
    var card = el('div', 'card');
    var thumb = el('button', 'thumb');
    thumb.type = 'button';
    thumb.setAttribute('aria-label', item.triggers.join(', '));
    var img = document.createElement('img');
    img.src = item.src; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    thumb.appendChild(img);
    thumb.addEventListener('click', function () {
      if (touch) openSheet(item); else copy(item.triggers[0]);
    });
    card.appendChild(thumb);
    if (item.subscriber) card.appendChild(el('span', 'sub', '구독자'));
    var tip = el('div', 'tip');
    tip.appendChild(chipsFor(item));
    if (item.tag) tip.appendChild(el('div', 'tagtext', '태그: ' + item.tag));
    card.appendChild(tip);
    card._item = item;
    return card;
  });
  var grid = $('grid');
  cards.forEach(function (c) { grid.appendChild(c); });

  // ---------- 폰: 눌러서 보는 창 ----------
  var sheetbg = $('sheetbg');
  function closeSheet() { sheetbg.classList.remove('open'); }
  function openSheet(item) {
    var s = $('sheet');
    s.textContent = '';
    var img = document.createElement('img');
    img.src = item.src; img.alt = '';
    s.appendChild(img);
    s.appendChild(chipsFor(item));
    if (item.subscriber) s.appendChild(el('span', 'tagtext', '구독자 전용'));
    if (item.tag) s.appendChild(el('span', 'tagtext', '태그: ' + item.tag));
    var close = el('button', 'close', '닫기');
    close.type = 'button';
    close.addEventListener('click', closeSheet);
    s.appendChild(close);
    sheetbg.classList.add('open');
  }
  sheetbg.addEventListener('click', function (e) { if (e.target === sheetbg) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  // ---------- 검색과 태그 ----------
  function matches(item) {
    if (state.tag && !(item.tag === state.tag || item.tag.indexOf(state.tag + '/') === 0)) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    if (item.tag.toLowerCase().indexOf(q) >= 0) return true;
    return item.triggers.some(function (t) { return t.toLowerCase().indexOf(q) >= 0; });
  }
  function apply() {
    var shown = 0;
    cards.forEach(function (c) {
      var ok = matches(c._item);
      c.hidden = !ok;
      if (ok) shown++;
    });
    $('count').textContent = items.length ? shown + '개' : '';
    var empty = $('empty');
    empty.hidden = shown > 0;
    empty.textContent = items.length ? '찾는 명령어가 없습니다.' : '표시할 명령어가 없습니다.';
  }
  $('q').addEventListener('input', function (e) { state.q = e.target.value; apply(); });

  var tagList = [];
  items.forEach(function (it) {
    if (!it.tag) return;
    var parts = it.tag.split('/');
    for (var i = 1; i <= parts.length; i++) {
      var p = parts.slice(0, i).join('/');
      if (tagList.indexOf(p) < 0) tagList.push(p);
    }
  });
  tagList.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  if (tagList.length) {
    var tagBox = $('tags');
    tagBox.hidden = false;
    var buttons = [];
    function addTagButton(label, value) {
      var b = el('button', null, label);
      b.type = 'button';
      b.setAttribute('aria-pressed', value === state.tag ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.tag = value;
        buttons.forEach(function (x) { x.b.setAttribute('aria-pressed', x.v === state.tag ? 'true' : 'false'); });
        apply();
      });
      buttons.push({ b: b, v: value });
      tagBox.appendChild(b);
    }
    addTagButton('전체', '');
    tagList.forEach(function (t) { addTagButton(t, t); });
  }
  apply();

  // ---------- BBCode ----------
  var COLORS = ['red', 'orange', 'yellow', 'green', 'lime', 'cyan', 'blue', 'purple', 'violet', 'magenta', 'pink', 'gold', 'skyblue', 'tomato', 'coral', 'teal'];
  var BG_COLORS = ['yellow', 'lime', 'pink', 'skyblue', 'cyan', 'gold', 'coral', 'orange']; // 글자가 잘 읽히는 밝은 색
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function randSize(lim) {
    var lo = Math.ceil(lim.minSize / 10), hi = Math.floor(lim.maxSize / 10);
    return hi >= lo ? (lo + Math.floor(Math.random() * (hi - lo + 1))) * 10 : lim.maxSize;
  }
  // 여는 태그를 만듭니다. 값이 필요한 태그는 누를 때마다 다른 값이 들어갑니다.
  function openTag(t) {
    var lim = data.limits || { minSize: 70, maxSize: 200 };
    switch (t.arg) {
      case 'color': return '[' + t.copy + '=' + (t.canon === 'bg' ? pick(BG_COLORS) : pick(COLORS)) + ']';
      case 'color?': return '[' + t.copy + '=' + pick(COLORS) + ']';
      case 'colors': {
        var a = pick(COLORS), b = pick(COLORS);
        while (b === a) b = pick(COLORS);
        return '[' + t.copy + '=' + a + ',' + b + ']';
      }
      case 'size': return '[' + t.copy + '=' + randSize(lim) + ']';
      default: return '[' + t.copy + ']';
    }
  }
  var randomArgs = { 'color': 1, 'color?': 1, 'colors': 1, 'size': 1 };

  var tagsInfo = data.bbtags || [];
  if (tagsInfo.length && window.ChatMarkup) {
    $('bbsec').hidden = false;
    var bb = $('bb');
    var canons = tagsInfo.map(function (t) { return t.canon; });
    var limits = { maxEffects: 20 };
    if (data.limits) { limits.minSize = data.limits.minSize; limits.maxSize = data.limits.maxSize; }
    tagsInfo.forEach(function (t) {
      var row = el('button', 'bbrow');
      row.type = 'button';
      row.setAttribute('aria-label', t.label + ' 태그 복사');
      var name = el('span', 'bbname', t.label);
      if (t.effect) name.appendChild(el('span', 'badge', '움직임'));
      if (t.subscriber) name.appendChild(el('span', 'badge', '구독자'));
      if (randomArgs[t.arg]) name.appendChild(el('span', 'badge', '값이 바뀜'));
      row.appendChild(name);
      var names = el('span');
      t.names.forEach(function (n, i) {
        if (i) names.appendChild(document.createTextNode(' '));
        names.appendChild(el('code', null, n));
      });
      row.appendChild(names);
      var box = el('span', 'bbsample');
      var sample = el('span', 'sample');
      var ex = el('code');
      box.appendChild(sample);
      box.appendChild(ex);
      row.appendChild(box);

      function show(tag) {
        var markup = tag + t.text + '[/' + t.copy + ']';
        sample.textContent = '';
        sample.appendChild(window.ChatMarkup.render(markup, document, { aliases: data.aliases, allowedTags: canons, limits: limits }));
        ex.textContent = markup;
      }
      var current = openTag(t);
      show(current);
      var stopTimer = null;
      function play() { clearTimeout(stopTimer); sample.classList.add('play'); }
      function stop() { clearTimeout(stopTimer); sample.classList.remove('play'); }
      row.addEventListener('mouseenter', play);
      row.addEventListener('mouseleave', stop);
      row.addEventListener('focus', play);
      row.addEventListener('blur', stop);
      row.addEventListener('click', function () {
        current = openTag(t);   // 눌렀을 때 바뀐 값을 보여 주고, 그대로 복사합니다.
        show(current);
        copy(current);
        play();
        if (touch) { stopTimer = setTimeout(stop, 3000); }
      });
      bb.appendChild(row);
    });
    var notes = ['색은 영어(red), 한글(빨강), #ff5577 형식으로 쓸 수 있습니다.'];
    if (data.limits) {
      notes.push('글자 크기는 ' + data.limits.minSize + '~' + data.limits.maxSize + '%까지, 움직이는 효과는 한 메시지에 ' + data.limits.maxEffects + '개까지 적용됩니다.');
    }
    $('bbnote').textContent = notes.join(' ');
  }
})();
</script>
</body>
</html>
`;

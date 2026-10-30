/* input.html: ChzzkChatConPlus 앱(로컬 서버)과 통신하며 설정과 이미지를 편집합니다. 바꾸면 자동으로 저장됩니다. */
(function () {
  'use strict';
  var BB = ChatMarkup;
  var L = Lite;

  var S = {
    cfg: L.normalizeConfig(null),
    images: [],            // { name, size }
    status: { state: 'no-channel', detail: {} },
    recent: [],            // 최근에 받은 채팅 (연결 확인용)
    dataDir: '', urls: { overlay: '' }, canOpenFolder: false
  };
  window.__app = { state: S };

  // ---------- 작은 도구 ----------
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'open') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }
  var toastTimer;
  function toast(msg, bad) {
    var t = $('toast');
    t.textContent = msg; t.className = 'on' + (bad ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = ''; }, 3200);
  }
  function setChip(kind, text) { var c = $('savechip'); c.className = 'chip ' + kind; c.textContent = text; }
  function field(label, input, cls) { return h('div', { class: 'field ' + (cls || '') }, h('label', { text: label }), input); }
  function check(label, checked, onchange) {
    var i = h('input', { type: 'checkbox', checked: !!checked, onchange: function () { onchange(i.checked); } });
    return h('label', { class: 'check' }, i, label);
  }
  function text(value, oninput, extra) {
    return h('input', Object.assign({ type: 'text', value: value == null ? '' : value, oninput: function (e) { oninput(e.target.value); } }, extra || {}));
  }
  function num(value, min, max, oninput) {
    return h('input', { type: 'number', value: value, min: min, max: max, oninput: function (e) {
      var n = parseFloat(e.target.value); if (isFinite(n)) oninput(n);
    } });
  }
  function kb(n) { return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + 'KB' : (n / 1024 / 1024).toFixed(1) + 'MB'; }
  function clock() { var d = new Date(); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (x) { return (x < 10 ? '0' : '') + x; }).join(':'); }


  // ---------- 서버 통신 ----------
  function api(method, path, body, raw) {
    var opts = { method: method, headers: { 'X-Requested-With': 'app' } };
    if (body !== undefined) {
      if (raw) { opts.body = body; opts.headers['Content-Type'] = 'application/octet-stream'; }
      else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    }
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('요청에 실패했습니다 (' + r.status + ')'));
        return j;
      });
    });
  }

  var saveTimer = null;
  function updatePreview() {
    try { $('pv').contentWindow.postMessage({ type: 'cc-config', config: L.normalizeConfig(S.cfg) }, '*'); } catch (e) { /* 미리보기 로딩 전 */ }
  }
  $('pv').addEventListener('load', updatePreview);

  function changed() {
    updatePreview();
    setChip('warn', '저장 중…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
  }
  function save() {
    clearTimeout(saveTimer); saveTimer = null;
    return api('PUT', '/api/config', L.normalizeConfig(S.cfg))
      .then(function () { setChip('ok', '저장됨 ' + clock()); })
      .catch(function (e) { setChip('bad', '저장 실패: ' + e.message); });
  }
  function flush() { if (saveTimer) save(); }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });

  // ---------- 앱이 보내 주는 소식(연결 상태, 받은 채팅) ----------
  var wsRetry = 0;
  function connectWs() {
    var ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws');
    ws.onopen = function () { wsRetry = 0; };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'status') { S.status = m.status; renderConn(); }
      else if (m.type === 'chat') { S.recent.push(m.msg); if (S.recent.length > 10) S.recent.shift(); renderRecent(); }
      else if (m.type === 'recent') { S.recent = m.list; renderRecent(); }
    };
    ws.onclose = function () { wsRetry++; setTimeout(connectWs, Math.min(5000, 500 * wsRetry)); };
    ws.onerror = function () { try { ws.close(); } catch (e) { /* 무시 */ } };
  }

  // ---------- 단락 접기/펴기 ----------
  S.sections = {};
  function begin(id, key, title, extra) {
    var card = $(id); card.textContent = '';
    var collapsed = !!S.cfg.ui.collapsed[key];
    var arrow = h('span', { class: 'arrow', text: collapsed ? '▸' : '▾', 'aria-hidden': 'true' });
    var sum = h('span', { class: 'sum', hidden: !collapsed });
    var head = h('button', { type: 'button', class: 'sechead', 'aria-expanded': String(!collapsed), onclick: function () { toggleSection(key); } },
      arrow, h('span', { class: 'sectitle', text: title }), sum);
    var body = h('div', { class: 'secbody', hidden: collapsed });
    card.appendChild(h('div', { class: 'sechead-row' }, head, extra || null)); card.appendChild(body);
    S.sections[key] = { head: head, body: body, arrow: arrow, sum: sum };
    updateSummaries();
    return body;
  }

  function applySection(key) {
    var sec = S.sections[key];
    if (!sec) return;
    var collapsed = !!S.cfg.ui.collapsed[key];
    sec.body.hidden = collapsed;
    sec.sum.hidden = !collapsed;
    sec.arrow.textContent = collapsed ? '▸' : '▾';
    sec.head.setAttribute('aria-expanded', String(!collapsed));
  }

  function setCollapsed(key, on) {
    if (on) S.cfg.ui.collapsed[key] = true; else delete S.cfg.ui.collapsed[key];
    applySection(key);
  }
  function toggleSection(key) { setCollapsed(key, !S.cfg.ui.collapsed[key]); updateSummaries(); changed(); }
  function setAllSections(on) { L.SECTION_KEYS.forEach(function (k) { setCollapsed(k, on); }); updateSummaries(); changed(); }

  // 접어 두어도 상태를 알 수 있게 제목 옆에 한 줄 요약을 보여 줌
  function summaryFor(key) {
    var cfg = S.cfg;
    if (key === 'obs') return S.urls.overlay || '';
    if (key === 'channel') {
      var st = S.status.state;
      if (!cfg.channel.channelId) return '링크를 입력하십시오';
      return st === 'connected' ? '✓ 연결됨' : st === 'retry' ? '✗ 연결 실패' : '연결 중…';
    }
    if (key === 'images') {
      var n = 0; cfg.commands.forEach(function (c) { n += c.triggers.length; });
      return '이미지 ' + S.images.length + '개 · 명령어 ' + n + '개' + (S.folders.length ? ' · 태그 ' + S.folders.length + '개' : '');
    }
    if (key === 'hidden') {
      var m = cfg.hidden.commands.length + cfg.hidden.prefixes.length;
      return m ? '숨김 ' + m + '개' : '설정 없음';
    }
    if (key === 'bbcode') {
      if (!cfg.bbcode.enabled) return '꺼짐';
      var total = Object.keys(BB.TAG_DEFS).length, off = 0;
      Object.keys(cfg.bbcode.tags).forEach(function (k) { if (cfg.bbcode.tags[k] && cfg.bbcode.tags[k].enabled === false) off++; });
      return '태그 ' + (total - off) + '/' + total + '개 사용';
    }
    if (key === 'permissions') {
      var sub = 0, none = 0;
      function tally(a) { if (a === 'subscribers') sub++; else if (a === 'staff') none++; }
      var imgDef = cfg.permissions.imageAccess, tagDef = cfg.permissions.tagAccess;
      cfg.commands.forEach(function (cm) { tally(cm.access || imgDef); });
      Object.keys(BB.TAG_DEFS).forEach(function (k) { tally((cfg.bbcode.tags[k] && cfg.bbcode.tags[k].access) || tagDef); });
      return !sub && !none ? '모두 허용' : '구독자 전용 ' + sub + '개' + (none ? ' · 사용 불가 ' + none + '개' : '');
    }
    if (key === 'style') return '글자 ' + cfg.overlay.fontSize + 'px · 최대 ' + cfg.overlay.maxLines + '줄';
    return '';
  }
  function updateSummaries() {
    Object.keys(S.sections).forEach(function (k) { S.sections[k].sum.textContent = summaryFor(k); });
    if (S.updateResetBtn) S.updateResetBtn();
    if (S.refreshPerms) S.refreshPerms();
  }

  // ---------- 칩 입력 (이미지 명령어, 태그 이름 공용) ----------
  // opts: values() → 현재 값 목록, add(v) → 오류 문장('' 이면 성공), remove(v), onError(문장), onChange(), placeholder, label
  function chipInput(opts) {
    var wrap = h('div', { class: 'chips' });
    var list = h('span', { class: 'chiplist' });
    var input = h('input', { type: 'text', class: 'chipin', placeholder: opts.placeholder || '', 'aria-label': opts.label || '' });
    var addBtn = null;
    function hideInput() { if (opts.collapsedInput) { input.hidden = true; addBtn.hidden = false; } }
    if (opts.collapsedInput) {
      input.hidden = true;
      addBtn = h('button', { type: 'button', class: 'chipadd', title: '이름 추가', 'aria-label': (opts.label || '') + ' 추가', text: '＋', onclick: function () {
        input.hidden = false; addBtn.hidden = true; input.focus();
      } });
      wrap.classList.add('compact');
    }
    function paint() {
      list.textContent = '';
      opts.values().forEach(function (v) {
        list.appendChild(h('span', { class: 'chiptag' }, h('span', { text: v }),
          h('button', { type: 'button', class: 'chipx', 'aria-label': v + ' 지우기', text: '✕', onclick: function () {
            opts.remove(v); opts.onError(''); paint(); opts.onChange();
          } })));
      });
    }
    function commit() {
      var tokens = input.value.split(/[\s,]+/).filter(Boolean);
      if (!tokens.length) return;
      var rest = [], err = '';
      tokens.forEach(function (t) {
        if (rest.length) { rest.push(t); return; }
        var e = opts.add(t);
        if (e) { err = e; rest.push(t); }
      });
      input.value = rest.join(' ');
      opts.onError(err);
      if (!err) hideInput();
      paint(); opts.onChange();
    }
    input.addEventListener('keydown', function (e) {
      if (e.isComposing) return; // 한글 입력 중에는 건드리지 않음
      if (e.key === 'Escape' && opts.collapsedInput) { e.preventDefault(); input.value = ''; opts.onError(''); hideInput(); if (addBtn) addBtn.focus(); }
      else if (e.key === 'Enter' || e.key === ',' || e.key === ' ') { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !input.value) {
        var vals = opts.values();
        if (vals.length) { opts.remove(vals[vals.length - 1]); opts.onError(''); paint(); opts.onChange(); }
      }
    });
    input.addEventListener('input', function () { if (!input.value) opts.onError(''); }); // 칸을 비우면 이전 오류 문장도 지움
    input.addEventListener('blur', function () { commit(); if (!input.value) hideInput(); });
    wrap.appendChild(list); wrap.appendChild(input); if (addBtn) wrap.appendChild(addBtn);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) input.focus(); });
    paint();
    return { el: wrap, repaint: paint, input: input };
  }

  // ---------- 화면: 1. OBS에 넣기 ----------
  function renderObs() {
    var c = begin('s-obs', 'obs', '1. OBS에 넣기');
    c.appendChild(h('p', { class: 'lead', text: 'OBS 브라우저 소스의 URL에 아래 주소를 붙여 넣으십시오. 권장 크기는 500 × 700입니다.' }));
    var inp = h('input', { type: 'text', value: S.urls.overlay, readonly: true, 'aria-label': 'OBS 브라우저 소스 주소' });
    c.appendChild(h('div', { class: 'row' },
      field('OBS 브라우저 소스 주소', inp),
      h('button', { class: 'primary', type: 'button', text: '복사', onclick: function () {
        var done = function () { toast('주소를 복사했습니다'); };
        if (navigator.clipboard) navigator.clipboard.writeText(S.urls.overlay).then(done, function () { inp.select(); document.execCommand('copy'); done(); });
        else { inp.select(); document.execCommand('copy'); done(); }
      } })));
    c.appendChild(h('p', { class: 'msg muted', text: '앱이 켜져 있는 동안에만 OBS에 채팅이 나옵니다. 설정은 바로 반영됩니다.' }));
    var row = h('div', { class: 'row', style: 'margin-top:4px' });
    row.appendChild(h('span', { class: 'msg muted', style: 'margin:0', text: '저장 폴더: ' + S.dataDir }));
    if (S.canOpenFolder) row.appendChild(h('button', { class: 'link', type: 'button', text: '폴더 열기', onclick: function () {
      api('POST', '/api/open-data-folder', {}).catch(function (e) { toast(e.message, true); });
    } }));
    c.appendChild(row);
  }

  // ---------- 화면: 2. 내 채널 (연결 상태) ----------
  function channelMsg() {
    var url = S.cfg.channel.url;
    var m = $('channelmsg');
    if (!m) return;
    var id = L.parseChannelId(url);
    S.cfg.channel.channelId = id;
    if (!url.trim()) { m.className = 'msg muted'; m.textContent = '치지직에서 내 채널로 들어갔을 때 주소창에 보이는 주소를 붙여 넣으십시오. (https://chzzk.naver.com/ 뒤에 32자리 영문+숫자)'; }
    else if (!id) { m.className = 'msg bad'; m.textContent = '주소에서 채널 ID를 찾지 못했습니다. https://chzzk.naver.com/ 뒤에 32자리 영문+숫자가 있는 주소를 붙여 넣으십시오.'; }
    else if (L.looksLikeChatLink(url)) { m.className = 'msg warn'; m.textContent = '채팅창 링크로 보입니다. 이 링크의 번호는 채널 ID가 아닐 수 있어서 연결되지 않을 수 있습니다. 연결되지 않으면 내 채널 페이지 주소(https://chzzk.naver.com/…)를 넣으십시오.'; }
    else { m.className = 'msg ok'; m.textContent = '✓ 채널을 인식했습니다 (' + id.slice(0, 6) + '…' + id.slice(-4) + ')'; }
    updateSummaries();
  }

  function renderConn() {
    var box = $('connstatus');
    if (!box) return;
    var s = S.status, d = s.detail || {};
    if (s.state === 'no-channel') { box.className = 'msg muted'; box.textContent = '채널 링크를 입력하면 자동으로 치지직 채팅에 연결합니다.'; }
    else if (s.state === 'connecting') { box.className = 'msg muted'; box.textContent = '연결하는 중… ' + (d.step || ''); }
    else if (s.state === 'connected') { box.className = 'msg ok'; box.textContent = '✓ 치지직 채팅에 연결되었습니다 (' + (d.liveStatus === 'OPEN' ? '방송 중' : '방송 종료 상태') + '). 내 채팅창에 아무거나 쳐 보십시오. 아래에 나타나면 성공입니다.'; }
    else if (s.state === 'retry') { box.className = 'msg bad'; box.textContent = '✗ 연결하지 못했습니다: ' + d.message + (d.hint ? ' ' + d.hint : '') + ' (' + d.seconds + '초 뒤 다시 시도합니다)'; }
    updateSummaries();
  }

  function renderRecent() {
    var log = $('recentlog');
    if (!log) return;
    log.textContent = '';
    log.hidden = !S.recent.length;
    S.recent.forEach(function (ev) {
      var label = L.isStaff(ev) ? '[운영] ' : (ev.subscriber ? '[구독' + (ev.subscriber.months ? ' ' + ev.subscriber.months + '개월' : '') + '] ' : '');
      var line = h('div');
      if (label) line.appendChild(h('span', { class: 'rolelabel', text: label }));
      line.appendChild(document.createTextNode(ev.nickname + ': ' + ev.content));
      log.appendChild(line);
    });
    log.scrollTop = log.scrollHeight;
  }

  function renderChannel() {
    var c = begin('s-channel', 'channel', '2. 내 채널');
    c.appendChild(h('p', { class: 'lead', text: '내 치지직 채널 페이지 주소를 붙여 넣으십시오. 로그인은 필요 없습니다.' }));
    c.appendChild(h('div', { class: 'row' }, field('내 채널 페이지 주소', text(S.cfg.channel.url, function (v) {
      S.cfg.channel.url = v; channelMsg(); changed();
    }, { placeholder: 'https://chzzk.naver.com/내채널ID' }))));
    c.appendChild(h('p', { id: 'channelmsg', class: 'msg' }));
    channelMsg();
    c.appendChild(h('p', { id: 'connstatus', class: 'msg' }));
    c.appendChild(h('div', { id: 'recentlog', class: 'testlog', hidden: true }));
    renderConn(); renderRecent();
  }

  // ---------- 이미지 태그 (images 폴더 안의 폴더 이름이 태그입니다) ----------
  S.folders = [];
  S.addTag = '';                                                  // 이미지를 추가할 때 넣을 태그. '' = 태그 없음
  S.imgFilter = { q: '', noCmd: false, tag: null, sort: 'name' };  // tag: null = 전체, '' = 태그 없음, 그 밖에는 폴더 경로
  var NEW_TAG = '__new__';

  function baseName(p) { return p.split('/').pop(); }
  function encPath(p) { return p.split('/').map(encodeURIComponent).join('/'); }
  function imageUrl(it) { return '/images/' + encPath(it.path) + '?v=' + it.size + '-' + (it.mtime || 0); }
  function applyImageData(r) { S.images = r.images; if (r.folders) S.folders = r.folders; }
  function inTag(imgTag, filter) { return imgTag === filter || imgTag.indexOf(filter + '/') === 0; }
  function folderCount(f) { return S.images.filter(function (i) { return inTag(i.tag, f); }).length; }

  // ---------- 이미지 올리기/지우기/태그 바꾸기 ----------
  async function addFiles(files, tag) {
    var useTag = tag === undefined ? S.addTag : tag;
    if (useTag && L.splitTag(useTag) === null) { toast('태그 이름이 올바르지 않습니다. 폴더 이름에는 / \\ : * ? " < > | 를 쓸 수 없고, 3단계까지 만들 수 있습니다.', true); return; }
    var added = 0, registered = 0, skipped = 0;
    var taken = takenTriggers();
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!L.IMAGE_FILE_RE.test(f.name)) { toast('이미지 파일(png, jpg, gif, webp, svg)만 추가할 수 있습니다: ' + f.name, true); continue; }
      try {
        var r = await api('POST', '/api/images?name=' + encodeURIComponent(f.name) + (useTag ? '&tag=' + encodeURIComponent(useTag) : ''), f, true);
        applyImageData(r); added++;
        if (S.cfg.ui.autoCommand) {   // 파일 이름으로 만든 추천 명령어를 바로 등록
          var t = L.suggestTrigger(r.path, taken);
          if (t) { taken[t] = true; S.cfg.commands.push({ triggers: [t], image: r.path, height: '', match: 'anywhere' }); registered++; }
          else skipped++;
        }
      } catch (e) { toast(f.name + ': ' + e.message, true); }
    }
    if (added) {
      if (useTag && S.folders.indexOf(useTag) >= 0) S.addTag = useTag;
      renderImageList(); renderTagBar(); renderAddTag(); updateSummaries();
      if (registered) changed();
      toast(added + '개 추가했습니다' + (useTag ? ' (태그: ' + useTag + ')' : '') +
        (registered ? ' · 추천 명령어 ' + registered + '개 등록' : '') + (skipped ? ' · ' + skipped + '개는 명령어를 만들지 못했습니다(이름이 너무 길거나 쓸 수 없는 글자뿐)' : ''));
    }
  }

  async function deleteImage(path) {
    if (!confirm('"' + baseName(path) + '" 파일을 삭제하시겠습니까?\n이 이미지에 연결된 명령어도 함께 지워집니다.')) return;
    try { applyImageData(await api('DELETE', '/api/images/' + encodeURIComponent(path))); } catch (e) { toast(e.message, true); return; }
    S.cfg.commands = S.cfg.commands.filter(function (c) { return c.image !== path; });
    renderImageList(); renderTagBar(); renderAddTag(); updateSummaries(); changed();
  }

  function takenTriggers() {
    var taken = {};
    S.cfg.commands.forEach(function (c) { c.triggers.forEach(function (t) { taken[t] = true; }); });
    return taken;
  }

  // 지금 목록에 보이는 이미지 중 명령어가 없는 것에 추천 명령어를 한꺼번에 붙입니다. (태그 필터나 검색으로 범위를 좁힐 수 있습니다.)
  function applySuggestions() {
    var targets = visibleImageRows().shown.filter(function (r) { var e = cmdOf(r.path); return !r.missing && !(e && e.triggers.length); });
    if (!targets.length) { toast('추천 명령어를 붙일 이미지가 없습니다. (보이는 목록에서 명령어가 없는 이미지가 없습니다)'); return; }
    if (!confirm(targets.length + '개 이미지에 파일 이름으로 만든 추천 명령어를 붙입니다. 계속하시겠습니까?')) return;
    var taken = takenTriggers(), done = 0, skipped = 0;
    targets.forEach(function (r) {
      var t = L.suggestTrigger(r.path, taken);
      if (!t) { skipped++; return; }
      taken[t] = true; done++;
      var e = cmdOf(r.path);
      if (e) e.triggers.push(t); else S.cfg.commands.push({ triggers: [t], image: r.path, height: '', match: 'anywhere' });
    });
    renderImageList(); updateSummaries(); changed();
    toast(done + '개에 추천 명령어를 붙였습니다' + (skipped ? ' (' + skipped + '개는 이름이 너무 길거나 쓸 수 없는 글자뿐이라 건너뛰었습니다)' : ''));
  }

  // 이미지를 다른 태그(폴더)로 옮깁니다. 연결된 명령어는 새 경로로 함께 바꿉니다.
  async function moveImage(path, tag) {
    var newTag = tag.trim();
    if (L.splitTag(newTag) === null) { toast('태그 이름이 올바르지 않습니다. 폴더 이름에는 / \\ : * ? " < > | 를 쓸 수 없고, 3단계까지 만들 수 있습니다.', true); return; }
    try {
      var r = await api('POST', '/api/images/move', { path: path, tag: newTag });
      S.cfg.commands.forEach(function (c) { if (c.image === path) c.image = r.path; });
      applyImageData(r);
    } catch (e) { toast(e.message, true); return; }
    renderImageList(); renderTagBar(); renderAddTag(); updateSummaries(); changed();
    toast(newTag ? '태그를 "' + newTag + '"(으)로 바꿨습니다' : '태그를 없앴습니다');
  }

  // ---------- 화면: 3. 이미지와 명령어 ----------
  function cmdOf(path) { for (var i = 0; i < S.cfg.commands.length; i++) if (S.cfg.commands[i].image === path) return S.cfg.commands[i]; return null; }
  function suggest(path) { return '~' + baseName(path).replace(/\.[^.]+$/, '').replace(/\s+/g, ''); }

  // 새 명령어를 넣을 수 있는지 검사: 문제가 있으면 안내 문장을, 괜찮으면 '' 를 돌려줌
  function triggerProblem(path, t) {
    if (/\s/.test(t)) return '명령어에는 띄어쓰기를 쓸 수 없습니다.';
    if (/[\[\]{}]/.test(t)) return '명령어에는 [ ] { } 를 쓸 수 없습니다.';
    if (t.length > 40) return '명령어는 40자까지 쓸 수 있습니다.';
    for (var i = 0; i < S.cfg.commands.length; i++) {
      var o = S.cfg.commands[i];
      if (o.triggers.indexOf(t) >= 0) return o.image === path ? '"' + t + '"는 이미 있습니다.' : '"' + t + '"는 다른 이미지(' + baseName(o.image) + ')가 이미 쓰고 있습니다.';
    }
    var mine = cmdOf(path);
    if (mine && mine.triggers.length >= 20) return '한 이미지에는 명령어를 20개까지 쓸 수 있습니다.';
    return '';
  }

  var TRANSPARENT_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

  // 태그를 고르는 목록: 태그 없음 / 있는 폴더들 / 새 태그…
  function tagSelect(current, onPick) {
    var sel = h('select', { 'aria-label': '태그 선택' });
    function fill(value) {
      sel.textContent = '';
      sel.appendChild(h('option', { value: '', text: '태그 없음' }));
      S.folders.forEach(function (f) { sel.appendChild(h('option', { value: f, text: f })); });
      sel.appendChild(h('option', { value: NEW_TAG, text: '새 태그…' }));
      sel.value = (value === '' || S.folders.indexOf(value) >= 0) ? value : NEW_TAG;
    }
    fill(current);
    sel.addEventListener('change', function () { onPick(sel.value); });
    return { el: sel, fill: fill };
  }

  // 한 줄에 이미지 하나: [썸네일] [이름/크기·태그] [명령어 칩] [설정] [삭제]. 안내 문장은 오류나 경고가 있을 때만 보입니다.
  function imageRow(item) {
    var path = item.path, name = item.name, missing = !!item.missing;
    var errText = '';
    var msg = h('p', { class: 'msg', hidden: true });
    function entry(create) {
      var e = cmdOf(path);
      if (!e && create) { e = { triggers: [], image: path, height: '', match: 'anywhere' }; S.cfg.commands.push(e); }
      return e;
    }
    function refreshMsg() {
      var text = '', cls = '';
      if (errText) { cls = 'bad'; text = errText; }
      else if (missing) { cls = 'warn'; text = '"' + path + '" 파일을 찾지 못했습니다. 명령어는 동작하지 않습니다. 같은 이름의 파일이 여러 폴더에 있으면 자동으로 연결하지 못합니다.'; }
      msg.hidden = !text; msg.className = 'msg ' + cls; msg.textContent = text;
    }
    function updateSuggest() { var e = cmdOf(path); sug.hidden = missing || !!(e && e.triggers.length); }
    function afterChange() { refreshMsg(); updateSuggest(); updateSummaries(); changed(); }

    var sug = h('button', { class: 'link sugbtn', type: 'button', text: '+ 추천', title: '"' + suggest(path) + '" 명령어 추가', 'aria-label': '"' + suggest(path) + '" 명령어 추가', onclick: function () {
      var t = suggest(path);
      var bad = triggerProblem(path, t);
      if (bad) { errText = bad; refreshMsg(); return; }
      entry(true).triggers.push(t); errText = ''; chips.repaint(); afterChange();
    } });

    var chips = chipInput({
      label: name + ' 명령어', placeholder: '명령어 입력 후 엔터',
      values: function () { var e = cmdOf(path); return e ? e.triggers : []; },
      add: function (t) {
        var bad = triggerProblem(path, t);
        if (bad) return bad;
        entry(true).triggers.push(t); return '';
      },
      remove: function (t) { var e = cmdOf(path); if (e) e.triggers = e.triggers.filter(function (x) { return x !== t; }); },
      onError: function (e) { errText = e; refreshMsg(); },
      onChange: afterChange
    });
    chips.el.appendChild(sug);

    var c0 = cmdOf(path);
    var panelRows = [
      h('div', { class: 'row' },
        field('이미지 높이 (비우면 기본값)', text(c0 ? c0.height : '', function (v) {
          var x = cmdOf(path), val = v.trim();
          errText = val && !L.validHeight(val) ? '높이는 2.4em, 3rem, 60px 처럼 숫자와 단위(em, rem, px)로 입력하십시오. (em: 0.5~12, px: 8~400)' : '';
          refreshMsg();
          if (x && !errText) { x.height = val; updateSummaries(); changed(); }
        }, { placeholder: '기본값 ' + S.cfg.overlay.imageHeight }), 'small'),
        field('이미지로 바꾸는 조건', h('select', { onchange: function (e) { var x = cmdOf(path); if (x) { x.match = e.target.value; changed(); } } },
          h('option', { value: 'anywhere', text: '채팅 어디에 있어도', selected: !c0 || c0.match !== 'whole' }),
          h('option', { value: 'whole', text: '채팅 전체가 명령어일 때만', selected: !!c0 && c0.match === 'whole' }))))
    ];
    if (!missing) {
      // 태그(폴더) 바꾸기: 파일을 대신 옮겨 주고, 연결된 명령어는 그대로 유지됩니다.
      var newTagInput = text('', function () {}, { placeholder: '새 태그 (예: 표정 또는 표정/웃음)', 'aria-label': '새 태그 이름' });
      var applyNew = h('button', { type: 'button', class: 'primary small', text: '적용', onclick: function () { moveImage(path, newTagInput.value); } });
      var newRow = h('div', { class: 'row', hidden: true, style: 'align-items:center' }, newTagInput, applyNew);
      newTagInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); moveImage(path, newTagInput.value); } });
      var picker = tagSelect(item.tag, function (v) {
        if (v === NEW_TAG) { newRow.hidden = false; newTagInput.focus(); } else { newRow.hidden = true; moveImage(path, v); }
      });
      panelRows.push(h('div', { class: 'row' }, field('태그 (images 안의 폴더)', picker.el)), newRow);
    }
    panelRows.push(h('p', { class: 'msg muted', style: 'margin:0', text: '높이와 조건은 이 이미지의 모든 명령어에 적용됩니다. 높이는 글자 크기의 배수입니다 (2.4em = 2.4배). 비우면 기본 높이를 따릅니다. 명령어를 먼저 입력하십시오.' }));
    var panel = h.apply(null, ['div', { class: 'rowpanel', hidden: true }].concat(panelRows));
    var gear = h('button', { class: 'link', type: 'button', text: '설정', 'aria-expanded': 'false', onclick: function () {
      panel.hidden = !panel.hidden; gear.setAttribute('aria-expanded', String(!panel.hidden));
    } });

    var sizeText = item.size ? kb(item.size) + (item.size > 500 * 1024 ? ' · 큼' : '') : '';
    var row = h('div', { class: 'imgrow' + (missing ? ' missing' : '') },
      h('img', { class: 'thumb', alt: '', src: item.url || TRANSPARENT_GIF }),
      h('div', { class: 'imginfo' },
        h('div', { class: 'imgname', title: path, text: name }),
        h('div', { class: 'imgsize', title: item.size > 500 * 1024 ? '큰 이미지는 채팅이 느려질 수 있습니다' : '' },
          sizeText, item.tag ? h('span', { class: 'tagtext', text: (sizeText ? ' · ' : '') + item.tag }) : (missing && dirOf(path) ? h('span', { class: 'tagtext', text: dirOf(path) }) : null))),
      h('div', { class: 'cmdcell' }, chips.el),
      h('div', { class: 'rowbtns' }, gear,
        h('button', { class: 'link danger', type: 'button', text: missing ? '명령어 삭제' : '삭제', onclick: function () {
          if (missing) { S.cfg.commands = S.cfg.commands.filter(function (x) { return x.image !== path; }); renderImageList(); updateSummaries(); changed(); }
          else deleteImage(path);
        } })),
      h('div', { class: 'rowextra' }, msg, panel));
    refreshMsg(); updateSuggest();
    return row;
  }
  function dirOf(p) { var i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }

  function visibleImageRows() {
    var present = {}, rows = [];
    S.images.forEach(function (i) { present[i.path] = true; rows.push({ path: i.path, name: i.name, tag: i.tag, size: i.size, mtime: i.mtime, url: imageUrl(i), missing: false }); });
    S.cfg.commands.forEach(function (cm) {
      if (!present[cm.image] && cm.triggers.length) {
        present[cm.image] = true;
        rows.push({ path: cm.image, name: baseName(cm.image), tag: dirOf(cm.image), size: 0, mtime: 0, url: '', missing: true });
      }
    });
    var f = S.imgFilter, q = f.q.trim().toLowerCase();
    var filtered = rows.filter(function (r) {
      var e = cmdOf(r.path);
      var count = e ? e.triggers.length : 0;
      if (f.tag !== null && !(f.tag === '' ? r.tag === '' : inTag(r.tag, f.tag))) return false;
      if (f.noCmd && (r.missing || count > 0)) return false;
      if (!q) return true;
      return r.path.toLowerCase().indexOf(q) >= 0 || (e && e.triggers.some(function (t) { return t.toLowerCase().indexOf(q) >= 0; }));
    });
    var collator = new Intl.Collator('ko');
    function byName(a, b) { return collator.compare(a.name, b.name) || collator.compare(a.path, b.path); }
    function cnt(r) { var e = cmdOf(r.path); return e ? e.triggers.length : 0; }
    filtered.sort(function (a, b) {
      if (f.sort === 'tag') return collator.compare(a.tag, b.tag) || byName(a, b);
      if (f.sort === 'recent') return (b.mtime - a.mtime) || byName(a, b);
      if (f.sort === 'nocmd') return ((cnt(a) ? 1 : 0) - (cnt(b) ? 1 : 0)) || byName(a, b);
      return byName(a, b);
    });
    return { all: rows.length, shown: filtered };
  }

  // 검색어/필터/정렬에 맞는 이미지만 보여 줍니다. (칸에 입력하는 동안에는 목록을 다시 그리지 않아서, 입력 중인 행이 사라지지 않습니다.)
  function renderImageList() {
    var list = $('imglist'), count = $('imgcount');
    if (!list) return;
    var v = visibleImageRows();
    list.textContent = '';
    var groups = {};
    v.shown.forEach(function (r) { groups[r.tag] = (groups[r.tag] || 0) + 1; });
    var lastTag = null;
    v.shown.forEach(function (r) {
      if (S.imgFilter.sort === 'tag' && r.tag !== lastTag) {
        list.appendChild(h('div', { class: 'taghead', text: (r.tag || '태그 없음') + ' · ' + groups[r.tag] + '개' }));
        lastTag = r.tag;
      }
      list.appendChild(imageRow(r));
    });
    var filtering = S.imgFilter.q.trim() || S.imgFilter.noCmd || S.imgFilter.tag !== null;
    count.textContent = filtering ? '전체 ' + v.all + '개 중 ' + v.shown.length + '개 표시' : (v.all ? '이미지 ' + v.all + '개' : '');
    if (!v.shown.length) {
      list.appendChild(h('div', { class: 'dropzone', text: v.all
        ? '조건에 맞는 이미지가 없습니다.'
        : '아직 이미지가 없습니다. "이미지 추가"를 누르거나 파일을 끌어다 놓으십시오.' }));
    }
  }

  // 태그 필터 줄: 전체 / 태그 없음 / 폴더마다 개수와 함께 나열. 누르면 그 태그의 이미지만 보입니다.
  function renderTagBar() {
    var bar = $('tagbar');
    if (!bar) return;
    bar.textContent = '';
    bar.hidden = !S.folders.length;
    if (!S.folders.length) return;
    function chip(label, count, value) {
      var on = S.imgFilter.tag === value;
      bar.appendChild(h('button', { type: 'button', class: 'tagchip' + (on ? ' on' : ''), 'aria-pressed': String(on), text: label + ' ' + count, onclick: function () {
        S.imgFilter.tag = on ? null : value;
        if (!on && value) { S.addTag = value; renderAddTag(); }   // 태그를 골라 두면 새 이미지도 그 태그로 들어갑니다.
        renderTagBar(); renderImageList();
      } }));
    }
    var untagged = S.images.filter(function (i) { return i.tag === ''; }).length;
    chip('전체', S.images.length, null);
    chip('태그 없음', untagged, '');
    S.folders.forEach(function (f) { chip(f, folderCount(f), f); });
  }

  // 이미지를 추가할 때 넣을 태그를 고르는 칸
  var addTagPicker = null;
  function renderAddTag() {
    var box = $('addtag');
    if (!box) return;
    box.textContent = '';
    var newInput = text(S.folders.indexOf(S.addTag) < 0 ? S.addTag : '', function (v) { S.addTag = v.trim(); }, { placeholder: '새 태그 (예: 표정 또는 표정/웃음)', 'aria-label': '새 태그 이름' });
    newInput.hidden = S.addTag === '' || S.folders.indexOf(S.addTag) >= 0;
    addTagPicker = tagSelect(S.addTag, function (v) {
      if (v === NEW_TAG) { newInput.hidden = false; S.addTag = newInput.value.trim(); newInput.focus(); }
      else { newInput.hidden = true; S.addTag = v; }
    });
    box.appendChild(h('label', { class: 'addtaglabel', text: '추가할 태그' }));
    box.appendChild(addTagPicker.el);
    box.appendChild(newInput);
  }

  function renderImages() {
    var c = begin('s-images', 'images', '3. 이미지와 명령어');
    S.imgFilter.sort = S.cfg.ui.imageSort || 'name';
    c.appendChild(h('p', { class: 'lead', text: '이미지마다 명령어를 입력하면 채팅에서 그 글자가 이미지로 바뀝니다. 명령어는 여러 개 입력할 수 있고 (예: ~감사, ~땡큐), images 안의 폴더 이름은 태그가 됩니다.' }));
    var fileIn = h('input', { type: 'file', multiple: true, accept: '.png,.jpg,.jpeg,.gif,.webp,.svg,image/*', style: 'display:none',
      onchange: function (e) { addFiles(Array.prototype.slice.call(e.target.files)); e.target.value = ''; } });
    c.appendChild(h('div', { class: 'imgbar' },
      h('button', { class: 'primary', type: 'button', text: '이미지 추가', onclick: function () { fileIn.click(); } }), fileIn,
      h('div', { class: 'addtag', id: 'addtag' }),
      check('추가하면 추천 명령어 자동 등록', S.cfg.ui.autoCommand, function (on) { S.cfg.ui.autoCommand = on; changed(); })));
    var search = h('input', { type: 'search', class: 'imgsearch', placeholder: '이미지 이름, 명령어, 태그로 찾기', 'aria-label': '이미지 검색', value: S.imgFilter.q,
      oninput: function (e) { S.imgFilter.q = e.target.value; renderImageList(); } });
    var sort = h('select', { 'aria-label': '이미지 정렬', onchange: function (e) {
      S.imgFilter.sort = e.target.value; S.cfg.ui.imageSort = e.target.value; renderImageList(); changed();
    } },
      h('option', { value: 'name', text: '이름순' }), h('option', { value: 'tag', text: '태그별로 묶기' }),
      h('option', { value: 'recent', text: '최근 추가순' }), h('option', { value: 'nocmd', text: '명령어 없는 것 먼저' }));
    sort.value = S.imgFilter.sort;
    c.appendChild(h('div', { class: 'imgbar' }, search,
      check('명령어 없는 이미지만 보기', S.imgFilter.noCmd, function (on) { S.imgFilter.noCmd = on; renderImageList(); }), sort));
    c.appendChild(h('div', { class: 'tagbar', id: 'tagbar', hidden: true }));
    c.appendChild(h('div', { class: 'imgcountrow' },
      h('div', { class: 'imgcount msg muted', id: 'imgcount' }),
      h('button', { type: 'button', class: 'small', text: '명령어 없는 이미지에 추천 명령어 붙이기', title: '지금 보이는 목록에서 명령어가 없는 이미지에, 파일 이름으로 만든 명령어(예: 식은땀.gif → ~식은땀)를 붙입니다.', onclick: applySuggestions })));
    c.appendChild(h('div', { class: 'imglist', id: 'imglist' }));
    renderAddTag(); renderTagBar(); renderImageList();
  }

  // ---------- 화면: 5. 숨길 채팅 ----------
  function renderHidden() {
    var c = begin('s-hidden', 'hidden', '5. 방송 화면에서 숨길 채팅');
    c.appendChild(h('p', { class: 'lead', text: '치지직 채팅창에는 보이지만 방송 화면에서는 숨길 채팅입니다. (예: 챗봇 명령어)' }));
    c.appendChild(h('div', { class: 'row' },
      field('숨길 명령어 (한 줄에 하나, 예: !목록)', h('textarea', { value: S.cfg.hidden.commands.join('\n'), placeholder: '!목록\n!명령어', oninput: function (e) {
        S.cfg.hidden.commands = e.target.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); updateSummaries(); changed();
      } }))));
    c.appendChild(h('div', { class: 'row' },
      field('이 글자로 시작하는 채팅은 모두 숨기기 (쉼표로 구분, 예: !)', text(S.cfg.hidden.prefixes.join(','), function (v) {
        S.cfg.hidden.prefixes = v.split(',').map(function (s) { return s.trim(); }).filter(Boolean); updateSummaries(); changed();
      }))));
  }

  // ---------- 화면: 4. 글자 꾸미기 ----------
  function tagEntry(canon) { return S.cfg.bbcode.tags[canon]; }
  function tagNames(canon) { var e = tagEntry(canon); return e && Array.isArray(e.names) ? e.names : BB.TAG_DEFS[canon].names; }
  // 이름을 바꾼 결과를 설정에 기록 (기본 상태로 돌아오면 흔적을 지움)
  function setTagNames(canon, names) {
    var e = S.cfg.bbcode.tags[canon] || (S.cfg.bbcode.tags[canon] = {});
    var def = BB.TAG_DEFS[canon].names;
    if (names.length === def.length && names.every(function (n, k) { return n === def[k]; })) delete e.names; else e.names = names;
    if (!Object.keys(e).length) delete S.cfg.bbcode.tags[canon];
  }
  function tagOwner(name) {
    var keys = Object.keys(BB.TAG_DEFS);
    for (var i = 0; i < keys.length; i++) if (tagNames(keys[i]).indexOf(name) >= 0) return keys[i];
    return null;
  }
  function tagExample(canon) {
    var names = tagNames(canon);
    var first = names[0];
    if (!first) return '(이름이 없어서 쓸 수 없습니다)';
    return BB.TAG_DEFS[canon].example.replace('[' + canon, '[' + first).replace('[/' + canon + ']', '[/' + first + ']');
  }

  function renderBBCode() {
    var bb = S.cfg.bbcode;
    // 사용 여부 스위치는 제목 줄 오른쪽에 둡니다. (접어 두어도 켜져 있는지 요약에 보입니다.)
    var sw = check('사용', bb.enabled, function (on) {
      bb.enabled = on; list.classList.toggle('off', !on); updateSummaries(); changed();
    });
    sw.classList.add('headswitch');
    var c = begin('s-bbcode', 'bbcode', '4. 글자 꾸미기', sw);
    var list = h('div', { class: 'tags2' + (bb.enabled ? '' : ' off') });
    c.appendChild(h('p', { class: 'lead', text: '채팅에 [color=red]글자[/color]처럼 쓰면 방송 화면에서 꾸며집니다. 태그 이름은 바꿀 수 있고, 닫는 태그는 생략할 수 있습니다. (예: [색=빨강]글자)' }));
    function setAll(on) {
      Object.keys(BB.TAG_DEFS).forEach(function (canon) {
        var e = tagEntry(canon) || (S.cfg.bbcode.tags[canon] = {});
        if (on) delete e.enabled; else e.enabled = false;
        if (!Object.keys(e).length) delete S.cfg.bbcode.tags[canon];
      });
      renderBBCode(); updateSummaries(); changed();
    }
    c.appendChild(h('div', { class: 'row', style: 'margin-bottom:6px' },
      h('button', { type: 'button', class: 'small', text: '모두 켜기', onclick: function () { setAll(true); } }),
      h('button', { type: 'button', class: 'small', text: '모두 끄기', onclick: function () { setAll(false); } })));

    Object.keys(BB.TAG_DEFS).forEach(function (canon) {
      var def = BB.TAG_DEFS[canon];
      var on = !(tagEntry(canon) && tagEntry(canon).enabled === false);
      var code = h('code', { class: 'tagex', text: tagExample(canon), title: tagExample(canon) });
      var msg = h('p', { class: 'msg', hidden: true });
      var chips = chipInput({
        label: def.label + ' 태그 이름', placeholder: '이름 추가 (예: ' + (canon === 'rainbow' ? '무지개' : '한글 이름') + ')', collapsedInput: true,
        values: function () { return tagNames(canon); },
        add: function (raw) {
          var n = raw.trim().toLowerCase();
          if (!L.TAG_NAME_RE.test(n)) return '이름은 한글, 영문, 숫자, _ 로 1~12자여야 합니다. (띄어쓰기와 [ ] = / 는 쓸 수 없습니다)';
          var owner = tagOwner(n);
          if (owner === canon) return '"' + n + '"는 이미 있습니다.';
          if (owner) return '"' + n + '"는 "' + BB.TAG_DEFS[owner].label + '" 태그가 이미 쓰고 있습니다.';
          if (tagNames(canon).length >= 6) return '한 태그에는 이름을 6개까지 쓸 수 있습니다.';
          setTagNames(canon, tagNames(canon).concat(n)); return '';
        },
        remove: function (n) { setTagNames(canon, tagNames(canon).filter(function (x) { return x !== n; })); },
        onError: function (e) {
          if (e) { msg.hidden = false; msg.className = 'msg bad'; msg.textContent = e; }
          else if (!tagNames(canon).length) { msg.hidden = false; msg.className = 'msg warn'; msg.textContent = '이름이 없어서 이 태그는 쓸 수 없습니다. 이름을 하나 추가하십시오.'; }
          else msg.hidden = true;
        },
        onChange: function () { code.textContent = tagExample(canon); code.title = tagExample(canon); changed(); }
      });
      list.appendChild(h('div', { class: 'tagrow2' + (on ? '' : ' dim') },
        check(def.label + (def.effect ? ' (움직임)' : ''), on, function (v) {
          var e = tagEntry(canon) || (S.cfg.bbcode.tags[canon] = {});
          if (v) delete e.enabled; else e.enabled = false;
          if (!Object.keys(e).length) delete S.cfg.bbcode.tags[canon];
          updateSummaries(); changed();
        }),
        code, chips.el, msg));
    });
    c.appendChild(list);
    var L2 = bb.limits;
    function lim(label, key, min, max) { return field(label, num(L2[key], min, max, function (n) { L2[key] = n; changed(); }), 'small'); }
    c.appendChild(h('details', null, h('summary', { text: '남용 방지 한도 (보통은 그대로 두십시오)' }),
      h('p', { class: 'msg muted', text: '한도를 넘는 꾸밈은 글자 그대로 나옵니다.' }),
      h('div', { class: 'row' }, lim('최대 글자 수', 'maxLength', 20, 1000), lim('태그 겹치는 깊이', 'maxDepth', 1, 10), lim('태그 개수', 'maxTags', 1, 50)),
      h('div', { class: 'row' }, lim('움직이는 효과 수', 'maxEffects', 0, 20), lim('글자 크기 하한(%)', 'minSize', 30, 100), lim('글자 크기 상한(%)', 'maxSize', 100, 400), lim('이미지 수', 'maxImages', 0, 30))));
  }

  // ---------- 화면: 6. 권한 ----------
  // 일반 시청자와 구독자가 쓸 수 있는 이미지 명령어/글자 꾸미기 태그를 정합니다.
  // 값은 all(일반 시청자+구독자) / subscribers(구독자만) / staff(스트리머와 운영진만)이고, 기능마다 따로 정하지 않으면 기본 권한을 따릅니다.
  function permFlags(access) { return { viewer: access === 'all', sub: access === 'all' || access === 'subscribers' }; }

  // 체크 두 개(일반 시청자, 구독자)를 하나의 권한 값으로 바꿉니다. 구독자는 일반 시청자가 쓸 수 있는 기능을 항상 쓸 수 있으므로
  // "일반 시청자만 가능, 구독자는 불가" 같은 조합은 만들 수 없습니다.
  function permControl(getAccess, setAccess) {
    var viewerCb = h('input', { type: 'checkbox', 'aria-label': '일반 시청자 사용 가능' });
    var subCb = h('input', { type: 'checkbox', 'aria-label': '구독자 사용 가능' });
    function paint() { var f = permFlags(getAccess()); viewerCb.checked = f.viewer; subCb.checked = f.sub; }
    viewerCb.addEventListener('change', function () {
      var wasSub = permFlags(getAccess()).sub;
      setAccess(viewerCb.checked ? 'all' : (wasSub ? 'subscribers' : 'staff'));
      paint();
    });
    subCb.addEventListener('change', function () {
      setAccess(subCb.checked ? (permFlags(getAccess()).viewer ? 'all' : 'subscribers') : 'staff');
      paint();
    });
    paint();
    return { viewer: h('label', { class: 'permcell', title: '일반 시청자' }, viewerCb), sub: h('label', { class: 'permcell', title: '구독자' }, subCb), repaint: paint };
  }

  function renderPermissions() {
    var c = begin('s-permissions', 'permissions', '6. 권한');
    var perm = S.cfg.permissions;
    c.appendChild(h('p', { class: 'lead', text: '일반 시청자와 구독자가 쓸 수 있는 이미지 명령어와 글자 꾸미기를 정합니다. 권한이 없으면 쓴 글자 그대로 나옵니다. 스트리머와 운영진은 항상 모두 쓸 수 있습니다.' }));

    function head() {
      return h('div', { class: 'permhead' }, h('span', { text: '' }), h('span', { class: 'permcol', text: '일반 시청자' }), h('span', { class: 'permcol', text: '구독자' }), h('span', { text: '' }));
    }

    // 기본 권한
    var defImg = permControl(function () { return perm.imageAccess; }, function (a) { perm.imageAccess = a; renderPermLists(); updateSummaries(); changed(); });
    var defTag = permControl(function () { return perm.tagAccess; }, function (a) { perm.tagAccess = a; renderPermLists(); updateSummaries(); changed(); });
    c.appendChild(h('div', { class: 'permbox' },
      h('div', { class: 'permtitle', text: '기본 권한' }),
      head(),
      h('div', { class: 'permrow' }, h('span', { class: 'permname', text: '이미지 명령어' }), defImg.viewer, defImg.sub, h('span')),
      h('div', { class: 'permrow' }, h('span', { class: 'permname', text: '글자 꾸미기' }), defTag.viewer, defTag.sub, h('span')),
      h('p', { class: 'msg muted', style: 'margin:6px 0 0', text: '따로 정하지 않은 기능과 새로 추가하는 항목은 이 기본 권한을 따릅니다.' })));

    c.appendChild(h('div', { id: 'permlists' }));
    c.appendChild(h('p', { class: 'msg muted', text: '구독자 여부는 치지직 채팅 정보로 판단합니다. 2번 패널의 최근 채팅에 [구독 N개월]이 보이는지 확인하십시오. 읽지 못하면 구독자 전용 기능은 운영진만 쓸 수 있습니다.' }));
    S.permFilter = S.permFilter || { img: false, tag: false };
    renderPermLists();
    S.refreshPerms = refreshPermsIfChanged;
  }

  // 이미지/명령어가 바뀌었을 때만 목록을 다시 그립니다. (다른 패널에서 입력하는 동안 불필요하게 다시 그리지 않게)
  var permSig = '';
  function permSignature() {
    // 권한 값(access) 자체는 포함하지 않습니다. 체크를 누를 때마다 목록이 다시 그려지면 불편하기 때문입니다.
    var tags = S.cfg.bbcode.tags;
    return JSON.stringify([
      S.cfg.commands.map(function (cm) { return [cm.image, cm.triggers.join(',')]; }),
      S.images.map(function (i) { return i.path; }),
      Object.keys(tags).map(function (k) { return [k, tags[k].enabled, tags[k].names]; })
    ]);
  }
  function refreshPermsIfChanged() { if ($('permlists') && permSignature() !== permSig) renderPermLists(); }

  function permList(title, rowsFn, key) {
    var box = h('div', { class: 'permbox' });
    var list = h('div', { class: 'permlist' });
    var only = check('기본 권한과 다른 항목만 보기', S.permFilter[key], function (on) { S.permFilter[key] = on; renderPermLists(); });
    var reset = h('button', { type: 'button', class: 'small', text: '모두 기본 권한으로', onclick: function () {
      if (key === 'img') S.cfg.commands.forEach(function (cm) { cm.access = ''; });
      else Object.keys(S.cfg.bbcode.tags).forEach(function (k) { if (S.cfg.bbcode.tags[k]) { delete S.cfg.bbcode.tags[k].access; if (!Object.keys(S.cfg.bbcode.tags[k]).length) delete S.cfg.bbcode.tags[k]; } });
      renderPermLists(); updateSummaries(); changed();
    } });
    box.appendChild(h('div', { class: 'permbar' }, h('div', { class: 'permtitle', text: title }), only, reset));
    box.appendChild(head2());
    var n = rowsFn(list);
    if (!n) list.appendChild(h('div', { class: 'dropzone', text: key === 'img' ? (S.cfg.commands.length ? '조건에 맞는 이미지가 없습니다.' : '명령어가 있는 이미지가 아직 없습니다. 3번 패널에서 이미지를 추가하십시오.') : '조건에 맞는 태그가 없습니다.' }));
    box.appendChild(list);
    return box;
    function head2() { return h('div', { class: 'permhead' }, h('span', { text: '' }), h('span', { class: 'permcol', text: '일반 시청자' }), h('span', { class: 'permcol', text: '구독자' }), h('span', { text: '' })); }
  }

  // 한 줄: [이름] [일반 시청자 체크] [구독자 체크] [기본으로]
  function permRow(nameEl, getOverride, setOverride, getDefault) {
    var row = h('div', { class: 'permrow' });
    var resetLink = h('button', { type: 'button', class: 'link', text: '기본으로' });
    var ctl = permControl(function () { return getOverride() || getDefault(); }, function (a) { setOverride(a === getDefault() ? '' : a); onChange(); });
    function onChange() { row.classList.toggle('custom', !!getOverride()); resetLink.hidden = !getOverride(); updateSummaries(); changed(); }
    resetLink.addEventListener('click', function () { setOverride(''); ctl.repaint(); onChange(); if (S.permFilter.img || S.permFilter.tag) renderPermLists(); });
    row.appendChild(nameEl); row.appendChild(ctl.viewer); row.appendChild(ctl.sub); row.appendChild(resetLink);
    row.classList.toggle('custom', !!getOverride()); resetLink.hidden = !getOverride();
    return row;
  }

  function renderPermLists() {
    var host = $('permlists');
    if (!host) return;
    host.textContent = '';
    var perm = S.cfg.permissions;
    var byPath = {};
    S.images.forEach(function (i) { byPath[i.path] = i; });

    host.appendChild(permList('이미지 명령어별 권한', function (list) {
      var collator = new Intl.Collator('ko');
      var cmds = S.cfg.commands.filter(function (cm) { return cm.triggers.length; }).slice().sort(function (a, b) { return collator.compare(baseName(a.image), baseName(b.image)); });
      var shown = 0;
      cmds.forEach(function (cm) {
        if (S.permFilter.img && !cm.access) return;
        var it = byPath[cm.image];
        var nameEl = h('div', { class: 'permname permimg' },
          h('img', { class: 'permthumb', alt: '', src: it ? imageUrl(it) : TRANSPARENT_GIF }),
          h('div', { class: 'permtext' }, h('div', { class: 'permtrig', title: cm.triggers.join('  '), text: cm.triggers.join('  ') }),
            h('div', { class: 'permsub', title: cm.image, text: baseName(cm.image) + (it ? '' : ' (파일 없음)') })));
        list.appendChild(permRow(nameEl, function () { return cm.access || ''; }, function (a) { cm.access = a; }, function () { return perm.imageAccess; }));
        shown++;
      });
      return shown;
    }, 'img'));

    host.appendChild(permList('글자 꾸미기 태그별 권한', function (list) {
      var shown = 0;
      Object.keys(BB.TAG_DEFS).forEach(function (canon) {
        var e = S.cfg.bbcode.tags[canon];
        if (S.permFilter.tag && !(e && e.access)) return;
        var def = BB.TAG_DEFS[canon];
        var off = e && e.enabled === false;
        var nameEl = h('div', { class: 'permname' }, h('div', { class: 'permtrig', text: def.label + (def.effect ? ' (움직임)' : '') + (off ? ' · 꺼짐' : '') }),
          h('div', { class: 'permsub', title: tagExample(canon), text: tagExample(canon) }));
        list.appendChild(permRow(nameEl, function () { var x = S.cfg.bbcode.tags[canon]; return (x && x.access) || ''; }, function (a) {
          var x = S.cfg.bbcode.tags[canon] || (S.cfg.bbcode.tags[canon] = {});
          if (a) x.access = a; else delete x.access;
          if (!Object.keys(x).length) delete S.cfg.bbcode.tags[canon];
        }, function () { return perm.tagAccess; }));
        shown++;
      });
      return shown;
    }, 'tag'));
    permSig = permSignature();
  }

  // ---------- 화면: 7. 화면 스타일 ----------
  function parseRgba(s) {
    var m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s || '');
    if (m) return { hex: '#' + [m[1], m[2], m[3]].map(function (x) { return ('0' + Math.min(255, +x).toString(16)).slice(-2); }).join(''), a: m[4] === undefined ? 1 : parseFloat(m[4]) };
    if (/^#[0-9a-fA-F]{6}$/.test(s || '')) return { hex: s, a: 1 };
    return { hex: '#000000', a: 0 };
  }
  function hexToRgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // ---------- 글꼴 고르기 (검색 가능한 드롭다운) ----------
  // 한글 글꼴은 한글 이름도 함께 보여 주고, 검색도 한글 이름으로 할 수 있게 합니다.
  var KO_FONT_NAMES = {
    'Malgun Gothic': '맑은 고딕', 'Gulim': '굴림', 'Dotum': '돋움', 'Batang': '바탕', 'Gungsuh': '궁서',
    'NanumGothic': '나눔고딕', 'NanumMyeongjo': '나눔명조', 'NanumSquare': '나눔스퀘어', 'NanumBarunGothic': '나눔바른고딕',
    'Noto Sans KR': '본고딕 (Noto Sans KR)', 'Noto Serif KR': '본명조 (Noto Serif KR)', 'Pretendard': '프리텐다드',
    'Apple SD Gothic Neo': '애플 SD 산돌고딕 Neo', 'KoPubWorld Dotum': 'KoPub돋움', 'KoPubWorld Batang': 'KoPub바탕'
  };
  var CURATED_FONTS = Object.keys(KO_FONT_NAMES).concat(['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Impact', 'Consolas', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Trebuchet MS']);

  function fontInstalled(name) {
    // 글꼴이 있으면 비교용 기본 글꼴과 글자 폭이 달라지는 점을 이용해 설치 여부를 확인합니다.
    var ctx = document.createElement('canvas').getContext('2d');
    var sample = 'mmmmmmmmmmlli가나다라마바사0123';
    return ['monospace', 'serif', 'sans-serif'].some(function (base) {
      ctx.font = '40px ' + base; var w0 = ctx.measureText(sample).width;
      ctx.font = '40px "' + name + '", ' + base; return ctx.measureText(sample).width !== w0;
    });
  }

  function loadFonts() {
    if (S.fontsPromise) return S.fontsPromise;
    S.fontsPromise = (async function () {
      var fams = [];
      S.fontsSource = '';
      if (typeof window.queryLocalFonts === 'function') {
        try {
          var seen = {};
          (await window.queryLocalFonts()).forEach(function (f) { if (!seen[f.family]) { seen[f.family] = true; fams.push(f.family); } });
          S.fontsSource = 'system';
        } catch (e) { fams = []; }
      }
      if (!fams.length) { fams = CURATED_FONTS.filter(fontInstalled); S.fontsSource = 'curated'; }
      var collator = new Intl.Collator('ko');
      return fams.sort(function (a, b) { return collator.compare(a, b); });
    })();
    return S.fontsPromise;
  }

  function fontLabel(family) { return KO_FONT_NAMES[family] ? KO_FONT_NAMES[family] + ' · ' + family : family; }

  function fontPicker(current, onPick) {
    var value = current || '';
    var wrap = h('div', { class: 'fontpick' });
    var btnText = h('span', { class: 'fonttext' });
    var btn = h('button', { type: 'button', class: 'fontbtn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, btnText, h('span', { class: 'arrow', text: '▾', 'aria-hidden': 'true' }));
    var search = h('input', { type: 'text', class: 'fontsearch', placeholder: '글꼴 이름 검색', 'aria-label': '글꼴 검색' });
    var list = h('div', { class: 'fontlist', role: 'listbox' });
    var note = h('p', { class: 'msg muted', style: 'margin:6px 8px 8px' });
    var pop = h('div', { class: 'fontpop', hidden: true }, search, list, note);
    var focusIdx = 0, items = [], customMode = false;

    function paintButton() {
      btnText.textContent = value ? fontLabel(value) : '기본 글꼴';
      btnText.style.fontFamily = value ? '"' + value + '", sans-serif' : '';
    }
    function pick(v) { value = v; paintButton(); close(); onPick(v); }

    function render(fonts) {
      var q = search.value.trim().toLowerCase();
      list.textContent = ''; items = [];
      function add(label, v, fam, extraClass) {
        var b = h('button', { type: 'button', role: 'option', class: 'fontitem' + (extraClass ? ' ' + extraClass : '') + (v === value && !extraClass ? ' sel' : ''), 'aria-selected': String(v === value && !extraClass),
          text: label, onclick: function () { if (extraClass === 'custom') { customMode = true; render(fonts); } else pick(v); } });
        if (fam) b.style.fontFamily = '"' + fam + '", sans-serif';
        list.appendChild(b); items.push(b);
      }
      if (customMode) {
        var inp = h('input', { type: 'text', class: 'fontcustom', placeholder: '글꼴 이름을 직접 입력', 'aria-label': '글꼴 이름 직접 입력', value: value });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); pick(inp.value.replace(/[^\p{L}\p{N} ._()+&-]/gu, '').trim()); } });
        list.appendChild(h('div', { class: 'fontcustomrow' }, inp, h('button', { type: 'button', class: 'primary small', text: '적용', onclick: function () { pick(inp.value.replace(/[^\p{L}\p{N} ._()+&-]/gu, '').trim()); } })));
        setTimeout(function () { inp.focus(); }, 0);
        return;
      }
      if (!q || '기본 글꼴'.indexOf(q) >= 0) add('기본 글꼴', '', '');
      if (!q || '직접 입력'.indexOf(q) >= 0) add('직접 입력…', '', '', 'custom');
      var shown = 0;
      fonts.forEach(function (f) {
        var label = fontLabel(f);
        if (q && label.toLowerCase().indexOf(q) < 0) return;
        add(label, f, f); shown++;
      });
      if (value && fonts.indexOf(value) < 0 && (!q || value.toLowerCase().indexOf(q) >= 0)) add(value + ' (직접 입력)', value, value);
      if (!shown && q) list.appendChild(h('div', { class: 'msg muted', style: 'padding:8px', text: '검색 결과가 없습니다. "직접 입력…"으로 글꼴 이름을 입력할 수 있습니다.' }));
      note.textContent = S.fontsSource === 'system'
        ? 'PC에 설치된 글꼴입니다. OBS와 같은 PC에서 고르십시오. 설치되지 않은 글꼴은 방송 화면에 나오지 않습니다.'
        : '설치된 글꼴 전체를 읽지 못해 자주 쓰는 글꼴만 보여 드립니다. 다른 글꼴은 "직접 입력…"을 사용하십시오.';
      focusIdx = Math.max(0, items.findIndex(function (b) { return b.classList.contains('sel'); }));
      highlight(false);
    }
    function highlight(scroll) {
      items.forEach(function (b, i) { b.classList.toggle('focus', i === focusIdx); });
      if (scroll && items[focusIdx]) items[focusIdx].scrollIntoView({ block: 'nearest' });
    }

    var fontsCache = null;
    function open() {
      pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); customMode = false; search.value = '';
      list.textContent = ''; list.appendChild(h('div', { class: 'msg muted', style: 'padding:8px', text: '글꼴 목록을 불러오는 중…' }));
      search.focus();
      loadFonts().then(function (fonts) { fontsCache = fonts; if (!pop.hidden) render(fonts); });
    }
    function close() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }

    btn.addEventListener('click', function () { if (pop.hidden) open(); else close(); });
    search.addEventListener('input', function () { if (fontsCache) render(fontsCache); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); focusIdx = Math.min(items.length - 1, focusIdx + 1); highlight(true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusIdx = Math.max(0, focusIdx - 1); highlight(true); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[focusIdx]) items[focusIdx].click(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
    });
    document.addEventListener('mousedown', function (e) { if (!pop.hidden && !wrap.contains(e.target)) close(); });
    wrap.appendChild(btn); wrap.appendChild(pop);
    paintButton();
    return { el: wrap };
  }

  function renderStyle() {
    var c = begin('s-style', 'style', '7. 화면 스타일');
    var o = S.cfg.overlay;
    c.appendChild(h('p', { class: 'lead', text: '채팅의 크기와 색입니다.' }));
    function color(label, key) {
      var inp = h('input', { type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(o[key]) ? o[key] : '#ffffff', oninput: function (e) { o[key] = e.target.value; changed(); } });
      return field(label, inp, 'small');
    }
    c.appendChild(h('div', { class: 'row' },
      field('글자 크기(px)', num(o.fontSize, 10, 120, function (n) { o.fontSize = n; updateSummaries(); changed(); }), 'small'),
      field('최대 줄 수', num(o.maxLines, 1, 100, function (n) { o.maxLines = n; updateSummaries(); changed(); }), 'small'),
      field('채팅이 사라지는 시간(초, 0이면 사라지지 않음)', num(o.lineLifetimeSec, 0, 3600, function (n) { o.lineLifetimeSec = n; changed(); }))));
    // 명령어 이미지의 기본 높이: 이미지마다 따로 정하지 않은 이미지는 모두 이 값을 따릅니다.
    var customCount = function () { return S.cfg.commands.filter(function (cm) { return cm.height; }).length; };
    var resetBtn = h('button', { type: 'button', class: 'small', onclick: function () {
      S.cfg.commands.forEach(function (cm) { cm.height = ''; });
      renderImageList(); updateResetBtn(); changed(); toast('이미지별 높이를 모두 지웠습니다. 이제 모든 이미지가 기본 높이를 따릅니다.');
    } });
    function updateResetBtn() { var n = customCount(); resetBtn.textContent = '이미지별로 따로 정한 높이 모두 지우기 (' + n + '개)'; resetBtn.disabled = n === 0; }
    var imgH = h('input', { type: 'number', min: 0.5, max: 12, step: 0.1, value: parseFloat(o.imageHeight), 'aria-label': '명령어 이미지 기본 높이', oninput: function (e) {
      var n = parseFloat(e.target.value);
      if (isFinite(n) && n >= 0.5 && n <= 12) { o.imageHeight = (Math.round(n * 10) / 10) + 'em'; changed(); }
    } });
    c.appendChild(h('div', { class: 'row' }, field('명령어 이미지 기본 높이 (글자 크기의 몇 배)', imgH, 'small'),
      h('div', { class: 'field' }, h('label', { text: '\u00a0' }), resetBtn)));
    c.appendChild(h('p', { class: 'msg muted', style: 'margin:-4px 0 12px', text: '글자 크기가 24px이면 3배는 72px입니다. 이미지 하나만 바꾸려면 3번 패널 행의 "설정"을 누르십시오.' }));
    S.updateResetBtn = updateResetBtn;   // 이미지 행에서 높이를 바꿀 때도 이 버튼의 개수와 활성 상태를 갱신합니다.
    updateResetBtn();
    var bg = parseRgba(o.backgroundColor);
    var bgColor = h('input', { type: 'color', value: bg.hex });
    var bgAlpha = h('input', { type: 'range', min: 0, max: 100, value: Math.round(bg.a * 100) });
    function bgChanged() { o.backgroundColor = hexToRgba(bgColor.value, (bgAlpha.value / 100).toFixed(2)); changed(); }
    bgColor.addEventListener('input', bgChanged); bgAlpha.addEventListener('input', bgChanged);
    c.appendChild(h('div', { class: 'row' }, color('글자 색', 'textColor'), color('테두리 색', 'outlineColor'),
      field('배경 색', bgColor, 'small'), field('배경 진하기 (왼쪽 끝 = 투명)', bgAlpha)));
    c.appendChild(h('div', { class: 'row' }, field('글꼴', fontPicker(o.fontFamily, function (v) { o.fontFamily = v; changed(); }).el)));
    c.appendChild(h('div', { class: 'checks' },
      check('치지직 뱃지 보이기', o.showBadges, function (on) { o.showBadges = on; changed(); }),
      check('닉네임 보이기', o.showNickname, function (on) { o.showNickname = on; changed(); }),
      check('연결 상태 안내를 화면에 보이기 (연결 중/실패일 때만)', o.showStatus, function (on) { o.showStatus = on; changed(); })));
  }

  // ---------- 화면: 고급 ----------
  function renderAdvanced() {
    var c = $('s-advanced'); c.textContent = '';
    var ad = S.cfg.advanced;
    c.appendChild(h('details', null, h('summary', { text: '문제 해결용 설정 (보통은 건드릴 필요 없습니다)' }),
      h('p', { class: 'msg muted', text: '비워 두면 기본 주소를 씁니다.' }),
      h('div', { class: 'row' }, field('채널 정보 서버', text(ad.apiBase, function (v) { ad.apiBase = v; changed(); }, { placeholder: 'https://api.chzzk.naver.com' }))),
      h('div', { class: 'row' }, field('채팅 권한 서버', text(ad.commApiBase, function (v) { ad.commApiBase = v; changed(); }, { placeholder: 'https://comm-api.game.naver.com' }))),
      h('div', { class: 'row' }, field('채팅 웹소켓 주소', text(ad.wsUrl, function (v) { ad.wsUrl = v; changed(); }, { placeholder: 'wss://kr-ss1.chat.naver.com/chat' })))));
  }


  function renderAll() {
    renderObs(); renderChannel(); renderImages(); renderBBCode(); renderHidden(); renderPermissions(); renderStyle(); renderAdvanced();
  }

  // ---------- 파일 끌어다 놓기 ----------
  var veil = $('dropveil'), depth = 0;
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
  document.addEventListener('dragenter', function (e) { if (hasFiles(e)) { depth++; veil.hidden = false; e.preventDefault(); } });
  document.addEventListener('dragover', function (e) { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) veil.hidden = true; });
  document.addEventListener('drop', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; veil.hidden = true;
    addFiles(Array.prototype.slice.call(e.dataTransfer.files));
  });

  // 창으로 돌아왔을 때 이미지 폴더가 바뀌었으면(탐색기에서 넣었다면) 다시 읽기
  window.addEventListener('focus', function () {
    api('GET', '/api/state').then(function (st) {
      var key = function (list) { return list.map(function (i) { return i.path + ':' + i.size + ':' + i.mtime; }).join('|'); };
      var changedFiles = key(st.images) !== key(S.images) || st.folders.join('|') !== S.folders.join('|');
      if (changedFiles) {
        // 탐색기에서 이미지를 옮겨서 서버가 명령어 경로를 자동으로 고쳤다면 그 설정도 받아 옵니다.
        S.images = st.images; S.folders = st.folders;
        if (JSON.stringify(st.config.commands) !== JSON.stringify(L.normalizeConfig(S.cfg).commands)) S.cfg.commands = L.normalizeConfig(st.config).commands;
        renderImageList(); renderTagBar(); renderAddTag(); updateSummaries();
      }
    }).catch(function () { /* 다음에 다시 */ });
  });

  $('collapseAll').addEventListener('click', function () { setAllSections(true); });
  $('expandAll').addEventListener('click', function () { setAllSections(false); });

  // ---------- 시작 ----------
  api('GET', '/api/state').then(function (st) {
    S.cfg = L.normalizeConfig(st.config);
    S.images = st.images; S.folders = st.folders || []; S.status = st.status; S.recent = st.recent || [];
    S.dataDir = st.dataDir; S.urls = st.urls; S.canOpenFolder = st.canOpenFolder;
    renderAll();
    setChip('ok', '자동 저장');
    connectWs();
  }).catch(function (e) {
    setChip('bad', '앱과 연결하지 못했습니다');
    document.querySelector('main').textContent = '앱과 연결하지 못했습니다: ' + e.message + ' — ChzzkChatConPlus 앱이 켜져 있는지 확인하십시오.';
  });
})();

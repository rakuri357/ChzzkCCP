/* output.html: ChzzkChatConPlus 앱(로컬 서버)에서 채팅과 설정을 받아 화면에 그립니다. */
(function () {
  'use strict';
  var chatEl = document.getElementById('chat');
  var statusEl = document.getElementById('status');
  var params = new URLSearchParams(location.search);
  var demo = params.get('demo') === '1'; // 접속 없이 모양만 보는 용도 (설정 화면의 미리보기)
  if (params.get('preview') === '1' || demo) document.body.classList.add('preview');

  var cfg = Lite.normalizeConfig(null);
  var derived = Lite.derive(cfg);
  var appDown = false, everConnected = false, lastStatus = null;

  // ---------- 상태 표시 ----------
  function setStatus(text, sub, isError) {
    if (!text || !cfg.overlay.showStatus) { statusEl.hidden = true; return; }
    statusEl.hidden = false;
    statusEl.className = isError ? 'error' : '';
    statusEl.textContent = text;
    if (sub) { var s = document.createElement('small'); s.textContent = sub; statusEl.appendChild(s); }
  }

  function renderStatus() {
    if (demo) { setStatus(''); return; }
    if (appDown) { setStatus('ChzzkChatConPlus 앱과 연결이 끊겼습니다.', '앱이 켜져 있는지 확인하십시오. 켜면 자동으로 다시 연결됩니다.', true); return; }
    var s = lastStatus;
    if (!s) { setStatus(''); return; }
    if (s.state === 'no-channel') setStatus('채널 링크가 아직 설정되지 않았습니다.', 'ChzzkChatConPlus 앱에서 내 채널 페이지 주소를 입력하십시오.', true);
    else if (s.state === 'connecting') setStatus('치지직 채팅에 연결하는 중… ' + (s.detail.step || ''), '', false);
    else if (s.state === 'retry') setStatus('치지직 연결 실패: ' + s.detail.message + ' (' + s.detail.seconds + '초 뒤 다시 시도)', s.detail.hint, true);
    else setStatus('');
  }

  // ---------- 채팅 줄 ----------
  function trim() { while (chatEl.children.length > cfg.overlay.maxLines) chatEl.removeChild(chatEl.firstChild); }

  // 채팅 줄마다 올라온 시각을 기억해 두고, 사라지는 시간이 바뀌면 화면에 있는 모든 줄의 타이머를 다시 맞춥니다.
  function clearFade(line) { clearTimeout(line._t1); clearTimeout(line._t2); }

  function leave(line) {
    line.classList.add('leaving');
    line._t2 = setTimeout(function () { if (line.parentNode) line.parentNode.removeChild(line); }, 700);
  }

  function scheduleFade(line) {
    clearFade(line);
    line.classList.remove('leaving');
    var life = cfg.overlay.lineLifetimeSec;
    if (demo || life <= 0) return; // 0이면 사라지지 않음 (이미 사라지는 중이던 줄도 되돌립니다)
    var remain = life * 1000 - (Date.now() - line._born);
    if (remain <= 0) leave(line);
    else line._t1 = setTimeout(function () { leave(line); }, remain);
  }

  function addChat(ev) {
    if (Lite.isHidden(ev.content, derived)) return;
    var line = Lite.renderLine(ev, derived, document);
    if (!line) return; // 권한 때문에 보여 줄 내용이 없는 채팅
    line._born = Date.now();
    chatEl.appendChild(line);
    trim();
    scheduleFade(line);
  }

  function applyConfig(raw) {
    cfg = Lite.normalizeConfig(raw);
    derived = Lite.derive(cfg);
    Lite.applyStyle(cfg.overlay, document);
    trim();
    Array.prototype.forEach.call(chatEl.children, scheduleFade); // 이미 올라와 있는 채팅에도 새 설정을 적용
    if (demo) renderDemo();
    renderStatus();
  }

  // ---------- 앱과 연결 ----------
  var retry = 0;
  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws = new WebSocket(proto + '//' + location.host + '/ws');
    ws.onopen = function () { retry = 0; appDown = false; renderStatus(); };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'config') applyConfig(m.config);
      else if (m.type === 'status') { lastStatus = m.status; renderStatus(); }
      else if (m.type === 'chat') addChat(m.msg);
      else if (m.type === 'clear') chatEl.textContent = '';
    };
    ws.onclose = function () { retry++; if (retry >= 2 || everConnected) { appDown = true; renderStatus(); } everConnected = true; setTimeout(connect, Math.min(5000, 500 * retry)); };
    ws.onerror = function () { try { ws.close(); } catch (e) { /* 무시 */ } };
  }

  // ---------- 미리보기(데모) ----------
  // 설정한 태그 이름(예: 무지개)으로 예시 글을 만들어서, 이름을 바꿔도 미리보기에서 효과가 보이게 함
  function tag(canon, inner, arg) {
    var n = Lite.firstTagName(cfg, canon);
    return n ? '[' + n + (arg ? '=' + arg : '') + ']' + inner + '[/' + n + ']' : inner;
  }

  // 일반 시청자와 구독자가 같은 글을 썼을 때 권한에 따라 어떻게 달라지는지 보여 줍니다.
  function renderDemo() {
    chatEl.textContent = '';
    var viewer = { userId: 'demo-viewer', nickname: '일반 시청자', role: 'common_user', badges: [], emojis: {}, subscriber: null };
    var subscriber = { userId: 'demo-sub', nickname: '구독자', role: 'common_user', badges: [], emojis: {}, subscriber: { months: 3, tier: 1 } };
    function say(who, text) { addChat(Object.assign({}, who, { content: text })); }
    say(viewer, '안녕하세요 ' + tag('b', '반가워요'));
    if (cfg.commands.length) {
      var t = '이렇게 보입니다 ' + cfg.commands[0].triggers[0];
      say(viewer, t); say(subscriber, t);
    }
    var fancy = tag('color', '분홍', '#ff7aa2') + ' ' + tag('blink', '깜빡') + ' ' + tag('rainbow', '무지개');
    say(viewer, fancy); say(subscriber, fancy);
    say(subscriber, tag('marquee', '이 글자는 오른쪽에서 왼쪽으로 흘러갑니다') + ' 끝');
  }

  if (demo) {
    window.addEventListener('message', function (e) {
      if (e.data && e.data.type === 'cc-config') applyConfig(e.data.config);
    });
    fetch('/api/state').then(function (r) { return r.json(); }).then(function (s) { applyConfig(s.config); }).catch(function () { renderDemo(); });
  } else {
    connect();
  }
})();

/*
 * 치지직 채팅에 로그인 없이 접속해 채팅을 받습니다. (읽기 전용, 데스크톱 앱/Node에서 실행)
 * 브라우저 페이지에서는 치지직이 요청을 막기(CORS) 때문에 앱 쪽에서 접속합니다.
 *
 * 주의: 치지직이 공식으로 문서화한 방식이 아니라, 치지직 웹페이지 자신이 쓰는 채팅 접속 방식을 따라 한 것입니다.
 * 치지직이 방식을 바꾸면 동작하지 않을 수 있습니다. 실패하면 원인을 사람이 읽을 수 있는 말로 알려 줍니다.
 *
 * 접속 순서
 *   1) 채널 ID → 채팅 채널 ID 확인   (api.chzzk.naver.com)
 *   2) 채팅 접속용 토큰 받기          (comm-api.game.naver.com)
 *   3) 웹소켓 접속 → 접속 요청(cmd 100) → 응답(cmd 10100) → 채팅 수신(cmd 93101)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChzzkChat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    apiBase: 'https://api.chzzk.naver.com',
    commApiBase: 'https://comm-api.game.naver.com',
    wsUrl: '',
    recent: 0,        // 접속 직후 받아 올 최근 채팅 수 (연결 테스트용)
    headers: null,     // 치지직 REST 요청에 붙일 헤더 (앱에서는 브라우저처럼 보이는 User-Agent)
    WebSocketImpl: null, // 웹소켓 구현 (기본: 전역 WebSocket, 없으면 ws 패키지)
    handshakeMs: 7000, // 접속 요청에 대한 응답을 기다리는 시간
    retryBaseSec: 3    // 재시도 간격(실패가 이어질수록 늘어나 최대 30초)
  };

  var CMD = { PING: 0, PONG: 10000, CONNECT: 100, CONNECTED: 10100, RECENT: 5101, RECENT_RES: 15101, CHAT: 93101 };

  function ChatError(kind, message, hint) {
    var e = new Error(message);
    e.kind = kind;
    e.hint = hint || '';
    return e;
  }

  function parseJson(v) {
    if (v && typeof v === 'object') return v;
    if (typeof v !== 'string') return null;
    try { return JSON.parse(v); } catch (e) { return null; }
  }

  /** 서버가 보내는 메시지 한 건을 오버레이가 쓰는 모양으로 바꿈 */
  function normalizeMessage(m) {
    var profile = parseJson(m.profile) || {};
    var extras = parseJson(m.extras) || {};
    var badges = [];
    function add(u) { if (typeof u === 'string' && /^https:\/\//.test(u) && badges.indexOf(u) < 0) badges.push(u); }
    if (profile.badge) add(profile.badge.imageUrl);
    if (profile.streamingProperty && profile.streamingProperty.subscription && profile.streamingProperty.subscription.badge) {
      add(profile.streamingProperty.subscription.badge.imageUrl);
    }
    if (Array.isArray(profile.activityBadges)) profile.activityBadges.forEach(function (b) { add(b && b.imageUrl); });
    // 구독자: 채팅 정보의 프로필에 구독 정보(누적 개월 수, 티어)가 있으면 구독자입니다.
    var sub = profile.streamingProperty && profile.streamingProperty.subscription;
    return {
      subscriber: sub && typeof sub === 'object' ? { months: Number(sub.accumulativeMonth) || 0, tier: Number(sub.tier) || 0 } : null,
      userId: String(profile.userIdHash || m.uid || ''),
      nickname: String(profile.nickname || ''),
      role: String(profile.userRoleCode || 'common_user'),
      titleColor: profile.title && profile.title.color ? String(profile.title.color) : '',
      badges: badges,
      content: typeof m.msg === 'string' ? m.msg : '',
      emojis: extras.emojis && typeof extras.emojis === 'object' ? extras.emojis : {},
      time: Number(m.msgTime || m.ctime) || Date.now(),
      type: m.msgTypeCode
    };
  }

  /** 채팅 서버 번호: 채팅 채널 ID의 글자 코드 합 % 9 + 1 */
  function serverNo(chatChannelId) {
    var sum = 0;
    for (var i = 0; i < chatChannelId.length; i++) sum += chatChannelId.charCodeAt(i);
    return (sum % 9) + 1;
  }

  function ChzzkChat(opts) {
    this.o = Object.assign({}, DEFAULTS, opts || {});
    this.o.apiBase = (this.o.apiBase || DEFAULTS.apiBase).replace(/\/$/, '');
    this.o.commApiBase = (this.o.commApiBase || DEFAULTS.commApiBase).replace(/\/$/, '');
    this.stopped = true;
    this.ws = null;
    this.ver = '3';
    this.fails = 0;
    this._wake = null;
  }

  ChzzkChat.prototype._status = function (state, detail) {
    if (this.o.onStatus) { try { this.o.onStatus({ state: state, detail: detail || {} }); } catch (e) { /* 화면 쪽 오류는 무시 */ } }
  };

  ChzzkChat.prototype.start = function () {
    if (!this.stopped) return;
    this.stopped = false;
    this._loop();
  };

  ChzzkChat.prototype.stop = function () {
    this.stopped = true;
    if (this.ws) { try { this.ws.close(); } catch (e) { /* 무시 */ } }
    if (this._wake) this._wake();
  };

  ChzzkChat.prototype._sleep = function (ms) {
    var self = this;
    return new Promise(function (resolve) {
      var t = setTimeout(done, ms);
      function done() { clearTimeout(t); self._wake = null; resolve(); }
      self._wake = done;
    });
  };

  ChzzkChat.prototype._loop = async function () {
    while (!this.stopped) {
      var startedAt = Date.now();
      var err;
      try { err = await this._connectOnce(); } catch (e) { err = e; }
      if (this.stopped) break;
      var info = { kind: err.kind || 'unknown', message: err.message || String(err), hint: err.hint || '' };
      this.fails = Date.now() - startedAt > 60000 ? 1 : this.fails + 1;
      var seconds = Math.min(30, this.o.retryBaseSec * Math.pow(2, Math.min(this.fails - 1, 3)));
      this._status('retry', Object.assign({ seconds: seconds }, info));
      await this._sleep(seconds * 1000);
    }
  };

  ChzzkChat.prototype._fetchJson = async function (url, what) {
    var res;
    try {
      res = await fetch(url, { cache: 'no-store', headers: this.o.headers || undefined });
    } catch (e) {
      throw ChatError('network', what + ' 요청이 막혔습니다.',
        '인터넷 연결을 확인하십시오. 방화벽/보안 프로그램이 이 앱의 인터넷 사용을 막고 있지 않은지도 확인하십시오.');
    }
    if (!res.ok) throw ChatError('http', what + ' 요청이 실패했습니다 (HTTP ' + res.status + ').', res.status === 404 ? '채널 ID를 찾을 수 없습니다. 채팅창 링크가 아니라 내 채널 페이지 주소(https://chzzk.naver.com/…)를 넣어야 할 수 있습니다.' : '');
    var json;
    try { json = await res.json(); } catch (e) { throw ChatError('format', what + ' 응답을 읽지 못했습니다.'); }
    if (json && typeof json.code === 'number' && json.code !== 200) {
      throw ChatError('api', what + ' 응답 오류: ' + (json.message || json.code), '내 채널 페이지 주소(https://chzzk.naver.com/…)가 맞는지 확인하십시오.');
    }
    return json;
  };

  ChzzkChat.prototype._connectOnce = async function () {
    var o = this.o;
    this._status('connecting', { step: '채널 확인 중' });
    var live = await this._fetchJson(o.apiBase + '/polling/v2/channels/' + encodeURIComponent(o.channelId) + '/live-status', '채널 정보');
    var content = live && live.content;
    var chatChannelId = content && content.chatChannelId;
    if (!chatChannelId) throw ChatError('channel', '이 채널의 채팅 정보를 찾지 못했습니다.', '내 채널 페이지 주소(https://chzzk.naver.com/…)가 맞는지 확인하십시오.');
    this.liveStatus = content.status || '';

    this._status('connecting', { step: '채팅 접속 권한 받는 중', liveStatus: this.liveStatus });
    var tok = await this._fetchJson(o.commApiBase + '/nng_main/v1/chats/access-token?channelId=' + encodeURIComponent(chatChannelId) + '&chatType=STREAMING', '채팅 접속 권한');
    var accessToken = tok && tok.content && tok.content.accessToken;
    if (!accessToken) throw ChatError('api', '채팅 접속 권한을 받지 못했습니다.');

    this._status('connecting', { step: '채팅 서버 접속 중', liveStatus: this.liveStatus });
    return this._openSocket(chatChannelId, accessToken);
  };

  ChzzkChat.prototype._openSocket = function (chatChannelId, accessToken) {
    var self = this;
    var o = this.o;
    return new Promise(function (resolve) {
      var url = o.wsUrl || ('wss://kr-ss' + serverNo(chatChannelId) + '.chat.naver.com/chat');
      var ws;
      var WS = o.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : require('ws'));
      try { ws = new WS(url, o.headers ? { headers: { 'User-Agent': o.headers['User-Agent'] } } : undefined); }
      catch (e) { resolve(ChatError('ws', '채팅 서버 주소가 올바르지 않습니다.')); return; }
      self.ws = ws;
      var connected = false, done = false, hb = null, handshake = null;

      function send(obj) { try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) { /* 무시 */ } }
      function finish(err) {
        if (done) return;
        done = true;
        clearInterval(hb); clearTimeout(handshake);
        try { ws.close(); } catch (e) { /* 무시 */ }
        if (self.ws === ws) self.ws = null;
        resolve(err);
      }

      // 접속 요청에 응답이 없으면 프로토콜 버전을 바꿔서 다음 시도
      handshake = setTimeout(function () {
        if (connected) return;
        self.ver = self.ver === '3' ? '2' : '3';
        finish(ChatError('timeout', '채팅 서버가 응답하지 않습니다.', '잠시 후 다시 시도합니다. 계속 안 되면 치지직 채팅 접속 방식이 바뀐 것일 수 있습니다.'));
      }, o.handshakeMs);

      ws.onopen = function () {
        send({ ver: self.ver, cmd: CMD.CONNECT, svcid: 'game', cid: chatChannelId, tid: 1,
          bdy: { uid: null, devType: 2001, accTkn: accessToken, auth: 'READ' } });
      };

      ws.onmessage = function (ev) {
        var msg = parseJson(ev.data);
        if (!msg) return;
        switch (msg.cmd) {
          case CMD.PING: send({ ver: self.ver, cmd: CMD.PONG }); break;
          case CMD.CONNECTED: {
            var b = msg.bdy || {};
            if (typeof msg.retCode === 'number' && msg.retCode !== 0) {
              finish(ChatError('auth', '채팅 서버가 접속을 거부했습니다: ' + (msg.retMsg || msg.retCode)));
              break;
            }
            connected = true;
            clearTimeout(handshake);
            self.fails = 0;
            hb = setInterval(function () { send({ ver: self.ver, cmd: CMD.PING }); }, 20000);
            self._status('connected', { liveStatus: self.liveStatus, chatChannelId: chatChannelId });
            if (o.recent > 0) {
              send({ ver: self.ver, cmd: CMD.RECENT, svcid: 'game', cid: chatChannelId, sid: b.sid, tid: 2, bdy: { recentMessageCount: o.recent } });
            }
            break;
          }
          case CMD.CHAT:
          case CMD.RECENT_RES: {
            var list = Array.isArray(msg.bdy) ? msg.bdy : (msg.bdy && Array.isArray(msg.bdy.messageList) ? msg.bdy.messageList : []);
            list.forEach(function (m) {
              var n = normalizeMessage(m);
              if (n.type !== undefined && n.type !== 1) return; // 일반 채팅만 (후원 등은 제외)
              n.recent = msg.cmd === CMD.RECENT_RES;
              if (o.onChat) { try { o.onChat(n); } catch (e) { /* 화면 쪽 오류는 무시 */ } }
            });
            break;
          }
          default: break; // 모르는 명령은 무시
        }
      };

      ws.onerror = function () { /* 곧 onclose가 오므로 거기서 처리 */ };
      ws.onclose = function (ev) {
        if (connected) finish(ChatError('closed', '채팅 연결이 끊겼습니다.'));
        else finish(ChatError('ws', '채팅 서버가 접속을 받아 주지 않았습니다 (코드 ' + (ev && ev.code) + ').',
          '방화벽/보안 프로그램이 막고 있거나, 치지직의 채팅 접속 방식이 바뀐 것일 수 있습니다.'));
      };
    });
  };

  ChzzkChat.normalizeMessage = normalizeMessage;
  ChzzkChat.serverNo = serverNo;
  return ChzzkChat;
});

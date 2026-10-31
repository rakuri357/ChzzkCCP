'use strict';
// 치지직 채팅 접속 방식(REST 2번 + 웹소켓)을 흉내 낸 가짜 서버. CORS 허용.
const http = require('http');
const { WebSocketServer } = require('ws');

// 가짜 서버가 인정하는 스튜디오 채팅창 주소의 32자리(위젯 키)
const WIDGET_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

async function startFakeChzzk(opts = {}) {
  const state = { connects: [], pongs: 0, recentRequests: 0, sockets: new Set(), liveStatusCalls: 0, tokenCalls: 0, sourceCalls: 0, chatChannelId: 'N1abc' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    const json = (obj, code = 200) => { res.writeHead(code, cors); res.end(JSON.stringify(obj)); };
    const m = /^\/polling\/v2\/channels\/([^/]+)\/live-status$/.exec(u.pathname);
    if (m) {
      state.liveStatusCalls++;
      if (opts.liveStatusHttp) return json({}, opts.liveStatusHttp);
      if (m[1] === 'nochat') return json({ code: 200, content: { status: 'CLOSE' } });
      return json({ code: 200, message: null, content: { status: state.status || opts.status || 'OPEN', chatChannelId: state.chatChannelId } });
    }
    // 스튜디오 채팅창 주소(위젯 키)로 지금의 채팅 채널을 알려 주는 요청. 키는 WIDGET_KEY만 인정합니다.
    const src = /^\/manage\/v1\/chats\/sources\/([^/]+)$/.exec(u.pathname);
    if (src) {
      state.sourceCalls++;
      if (opts.sourceHttp) return json({}, opts.sourceHttp);
      if (src[1] !== WIDGET_KEY) return json({ code: 404, message: 'not found' }, 404);
      return json({ code: 200, message: null, content: { chatChannelId: state.chatChannelId } });
    }
    if (u.pathname === '/nng_main/v1/chats/access-token') {
      state.tokenCalls++;
      return json({ code: 200, content: { accessToken: 'TOK', extraToken: 'x', realNameAuth: false } });
    }
    res.writeHead(404, cors); res.end('{}');
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      state.sockets.add(ws);
      ws.on('close', () => state.sockets.delete(ws));
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.cmd === 100) {
          state.connects.push(msg);
          if (opts.ignoreVer && msg.ver === opts.ignoreVer) return; // 이 버전은 응답하지 않음
          if (msg.bdy.accTkn !== 'TOK' || msg.cid !== state.chatChannelId) { ws.send(JSON.stringify({ ver: msg.ver, cmd: 10100, retCode: 1, retMsg: 'bad token', bdy: {} })); return; }
          ws.send(JSON.stringify({ ver: msg.ver, cmd: 10100, retCode: 0, bdy: { sid: 'SID' } }));
          if (opts.pingServer) ws.send(JSON.stringify({ ver: msg.ver, cmd: 0 }));
        } else if (msg.cmd === 10000) {
          state.pongs++;
        } else if (msg.cmd === 5101) {
          state.recentRequests++;
          ws.send(JSON.stringify({ ver: msg.ver, cmd: 15101, bdy: { messageList: (opts.recent || []).map(chatMsg) } }));
        }
      });
    });
  });
  await new Promise((r) => server.listen(opts.port || 0, '127.0.0.1', r));
  const port = server.address().port;

  function chatMsg(o) {
    return {
      svcid: 'game', cid: state.chatChannelId, uid: o.uid || 'u1', msg: o.msg, msgTypeCode: o.type === undefined ? 1 : o.type, msgTime: o.time || Date.now(),
      profile: JSON.stringify(o.profile || { userIdHash: o.uid || 'u1', nickname: o.nick || '시청자', userRoleCode: o.role || 'common_user' }),
      extras: JSON.stringify(o.extras || { emojis: o.emojis || {} })
    };
  }
  return {
    state, port, base: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}/chat`,
    emit(o) { const text = JSON.stringify({ ver: '3', cmd: 93101, bdy: [chatMsg(o)] }); state.sockets.forEach((s) => s.send(text)); },
    // 방송이 시작되거나 끝나서 채팅 채널이 새로 만들어진 상황을 흉내 냅니다. (예전 채팅방에 보낸 채팅은 더 이상 오지 않음)
    setChatChannel(id, status) { state.chatChannelId = id; if (status) state.status = status; },
    dropAll() { state.sockets.forEach((s) => s.terminate()); },
    close: () => new Promise((r) => { state.sockets.forEach((s) => s.terminate()); server.close(r); if (server.closeAllConnections) server.closeAllConnections(); })
  };
}

module.exports = { startFakeChzzk, WIDGET_KEY };

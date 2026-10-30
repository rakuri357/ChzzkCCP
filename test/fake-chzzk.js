'use strict';
// 치지직 채팅 접속 방식(REST 2번 + 웹소켓)을 흉내 낸 가짜 서버. CORS 허용.
const http = require('http');
const { WebSocketServer } = require('ws');

async function startFakeChzzk(opts = {}) {
  const state = { connects: [], pongs: 0, recentRequests: 0, sockets: new Set(), liveStatusCalls: 0, tokenCalls: 0 };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    const json = (obj, code = 200) => { res.writeHead(code, cors); res.end(JSON.stringify(obj)); };
    const m = /^\/polling\/v2\/channels\/([^/]+)\/live-status$/.exec(u.pathname);
    if (m) {
      state.liveStatusCalls++;
      if (opts.liveStatusHttp) return json({}, opts.liveStatusHttp);
      if (m[1] === 'nochat') return json({ code: 200, content: { status: 'CLOSE' } });
      return json({ code: 200, message: null, content: { status: opts.status || 'OPEN', chatChannelId: 'N1abc' } });
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
          if (msg.bdy.accTkn !== 'TOK' || msg.cid !== 'N1abc') { ws.send(JSON.stringify({ ver: msg.ver, cmd: 10100, retCode: 1, retMsg: 'bad token', bdy: {} })); return; }
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
      svcid: 'game', cid: 'N1abc', uid: o.uid || 'u1', msg: o.msg, msgTypeCode: o.type === undefined ? 1 : o.type, msgTime: o.time || Date.now(),
      profile: JSON.stringify(o.profile || { userIdHash: o.uid || 'u1', nickname: o.nick || '시청자', userRoleCode: o.role || 'common_user' }),
      extras: JSON.stringify(o.extras || { emojis: o.emojis || {} })
    };
  }
  return {
    state, port, base: `http://127.0.0.1:${port}`, wsUrl: `ws://127.0.0.1:${port}/chat`,
    emit(o) { const text = JSON.stringify({ ver: '3', cmd: 93101, bdy: [chatMsg(o)] }); state.sockets.forEach((s) => s.send(text)); },
    dropAll() { state.sockets.forEach((s) => s.terminate()); },
    close: () => new Promise((r) => { state.sockets.forEach((s) => s.terminate()); server.close(r); if (server.closeAllConnections) server.closeAllConnections(); })
  };
}

module.exports = { startFakeChzzk };

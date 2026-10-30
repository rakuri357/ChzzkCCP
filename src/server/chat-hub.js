'use strict';
// 설정에 맞춰 치지직 채팅 접속을 관리하고, 받은 채팅/상태를 구독자(오버레이, 설정 화면)에게 전달합니다.
const { EventEmitter } = require('events');
const ChzzkChat = require('./chzzk-chat');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

class ChatHub extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.chatOptions = opts.chatOptions || {};
    this.key = '';
    this.client = null;
    this.recent = [];
    this.status = { state: 'no-channel', detail: {} };
  }

  _setStatus(state, detail) {
    this.status = { state, detail: detail || {} };
    this.emit('status', this.status);
  }

  /** 설정이 바뀔 때마다 호출: 채널/접속 주소가 바뀌었을 때만 다시 접속 */
  apply(config) {
    const key = JSON.stringify([config.channel.channelId, config.advanced]);
    if (key === this.key) return;
    this.key = key;
    this.stop();
    this.recent = [];
    const id = config.channel.channelId;
    if (!id) { this._setStatus('no-channel'); return; }
    this._setStatus('connecting', { step: '채널 확인 중' });
    this.client = new ChzzkChat(Object.assign({
      channelId: id,
      apiBase: config.advanced.apiBase, commApiBase: config.advanced.commApiBase, wsUrl: config.advanced.wsUrl,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
      WebSocketImpl: require('ws'),
      onStatus: (s) => this._setStatus(s.state, s.detail),
      onChat: (ev) => {
        this.recent.push(ev);
        if (this.recent.length > 30) this.recent.shift();
        this.emit('chat', ev);
      }
    }, this.chatOptions));
    this.client.start();
  }

  stop() {
    if (this.client) { this.client.stop(); this.client = null; }
  }
}

module.exports = { ChatHub };

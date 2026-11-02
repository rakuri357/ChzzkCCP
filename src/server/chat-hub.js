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
    this.history = [];   // 진단용: 최근 연결 상태 변화(시각, 상태, 오류 종류와 내용)
  }

  _setStatus(state, detail) {
    const last = this.history[this.history.length - 1];
    const d = detail || {};
    // 같은 상태가 이어지는 단계 표시(접속 중 등)는 기록하지 않고, 상태가 바뀌었거나 오류일 때만 남깁니다.
    if (!last || last.state !== state || state === 'retry') {
      this.history.push({ time: Date.now(), state, kind: d.kind || '', message: d.message || '' });
      if (this.history.length > 20) this.history.shift();
    }
    this.status = { state, detail: d };
    this.emit('status', this.status);
  }

  /** 설정이 바뀔 때마다 호출: 채널/접속 주소가 바뀌었을 때만 다시 접속 */
  apply(config) {
    const key = JSON.stringify([config.channel.channelId, config.channel.chatKey || '', config.advanced]);
    if (key === this.key) return;
    this.key = key;
    this.stop();
    this.recent = [];
    const id = config.channel.channelId;
    const sourceKey = config.channel.chatKey || '';
    if (!id && !sourceKey) { this._setStatus('no-channel'); return; }
    this._setStatus('connecting', { step: '채널 확인 중' });
    this.client = new ChzzkChat(Object.assign({
      channelId: id, sourceKey,
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

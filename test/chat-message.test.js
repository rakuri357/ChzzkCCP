'use strict';
// 치지직 채팅 메시지를 오버레이가 쓰는 모양으로 바꾸는 부분의 시험 (구독 정보, 역할, 뱃지)
const test = require('node:test');
const assert = require('node:assert');
const ChzzkChat = require('../src/server/chzzk-chat');

const msg = (profile, extra) => ({ msg: '안녕', msgTypeCode: 1, uid: 'u1', msgTime: 1, profile: JSON.stringify(profile), extras: '{}', ...extra });

test('구독 정보가 있으면 구독자로 읽는다 (누적 개월 수와 티어)', () => {
  const n = ChzzkChat.normalizeMessage(msg({ userIdHash: 'h', nickname: '구독자', userRoleCode: 'common_user',
    streamingProperty: { subscription: { accumulativeMonth: 5, tier: 2, badge: { imageUrl: 'https://ssl.pstatic.net/s.png' } } } }));
  assert.deepEqual(n.subscriber, { months: 5, tier: 2 });
  assert.equal(n.role, 'common_user');
  assert.deepEqual(n.badges, ['https://ssl.pstatic.net/s.png']);
});

test('구독 정보가 없거나 이상하면 구독자가 아니다', () => {
  for (const sp of [undefined, {}, { subscription: null }, { subscription: 'yes' }, { subscription: 0 }]) {
    const n = ChzzkChat.normalizeMessage(msg({ nickname: 'x', userRoleCode: 'common_user', streamingProperty: sp }));
    assert.equal(n.subscriber, null, JSON.stringify(sp));
  }
  assert.equal(ChzzkChat.normalizeMessage(msg('깨진 JSON')).subscriber, null);
  assert.equal(ChzzkChat.normalizeMessage(msg(null)).subscriber, null);
});

test('구독 정보의 값이 숫자가 아니어도 구독자로는 인식한다 (개월 수는 0)', () => {
  const n = ChzzkChat.normalizeMessage(msg({ streamingProperty: { subscription: { accumulativeMonth: 'x', tier: null } } }));
  assert.deepEqual(n.subscriber, { months: 0, tier: 0 });
});

test('역할 코드를 그대로 전달한다', () => {
  for (const role of ['streamer', 'streaming_chat_manager', 'streaming_channel_manager', 'common_user']) {
    assert.equal(ChzzkChat.normalizeMessage(msg({ userRoleCode: role })).role, role);
  }
  assert.equal(ChzzkChat.normalizeMessage(msg({})).role, 'common_user');
});

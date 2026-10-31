'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const L = require('../public/lib/common');

const dom = (text, cfgRaw, extra) => {
  const cfg = L.normalizeConfig(cfgRaw);
  const d = L.derive(cfg);
  const doc = new JSDOM('<body></body>').window.document;
  return L.renderLine(Object.assign({ nickname: 'x', role: 'common_user', userId: 'u', content: text, emojis: {} }, extra), d, doc);
};

test('채널 주소에서 ID 뽑기 / 채팅창 링크 구분', () => {
  const id = '0123456789abcdef0123456789abcdef';
  assert.equal(L.parseChannelId(`https://chzzk.naver.com/${id}`), id);
  assert.equal(L.parseChannelId(`https://chzzk.naver.com/chat/${id}`), id);
  assert.equal(L.parseChannelId('https://chzzk.naver.com/짧은값'), '');
  assert.ok(L.looksLikeChatLink(`https://chzzk.naver.com/chat/${id}`));
  assert.ok(!L.looksLikeChatLink(`https://chzzk.naver.com/${id}`));
});

test('이미지 하나에 명령어 여러 개: 모두 인식하고 긴 명령어가 먼저 잡힌다', () => {
  const raw = { commands: [{ triggers: ['~감사', '~감사합니다', '~땡큐'], image: '감사.svg' }] };
  for (const word of ['~감사', '~감사합니다', '~땡큐']) {
    const line = dom(`고마워요 ${word}`, raw);
    assert.equal(line.querySelectorAll('img.cmd-img').length, 1, word);
    assert.equal(line.querySelector('.msg').textContent, '고마워요 ', word + ' 뒤에 글자가 남으면 안 됨');
  }
  assert.equal(dom('~감사합니다 ~땡큐', raw).querySelectorAll('img.cmd-img').length, 2);
});

test('예전 형식(명령어 하나)의 설정은 새 형식으로 바뀌고, 예전 기본 높이(2.4em)는 기본값을 따르게 된다', () => {
  const c = L.normalizeConfig({ commands: [{ trigger: '~감사', image: '감사.svg' }, { trigger: '~땡큐', image: '감사.svg', height: '3em' }, { trigger: '~사랑', image: '하트.svg', match: 'whole', height: '2.4em' }] });
  assert.deepEqual(c.commands, [
    { triggers: ['~감사', '~땡큐'], image: '감사.svg', height: '', match: 'anywhere', access: '' },
    { triggers: ['~사랑'], image: '하트.svg', height: '', match: 'whole', access: '' }
  ]);
  assert.equal(c.version, L.CONFIG_VERSION);
});

test('기본값: 채팅은 10초 뒤에 사라지고, 명령어 이미지 기본 높이는 3em', () => {
  const o = L.normalizeConfig(null).overlay;
  assert.equal(o.lineLifetimeSec, 10);
  assert.equal(o.imageHeight, '3em');
  assert.equal(L.normalizeConfig({ overlay: { lineLifetimeSec: 0 } }).overlay.lineLifetimeSec, 0, '직접 0으로 정한 설정은 그대로');
});

test('기본 태그 이름: 영문, 단축, 한글이 처음부터 켜져 있다', () => {
  const n = L.resolveTagNames({});
  assert.deepEqual(n.names.rainbow, ['rainbow', 'rb', '무지개']);
  assert.deepEqual(n.names.wave, ['wave', 'wv', '물결', '파도', '출렁']);
  assert.deepEqual(n.names.glow, ['glow', 'gl', '반짝', '빛']);
  assert.deepEqual(n.names.shine, ['shine', 'sh', '광택', '윤', '광']);
  assert.deepEqual(n.conflicts, []);
  const c = L.normalizeConfig(null);
  assert.deepEqual(c.bbcode.tags, {});
  assert.equal(dom('[굵게]x[/굵게] [rb]y', {}).querySelector('.bb-b').textContent, 'x');
});

test('채널 설정: 채널 페이지 주소는 channelId, 스튜디오의 채팅창 주소는 chatKey(위젯 키)로 저장한다', () => {
  const id = '0123456789abcdef0123456789abcdef';
  const page = L.normalizeConfig({ channel: { url: `https://chzzk.naver.com/${id}` } }).channel;
  assert.deepEqual(page, { url: `https://chzzk.naver.com/${id}`, channelId: id, chatKey: '' });
  const chat = L.normalizeConfig({ channel: { url: `https://chzzk.naver.com/chat/${id}` } }).channel;
  assert.deepEqual(chat, { url: `https://chzzk.naver.com/chat/${id}`, channelId: '', chatKey: id });
  assert.deepEqual(L.normalizeConfig({ channel: { url: 'https://chzzk.naver.com/chat/abc123' } }).channel, { url: 'https://chzzk.naver.com/chat/abc123', channelId: '', chatKey: '' }, '32자리가 아니면 둘 다 비움');
  assert.deepEqual(L.normalizeConfig(null).channel, { url: '', channelId: '', chatKey: '' });
  // 예전 설정(chatKey 없음)과 주소를 바꾼 경우
  assert.equal(L.normalizeConfig({ channel: { url: '', channelId: id } }).channel.channelId, id);
  assert.equal(L.normalizeConfig({ channel: { url: `https://chzzk.naver.com/${id}`, chatKey: 'zzz' } }).channel.chatKey, '', '저장된 chatKey보다 주소를 따른다');
});

test('명령어 검사: 띄어쓰기/대괄호/중복/개수', () => {
  const t20 = Array.from({ length: 25 }, (_, i) => '~a' + i);
  const c = L.normalizeConfig({ commands: [
    { triggers: ['a b', '[x]', '~ok', '~ok', ''], image: 'a.png' },
    { triggers: ['~ok', '~two'], image: 'b.png' },          // ~ok는 앞 이미지가 이미 사용
    { triggers: t20, image: 'c.png' },
    { triggers: ['~x'], image: '../evil.png' }
  ] });
  assert.deepEqual(c.commands[0].triggers, ['~ok']);
  assert.deepEqual(c.commands[1].triggers, ['~two']);
  assert.equal(c.commands[2].triggers.length, 20);
  assert.equal(c.commands.length, 3);
});

test('명령어가 하나도 없는 이미지는 저장하지 않는다', () => {
  assert.deepEqual(L.normalizeConfig({ commands: [{ triggers: [], image: 'a.png' }] }).commands, []);
});

test('태그 이름 바꾸기: 한글 이름과 기본 이름을 함께/따로 쓰기', () => {
  const both = { bbcode: { tags: { rainbow: { names: ['rainbow', '무지개'] } } } };
  assert.ok(dom('[무지개]x[/무지개]', both).querySelector('.bb-rainbow'));
  assert.ok(dom('[rainbow]x[/rainbow]', both).querySelector('.bb-rainbow'));
  const onlyKo = { bbcode: { tags: { rainbow: { names: ['무지개'] } } } };
  assert.ok(dom('[무지개]x[/무지개]', onlyKo).querySelector('.bb-rainbow'));
  assert.equal(dom('[rainbow]x[/rainbow]', onlyKo).querySelector('.bb-rainbow'), null);
});

test('태그 이름 규칙: 이상한 이름은 버리고, 겹치면 앞 태그가 갖는다', () => {
  const c = L.normalizeConfig({ bbcode: { tags: {
    b: { names: ['b', '굵게'] },
    i: { names: ['굵게', '기울임', 'a b', '[x]', 'x'.repeat(13)] }, // 굵게는 이미 b가 사용
    rainbow: { names: [] }
  } } });
  assert.deepEqual(L.resolveTagNames(c.bbcode.tags).names.i, ['기울임']);
  assert.deepEqual(L.resolveTagNames(c.bbcode.tags).names.rainbow, []);
  assert.equal(L.firstTagName(c, 'rainbow'), null);
  assert.equal(L.firstTagName(c, 'b'), 'b');
  assert.deepEqual(L.resolveTagNames({ i: { names: ['굵게'] }, b: { names: ['b', '굵게'] } }).conflicts.map((x) => x.name), ['굵게']);
});

test('기본 상태의 태그는 설정에 흔적을 남기지 않는다', () => {
  const c = L.normalizeConfig({ bbcode: { tags: { b: { names: ['b', '굵게'] }, i: { enabled: true }, blink: { enabled: false } } } });
  assert.deepEqual(c.bbcode.tags, { blink: { enabled: false } });
  assert.deepEqual(L.normalizeConfig({ bbcode: { tags: { b: { names: ['b'] } } } }).bbcode.tags, { b: { names: ['b'] } }, '이름을 줄이면 설정에 남는다');
});

test('태그를 끄면 이름이 있어도 동작하지 않는다', () => {
  const raw = { bbcode: { tags: { rainbow: { enabled: false, names: ['rainbow', '무지개'] } } } };
  assert.equal(dom('[무지개]x[/무지개]', raw).querySelector('.bb-rainbow'), null);
});

test('화면 접기 상태 저장: 알려진 단락만, true만', () => {
  const c = L.normalizeConfig({ ui: { collapsed: { obs: true, images: true, hack: true, style: false } } });
  assert.deepEqual(c.ui.collapsed, { obs: true, images: true });
  assert.deepEqual(L.normalizeConfig(null).ui.collapsed, {});
});

test('이미지 경로: 폴더 이름이 태그이고, 위험한 경로는 거절한다', () => {
  assert.deepEqual(L.splitImagePath('표정/웃음/감사.svg'), { tag: '표정/웃음', name: '감사.svg', segs: ['표정', '웃음'] });
  assert.deepEqual(L.splitImagePath('감사.svg'), { tag: '', name: '감사.svg', segs: [] });
  for (const bad of ['../x.png', 'a/../x.png', '/abs.png', 'a\\b.png', '.hidden/x.png', 'a//x.png', 'a/b/c/d/x.png', 'a:b/x.png', 'x.txt', 'a /x.png', 'a./x.png', '', 'x'.repeat(61) + '.png']) {
    assert.equal(L.splitImagePath(bad), null, bad);
  }
  assert.deepEqual(L.splitTag('표정/웃음'), ['표정', '웃음']);
  assert.deepEqual(L.splitTag(''), []);
  assert.deepEqual(L.splitTag('   '), []);
  for (const bad of ['a/../b', '/a', 'a/b/c/d', 'a//b', 'a:b', '.x']) assert.equal(L.splitTag(bad), null, bad);
});

test('폴더 안 이미지의 명령어: 설정에 경로로 저장되고, 화면 주소는 폴더 이름마다 인코딩된다', () => {
  const c = L.normalizeConfig({ commands: [{ triggers: ['~기쁨'], image: '표정/웃음/기쁨 1.png' }, { triggers: ['~x'], image: '../x.png' }] });
  assert.deepEqual(c.commands.map((x) => x.image), ['표정/웃음/기쁨 1.png']);
  const d = L.derive(c);
  assert.equal(d.cmds[0].src, 'images/' + ['표정', '웃음', '기쁨 1.png'].map(encodeURIComponent).join('/'));
  const line = dom('~기쁨', c);
  assert.equal(line.querySelectorAll('img.cmd-img').length, 1, '폴더 안 이미지도 오버레이에서 이미지로 바뀜');
});

test('이미지 정렬 설정 저장: 알려진 값만', () => {
  assert.equal(L.normalizeConfig({ ui: { imageSort: 'tag' } }).ui.imageSort, 'tag');
  assert.equal(L.normalizeConfig({ ui: { imageSort: 'hack' } }).ui.imageSort, 'name');
  assert.equal(L.normalizeConfig(null).ui.imageSort, 'name');
});

test('패널 순서: BBCode가 숨길 채팅보다 먼저', () => {
  const k = L.SECTION_KEYS;
  assert.ok(k.indexOf('bbcode') < k.indexOf('hidden'));
});

test('명령어 이미지 기본 높이: 이미지마다 따로 정하지 않으면 기본값을 따른다', () => {
  const raw = { version: 3, overlay: { imageHeight: '3.2em' }, commands: [
    { triggers: ['~a'], image: 'a.png' },                      // 따로 정하지 않음 → 기본값
    { triggers: ['~b'], image: 'b.png', height: '60px' },      // 따로 정함
    { triggers: ['~c'], image: 'c.png', height: '2.4em' }      // 새 설정에서는 2.4em을 직접 적어도 그대로 유지
  ] };
  const d = L.derive(L.normalizeConfig(raw));
  assert.deepEqual(d.cmds.map((x) => x.height), ['3.2em', '60px', '2.4em']);
  assert.equal(L.derive(L.normalizeConfig({ version: 3, commands: [{ triggers: ['~a'], image: 'a.png' }] })).cmds[0].height, '3em', '기본값의 기본값');
  const line = dom('~a', raw);
  assert.equal(line.querySelector('img.cmd-img').style.height, '3.2em', '오버레이에 기본 높이가 적용됨');
});

test('높이 값 검사: 단위와 범위', () => {
  for (const ok of ['2.4em', '0.5em', '12em', '3rem', '8px', '400px', '60px']) assert.ok(L.validHeight(ok), ok);
  for (const bad of ['0.4em', '13em', '7px', '401px', 'abc', '60', '', '1px;x', '2.4 em', 'em']) assert.ok(!L.validHeight(bad), bad);
  assert.equal(L.normalizeConfig({ overlay: { imageHeight: '999em' } }).overlay.imageHeight, '3em');
  assert.equal(L.normalizeConfig({ overlay: { imageHeight: '1.6em' } }).overlay.imageHeight, '1.6em');
});

test('추천 명령어: 파일 이름으로 만들고, 겹치면 숫자를 붙이고, 만들 수 없으면 빈 값', () => {
  assert.equal(L.suggestTrigger('식은땀.gif', {}), '~식은땀');
  assert.equal(L.suggestTrigger('표정/웃음/기쁨.png', {}), '~기쁨', '폴더 이름은 명령어에 넣지 않음');
  assert.equal(L.suggestTrigger('기쁨 1.png', {}), '~기쁨1', '띄어쓰기는 뺌');
  assert.equal(L.suggestTrigger('[감사] {x}.png', {}), '~감사x', '쓸 수 없는 글자는 뺌');
  assert.equal(L.suggestTrigger('감사.svg', { '~감사': true }), '~감사2');
  assert.equal(L.suggestTrigger('감사.svg', { '~감사': true, '~감사2': true }), '~감사3');
  assert.equal(L.suggestTrigger('기쁨 (2).png', {}), '~기쁨2', '자동으로 붙은 (2)는 숫자로');
  assert.equal(L.suggestTrigger('[] {}.png', {}), '', '쓸 수 있는 글자가 없으면 만들지 않음');
  assert.equal(L.suggestTrigger('가'.repeat(40) + '.png', {}), '', '명령어는 40자까지 (~ 포함)');
  assert.equal(L.suggestTrigger('가'.repeat(39) + '.png', {}), '~' + '가'.repeat(39));
  assert.equal(L.suggestTrigger('../x.png', {}), '', '올바르지 않은 경로');
  // 만들어진 명령어는 설정에서 그대로 쓸 수 있어야 함
  const t = L.suggestTrigger('표정/식은땀 2.gif', {});
  assert.deepEqual(L.normalizeConfig({ commands: [{ triggers: [t], image: '표정/식은땀 2.gif' }] }).commands.map((c) => c.triggers), [[t]]);
});

test('추천 명령어 자동 등록 설정은 기본으로 켜져 있다', () => {
  assert.equal(L.normalizeConfig(null).ui.autoCommand, true);
  assert.equal(L.normalizeConfig({ ui: { autoCommand: false } }).ui.autoCommand, false);
  assert.equal(L.normalizeConfig({ ui: { autoCommand: 'no' } }).ui.autoCommand, true);
});

// ---------- 권한 (일반 시청자 / 구독자) ----------
const viewerEv = { role: 'common_user', userId: 'v', nickname: '시청자', subscriber: null };
const subEv = { role: 'common_user', userId: 's', nickname: '구독자', subscriber: { months: 3, tier: 1 } };
const staffEv = { role: 'streaming_chat_manager', userId: 'm', nickname: '운영자', subscriber: null };
const streamerEv = { role: 'streamer', userId: 'st', nickname: '스트리머', subscriber: null };
const line = (text, cfg, ev) => dom(text, cfg, ev);

test('권한 판단: 모두 / 구독자만 / 운영진만', () => {
  assert.ok(L.allowedFor('all', viewerEv) && L.allowedFor('all', subEv));
  assert.ok(!L.allowedFor('subscribers', viewerEv) && L.allowedFor('subscribers', subEv));
  assert.ok(!L.allowedFor('staff', viewerEv) && !L.allowedFor('staff', subEv), '구독자도 "운영진만"은 쓸 수 없음');
  for (const who of [staffEv, streamerEv, { role: 'streaming_channel_manager' }, { role: 'manager' }]) {
    assert.ok(L.allowedFor('all', who) && L.allowedFor('subscribers', who) && L.allowedFor('staff', who), who.role + '은 항상 사용 가능');
  }
  // 알 수 없는 값은 가장 좁게 본다
  assert.ok(!L.allowedFor('hack', subEv) && !L.allowedFor(undefined, viewerEv) && !L.allowedFor('', subEv));
  // 구독 정보가 없거나 이상하면 구독자로 보지 않는다
  assert.ok(!L.isSubscriber({ role: 'common_user' }) && !L.isSubscriber({ subscriber: null }) && !L.isSubscriber(null));
});

test('권한 설정 정리: 알려진 값만 저장하고, 기본은 모두 허용', () => {
  const d = L.normalizeConfig(null);
  assert.deepEqual(d.permissions, { imageAccess: 'all', tagAccess: 'all', deniedMode: 'hide' });
  assert.equal(L.normalizeConfig({ permissions: { deniedMode: 'show' } }).permissions.deniedMode, 'show');
  assert.equal(L.normalizeConfig({ permissions: { deniedMode: 'zzz' } }).permissions.deniedMode, 'hide');
  const c = L.normalizeConfig({ permissions: { imageAccess: 'subscribers', tagAccess: 'hack' },
    commands: [{ triggers: ['~a'], image: 'a.png', access: 'staff' }, { triggers: ['~b'], image: 'b.png', access: 'zzz' }, { triggers: ['~c'], image: 'c.png' }],
    bbcode: { tags: { rainbow: { access: 'subscribers' }, b: { access: 'nope' } } } });
  assert.deepEqual(c.permissions, { imageAccess: 'subscribers', tagAccess: 'all', deniedMode: 'hide' });
  assert.deepEqual(c.commands.map((x) => x.access), ['staff', '', '']);
  assert.deepEqual(c.bbcode.tags, { rainbow: { access: 'subscribers' } });
});

test('권한: 채팅콘은 권한이 없는 사람에게는 이미지로 바뀌지 않고 글자 그대로 나온다', () => {
  const cfg = { permissions: { imageAccess: 'all' }, commands: [
    { triggers: ['~모두'], image: 'a.png' },                         // 기본 권한(모두)
    { triggers: ['~구독'], image: 'b.png', access: 'subscribers' },
    { triggers: ['~운영'], image: 'c.png', access: 'staff' }] };
  const text = '~모두 ~구독 ~운영';
  const imgs = (ev) => Array.from(line(text, cfg, ev).querySelectorAll('img.cmd-img')).map((i) => decodeURIComponent(i.getAttribute('src')));
  assert.deepEqual(imgs(viewerEv), ['images/a.png']);
  assert.deepEqual(imgs(subEv), ['images/a.png', 'images/b.png']);
  assert.deepEqual(imgs(staffEv), ['images/a.png', 'images/b.png', 'images/c.png']);
  assert.deepEqual(imgs(streamerEv), ['images/a.png', 'images/b.png', 'images/c.png']);
  assert.equal(line(text, cfg, viewerEv).querySelector('.msg').textContent, '  ~운영', '구독자 전용은 지우고, 운영진 전용은 글자 그대로 남음');
  const show = Object.assign({}, cfg, { permissions: { imageAccess: 'all', deniedMode: 'show' } });
  assert.equal(line(text, show, viewerEv).querySelector('.msg').textContent, ' ~구독 ~운영', '"글자 그대로" 설정이면 모두 남음');
});

test('권한: 기본 권한을 바꾸면 따로 정하지 않은 명령어가 모두 따라간다', () => {
  const cfg = { permissions: { imageAccess: 'subscribers' }, commands: [{ triggers: ['~a'], image: 'a.png' }, { triggers: ['~b'], image: 'b.png', access: 'all' }] };
  assert.equal(line('~a', cfg, viewerEv), null, '구독자 전용이 되면 일반 시청자의 명령어만 쓴 채팅은 숨겨진다');
  assert.equal(line('~a', cfg, subEv).querySelectorAll('img.cmd-img').length, 1);
  assert.equal(line('~b', cfg, viewerEv).querySelectorAll('img.cmd-img').length, 1, '따로 정한 "모두"가 기본 권한보다 우선');
});

test('권한: BBCode 태그도 같은 방식 (한글 이름으로 불러도 권한이 적용된다)', () => {
  const cfg = { permissions: { tagAccess: 'all' }, bbcode: { tags: { rainbow: { names: ['rainbow', '무지개'], access: 'subscribers' }, blink: { access: 'staff' } } } };
  const has = (text, ev, cls) => line(text, cfg, ev).querySelector(cls) !== null;
  assert.ok(has('[b]굵게[/b]', viewerEv, '.bb-b'), '기본 권한(모두)은 일반 시청자도 사용');
  assert.ok(!has('[rainbow]x[/rainbow]', viewerEv, '.bb-rainbow') && has('[rainbow]x[/rainbow]', subEv, '.bb-rainbow'));
  assert.ok(!has('[무지개]x[/무지개]', viewerEv, '.bb-rainbow') && has('[무지개]x[/무지개]', subEv, '.bb-rainbow'), '한글 이름도 같은 권한');
  assert.ok(!has('[blink]x[/blink]', subEv, '.bb-blink') && has('[blink]x[/blink]', staffEv, '.bb-blink'));
  // 구독자 전용 태그는 태그 글자만 지우고 안의 글자는 남김, 운영진 전용 태그는 쓴 글자 그대로
  assert.equal(line('[rainbow]x[/rainbow]', cfg, viewerEv).querySelector('.msg').textContent, 'x');
  assert.equal(line('[blink]x[/blink]', cfg, subEv).querySelector('.msg').textContent, '[blink]x[/blink]');
  const show = Object.assign({}, cfg, { permissions: { tagAccess: 'all', deniedMode: 'show' } });
  assert.equal(line('[rainbow]x[/rainbow]', show, viewerEv).querySelector('.msg').textContent, '[rainbow]x[/rainbow]');
});

test('권한: 구독 정보가 없는 채팅(읽지 못한 경우 포함)은 구독자 전용 기능을 쓸 수 없다', () => {
  const cfg = { commands: [{ triggers: ['~구독'], image: 'b.png', access: 'subscribers' }] };
  for (const ev of [{ role: 'common_user' }, { role: 'common_user', subscriber: null }, { role: 'common_user', subscriber: undefined }]) {
    assert.equal(line('~구독', cfg, ev), null, '남는 글이 없으면 줄 전체를 숨긴다');
    assert.equal(line('~구독 안녕', cfg, ev).querySelectorAll('img.cmd-img').length, 0);
    assert.equal(line('~구독 안녕', cfg, ev).querySelector('.msg').textContent, ' 안녕');
  }
});

test('권한 없는 부분 숨기기: 꺼 둔 태그와 운영진 전용 태그는 글자 그대로, 모르는 글자는 건드리지 않는다', () => {
  const cfg = { bbcode: { tags: { blink: { enabled: false }, shake: { access: 'staff' }, rainbow: { access: 'subscribers' } } } };
  const text = (t, ev) => line(t, cfg, ev).querySelector('.msg').textContent;
  assert.equal(text('[blink]a[/blink]', viewerEv), '[blink]a[/blink]', '꺼 둔 태그');
  assert.equal(text('[shake]a[/shake]', viewerEv), '[shake]a[/shake]', '운영진 전용');
  assert.equal(text('[rainbow]a[/rainbow] [1] [ㅋㅋ]', viewerEv), 'a [1] [ㅋㅋ]', '구독자 전용만 지움');
  assert.equal(text('[rb]a', viewerEv), 'a', '단축 이름도 같은 권한');
  assert.equal(text('[b]안녕[rainbow]반가워[/rainbow][/b]', viewerEv), '안녕반가워');
  assert.ok(line('[b]안녕[rainbow]반가워[/rainbow][/b]', cfg, viewerEv).querySelector('.bb-b'), '허용된 태그는 그대로 적용');
  assert.equal(line('[rainbow]', cfg, viewerEv), null, '태그만 쓰면 줄 전체를 숨김');
  assert.equal(line('  ', cfg, viewerEv).querySelector('.msg').textContent, '  ', '원래 빈 글은 건드리지 않음');
  assert.ok(line('[rainbow]a[/rainbow]', cfg, subEv).querySelector('.bb-rainbow'), '구독자는 그대로 사용');
  assert.ok(line('[rainbow]a[/rainbow]', cfg, streamerEv).querySelector('.bb-rainbow'), '스트리머는 그대로 사용');
});

test('권한 없는 부분 숨기기: 이미지만 남아도 줄은 남는다', () => {
  const cfg = { commands: [{ triggers: ['~모두'], image: 'a.png' }, { triggers: ['~구독'], image: 'b.png', access: 'subscribers' }] };
  const l = line('~구독 ~모두', cfg, viewerEv);
  assert.ok(l && l.querySelectorAll('img.cmd-img').length === 1);
});

test('한도를 넘은 부분: 기본은 숨기고, 설정에서 쓴 글자 그대로 보이게 바꿀 수 있다', () => {
  assert.equal(L.normalizeConfig(null).bbcode.overflowMode, 'hide');
  assert.equal(L.normalizeConfig({ bbcode: { overflowMode: 'show' } }).bbcode.overflowMode, 'show');
  assert.equal(L.normalizeConfig({ bbcode: { overflowMode: 'zzz' } }).bbcode.overflowMode, 'hide');
  const text = '[blink]a[/blink][shake]b[/shake][rainbow]c[/rainbow][wave]d[/wave]';
  const msg = (cfg) => line(text, cfg, viewerEv).querySelector('.msg').textContent;
  assert.equal(msg({}), 'abcd', '기본(숨기기): 한도(3개)를 넘은 태그 글자만 지움');
  assert.equal(msg({ bbcode: { overflowMode: 'show' } }), 'abc[wave]d[/wave]', '글자 그대로 보이기');
  // 채팅콘 개수 한도
  const cmds = { commands: [{ triggers: ['~a'], image: 'a.png' }] };
  assert.equal(line('~a~a~a~a~a~a~a', cmds, viewerEv).querySelectorAll('img.cmd-img').length, 5);
  assert.equal(line('~a~a~a~a~a~a~a', cmds, viewerEv).querySelector('.msg').textContent, '', '한도(5개)를 넘은 명령어 글자는 숨김');
  assert.equal(line('~a~a~a~a~a~a~a', Object.assign({ bbcode: { overflowMode: 'show' } }, cmds), viewerEv).querySelector('.msg').textContent, '~a~a');
  // 남는 글이 없으면 줄 전체를 숨김
  assert.equal(line('[blink][/blink]', { bbcode: { limits: { maxEffects: 0 } } }, viewerEv), null);
  assert.ok(line('[blink]x[/blink]', { bbcode: { limits: { maxEffects: 0 } } }, viewerEv), '안의 글이 있으면 줄은 남음');
});

test('이상한 글자만 있는 채팅은 줄을 숨기고, 보통 채팅은 그대로 둔다', () => {
  assert.equal(line('ㅤㅤㅤ', {}, viewerEv), null);
  assert.equal(line('‮​', {}, viewerEv), null);
  assert.equal(line('안녕‮하세요', {}, viewerEv).querySelector('.msg').textContent, '안녕하세요');
  assert.equal(line('   ', {}, viewerEv).querySelector('.msg').textContent, '   ', '원래 공백뿐인 채팅은 그대로');
  assert.equal(line('안녕하세요', {}, viewerEv).querySelector('.msg').textContent, '안녕하세요');
});

test('채팅콘 순서(order): 같은 태그 안의 올바른 이미지 경로만, 중복 없이 저장한다', () => {
  const c = L.normalizeConfig({ order: {
    '인사': ['인사/b.png', '인사/a.png', '인사/b.png', '응원/x.png', '../evil.png', 7, '인사/c.txt'],
    '': ['z.png', 'y.png'],
    '표정/웃음': ['표정/웃음/q.gif'],
    '나쁜//태그': ['a.png'],
    '빈태그': [],
    '배열아님': 'x'
  } });
  assert.deepEqual(c.order, { '인사': ['인사/b.png', '인사/a.png'], '': ['z.png', 'y.png'], '표정/웃음': ['표정/웃음/q.gif'] });
  assert.deepEqual(L.normalizeConfig(null).order, {});
  assert.deepEqual(L.normalizeConfig({ order: 'x' }).order, {});
  assert.equal(L.orderRank(c.order, '인사', '인사/a.png'), 1);
  assert.equal(L.orderRank(c.order, '인사', '인사/없음.png'), 1e9, '정하지 않은 것은 뒤로');
  assert.equal(L.orderRank({}, '인사', '인사/a.png'), 1e9);
});

test('위쪽 흐림 설정: 기본 24px, 맨 위 선명도 50%, 범위를 벗어나면 한도 안으로, 0이면 끈다', () => {
  const o = L.normalizeConfig(null).overlay;
  assert.equal(o.fadeTopPx, 24);
  assert.equal(o.fadeTopOpacity, 50);
  const c = L.normalizeConfig({ overlay: { fadeTopPx: 99999, fadeTopOpacity: -5 } }).overlay;
  assert.equal(c.fadeTopPx, 400);
  assert.equal(c.fadeTopOpacity, 0);
  assert.equal(L.normalizeConfig({ overlay: { fadeTopPx: 'x', fadeTopOpacity: 'y' } }).overlay.fadeTopPx, 24, '이상한 값은 기본값');
  assert.equal(L.normalizeConfig({ overlay: { fadeTopPx: 0 } }).overlay.fadeTopPx, 0, '0은 그대로(끔)');
});

test('위쪽 흐림 적용: 화면 변수가 정해지고, 높이 0이거나 선명도 100%면 효과를 끈다', () => {
  const apply = (ov) => {
    const doc = new JSDOM('<body></body>').window.document;
    L.applyStyle(L.normalizeConfig({ overlay: ov }).overlay, doc);
    return { h: doc.documentElement.style.getPropertyValue('--fade-h'), m: doc.documentElement.style.getPropertyValue('--fade-min'), off: doc.body.classList.contains('no-fade') };
  };
  assert.deepEqual(apply({}), { h: '24px', m: '0.5', off: false });
  assert.deepEqual(apply({ fadeTopPx: 60, fadeTopOpacity: 20 }), { h: '60px', m: '0.2', off: false });
  assert.equal(apply({ fadeTopPx: 0 }).off, true);
  assert.equal(apply({ fadeTopOpacity: 100 }).off, true);
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'lib', 'overlay.css'), 'utf8');
  assert.ok(/#chat \{[^}]*mask-image: linear-gradient\(to bottom, rgba\(0, 0, 0, var\(--fade-min/.test(css), '채팅 영역에 위쪽 그라데이션 마스크');
  assert.ok(/body\.no-fade #chat \{[^}]*mask-image: none/.test(css), '끄는 규칙');
  assert.ok(!/#status[^{]*\{[^}]*mask/.test(css), '연결 안내 상자는 흐리게 하지 않는다');
});

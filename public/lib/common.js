/*
 * 설정 형식과 채팅 줄 그리기. 설정 화면(input.html)과 오버레이(output.html), 서버가 같이 씁니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./bbcode'));
  else root.Lite = factory(root.ChatMarkup);
})(typeof self !== 'undefined' ? self : this, function (BB) {
  'use strict';

  var IMAGE_FILE_RE = /^[^\\/:*?"<>|\u0000-\u001f.][^\\/:*?"<>|\u0000-\u001f]{0,118}\.(png|jpe?g|gif|webp|svg)$/i;
  var CHANNEL_ID_RE = /[0-9a-fA-F]{32}/;
  var MAX_TAG_DEPTH = 3;       // images 안의 폴더는 3단계까지 (태그 = 폴더 이름)
  var MAX_SEGMENT_LEN = 60;    // 폴더/파일 이름 하나의 최대 길이
  var HEIGHT_RE = /^\d{1,3}(\.\d{1,2})?(em|rem|px)$/;
  var DEFAULT_IMAGE_HEIGHT = '3em';
  var CONFIG_VERSION = 3;
  var TAG_NAME_RE = /^[A-Za-z0-9_\uAC00-\uD7A3]{1,12}$/;
  var MAX_TAG_NAMES = 6;
  var MAX_TRIGGERS_PER_IMAGE = 20;
  var SECTION_KEYS = ['obs', 'channel', 'images', 'bbcode', 'hidden', 'permissions', 'style'];
  var DENIED_MODES = ['hide', 'show'];             // 구독자 전용 기능을 권한 없이 썼을 때: 그 부분만 숨기기 / 쓴 글자 그대로 보이기
  var ACCESS = ['all', 'subscribers', 'staff'];   // 모두(일반 시청자+구독자) / 구독자만 / 스트리머와 운영진만(사용 불가)
  var STAFF_ROLES = ['streamer', 'streaming_channel_manager', 'streaming_chat_manager', 'manager'];
  var IMAGE_SORTS = ['name', 'tag', 'recent', 'nocmd'];

  // ---------- 이미지 경로 (images/표정/웃음/감사.svg → 태그: 표정, 표정/웃음) ----------
  function validSegment(seg) {
    return typeof seg === 'string' && seg.length > 0 && seg.length <= MAX_SEGMENT_LEN && seg !== '.' && seg !== '..' &&
      !/^[.\s]/.test(seg) && !/[\s.]$/.test(seg) && !/[\\/:*?"<>|\u0000-\u001f]/.test(seg);
  }
  /** "표정/웃음" 같은 태그 이름을 폴더 이름 배열로. 올바르지 않으면 null (빈 문자열은 [] = 태그 없음) */
  function splitTag(tag) {
    var t = typeof tag === 'string' ? tag.trim() : '';
    if (!t) return [];
    var segs = t.split('/').map(function (x) { return x.trim(); });
    if (segs.length > MAX_TAG_DEPTH) return null;
    for (var i = 0; i < segs.length; i++) if (!validSegment(segs[i])) return null;
    return segs;
  }
  /** "표정/감사.svg" → { tag: '표정', name: '감사.svg' }. 올바르지 않으면 null */
  function splitImagePath(p) {
    if (typeof p !== 'string' || p.length > 220) return null;
    var segs = p.split('/');
    var name = segs.pop();
    if (!IMAGE_FILE_RE.test(name) || name.length > MAX_SEGMENT_LEN || !validSegment(name) || segs.length > MAX_TAG_DEPTH) return null;
    for (var i = 0; i < segs.length; i++) if (!validSegment(segs[i])) return null;
    return { tag: segs.join('/'), name: name, segs: segs };
  }
  function isImagePath(p) { return splitImagePath(p) !== null; }

  /** "2.4em", "3rem", "60px" 같은 높이 값인지 (숫자 범위까지) 확인합니다. */
  function validHeight(v) {
    if (typeof v !== 'string' || !HEIGHT_RE.test(v.trim())) return false;
    var n = parseFloat(v), px = /px$/.test(v.trim());
    return px ? (n >= 8 && n <= 400) : (n >= 0.5 && n <= 12);
  }

  function defaultConfig() {
    return {
      version: CONFIG_VERSION,
      channel: { url: '', channelId: '' },
      commands: [], // { triggers: ['~감사', '~땡큐'], image: '표정/감사.svg', height: '', match: 'anywhere', access: '' }  (height가 비어 있으면 기본 높이를 따릅니다)
      hidden: { commands: [], prefixes: [] },
      bbcode: { enabled: true, tags: {}, limits: JSON.parse(JSON.stringify(BB.DEFAULT_LIMITS)) },
      overlay: {
        maxLines: 14, fontSize: 24, lineLifetimeSec: 10, showBadges: true, showNickname: true, showStatus: true,
        textColor: '#ffffff', outlineColor: '#000000', backgroundColor: 'rgba(0,0,0,0)', fontFamily: '',
        imageHeight: DEFAULT_IMAGE_HEIGHT   // 명령어 이미지의 기본 높이 (글자 크기 기준). 이미지마다 따로 정하지 않으면 이 값을 씁니다.
      },
      advanced: { apiBase: '', commApiBase: '', wsUrl: '' },
      // 일반 시청자/구독자가 쓸 수 있는 기능. 기능마다 따로 정하지 않으면 이 기본 권한을 따릅니다. (스트리머와 운영진은 항상 모두 쓸 수 있습니다.)
      permissions: { imageAccess: 'all', tagAccess: 'all', deniedMode: 'hide' },
      ui: { collapsed: {}, imageSort: 'name', autoCommand: true }
    };
  }

  function str(v, max, fb) { return typeof v === 'string' ? v.slice(0, max) : fb; }
  function num(v, min, max, fb) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? Math.max(min, Math.min(max, n)) : fb;
  }
  function bool(v, fb) { return typeof v === 'boolean' ? v : fb; }
  function strList(v, maxItems, maxLen) {
    var out = [];
    if (Array.isArray(v)) v.forEach(function (x) {
      if (typeof x === 'string' && x.trim() && out.length < maxItems && out.indexOf(x.trim()) < 0) out.push(x.trim().slice(0, maxLen));
    });
    return out;
  }
  function color(v, fb) {
    if (typeof v !== 'string') return fb;
    var s = v.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
    if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/.test(s)) return s;
    if (/^[a-zA-Z]{3,20}$/.test(s)) return s;
    return fb;
  }
  function urlOr(v, schemes) {
    var s = typeof v === 'string' ? v.trim() : '';
    return s && schemes.test(s) && s.length < 300 ? s : '';
  }

  /** 채널 링크(채널 페이지/채팅창/방송 주소)나 ID에서 32자리 채널 ID를 뽑습니다. 없으면 '' */
  function parseChannelId(text) {
    var m = CHANNEL_ID_RE.exec(String(text || ''));
    return m ? m[0].toLowerCase() : '';
  }

  /** 입력한 링크가 채팅창 링크(/chat/…)처럼 보이는지: 이 경우 ID가 채널 ID가 아닐 수 있습니다 */
  function looksLikeChatLink(text) {
    return /\/chat\/[0-9a-fA-F]{8,}/.test(String(text || ''));
  }

  // ---------- 명령어 ----------
  function validTrigger(t) {
    return typeof t === 'string' && t.length > 0 && t.length <= 40 && !/\s/.test(t) && !/[\[\]{}]/.test(t);
  }

  function normalizeCommands(list, legacy) {
    var seen = {};
    var byImage = {};
    var order = [];
    (Array.isArray(list) ? list : []).forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      var image = typeof x.image === 'string' ? x.image : '';
      if (!isImagePath(image)) return;
      // 예전 형식(trigger 하나)도 읽어서 triggers로 바꿈
      var raw = Array.isArray(x.triggers) ? x.triggers : (typeof x.trigger === 'string' ? [x.trigger] : []);
      var entry = byImage[image];
      if (!entry) {
        var h = typeof x.height === 'string' ? x.height.trim() : '';
        h = validHeight(h) ? h : '';
        // 예전 버전(기본 높이 설정이 없던 때)은 모든 명령어에 2.4em이 저장되어 있었으므로, 기본값을 따르는 것으로 봅니다.
        if (legacy && h === '2.4em') h = '';
        entry = byImage[image] = { triggers: [], image: image, height: h, match: x.match === 'whole' ? 'whole' : 'anywhere', access: ACCESS.indexOf(x.access) >= 0 ? x.access : '' };
        order.push(image);
      }
      raw.forEach(function (t) {
        t = typeof t === 'string' ? t.trim() : '';
        if (!validTrigger(t) || seen[t] || entry.triggers.length >= MAX_TRIGGERS_PER_IMAGE) return;
        seen[t] = true;
        entry.triggers.push(t);
      });
    });
    return order.map(function (img) { return byImage[img]; }).filter(function (e) { return e.triggers.length > 0; });
  }

  /**
   * 이미지 파일 이름으로 추천 명령어를 만듭니다. 예: "표정/식은땀.gif" → "~식은땀"
   * taken: 이미 쓰고 있는 명령어({ 명령어: true }). 겹치면 숫자를 붙입니다(~감사2). 만들 수 없으면 ''
   * (이름이 비었거나, 쓸 수 없는 글자만 있거나, 40자를 넘는 경우)
   */
  function suggestTrigger(imagePath, taken) {
    var parts = splitImagePath(imagePath);
    if (!parts) return '';
    var base = parts.name.replace(/\.[^.]+$/, '')
      .replace(/\s*\((\d+)\)$/, '$1')       // "기쁨 (2)" → "기쁨2"
      .replace(/[\s\[\]{}]+/g, '');          // 띄어쓰기와 [ ] { } 는 명령어에 쓸 수 없음
    if (!base) return '';
    var used = taken || {};
    var first = '~' + base;
    if (first.length <= 40 && validTrigger(first) && !used[first]) return first;
    for (var n = 2; n < 100; n++) {
      var cand = '~' + base + n;
      if (cand.length > 40) return '';
      if (validTrigger(cand) && !used[cand]) return cand;
    }
    return '';
  }

  // ---------- BBCode 태그 이름 ----------
  /**
   * 태그마다 쓸 수 있는 이름(예: rainbow → ["rainbow", "rb", "무지개"], 기본값은 TAG_DEFS의 names)을 정하고, 이름이 겹치면 TAG_DEFS 순서상 앞의 태그가 가져갑니다.
   * 반환: { names: { 태그: [이름…] }, conflicts: [{ name, tag, owner }] }
   */
  function resolveTagNames(tagsCfg) {
    var names = {}, claimed = {}, conflicts = [];
    Object.keys(BB.TAG_DEFS).forEach(function (canon) {
      var entry = tagsCfg && tagsCfg[canon];
      var list = entry && Array.isArray(entry.names) ? entry.names : BB.TAG_DEFS[canon].names;
      var out = [];
      list.forEach(function (n) {
        n = typeof n === 'string' ? n.trim().toLowerCase() : '';
        if (!TAG_NAME_RE.test(n) || out.indexOf(n) >= 0 || out.length >= MAX_TAG_NAMES) return;
        if (claimed[n]) { conflicts.push({ name: n, tag: canon, owner: claimed[n] }); return; }
        claimed[n] = canon;
        out.push(n);
      });
      names[canon] = out;
    });
    return { names: names, conflicts: conflicts };
  }

  function normalizeTags(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var cleaned = {};
    Object.keys(BB.TAG_DEFS).forEach(function (canon) {
      var e = src[canon];
      if (!e || typeof e !== 'object') return;
      cleaned[canon] = { enabled: e.enabled === false ? false : true };
      if (Array.isArray(e.names)) cleaned[canon].names = e.names;
      if (ACCESS.indexOf(e.access) >= 0) cleaned[canon].access = e.access;
    });
    var resolved = resolveTagNames(cleaned).names;
    var out = {};
    Object.keys(BB.TAG_DEFS).forEach(function (canon) {
      var e = cleaned[canon];
      var entry = {};
      if (e && e.enabled === false) entry.enabled = false;
      var def = BB.TAG_DEFS[canon].names;
      var same = resolved[canon].length === def.length && resolved[canon].every(function (n, k) { return n === def[k]; });
      if (e && e.names && !same) entry.names = resolved[canon];
      if (e && e.access) entry.access = e.access;
      if (Object.keys(entry).length) out[canon] = entry;
    });
    return out;
  }

  /** 이 태그를 부를 때 쓸 첫 번째 이름 (없으면 null) */
  function firstTagName(cfg, canon) {
    var n = resolveTagNames(cfg.bbcode.tags).names[canon];
    return n && n.length ? n[0] : null;
  }

  // ---------- 설정 정리 ----------
  /** 어떤 값이 들어와도 안전한 설정으로 바꿉니다 (잘못된 값은 기본값/한도 안으로). */
  function normalizeConfig(raw) {
    var d = defaultConfig();
    var c = raw && typeof raw === 'object' ? raw : {};
    var ch = c.channel || {}, hid = c.hidden || {}, bb = c.bbcode || {}, lim = bb.limits || {}, ov = c.overlay || {}, ad = c.advanced || {};
    var ui = c.ui && typeof c.ui === 'object' ? c.ui : {};
    var perm = c.permissions && typeof c.permissions === 'object' ? c.permissions : {};
    var L = d.bbcode.limits;

    var url = str(ch.url, 300, '').trim();
    var channelId = parseChannelId(url) || (CHANNEL_ID_RE.test(ch.channelId || '') ? parseChannelId(ch.channelId) : '');

    var legacy = !(Number(c.version) >= CONFIG_VERSION);
    var collapsed = {};
    SECTION_KEYS.forEach(function (k) { if (ui.collapsed && ui.collapsed[k] === true) collapsed[k] = true; });

    return {
      version: CONFIG_VERSION,
      channel: { url: url, channelId: channelId },
      commands: normalizeCommands(c.commands, legacy),
      hidden: { commands: strList(hid.commands, 100, 40), prefixes: strList(hid.prefixes, 20, 10) },
      bbcode: {
        enabled: bool(bb.enabled, true),
        tags: normalizeTags(bb.tags),
        limits: {
          maxLength: Math.round(num(lim.maxLength, 20, 1000, L.maxLength)),
          maxDepth: Math.round(num(lim.maxDepth, 1, 10, L.maxDepth)),
          maxTags: Math.round(num(lim.maxTags, 1, 50, L.maxTags)),
          maxEffects: Math.round(num(lim.maxEffects, 0, 20, L.maxEffects)),
          minSize: Math.round(num(lim.minSize, 30, 100, L.minSize)),
          maxSize: Math.round(num(lim.maxSize, 100, 400, L.maxSize)),
          maxImages: Math.round(num(lim.maxImages, 0, 30, L.maxImages))
        }
      },
      overlay: {
        maxLines: Math.round(num(ov.maxLines, 1, 100, d.overlay.maxLines)),
        fontSize: Math.round(num(ov.fontSize, 10, 120, d.overlay.fontSize)),
        lineLifetimeSec: Math.round(num(ov.lineLifetimeSec, 0, 3600, d.overlay.lineLifetimeSec)),
        showBadges: bool(ov.showBadges, true),
        showNickname: bool(ov.showNickname, true),
        showStatus: bool(ov.showStatus, true),
        textColor: color(ov.textColor, d.overlay.textColor),
        outlineColor: color(ov.outlineColor, d.overlay.outlineColor),
        backgroundColor: color(ov.backgroundColor, d.overlay.backgroundColor),
        fontFamily: str(ov.fontFamily, 120, '').replace(/[^\p{L}\p{N} ._()+&-]/gu, '').trim(),
        imageHeight: validHeight(ov.imageHeight) ? ov.imageHeight.trim() : DEFAULT_IMAGE_HEIGHT
      },
      advanced: {
        apiBase: urlOr(ad.apiBase, /^https?:\/\//i),
        commApiBase: urlOr(ad.commApiBase, /^https?:\/\//i),
        wsUrl: urlOr(ad.wsUrl, /^wss?:\/\//i)
      },
      permissions: {
        imageAccess: ACCESS.indexOf(perm.imageAccess) >= 0 ? perm.imageAccess : 'all',
        tagAccess: ACCESS.indexOf(perm.tagAccess) >= 0 ? perm.tagAccess : 'all',
        deniedMode: DENIED_MODES.indexOf(perm.deniedMode) >= 0 ? perm.deniedMode : 'hide'
      },
      ui: { collapsed: collapsed, imageSort: IMAGE_SORTS.indexOf(ui.imageSort) >= 0 ? ui.imageSort : 'name', autoCommand: bool(ui.autoCommand, true) }
    };
  }

  // ---------- 권한 ----------
  /** 스트리머, 채팅 운영자, 채널 관리자: 항상 모든 기능을 쓸 수 있습니다. */
  function isStaff(ev) { return STAFF_ROLES.indexOf(ev && ev.role) >= 0; }
  /** 채팅 정보에 구독 정보가 들어 있으면 구독자입니다. 정보가 없거나 읽지 못하면 구독자로 보지 않습니다. */
  function isSubscriber(ev) { return !!(ev && ev.subscriber); }
  /**
   * 이 채팅을 쓴 사람이 access(all / subscribers / staff)로 정해진 기능을 쓸 수 있는지.
   * 구독자는 일반 시청자가 쓸 수 있는 기능을 항상 쓸 수 있고, 알 수 없는 값은 가장 좁게(운영진만) 봅니다.
   */
  function allowedFor(access, ev) {
    if (isStaff(ev)) return true;
    if (access === 'all') return true;
    if (access === 'subscribers') return isSubscriber(ev);
    return false;
  }

  // ---------- 채팅 줄 ----------
  function imageSrc(imagePath) { return 'images/' + String(imagePath).split('/').map(encodeURIComponent).join('/'); }

  /** 설정에서 채팅 처리에 필요한 값을 미리 계산 */
  function derive(cfg) {
    var cmds = [];
    cfg.commands.forEach(function (c) {
      c.triggers.forEach(function (t) {
        cmds.push({ trigger: t, whole: c.match === 'whole', src: imageSrc(c.image), height: c.height || cfg.overlay.imageHeight, access: c.access || cfg.permissions.imageAccess });
      });
    });
    var names = resolveTagNames(cfg.bbcode.tags).names;
    var tags = [], aliases = {}, tagAccess = {};
    if (cfg.bbcode.enabled) Object.keys(BB.TAG_DEFS).forEach(function (canon) {
      if (cfg.bbcode.tags[canon] && cfg.bbcode.tags[canon].enabled === false) return;
      tags.push(canon);
      tagAccess[canon] = (cfg.bbcode.tags[canon] && cfg.bbcode.tags[canon].access) || cfg.permissions.tagAccess;
      names[canon].forEach(function (n) { aliases[n] = canon; });
    });
    return { cmds: cmds, tags: tags, tagAccess: tagAccess, aliases: aliases, deniedMode: cfg.permissions.deniedMode, limits: cfg.bbcode.limits, hiddenCommands: cfg.hidden.commands, hiddenPrefixes: cfg.hidden.prefixes };
  }

  function isHidden(text, d) {
    var t = String(text || '').trim();
    var i;
    for (i = 0; i < d.hiddenCommands.length; i++) {
      var h = d.hiddenCommands[i];
      if (t === h || t.indexOf(h + ' ') === 0) return true;
    }
    for (i = 0; i < d.hiddenPrefixes.length; i++) {
      if (d.hiddenPrefixes[i] && t.indexOf(d.hiddenPrefixes[i]) === 0) return true;
    }
    return false;
  }

  function roleColor(ev) {
    if (typeof ev.titleColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(ev.titleColor)) return ev.titleColor;
    if (ev.role === 'streamer') return '#ffd166';
    if (ev.role === 'streaming_channel_manager' || ev.role === 'streaming_chat_manager') return '#7ee2a8';
    var h = 0, s = String(ev.userId || ev.nickname || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ' 85% 74%)';
  }

  /** 채팅 한 줄(DOM)을 만듭니다. 권한 때문에 보여 줄 내용이 없어지면 null을 돌려줍니다. ev = { nickname, role, userId, badges, titleColor, content, emojis } */
  function renderLine(ev, d, doc) {
    var line = doc.createElement('div');
    line.className = 'line';

    var badges = doc.createElement('span');
    badges.className = 'badges';
    (ev.badges || []).slice(0, 5).forEach(function (url) {
      if (!/^https:\/\//.test(url)) return;
      var img = doc.createElement('img');
      img.src = url; img.alt = ''; img.setAttribute('draggable', 'false');
      badges.appendChild(img);
    });
    line.appendChild(badges);

    var nick = doc.createElement('span');
    nick.className = 'nick';
    nick.textContent = String(ev.nickname || '').slice(0, 40);
    nick.style.color = roleColor(ev);
    line.appendChild(nick);

    // 권한이 없을 때: 구독자 전용 기능은 "그 부분만 숨기기"(기본) 또는 쓴 글자 그대로. 운영진 전용이나 꺼 둔 기능은 항상 글자 그대로 둡니다.
    var hideDenied = d.deniedMode !== 'show';
    var cmds = {};
    var plain = String(ev.content || '').trim();
    d.cmds.forEach(function (c) {
      if (c.whole && plain !== c.trigger) return;
      if (!allowedFor(c.access, ev)) {
        if (hideDenied && c.access === 'subscribers') cmds[c.trigger] = { denied: true };
        return;
      }
      cmds[c.trigger] = { src: c.src, alt: c.trigger, height: c.height };
    });
    var tags = [], deniedTags = [];
    d.tags.forEach(function (t) {
      if (allowedFor(d.tagAccess[t], ev)) tags.push(t);
      else if (hideDenied && d.tagAccess[t] === 'subscribers') deniedTags.push(t);
    });
    var nodes = BB.parse(String(ev.content || ''), {
      allowedTags: tags, deniedTags: deniedTags, aliases: d.aliases, limits: d.limits, commands: cmds, emojis: ev.emojis || {}
    });
    // 권한 때문에 글자를 지웠더니 보여 줄 내용이 남지 않으면 줄 전체를 숨깁니다.
    if (nodes.stripped > 0 && BB.isBlank(nodes)) return null;
    var msg = doc.createElement('span');
    msg.className = 'msg';
    msg.appendChild(BB.toDOM(nodes, doc));
    line.appendChild(msg);
    return line;
  }

  /** 글자 크기/색 등 스타일을 문서에 적용 */
  function applyStyle(o, doc) {
    var r = doc.documentElement.style;
    r.setProperty('--font-size', o.fontSize + 'px');
    r.setProperty('--text', o.textColor);
    r.setProperty('--outline', o.outlineColor);
    r.setProperty('--bg', o.backgroundColor);
    if (o.fontFamily) r.setProperty('--font', '"' + o.fontFamily + '", \'Malgun Gothic\', sans-serif');
    else r.removeProperty('--font');
    doc.body.classList.toggle('no-badges', !o.showBadges);
    doc.body.classList.toggle('no-nick', !o.showNickname);
  }

  return {
    IMAGE_FILE_RE: IMAGE_FILE_RE,
    ACCESS: ACCESS,
    DENIED_MODES: DENIED_MODES,
    isStaff: isStaff,
    isSubscriber: isSubscriber,
    allowedFor: allowedFor,
    DEFAULT_IMAGE_HEIGHT: DEFAULT_IMAGE_HEIGHT,
    CONFIG_VERSION: CONFIG_VERSION,
    validHeight: validHeight,
    suggestTrigger: suggestTrigger,
    IMAGE_SORTS: IMAGE_SORTS,
    MAX_TAG_DEPTH: MAX_TAG_DEPTH,
    validSegment: validSegment,
    splitTag: splitTag,
    splitImagePath: splitImagePath,
    isImagePath: isImagePath,
    TAG_NAME_RE: TAG_NAME_RE,
    SECTION_KEYS: SECTION_KEYS,
    defaultConfig: defaultConfig,
    normalizeConfig: normalizeConfig,
    parseChannelId: parseChannelId,
    looksLikeChatLink: looksLikeChatLink,
    validTrigger: validTrigger,
    resolveTagNames: resolveTagNames,
    firstTagName: firstTagName,
    imageSrc: imageSrc,
    derive: derive,
    isHidden: isHidden,
    renderLine: renderLine,
    applyStyle: applyStyle
  };
});

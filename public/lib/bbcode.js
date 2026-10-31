/*
 * chat-markup (BBCode + 채팅콘 + 치지직 이모티콘)
 *
 * - 서버, OBS 오버레이, 목록 페이지, (나중에) 크롬 확장 프로그램이 같은 파일을 그대로 씁니다.
 * - 입력 문자열을 HTML로 바꾸지 않습니다. parse()가 안전한 트리(AST)를 만들고,
 *   toDOM()이 textContent/속성 설정만으로 요소를 만듭니다. innerHTML은 쓰지 않습니다.
 * - 허용되지 않은 태그, 형식이 틀린 태그, 남용 방지 한도를 넘는 태그는 "그냥 글자"로 남습니다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChatMarkup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 지원하는 태그 목록. 관리 페이지와 목록 페이지의 설명도 여기서 가져갑니다. 순서가 화면에 보이는 순서입니다. 정적인 태그를 위에, 움직이는 태그를 아래에 두고, 비슷한 효과끼리 붙여 둡니다. */
  var TAG_DEFS = {
    b       : { label: '굵게', arg: 'none', effect: false, names: ['b', '굵게'], example: '[b]굵게[/b]' },
    i       : { label: '기울임', arg: 'none', effect: false, names: ['i', '기울'], example: '[i]기울임[/i]' },
    u       : { label: '밑줄', arg: 'none', effect: false, names: ['u', '밑줄'], example: '[u]밑줄[/u]' },
    s       : { label: '취소선', arg: 'none', effect: false, names: ['s', '취소'], example: '[s]취소선[/s]' },
    color   : { label: '글자 색', arg: 'color', effect: false, names: ['color', 'cl', '색'], example: '[color=#ff5577]색칠[/color]' },
    size    : { label: '글자 크기', arg: 'size', effect: false, names: ['size', 'sz', '크기'], example: '[size=150]크게[/size]' },
    glow    : { label: '빛나는 글자', arg: 'color?', effect: false, names: ['glow', 'gl', '반짝', '빛'], example: '[glow=#ffd400]반짝[/glow]' },
    bg      : { label: '배경색', arg: 'color', effect: false, names: ['bg', '배경'], example: '[bg=yellow]형광펜[/bg]' },
    outline : { label: '테두리', arg: 'color?', effect: false, names: ['outline', 'ol', '외곽', '테두리'], example: '[outline=red]테두리[/outline]' },
    grad    : { label: '그라데이션', arg: 'colors', effect: false, names: ['grad', 'gr', '그라', '그라데이션'], example: '[grad=red,blue]그라데이션[/grad]' },
    blink   : { label: '깜빡임', arg: 'none', effect: true, names: ['blink', 'bl', '깜빡'], example: '[blink]깜빡[/blink]' },
    neon    : { label: '네온', arg: 'color?', effect: true, names: ['neon', 'nn', '네온'], example: '[neon=pink]네온사인[/neon]' },
    zap     : { label: '번개', arg: 'none', effect: true, names: ['zap', 'zp', '번개'], example: '[zap]찌릿찌릿[/zap]' },
    siren   : { label: '사이렌', arg: 'none', effect: true, names: ['siren', 'sr', '사이렌'], example: '[siren]긴급 공지[/siren]' },
    twinkle : { label: '별빛', arg: 'none', effect: true, names: ['twinkle', 'tw', '별빛', '반짝반짝'], example: '[twinkle]반짝반짝 별빛[/twinkle]' },
    shine   : { label: '광택', arg: 'none', effect: true, names: ['shine', 'sh', '광택', '윤', '광'], example: '[shine]황금 광택[/shine]' },
    scan    : { label: '스캔', arg: 'none', effect: true, names: ['scan', 'sn', '스캔'], example: '[scan]스캔 중[/scan]' },
    rainbow : { label: '무지개', arg: 'none', effect: true, names: ['rainbow', 'rb', '무지개'], example: '[rainbow]무지개[/rainbow]' },
    aurora  : { label: '오로라', arg: 'none', effect: true, names: ['aurora', 'au', '오로라'], example: '[aurora]오로라가 흐른다[/aurora]' },
    party   : { label: '파티', arg: 'none', effect: true, names: ['party', 'pt', '파티'], example: '[party]축하합니다[/party]' },
    hue     : { label: '색변환', arg: 'none', effect: true, names: ['hue', 'hu', '색변환', '휴'], example: '[hue]색이 변한다[/hue]' },
    fire    : { label: '불꽃', arg: 'none', effect: true, names: ['fire', 'fr', '불꽃', '불'], example: '[fire]활활 타오른다[/fire]' },
    ice     : { label: '얼음', arg: 'none', effect: true, names: ['ice', 'ic', '얼음'], example: '[ice]차가운 서리[/ice]' },
    shake   : { label: '흔들림', arg: 'none', effect: true, names: ['shake', 'sk', '흔들'], example: '[shake]덜덜[/shake]' },
    glitch  : { label: '글리치', arg: 'none', effect: true, names: ['glitch', 'gt', '지직', '글리치'], example: '[glitch]지직 오류 발생[/glitch]' },
    swing   : { label: '시계추', arg: 'none', effect: true, names: ['swing', 'sw', '시계추', '추'], example: '[swing]좌우로 흔들[/swing]' },
    spin    : { label: '회전', arg: 'none', effect: true, names: ['spin', 'sp', '회전', '빙글'], example: '[spin]빙글빙글[/spin]' },
    wave    : { label: '물결', arg: 'none', effect: true, names: ['wave', 'wv', '물결', '파도', '출렁'], example: '[wave]출렁출렁[/wave]' },
    bounce  : { label: '통통', arg: 'none', effect: true, names: ['bounce', 'bn', '통통', '바운스'], example: '[bounce]통통 튄다[/bounce]' },
    float   : { label: '둥실', arg: 'none', effect: true, names: ['float', 'ft', '둥실'], example: '[float]둥실둥실[/float]' },
    jelly   : { label: '젤리', arg: 'none', effect: true, names: ['jelly', 'jl', '젤리'], example: '[jelly]말랑말랑[/jelly]' },
    stretch : { label: '고무줄', arg: 'none', effect: true, names: ['stretch', 'sc', '고무줄'], example: '[stretch]쭈우욱[/stretch]' },
    pulse   : { label: '두근두근', arg: 'none', effect: true, names: ['pulse', 'pl', '맥박', '펄스'], example: '[pulse]두근[/pulse]' },
    beat    : { label: '심장박동', arg: 'none', effect: true, names: ['beat', 'bt', '심장', '두근'], example: '[beat]두근두근[/beat]' },
    type    : { label: '타자기', arg: 'none', effect: true, names: ['type', 'ty', '타자', '타닥'], example: '[type]타닥타닥[/type]' },
    marquee : { label: '흐르는 글자', arg: 'none', effect: true, names: ['marquee', 'mq', '흐름', '마퀴'], example: '[marquee]흘러간다[/marquee]' }
  };

  var DEFAULT_LIMITS = {
    maxLength: 500,     // 처리할 최대 글자 수 (넘는 부분은 잘라냄)
    maxDepth: 4,        // 태그 중첩 깊이
    maxTags: 10,        // 메시지 하나에 해석할 태그 수
    maxEffects: 3,      // 움직이는 효과(깜빡임, 무지개, 흔들림, 흐름) 개수
    minSize: 70,        // [size] 하한(%)
    maxSize: 200,       // [size] 상한(%)
    maxImages: 5        // 메시지 하나에 대체할 이미지(명령어+이모티콘) 수
  };

  var NAMED_COLORS = {
    red: 1, orange: 1, yellow: 1, green: 1, lime: 1, cyan: 1, aqua: 1, blue: 1, navy: 1,
    purple: 1, violet: 1, magenta: 1, pink: 1, white: 1, black: 1, gray: 1, grey: 1,
    gold: 1, skyblue: 1, tomato: 1, coral: 1, teal: 1, brown: 1, silver: 1
  };

  // 한글 색 이름 → 영어 색 이름
  var COLOR_KO = {
    '빨강': 'red', '빨간색': 'red', '레드': 'red',
    '주황': 'orange', '주황색': 'orange',
    '노랑': 'yellow', '노란색': 'yellow',
    '초록': 'green', '초록색': 'green', '녹색': 'green',
    '연두': 'lime', '연두색': 'lime',
    '청록': 'cyan', '청록색': 'cyan', '시안': 'cyan',
    '아쿠아': 'aqua',
    '파랑': 'blue', '파란색': 'blue',
    '남색': 'navy', '네이비': 'navy',
    '보라': 'purple', '보라색': 'purple',
    '자주': 'violet', '자주색': 'violet', '바이올렛': 'violet',
    '마젠타': 'magenta',
    '분홍': 'pink', '분홍색': 'pink',
    '하양': 'white', '하얀색': 'white', '흰색': 'white',
    '검정': 'black', '검정색': 'black', '검은색': 'black',
    '회색': 'gray',
    '금색': 'gold',
    '하늘': 'skyblue', '하늘색': 'skyblue',
    '토마토': 'tomato', '토마토색': 'tomato',
    '산호': 'coral', '산호색': 'coral',
    '틸': 'teal',
    '갈색': 'brown',
    '은색': 'silver'
  };

  var TAG_RE = /\[(\/)?([A-Za-z0-9_\uAC00-\uD7A3]{1,12})(?:=([^\[\]\s]{1,24}))?\]/g;
  var EMOJI_RE = /\{:([A-Za-z0-9_]{1,40}):\}/g;

  // 기본 태그 이름(영문, 단축, 한글) → 태그
  var DEFAULT_ALIASES = {};
  Object.keys(TAG_DEFS).forEach(function (canon) {
    TAG_DEFS[canon].names.forEach(function (n) { DEFAULT_ALIASES[n] = canon; });
  });

  // 채팅 줄을 망가뜨리는 글자를 정리합니다.
  //  - 제어 문자, 방향을 바꾸는 문자(글이 거꾸로 보임), 보이지 않는 채움 문자(빈 채팅처럼 보임)를 지웁니다.
  //  - 한 글자 위에 쌓는 결합 문자는 2개까지만 남깁니다. (글자 위아래로 기호가 길게 쌓여 다른 줄을 가림)
  //  이모티콘에 쓰는 글자 연결 문자(U+200D)와 이모티콘 변형 문자는 그대로 둡니다.
  var STRIP_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u206A-\u206F\u2800\u3164\uFEFF\uFFA0\uFFF9-\uFFFB]/g;
  var MARKS_RE = /(\p{M}{2})\p{M}+/gu;
  function cleanText(t) {
    return t.replace(STRIP_RE, '').replace(MARKS_RE, '$1');
  }

  function mergeLimits(limits) {
    var out = {};
    var k;
    for (k in DEFAULT_LIMITS) out[k] = DEFAULT_LIMITS[k];
    if (limits) for (k in limits) {
      if (k in DEFAULT_LIMITS && typeof limits[k] === 'number' && isFinite(limits[k])) out[k] = limits[k];
    }
    return out;
  }

  function normalizeColor(arg) {
    if (typeof arg !== 'string') return null;
    var a = arg.toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(a) || /^#[0-9a-f]{6}$/.test(a)) return a;
    if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, a)) return a;
    if (Object.prototype.hasOwnProperty.call(COLOR_KO, a)) return COLOR_KO[a];
    return null;
  }

  function normalizeSize(arg, limits) {
    if (typeof arg !== 'string') return null;
    var m = /^(\d{2,3})%?$/.exec(arg);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return Math.max(limits.minSize, Math.min(limits.maxSize, n));
  }

  /** 태그 인자를 검증해서 정규화한 값을 돌려줍니다. 규칙에 맞지 않으면 undefined. */
  function normalizeArg(def, arg, limits) {
    if (def.arg === 'none') return arg == null ? null : undefined;
    if (def.arg === 'color') { var c = normalizeColor(arg); return c == null ? undefined : c; }
    if (def.arg === 'color?') {
      if (arg == null) return null;
      var c2 = normalizeColor(arg); return c2 == null ? undefined : c2;
    }
    if (def.arg === 'colors') {
      if (arg == null) return undefined;
      var parts = arg.split(',');
      if (parts.length > 2) return undefined;
      var cs = [];
      for (var k = 0; k < parts.length; k++) { var ck = normalizeColor(parts[k]); if (ck == null) return undefined; cs.push(ck); }
      return cs.join(',');
    }
    if (def.arg === 'size') { var s = normalizeSize(arg, limits); return s == null ? undefined : s; }
    return undefined;
  }

  function toSet(list) {
    if (list == null) return null; // null = 정의된 태그 전부 허용
    if (list instanceof Set) return list;
    return new Set(list);
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /**
   * parse(input, options)
   *  options.allowedTags : 허용할 태그 이름 배열/Set (없으면 전부)
   *  options.limits      : DEFAULT_LIMITS 일부를 덮어쓰기
   *  options.commands    : { "~감사": { src, alt, height } }  이 사용자가 쓸 수 있는 채팅콘 명령어
   *  options.emojis      : { id: url }  치지직이 이벤트에 넣어 준 이모티콘 정보
   *  options.hideOverflow : true이면 한도(겹침 깊이, 태그 개수, 움직이는 효과 수, 이미지 수)를 넘은 태그와 명령어 글자를 쓴 글자 그대로 두지 않고 지웁니다.
   *  options.deniedTags  : 권한이 없어서 "그 부분만 숨길" 태그 이름 배열. (여는 태그와 닫는 태그 글자를 지우고 안의 글자는 남깁니다.)
   *  options.aliases     : { 쓰는이름: 태그이름 }  예: { "무지개": "rainbow" }. 없으면 TAG_DEFS의 기본 이름(영문, 단축, 한글)을 사용
   */
  function parse(input, options) {
    options = options || {};
    var limits = mergeLimits(options.limits);
    var allowed = toSet(options.allowedTags);
    var text = String(input == null ? '' : input);
    var cleaned = cleanText(text);   // 채팅 줄을 망가뜨리는 이상한 글자를 먼저 정리합니다.
    var stripped = cleaned !== text ? 1 : 0;
    text = cleaned;
    if (text.length > limits.maxLength) text = text.slice(0, limits.maxLength);

    var denied = options.deniedTags ? new Set(options.deniedTags) : null;
    var hide = !!options.hideOverflow;
    var aliasMap = options.aliases || null;
    function canonical(written) {
      if (aliasMap) return Object.prototype.hasOwnProperty.call(aliasMap, written) ? aliasMap[written] : null;
      return Object.prototype.hasOwnProperty.call(DEFAULT_ALIASES, written) ? DEFAULT_ALIASES[written] : null;
    }

    var rootNode = { type: 'root', children: [] };
    // 스택 항목: { name, node }.  node가 null이면 "한도/형식 때문에 열리지 못한 태그"의 자리표시입니다.
    // 자리표시를 두는 이유: 열리지 못한 [b]의 [/b]가 바깥쪽 진짜 [b]를 잘못 닫지 않게 하려는 것.
    var stack = [{ name: null, node: rootNode }];
    var tagCount = 0;
    var effectCount = 0;

    function realTop() {
      for (var i = stack.length - 1; i >= 0; i--) if (stack[i].node) return stack[i].node;
      return rootNode;
    }
    function realDepth() {
      var n = 0;
      for (var i = 1; i < stack.length; i++) if (stack[i].node) n++;
      return n;
    }
    function addText(t) { if (t) realTop().children.push({ type: 'text', value: t }); }

    var last = 0;
    var m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text)) !== null) {
      addText(text.slice(last, m.index));
      last = m.index + m[0].length;

      var closing = !!m[1];
      var name = canonical(m[2].toLowerCase());
      var def = name && Object.prototype.hasOwnProperty.call(TAG_DEFS, name) ? TAG_DEFS[name] : null;
      if (def && denied && denied.has(name)) { stripped++; continue; } // 권한이 없는 태그: 태그 글자만 지웁니다.
      var usable = !!def && (allowed === null || allowed.has(name));

      if (closing) {
        var idx = -1;
        if (usable) {
          for (var s = stack.length - 1; s > 0; s--) {
            if (stack[s].name === name) { idx = s; break; }
          }
        }
        if (idx < 0) { addText(m[0]); continue; }
        var wasSkipped = !stack[idx].node;
        var wasHidden = !!stack[idx].hidden;
        stack.length = idx; // 닫힌 태그(또는 자리표시)까지 제거. 안쪽에서 닫히지 않은 태그는 여기서 함께 끝납니다.
        if (wasHidden) stripped++;          // 한도를 넘어 숨긴 태그의 짝도 함께 숨김
        else if (wasSkipped) addText(m[0]); // 형식이 틀려 열리지 못한 태그의 짝이므로 글자로 남김
        continue;
      }

      if (!usable) { addText(m[0]); continue; }
      var arg = normalizeArg(def, m[3], limits);
      var overDepth = realDepth() >= limits.maxDepth;
      var overTags = tagCount >= limits.maxTags;
      var overEffects = def.effect && effectCount >= limits.maxEffects;
      if (arg === undefined) {   // 형식이 틀린 태그: 한도와 상관없이 쓴 글자 그대로
        addText(m[0]);
        stack.push({ name: name, node: null });
        continue;
      }
      if (overDepth || overTags || overEffects) {
        if (hide) { stripped++; stack.push({ name: name, node: null, hidden: true }); }  // 한도를 넘은 태그: 태그 글자만 지움
        else { addText(m[0]); stack.push({ name: name, node: null }); }
        continue;
      }

      var node = { type: 'tag', name: name, arg: arg, raw: m[0], children: [] };
      realTop().children.push(node);
      stack.push({ name: name, node: node });
      tagCount++;
      if (def.effect) effectCount++;
    }
    addText(text.slice(last));
    // 끝까지 닫히지 않은 태그는 메시지 끝까지 적용됩니다.

    // 텍스트 노드 안에서 이모티콘과 채팅콘 명령어를 이미지 노드로 바꿉니다.
    var budget = { images: limits.maxImages, stripped: 0, hide: hide };
    expandInline(rootNode, options.commands || {}, options.emojis || {}, budget);
    var result = rootNode.children;
    result.stripped = stripped + budget.stripped; // 권한이 없어서 지운 태그와 명령어의 수
    return result;
  }

  function isSafeSrc(src) {
    if (typeof src !== 'string') return false;
    // https 주소, 서버 루트 상대 경로(/images/..), 그리고 폴더형(설치 없는 버전)의 images/ 상대 경로만 허용
    if (/^https:\/\/[^\s"'<>]+$/.test(src)) return true;
    if (/^\/(?!\/)[^\s"'<>]*$/.test(src)) return true;
    return /^images\/(?!.*\.\.)[^\s"'<>\\]+$/.test(src);
  }

  function expandInline(node, commands, emojis, budget) {
    var triggers = Object.keys(commands).filter(function (t) { return t.length > 0; });
    triggers.sort(function (a, b) { return b.length - a.length; });
    var cmdRe = triggers.length ? new RegExp(triggers.map(escapeRegExp).join('|'), 'g') : null;
    walk(node);

    function walk(n) {
      var out = [];
      for (var i = 0; i < n.children.length; i++) {
        var c = n.children[i];
        if (c.type === 'text') Array.prototype.push.apply(out, splitText(c.value));
        else { if (c.children) walk(c); out.push(c); }
      }
      n.children = out;
    }

    function splitText(value) {
      // 이모티콘과 명령어 중 먼저 나오는 것부터 순서대로 잘라냅니다.
      var parts = [];
      var pos = 0;
      while (pos < value.length) {
        var nextEmoji = findEmoji(value, pos);
        var nextCmd = findCommand(value, pos);
        var next = null;
        if (nextEmoji && (!nextCmd || nextEmoji.index <= nextCmd.index)) next = nextEmoji;
        else if (nextCmd) next = nextCmd;
        if (next && budget.images <= 0 && budget.hide && next.node.type !== 'removed') {
          // 이미지 수 한도를 넘은 명령어/이모티콘: 그 글자만 지웁니다.
          if (next.index > pos) parts.push({ type: 'text', value: value.slice(pos, next.index) });
          budget.stripped++;
          pos = next.index + next.length;
          continue;
        }
        if (!next || (budget.images <= 0 && next.node.type !== 'removed')) { parts.push({ type: 'text', value: value.slice(pos) }); break; }
        if (next.index > pos) parts.push({ type: 'text', value: value.slice(pos, next.index) });
        if (next.node.type === 'removed') budget.stripped++; // 권한이 없는 명령어: 글자만 지웁니다.
        else { parts.push(next.node); budget.images--; }
        pos = next.index + next.length;
      }
      return parts;
    }

    function findEmoji(value, from) {
      EMOJI_RE.lastIndex = from;
      var m;
      while ((m = EMOJI_RE.exec(value)) !== null) {
        var url = Object.prototype.hasOwnProperty.call(emojis, m[1]) ? emojis[m[1]] : null;
        if (isSafeSrc(url)) {
          return { index: m.index, length: m[0].length, node: { type: 'emoji', id: m[1], src: url } };
        }
        // 이벤트에 없는 이모티콘은 글자 그대로 둡니다.
      }
      return null;
    }

    function findCommand(value, from) {
      if (!cmdRe) return null;
      cmdRe.lastIndex = from;
      var m;
      while ((m = cmdRe.exec(value)) !== null) {
        var cmd = commands[m[0]];
        if (cmd && cmd.denied) return { index: m.index, length: m[0].length, node: { type: 'removed' } };
        if (cmd && isSafeSrc(cmd.src)) {
          return {
            index: m.index, length: m[0].length,
            node: { type: 'image', trigger: m[0], src: cmd.src, alt: cmd.alt || m[0], height: cmd.height || null }
          };
        }
      }
      return null;
    }
  }

  /** 트리를 순수 텍스트로 (이미지는 명령어 글자로) 되돌립니다. 미리보기/로그용. */
  function toPlainText(nodes) {
    var out = '';
    nodes.forEach(function (n) {
      if (n.type === 'text') out += n.value;
      else if (n.type === 'image') out += n.trigger;
      else if (n.type === 'emoji') out += '{:' + n.id + ':}';
      else if (n.children) out += toPlainText(n.children);
    });
    return out;
  }

  /** 보여 줄 내용이 없는지 (공백뿐이고 이미지도 없는지). 권한 때문에 글자를 지운 뒤 줄 전체를 숨길지 정할 때 씁니다. */
  function isBlank(nodes) {
    return nodes.every(function (n) {
      if (n.type === 'text') return !/\S/.test(n.value);
      if (n.type === 'image' || n.type === 'emoji') return false;
      return n.children ? isBlank(n.children) : true;
    });
  }

  function safeHeight(h) {
    return typeof h === 'string' && /^\d{1,3}(\.\d{1,2})?(em|rem|px)$/.test(h) ? h : null;
  }

  /** 트리를 DOM 조각으로. 모든 값은 textContent / 검증된 속성으로만 들어갑니다. */
  function toDOM(nodes, doc) {
    var frag = doc.createDocumentFragment();
    nodes.forEach(function (n) { frag.appendChild(build(n, doc, null)); });
    return frag;
  }

  // 글자마다 따로 움직이는 태그: 글자를 하나씩 span으로 나눕니다. step은 글자 사이 시작 시간 차이(초), random이면 글자마다 무작위
  var PER_CHAR = {
    wave: { step: 0.09 }, type: { step: 0.08 }, bounce: { step: 0.07 }, jelly: { step: 0.08 }, party: { step: 0.1 }, twinkle: { random: true }
  };

  function build(n, doc, ctx) {
    if (n.type === 'text') {
      if (!ctx) return doc.createTextNode(n.value);
      var frag = doc.createDocumentFragment();
      Array.from(n.value).forEach(function (ch) {
        var c = doc.createElement('span');
        c.className = 'bb-c';
        if (ctx.random) {
          c.style.animationDelay = (Math.random() * 2.4).toFixed(2) + 's';
          c.style.animationDuration = (1.8 + Math.random() * 1.6).toFixed(2) + 's';
        } else {
          c.style.animationDelay = (ctx.i++ * ctx.step).toFixed(2) + 's';
        }
        c.textContent = ch;
        frag.appendChild(c);
      });
      return frag;
    }
    if (n.type === 'image' || n.type === 'emoji') {
      var img = doc.createElement('img');
      img.className = n.type === 'image' ? 'cmd-img' : 'cc-emoji';
      img.setAttribute('src', n.src);
      img.setAttribute('alt', n.type === 'image' ? n.alt : ':' + n.id + ':');
      img.setAttribute('draggable', 'false');
      var h = n.type === 'image' ? safeHeight(n.height) : null;
      if (h) img.style.height = h;
      return img;
    }
    var el = doc.createElement('span');
    el.className = 'bb bb-' + n.name;
    if (n.name === 'color' && n.arg) el.style.color = n.arg;
    if (n.name === 'size' && n.arg) el.style.setProperty('--size', String(n.arg / 100)); // 크기는 겹쳐도 곱해지지 않게 bbcode.css에서 기본 글자 크기 기준으로 계산
    if (n.name === 'glow') el.style.setProperty('--glow', n.arg || '#ffffff');
    if (n.name === 'neon') el.style.setProperty('--c', n.arg || '#ff2bd6');
    if (n.name === 'bg') el.style.backgroundColor = n.arg;
    if (n.name === 'outline') el.style.setProperty('--ol', n.arg || '#000000');
    if (n.name === 'grad') {
      var cs = n.arg.split(',');
      if (cs.length === 1) el.style.color = cs[0];
      else { el.classList.add('bb-grad2'); el.style.setProperty('--g1', cs[0]); el.style.setProperty('--g2', cs[1]); }
    }
    var target = el;
    if (n.name === 'marquee') {
      var inner = doc.createElement('span');
      inner.className = 'bb-marquee-inner';
      el.appendChild(inner);
      target = inner;
    }
    var childCtx = ctx;
    if (PER_CHAR[n.name]) {
      var total = Array.from(toPlainText(n.children || [])).length || 1;
      // 타자기는 길어도 3초 안에 끝나도록 글자 사이 간격을 줄입니다.
      childCtx = { i: 0, random: !!PER_CHAR[n.name].random, step: n.name === 'type' ? Math.min(PER_CHAR.type.step, 3 / total) : PER_CHAR[n.name].step };
    }
    (n.children || []).forEach(function (c) { target.appendChild(build(c, doc, childCtx)); });
    return el;
  }

  /** 한 번에: 문자열 → DOM 조각 */
  function render(input, doc, options) {
    return toDOM(parse(input, options), doc);
  }

  return {
    TAG_DEFS: TAG_DEFS,
    DEFAULT_LIMITS: DEFAULT_LIMITS,
    parse: parse,
    toDOM: toDOM,
    render: render,
    toPlainText: toPlainText,
    isBlank: isBlank,
    cleanText: cleanText,
    normalizeColor: normalizeColor
  };
});

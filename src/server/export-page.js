'use strict';
// 시청자용 명령어 페이지 내보내기: 시청자가 쓸 수 있는 채팅콘 명령어와 BBCode 태그를 정적 웹페이지(폴더)로 만듭니다.
// 이 폴더를 아무 웹 호스팅에 올리면, 링크를 아는 시청자가 서버 없이 명령어 목록을 볼 수 있습니다.
const fs = require('fs');
const path = require('path');
const Lite = require('../../public/lib/common');
const BB = require('../../public/lib/bbcode');
const TEMPLATE = require('./export-template');

// 페이지 안에서 샘플 글자를 실제로 그리기 위해 오버레이와 같은 코드를 그대로 넣습니다.
const LIB = path.join(__dirname, '..', '..', 'public', 'lib');
const BBCODE_JS = fs.readFileSync(path.join(LIB, 'bbcode.js'), 'utf8');
const BBCODE_CSS = fs.readFileSync(path.join(LIB, 'bbcode.css'), 'utf8');

const OUT_DIR = 'viewer-page'; // 데이터 폴더 안의 이 폴더만 지우고 다시 만듭니다.

function imageUrl(imagePath) { return 'images/' + imagePath.split('/').map(encodeURIComponent).join('/'); }

/** 줄을 눌렀을 때 복사할 이름: 영문 이름 중 가장 짧은 것 (길이가 같으면 목록에서 앞선 것). 영문 이름이 없으면 남은 이름 중 가장 짧은 것. */
function copyName(list) {
  const shortest = (arr) => arr.reduce((best, n) => (n.length < best.length ? n : best), arr[0]);
  const ascii = list.filter((n) => /^[\x21-\x7e]+$/.test(n));
  return shortest(ascii.length ? ascii : list);
}

/** 이 설정에서 시청자에게 보여 줄 내용을 모읍니다. (구독자 전용은 표시하고, 스트리머와 운영진 전용은 뺍니다.) */
function collect(cfg, images) {
  const have = new Set(images.map((i) => i.path));
  const collator = new Intl.Collator('ko');
  const commands = [];
  cfg.commands.forEach((c) => {
    const access = c.access || cfg.permissions.imageAccess;
    if (access !== 'all' && access !== 'subscribers') return;
    if (!have.has(c.image) || !c.triggers.length) return;
    const parts = Lite.splitImagePath(c.image);
    commands.push({ image: c.image, src: imageUrl(c.image), tag: parts.tag, name: parts.name, triggers: c.triggers.slice(), subscriber: access === 'subscribers' });
  });
  // 태그 없는 것이 먼저, 그다음 태그 가나다순. 같은 태그 안에서는 내가 정한 순서, 정하지 않은 것은 그 뒤에 이름순.
  commands.sort((a, b) => collator.compare(a.tag, b.tag) || (Lite.orderRank(cfg.order, a.tag, a.image) - Lite.orderRank(cfg.order, b.tag, b.image)) || collator.compare(a.name, b.name));

  const bbtags = [];
  const aliases = {};
  if (cfg.bbcode.enabled) {
    const names = Lite.resolveTagNames(cfg.bbcode.tags).names;
    Object.keys(BB.TAG_DEFS).forEach((canon) => {
      const entry = cfg.bbcode.tags[canon] || {};
      if (entry.enabled === false) return;
      const access = entry.access || cfg.permissions.tagAccess;
      if (access !== 'all' && access !== 'subscribers') return;
      const list = names[canon];
      if (!list.length) return;
      const def = BB.TAG_DEFS[canon];
      list.forEach((n) => { aliases[n] = canon; });
      bbtags.push({
        canon, label: def.label, names: list, copy: copyName(list), arg: def.arg, effect: !!def.effect, subscriber: access === 'subscribers',
        text: (/\](.*?)\[\//.exec(def.example) || [])[1] || def.label // 샘플 글자 (예: 굵게)
      });
    });
  }
  const lim = cfg.bbcode.limits;
  return { commands, bbtags, aliases, limits: { minSize: lim.minSize, maxSize: lim.maxSize, maxEffects: lim.maxEffects } };
}

function renderHtml(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return TEMPLATE
    .replace('/*BBCSS*/', () => BBCODE_CSS)
    .replace('/*BBJS*/', () => BBCODE_JS.replace(/<\/script/gi, '<\\/script'))
    .replace('/*DATA*/', () => json);
}

/** 데이터 폴더 안에 viewer-page 폴더를 새로 만들고 index.html과 이미지를 넣습니다. */
function exportPage(store) {
  const data = collect(store.config, store.listImages());
  const outDir = path.join(store.dataDir, OUT_DIR);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let copied = 0;
  data.commands = data.commands.filter((c) => {
    const src = store.imagePath(c.image);
    if (!src || !fs.existsSync(src)) return false;
    const dest = path.join(outDir, 'images', ...c.image.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied++;
    return true;
  });
  fs.writeFileSync(path.join(outDir, 'index.html'), renderHtml(data));
  return { dir: outDir, commands: data.commands.length, images: copied, tags: data.bbtags.length };
}

module.exports = { collect, renderHtml, exportPage, copyName, OUT_DIR };

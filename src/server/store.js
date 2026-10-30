'use strict';
// 설정(config.json)과 이미지(images/)를 데이터 폴더에 저장합니다.
const fs = require('fs');
const path = require('path');
const Lite = require('../../public/lib/common');

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.imagesDir = path.join(dataDir, 'images');
    this.configPath = path.join(dataDir, 'config.json');
    this.config = Lite.normalizeConfig(null);
  }

  init() {
    fs.mkdirSync(this.imagesDir, { recursive: true });
    // 처음 실행: 이미지도 명령어도 없는 빈 상태로 시작합니다.
    if (!fs.existsSync(this.configPath)) this._write(Lite.normalizeConfig(Lite.defaultConfig()));
    this.load();
    return this;
  }

  load() {
    try { this.config = Lite.normalizeConfig(JSON.parse(fs.readFileSync(this.configPath, 'utf8'))); }
    catch (e) { console.warn('[store] config.json을 읽지 못해 이전 값을 유지합니다:', e.message); }
    return this.config;
  }

  _write(cfg) {
    const tmp = this.configPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, this.configPath);
  }

  save(input) {
    this.config = Lite.normalizeConfig(input);
    this._write(this.config);
    return this.config;
  }

  // ---------- 이미지 (images 폴더 안의 폴더 이름이 태그가 됩니다) ----------
  /** images 아래의 이미지를 폴더 안까지 모두 찾습니다. 경로는 항상 '/'로 구분합니다. (예: 표정/웃음/감사.svg) */
  listImages() {
    const out = [];
    const walk = (dir, segs) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
          if (segs.length < Lite.MAX_TAG_DEPTH && Lite.validSegment(e.name)) walk(path.join(dir, e.name), segs.concat(e.name));
        } else if (e.isFile() && Lite.IMAGE_FILE_RE.test(e.name) && Lite.validSegment(e.name)) {
          let st; try { st = fs.statSync(path.join(dir, e.name)); } catch { continue; }
          out.push({ path: segs.concat(e.name).join('/'), name: e.name, tag: segs.join('/'), size: st.size, mtime: Math.floor(st.mtimeMs) });
        }
      }
    };
    walk(this.imagesDir, []);
    const collator = new Intl.Collator('ko');
    return out.sort((a, b) => collator.compare(a.path, b.path));
  }

  /** images 아래의 모든 폴더 (이미지가 없는 빈 폴더도 포함) */
  listFolders() {
    const out = [];
    const walk = (dir, segs) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.isSymbolicLink() || !Lite.validSegment(e.name)) continue;
        const next = segs.concat(e.name);
        out.push(next.join('/'));
        if (next.length < Lite.MAX_TAG_DEPTH) walk(path.join(dir, e.name), next);
      }
    };
    walk(this.imagesDir, []);
    const collator = new Intl.Collator('ko');
    return out.sort((a, b) => collator.compare(a, b));
  }

  /** 이미지 경로 → 디스크의 실제 경로. 올바르지 않거나 images 밖을 가리키면 null */
  imagePath(imagePath) {
    const parts = Lite.splitImagePath(imagePath);
    if (!parts) return null;
    const abs = path.join(this.imagesDir, ...parts.segs, parts.name);
    try {
      const rootReal = fs.realpathSync(this.imagesDir);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) return null;
      if (!fs.realpathSync(abs).startsWith(rootReal + path.sep)) return null;
    } catch { /* 아직 없는 파일(저장 전)이면 아래에서 그대로 사용 */ }
    return abs;
  }

  /** 태그(폴더) 이름 → 폴더 경로. create이면 없는 폴더를 만듭니다. 올바르지 않으면 null */
  tagDir(tag, create) {
    const segs = Lite.splitTag(tag);
    if (segs === null) return null;
    const dir = path.join(this.imagesDir, ...segs);
    if (create) fs.mkdirSync(dir, { recursive: true });
    return { segs, dir };
  }

  uniqueName(dir, name) {
    let taken;
    try { taken = new Set(fs.readdirSync(dir).map((n) => n.toLowerCase())); } catch { taken = new Set(); }
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; n < 100; n++) {
      const cand = name.replace(/(\.[^.]+)$/, ` (${n})$1`);
      if (!taken.has(cand.toLowerCase())) return cand;
    }
    return name;
  }

  // 이미지를 지우거나 옮긴 뒤 비어 버린 폴더(태그)는 함께 정리합니다. images 폴더 자체는 남깁니다.
  _cleanEmptyDirs(dir) {
    const root = path.resolve(this.imagesDir);
    let cur = path.resolve(dir);
    while (cur !== root && cur.startsWith(root + path.sep)) {
      try {
        if (fs.readdirSync(cur).length) break;
        fs.rmdirSync(cur);
      } catch { break; }
      cur = path.dirname(cur);
    }
  }

  saveImage(name, buf, tag) {
    if (!Lite.IMAGE_FILE_RE.test(name) || !Lite.validSegment(name)) throw new Error('이미지 파일 이름이 올바르지 않습니다.');
    const t = this.tagDir(tag || '', true);
    if (!t) throw new Error('태그 이름이 올바르지 않습니다.');
    const finalName = this.uniqueName(t.dir, name);
    fs.writeFileSync(path.join(t.dir, finalName), buf);
    return t.segs.concat(finalName).join('/');
  }

  /** 이미지를 다른 태그(폴더)로 옮깁니다. 새 경로를 돌려줍니다. */
  moveImage(imagePath, tag) {
    const src = this.imagePath(imagePath);
    if (!src || !fs.existsSync(src)) throw new Error('이미지 파일을 찾을 수 없습니다.');
    const parts = Lite.splitImagePath(imagePath);
    const t = this.tagDir(tag || '', true);
    if (!t) throw new Error('태그 이름이 올바르지 않습니다.');
    if (t.segs.join('/') === parts.tag) return imagePath;
    const finalName = this.uniqueName(t.dir, parts.name);
    fs.renameSync(src, path.join(t.dir, finalName));
    this._cleanEmptyDirs(path.dirname(src));
    return t.segs.concat(finalName).join('/');
  }

  deleteImage(imagePath) {
    const p = this.imagePath(imagePath);
    if (!p) throw new Error('이미지 파일 이름이 올바르지 않습니다.');
    try { fs.unlinkSync(p); } catch { /* 이미 없음 */ }
    this._cleanEmptyDirs(path.dirname(p));
  }

  /**
   * 탐색기에서 파일을 다른 폴더로 옮겨서 명령어가 가리키는 경로가 사라진 경우:
   * 같은 이름의 파일이 딱 한 곳에만 있으면 그 파일로 자동 연결합니다. (여러 곳에 있으면 그대로 두어 "파일 없음"으로 보입니다.)
   * 설정이 바뀌었으면 true.
   */
  relinkCommands() {
    const images = this.listImages();
    const have = new Set(images.map((i) => i.path));
    let changed = false;
    const cfg = JSON.parse(JSON.stringify(this.config));
    for (const cmd of cfg.commands) {
      if (have.has(cmd.image)) continue;
      const base = Lite.splitImagePath(cmd.image);
      if (!base) continue;
      const same = images.filter((i) => i.name.toLowerCase() === base.name.toLowerCase());
      if (same.length === 1) { cmd.image = same[0].path; changed = true; }
    }
    if (changed) this.save(cfg);
    return changed;
  }
}

module.exports = { Store };

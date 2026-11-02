'use strict';
// 새 버전 확인: GitHub의 "최신 릴리스" 정보를 조회해서 지금 버전보다 새 것이 있는지만 알려 줍니다.
// 내려받기와 설치는 하지 않습니다. 사용자가 Release 페이지에서 직접 받습니다. (보내는 것은 요청 자체뿐이고 설정이나 채팅은 보내지 않습니다.)
const APP = require('./app-info');

const DEFAULT_API = 'https://api.github.com/repos/' + APP.REPO + '/releases/latest';
const RELEASES_URL = 'https://github.com/' + APP.REPO + '/releases';

/** "v0.4.10" → [0, 4, 10]. 읽지 못하면 null */
function parseVersion(v) {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(String(v == null ? '' : v));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** a가 b보다 새 버전이면 양수, 같으면 0, 오래된 버전이면 음수. 읽지 못하면 null (숫자로 비교하므로 0.4.10은 0.4.9보다 새 것) */
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** 안내에 쓸 주소는 이 저장소의 Release 주소만 인정하고, 그 밖의 값이 오면 Release 목록 주소를 씁니다. */
function safeReleaseUrl(url) {
  return typeof url === 'string' && url.startsWith(RELEASES_URL) && !/[\s"'<>]/.test(url) ? url : RELEASES_URL;
}

/** GitHub 응답에서 쓸 것만 뽑습니다. 초안, 사전 릴리스, 형식이 이상한 응답은 null */
function parseLatest(json) {
  if (!json || typeof json !== 'object' || json.draft === true || json.prerelease === true) return null;
  const v = parseVersion(json.tag_name);
  if (!v) return null;
  return { latest: v.join('.'), url: safeReleaseUrl(json.html_url) };
}

/** 최신 릴리스를 조회해서 { current, latest, url, newer }를 돌려줍니다. 실패하면 던집니다. (호출하는 쪽에서 조용히 무시) */
async function checkLatest(opts) {
  const fetchImpl = opts.fetch || fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 5000);
  try {
    const res = await fetchImpl(opts.apiUrl || DEFAULT_API, {
      signal: ctl.signal, cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': APP.NAME + '/' + opts.current }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const found = parseLatest(await res.json());
    if (!found) throw new Error('최신 버전 정보를 읽지 못했습니다.');
    const diff = compareVersions(found.latest, opts.current);
    return { current: opts.current, latest: found.latest, url: found.url, newer: diff !== null && diff > 0 };
  } finally { clearTimeout(timer); }
}

module.exports = { DEFAULT_API, RELEASES_URL, parseVersion, compareVersions, safeReleaseUrl, parseLatest, checkLatest };

'use strict';
// 문제가 생겼을 때 알려 줄 수 있도록 현재 상태를 한 덩어리 글로 모읍니다.
// 채널 주소, 채팅창 열쇠, 닉네임, 채팅 내용은 담지 않고, 경로의 사용자 이름은 가립니다.

function maskPath(p) {
  return String(p == null ? '' : p)
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/]+/gi, '$1<사용자>')
    .replace(/(\/home\/|\/Users\/)[^/]+/g, '$1<사용자>');
}

function maskText(t) {
  return maskPath(String(t == null ? '' : t)).replace(/[0-9a-fA-F]{32}/g, '<32자리 값 가림>');
}

function yn(v) { return v ? '예' : '아니오'; }
function pad(n) { return String(n).padStart(2, '0'); }
function stamp(ms) { const d = new Date(ms); return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

/**
 * info: { app, version, versions, platform, release, arch, dataDir, port, status, history, config, images, folders, bridge, update, now }
 * 반환: 복사해서 붙여 넣을 글
 */
function buildDiagnostics(info) {
  const cfg = info.config || {};
  const ch = cfg.channel || {};
  const bb = cfg.bbcode || {};
  const ov = cfg.overlay || {};
  const perm = cfg.permissions || {};
  const ui = cfg.ui || {};
  const cmds = cfg.commands || [];
  const tags = bb.tags || {};
  const tagKeys = Object.keys(tags);
  const count = (f) => tagKeys.filter((k) => f(tags[k])).length;
  const st = info.status || { state: '' };
  const d = st.detail || {};
  const L = [];
  L.push('[' + info.app + ' 진단 정보]');
  L.push('시각: ' + stamp(info.now || Date.now()));
  L.push('앱 버전: ' + info.version);
  if (info.versions) L.push('실행 환경: Electron ' + (info.versions.electron || '-') + ' / Chromium ' + (info.versions.chrome || '-') + ' / Node ' + (info.versions.node || '-'));
  L.push('운영체제: ' + info.platform + ' ' + info.release + ' (' + info.arch + ')');
  L.push('저장 폴더: ' + maskPath(info.dataDir));
  L.push('앱 주소 포트: ' + info.port);
  L.push('');
  L.push('[연결]');
  L.push('입력 방식: ' + (ch.chatKey ? '스튜디오 채팅창 주소' : ch.channelId ? '채널 페이지 주소' : '입력 없음') + ' (주소와 열쇠는 담지 않음)');
  L.push('상태: ' + (st.state || '-') + (d.liveStatus ? ' / 방송 상태 ' + d.liveStatus : '') + (d.step ? ' / ' + d.step : ''));
  if (d.message) L.push('마지막 오류: ' + maskText(d.message) + (d.hint ? ' ' + maskText(d.hint) : ''));
  const hist = (info.history || []).slice(-8);
  if (hist.length) {
    L.push('최근 연결 기록(오래된 것부터):');
    hist.forEach((h) => L.push('  ' + stamp(h.time) + ' ' + h.state + (h.kind ? ' [' + h.kind + ']' : '') + (h.message ? ' ' + maskText(h.message) : '')));
  }
  L.push('');
  L.push('[설정 요약]');
  L.push('채팅콘: 이미지 ' + (info.images == null ? '-' : info.images) + '개, 명령어가 있는 채팅콘 ' + cmds.filter((c) => c.triggers && c.triggers.length).length + '개, 태그 ' + (info.folders == null ? '-' : info.folders) + '개');
  L.push('BBCode: ' + (bb.enabled === false ? '꺼짐' : '켜짐') + ', 꺼 둔 태그 ' + count((t) => t && t.enabled === false) + '개, 이름을 바꾼 태그 ' + count((t) => t && Array.isArray(t.names)) + '개, 태그별 권한 ' + count((t) => t && t.access) + '개');
  L.push('권한: 채팅콘 기본 ' + (perm.imageAccess || '-') + ', BBCode 기본 ' + (perm.tagAccess || '-') + ', 권한 없는 부분 ' + (perm.deniedMode || '-') + ', 한도 넘은 부분 ' + (bb.overflowMode || '-'));
  L.push('화면: 글자 ' + ov.fontSize + 'px, 최대 ' + ov.maxLines + '줄, ' + ov.lineLifetimeSec + '초 뒤 사라짐, 위쪽 흐림 ' + ov.fadeTopPx + 'px/' + ov.fadeTopOpacity + '%');
  const adv = cfg.advanced || {};
  L.push('접속 주소 직접 지정: ' + yn(adv.apiBase || adv.commApiBase || adv.wsUrl));
  L.push('');
  L.push('[OBS 연결]');
  L.push('고정 위치 바로가기(한글 경로 대비): ' + (info.bridge == null ? '확인 안 함' : yn(info.bridge.launcher)));
  L.push('');
  L.push('[새 버전 알림]');
  L.push('알림 사용: ' + yn(ui.updateCheck !== false) + (info.update && info.update.latest ? ' / 최신 ' + info.update.latest + (info.update.newer ? ' (새 버전 있음)' : '') : ''));
  return L.join('\n');
}

module.exports = { buildDiagnostics, maskPath, maskText };

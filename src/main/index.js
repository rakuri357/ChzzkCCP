'use strict';
// Electron 진입점: 로컬 서버를 켜고 설정 창과 트레이 아이콘을 띄웁니다.
//  - 평소 실행: 설정 창이 열리고, 창을 닫으면 앱이 종료됩니다.
//  - --hidden 실행(OBS 스크립트가 사용): 창 없이 트레이 아이콘만 띄우고, 창을 닫아도 앱은 계속 실행됩니다.
//    트레이 메뉴의 "종료"나 종료 요청(/api/quit)으로만 끝납니다.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, Tray, nativeImage, clipboard, session, shell, dialog } = require('electron');
const { startServer } = require('../server/server');
const APP = require('../server/app-info');

const ASSETS = path.join(__dirname, '..', '..', 'assets');
const startHidden = process.argv.includes('--hidden');
// 숨김 실행(OBS용)은 화면을 거의 그리지 않으므로 GPU 가속을 끄면 시작이 빨라지고 메모리도 덜 씁니다. (app ready 전에 불러야 합니다.)
if (startHidden) app.disableHardwareAcceleration();

let win = null;
let tray = null;
let running = null;
let quitting = false;

// 이미지와 설정은 실행 파일 옆의 폴더에 저장합니다. (포터블: 폴더째 옮기면 설정도 같이 갑니다.) 쓸 수 없으면 사용자 데이터 폴더.
// 예전 이름의 폴더(chzzk-overlay-data)가 있으면 새 이름으로 바꿔서 설정과 이미지를 그대로 이어 씁니다.
function pickDataDir() {
  const base = process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(process.execPath) : process.cwd());
  const preferred = path.join(base, APP.DATA_DIR);
  try {
    if (!fs.existsSync(preferred)) {
      for (const legacy of APP.LEGACY_DATA_DIRS) {
        const old = path.join(base, legacy);
        if (fs.existsSync(old)) { fs.renameSync(old, preferred); break; }
      }
    }
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    return path.join(app.getPath('userData'), 'data');
  }
}

// OBS 스크립트(Lua)는 윈도우에서 한글이 들어간 경로를 열지 못합니다. 그래서 한글 없는 고정 위치(ProgramData 아래)에
// 이 앱을 숨김으로 여는 바로가기와 실행 상태 파일 사본을 두고, 스크립트는 그쪽만 봅니다. (윈도우의 설치본에서만)
function bridgeDir() {
  if (process.platform !== 'win32' || !app.isPackaged) return null;
  return path.join(process.env.ProgramData || 'C:\\ProgramData', APP.BRIDGE_DIR);
}

function writeLauncher(dir) {
  if (!dir) return;
  try {
    const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath; // 포터블은 압축을 푼 임시 위치가 아니라 원래 .exe
    fs.mkdirSync(dir, { recursive: true });
    shell.writeShortcutLink(path.join(dir, APP.LAUNCHER), 'create', {
      target, args: '--hidden', cwd: path.dirname(target), description: APP.NAME, icon: target, iconIndex: 0
    });
  } catch (e) {
    console.warn('[launcher] OBS용 바로가기를 만들지 못했습니다:', e.message); // 없어도 앱은 동작합니다. (OBS 스크립트에 .exe를 직접 지정하면 됩니다.)
  }
}

function isOurPage(url) {
  return !!running && typeof url === 'string' && url.startsWith(running.url);
}

// 설정 화면의 글꼴 목록(설치된 글꼴 읽기)만 허용하고, 그 밖의 권한 요청은 모두 거절합니다.
function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(permission === 'local-fonts' && isOurPage((details && details.requestingUrl) || wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => permission === 'local-fonts' && isOurPage(requestingOrigin));
}

const LOADING_PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  '<!doctype html><meta charset="utf-8"><title>' + APP.NAME + '</title>' +
  '<body style="margin:0;height:100vh;display:grid;place-items:center;background:#f5f6fb;color:#4a56e2;font:600 20px system-ui,sans-serif">' +
  APP.NAME + ' 시작하는 중…</body>');

// 서버가 준비되기 전에 창부터 띄웁니다. (실제 화면은 서버가 준비된 뒤에 불러옵니다.)
function openWindow() {
  win = new BrowserWindow({
    width: 1180, height: 860, minWidth: 760, minHeight: 560,
    title: APP.NAME,
    icon: path.join(ASSETS, 'icon.png'),
    backgroundColor: '#f5f6fb',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  win.removeMenu();
  // 바깥 주소(링크)는 기본 브라우저로 엽니다.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!isOurPage(url)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
  return win;
}

async function createWindow() {
  openWindow();
  await win.loadURL(running.url + '/input.html');
}

function showWindow() {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return; }
  createWindow().catch((e) => dialog.showErrorBox('창을 열지 못했습니다', String((e && e.message) || e)));
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
    tray.setToolTip(APP.NAME + ' (실행 중)');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '설정 열기', click: showWindow },
      { label: 'OBS 브라우저 소스 주소 복사', click: () => clipboard.writeText(running.url + '/output.html') },
      { type: 'separator' },
      { label: '종료', click: quitApp }
    ]));
    tray.on('click', showWindow);
  } catch (e) {
    console.warn('[tray] 트레이 아이콘을 만들지 못했습니다:', e.message); // 트레이가 없어도 앱은 동작합니다.
  }
}

function quitApp() {
  quitting = true;
  app.quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit(); // 이미 켜져 있으면 그 앱의 설정 창을 앞으로 가져오고 종료합니다.
} else {
  app.on('second-instance', () => { if (running) showWindow(); });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    if (!startHidden) { openWindow(); win.loadURL(LOADING_PAGE).catch(() => {}); }
    try {
      const bridge = bridgeDir();
      running = await startServer({
        dataDir: pickDataDir(),
        mirrorDir: bridge,
        openFolder: (dir) => shell.openPath(dir),
        onQuit: quitApp
      });
      writeLauncher(bridge);
      setupPermissions();
      createTray();
      if (!startHidden) {
        if (win) await win.loadURL(running.url + '/input.html'); // 먼저 띄워 둔 창에 실제 화면을 불러옵니다.
        else showWindow();
      }
    } catch (e) {
      dialog.showErrorBox('시작하지 못했습니다', String((e && e.message) || e));
      app.quit();
    }
  });

  // 숨김 실행일 때는 창을 닫아도 앱을 끝내지 않습니다. (OBS에 채팅을 계속 보내야 하기 때문)
  app.on('window-all-closed', () => { if (!startHidden || quitting) app.quit(); });
  app.on('before-quit', () => { quitting = true; if (running) running.close().catch(() => {}); });
}

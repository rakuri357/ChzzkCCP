'use strict';
// Electron 없이 서버만 실행 (개발/시험용): node src/server/cli.js [데이터 폴더]
const path = require('path');
const { startServer } = require('./server');
const APP = require('./app-info');

const dataDir = path.resolve(process.argv[2] || process.env.CHZZKCHATCONPLUS_DATA || path.join(process.cwd(), APP.DATA_DIR));
let stopFn = null;
startServer({ dataDir, onQuit: () => { if (stopFn) stopFn(); } }).then((s) => {
  console.log(`설정 화면      ${s.url}/input.html`);
  console.log(`OBS 브라우저   ${s.url}/output.html`);
  console.log(`데이터 폴더    ${dataDir}`);
  const stop = async () => { await s.close(); process.exit(0); };
  stopFn = stop;
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}).catch((e) => { console.error(e); process.exit(1); });

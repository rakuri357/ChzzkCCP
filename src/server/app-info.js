'use strict';
// 프로그램 이름과 식별자를 한 곳에서 관리합니다.
module.exports = {
  NAME: 'ChzzkChatConPlus',              // 화면에 보이는 이름
  ID: 'chzzkchatconplus',                // 내부 식별자 (OBS 스크립트가 앱을 알아보는 이름표, 파일/폴더 이름)
  DATA_DIR: 'chzzkchatconplus-data',     // 설정과 이미지가 저장되는 폴더 (.exe 옆)
  BRIDGE_DIR: 'ChzzkChatConPlus',          // 윈도우에서 한글 없는 고정 위치(ProgramData 아래)에 두는 OBS 연결용 폴더 이름
  LAUNCHER: 'launcher.lnk',                // 그 폴더 안의 실행 바로가기 (OBS 스크립트가 한글 경로의 exe 대신 이것을 실행합니다)
  LEGACY_DATA_DIRS: ['chzzk-overlay-data'] // 예전 이름의 폴더: 있으면 새 이름으로 바꿔서 설정과 이미지를 이어 씁니다.
};

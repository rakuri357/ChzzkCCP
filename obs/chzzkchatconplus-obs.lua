-- ChzzkChatConPlus - OBS 연동 스크립트
--
-- OBS를 켜면 ChzzkChatConPlus 앱을 숨김 상태로 함께 실행하고,
-- 앱이 준비되면 이 앱의 주소를 쓰는 브라우저 소스를 자동으로 새로고침합니다.
-- OBS를 끄면 이 스크립트가 켠 앱도 함께 종료합니다. (이미 켜져 있던 앱은 끄지 않습니다.)
--
-- 사용법: OBS → 도구 → 스크립트 → + 로 이 파일을 추가하고, "ChzzkChatConPlus 실행 파일"에 .exe 위치를 지정합니다.

obs = obslua

local exe_path = ""
local auto_quit = true

local SEP = package.config:sub(1, 1)       -- 윈도우는 "\", 그 밖에는 "/"
local MAX_TICKS = 60                       -- 0.5초 간격으로 최대 30초 기다립니다.
local TICK_MS = 500
local FRESH_SECONDS = 15                   -- 실행 상태 파일이 이 시간 안에 갱신되었으면 "실행 중"으로 봅니다.

local started_by_script = false            -- 이 스크립트가 직접 켠 경우에만 OBS를 끌 때 함께 종료합니다.
local launched_at = 0
local polling = false
local poll_ticks = 0
local quit_done = false
local obs_loaded = false

local function log(level, message)
  obs.script_log(level, message)
end

local function read_file(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local text = f:read("*a")
  f:close()
  return text
end

local function file_exists(path)
  local f = io.open(path, "rb")
  if f then f:close() return true end
  return false
end

local function dirname(path)
  return (path:gsub("[/\\][^/\\]*$", ""))
end

-- OBS의 Lua는 윈도우에서 한글이 들어간 경로를 열지 못합니다. (경로는 UTF-8인데 파일 함수는 현재 로케일로 읽기 때문)
-- 그래서 앱이 켜질 때 한글 없는 고정 위치(ProgramData 아래)에 "실행 바로가기"와 실행 상태 파일 사본을 만들어 두고,
-- 경로에 한글이 있으면 .exe 대신 그쪽을 씁니다.
local function is_ascii(path)
  return path:find("[\128-\255]") == nil
end

-- 윈도우에서만 경로의 한글을 문제로 봅니다. (다른 운영체제는 UTF-8 경로를 그대로 쓸 수 있습니다.)
local function ascii_only()
  return SEP == "\\" or os.getenv("CHZZKCCP_ASCII_ONLY") == "1" -- 두 번째 조건은 시험용
end

local function bridge_dir()
  local override = os.getenv("CHZZKCCP_BRIDGE_DIR") -- 시험용
  if override and override ~= "" then return override end
  if SEP == "\\" then return (os.getenv("ProgramData") or "C:\\ProgramData") .. "\\ChzzkChatConPlus" end
  return nil
end

local function launcher_path()
  local dir = bridge_dir()
  if not dir then return nil end
  local path = dir .. SEP .. "launcher.lnk"
  if file_exists(path) then return path end
  return nil
end

-- 실행에 쓸 대상: 한글 없는 .exe 경로가 있으면 그것을, 아니면 바로가기를 씁니다.
local function launch_target()
  if exe_path ~= "" and (is_ascii(exe_path) or not ascii_only()) and file_exists(exe_path) then return exe_path, false end
  local lnk = launcher_path()
  if lnk then return lnk, true end
  return nil, false
end

-- 앱이 5초마다 갱신하는 실행 상태 파일(chzzkchatconplus-data/runtime.json)을 읽습니다.
local function parse_runtime(text)
  if not text then return nil end
  local app = text:match('"app"%s*:%s*"([^"]*)"')
  local port = tonumber(text:match('"port"%s*:%s*(%d+)'))
  local pid = tonumber(text:match('"pid"%s*:%s*(%d+)'))
  local updated = tonumber(text:match('"updatedAt"%s*:%s*(%d+)'))
  if app ~= "chzzkchatconplus" or not port or not updated then return nil end
  return { port = port, pid = pid, updatedAt = updated }
end

-- .exe 옆의 상태 파일과, 한글 없는 고정 위치의 사본 중 더 최근 것을 씁니다.
local function read_runtime()
  local best = nil
  local function consider(path)
    local rt = parse_runtime(read_file(path))
    if rt and (best == nil or rt.updatedAt > best.updatedAt) then best = rt end
  end
  if exe_path ~= "" then consider(dirname(exe_path) .. SEP .. "chzzkchatconplus-data" .. SEP .. "runtime.json") end
  local dir = bridge_dir()
  if dir then consider(dir .. SEP .. "runtime.json") end
  return best
end

local function is_fresh(rt)
  return rt ~= nil and (os.time() - rt.updatedAt) <= FRESH_SECONDS
end

-- 앱 주소(localhost 또는 127.0.0.1의 해당 포트, output.html)를 쓰는 브라우저 소스인지 확인합니다.
local function is_our_url(url, port)
  local u = string.lower(url or "")
  local suffix = ":" .. tostring(port) .. "/output.html"
  return (u:find("localhost" .. suffix, 1, true) ~= nil) or (u:find("127.0.0.1" .. suffix, 1, true) ~= nil)
end

local function refresh_sources(port)
  local count = 0
  local sources = obs.obs_enum_sources()
  if sources ~= nil then
    for _, source in ipairs(sources) do
      if obs.obs_source_get_unversioned_id(source) == "browser_source" then
        local settings = obs.obs_source_get_settings(source)
        local url = obs.obs_data_get_string(settings, "url")
        obs.obs_data_release(settings)
        if is_our_url(url, port) then
          local props = obs.obs_source_properties(source)
          local button = obs.obs_properties_get(props, "refreshnocache")
          if button ~= nil then
            obs.obs_property_button_clicked(button, source)
            count = count + 1
          end
          obs.obs_properties_destroy(props)
        end
      end
    end
    obs.source_list_release(sources)
  end
  return count
end

local function launch(target, is_launcher)
  local cmd
  if SEP == "\\" then
    if is_launcher then
      cmd = 'start "" "' .. target .. '"' -- 바로가기에 --hidden이 들어 있습니다.
    else
      cmd = 'start "" /B "' .. target .. '" --hidden'
    end
  else
    cmd = '"' .. target .. '" --hidden >/dev/null 2>&1 &'
  end
  os.execute(cmd)
end

local poll_cb

local function stop_poll()
  if polling then
    obs.timer_remove(poll_cb)
    polling = false
  end
end

local function start_poll()
  stop_poll()
  poll_ticks = 0
  polling = true
  obs.timer_add(poll_cb, TICK_MS)
end

-- 앱이 켜져서 실행 상태 파일이 새로 만들어질 때까지 기다린 뒤, 브라우저 소스를 새로고침합니다.
poll_cb = function()
  poll_ticks = poll_ticks + 1
  local rt = read_runtime()
  if is_fresh(rt) and rt.updatedAt >= launched_at - 1 then
    stop_poll()
    local n = refresh_sources(rt.port)
    log(obs.LOG_INFO, "ChzzkChatConPlus 앱이 시작되었습니다 (포트 " .. rt.port .. "). 브라우저 소스 " .. n .. "개를 새로고침했습니다.")
    if n == 0 then
      log(obs.LOG_INFO, "새로고침할 브라우저 소스를 찾지 못했습니다. 소스의 URL이 http://localhost:" .. rt.port .. "/output.html 인지 확인하십시오.")
    end
  elseif poll_ticks >= MAX_TICKS then
    stop_poll()
    log(obs.LOG_WARNING, "ChzzkChatConPlus 앱이 30초 안에 시작되지 않았습니다. 실행 파일 위치를 확인하십시오: " .. exe_path)
  end
end

local function ensure_running()
  local target, is_launcher = launch_target()
  if not target then
    if exe_path == "" then
      log(obs.LOG_INFO, "ChzzkChatConPlus 실행 파일이 지정되지 않았습니다. 스크립트 설정에서 .exe 위치를 지정하십시오. 경로에 한글이 있으면 앱을 한 번 직접 실행한 뒤 OBS를 다시 켜십시오.")
    elseif ascii_only() and not is_ascii(exe_path) then
      log(obs.LOG_WARNING, "경로에 한글이 있어 OBS가 실행 파일을 열 수 없습니다: " .. exe_path .. " 앱(.exe)을 한 번 직접 실행한 뒤 OBS를 다시 켜거나, 한글이 없는 폴더에 두십시오.")
    else
      log(obs.LOG_WARNING, "실행 파일을 찾을 수 없습니다: " .. exe_path)
    end
    return
  end
  local rt = read_runtime()
  if is_fresh(rt) then
    log(obs.LOG_INFO, "ChzzkChatConPlus 앱이 이미 실행 중입니다 (포트 " .. rt.port .. "). 이 앱은 OBS를 끌 때 종료하지 않습니다.")
    return
  end
  launched_at = os.time()
  started_by_script = true
  quit_done = false
  launch(target, is_launcher)
  start_poll()
  log(obs.LOG_INFO, "ChzzkChatConPlus 앱을 숨김 상태로 시작합니다." .. (is_launcher and " (한글 없는 고정 위치의 바로가기 사용)" or ""))
end

-- OBS를 끌 때, 이 스크립트가 켠 앱을 종료합니다.
local function quit_app()
  if quit_done or not (started_by_script and auto_quit) then return end
  local rt = read_runtime()
  if not rt then return end
  quit_done = true
  local cmd
  if SEP == "\\" then
    cmd = 'curl.exe -s -m 3 -X POST -H "X-Requested-With: app" http://127.0.0.1:' .. rt.port .. '/api/quit >NUL 2>&1'
  else
    cmd = 'curl -s -m 3 -X POST -H "X-Requested-With: app" http://127.0.0.1:' .. rt.port .. '/api/quit >/dev/null 2>&1'
  end
  local result = os.execute(cmd)
  local ok = (result == 0) or (result == true)
  if not ok and rt.pid and SEP == "\\" then
    os.execute("taskkill /F /PID " .. rt.pid .. " >NUL 2>&1") -- curl을 쓸 수 없는 경우의 대비책
  end
  log(obs.LOG_INFO, "OBS를 종료하므로 ChzzkChatConPlus 앱도 종료합니다.")
end

local function manual_start()
  local rt = read_runtime()
  if is_fresh(rt) then
    local n = refresh_sources(rt.port)
    log(obs.LOG_INFO, "앱이 실행 중입니다. 브라우저 소스 " .. n .. "개를 새로고침했습니다.")
  else
    ensure_running()
  end
end

local function on_frontend_event(event)
  if event == obs.OBS_FRONTEND_EVENT_FINISHED_LOADING then
    obs_loaded = true
    ensure_running()
  elseif event == obs.OBS_FRONTEND_EVENT_EXIT then
    quit_app()
  end
end

-- ---------- OBS가 부르는 함수들 ----------
function script_description()
  return "<b>ChzzkChatConPlus</b><br>OBS를 켤 때 ChzzkChatConPlus 앱을 숨김 상태로 함께 실행하고, " ..
    "앱이 준비되면 브라우저 소스를 새로고침합니다. OBS를 끌 때 이 스크립트가 켠 앱도 함께 종료합니다.<br>" ..
    "경로에 한글이 있으면 OBS가 파일을 열 수 없으므로, 앱을 한 번 직접 실행해 두면 한글 없는 고정 위치의 바로가기로 대신 실행합니다."
end

function script_properties()
  local props = obs.obs_properties_create()
  obs.obs_properties_add_path(props, "exe_path", "ChzzkChatConPlus 실행 파일 (.exe)", obs.OBS_PATH_FILE, "ChzzkChatConPlus (*.exe)", nil)
  obs.obs_properties_add_bool(props, "auto_quit", "OBS를 끌 때 이 스크립트가 켠 앱도 함께 종료")
  obs.obs_properties_add_button(props, "start_now", "지금 시작 / 브라우저 소스 새로고침", function()
    manual_start()
    return false
  end)
  return props
end

function script_defaults(settings)
  obs.obs_data_set_default_bool(settings, "auto_quit", true)
end

function script_update(settings)
  local old_path = exe_path
  exe_path = obs.obs_data_get_string(settings, "exe_path")
  auto_quit = obs.obs_data_get_bool(settings, "auto_quit")
  -- 오래된 OBS처럼 "로딩 완료" 알림이 없으면, 설정을 읽은 직후 한 번 시작합니다.
  if obs.OBS_FRONTEND_EVENT_FINISHED_LOADING == nil then
    if not obs_loaded then
      obs_loaded = true
      if exe_path ~= "" or launcher_path() then ensure_running() end
    end
    return
  end
  -- OBS가 완전히 켜진 뒤에 실행 파일을 지정/변경했다면 바로 시작합니다.
  if obs_loaded and exe_path ~= "" and exe_path ~= old_path then
    ensure_running()
  end
end

function script_load(settings)
  obs.obs_frontend_add_event_callback(on_frontend_event)
end

function script_unload()
  stop_poll()
  quit_app()
end

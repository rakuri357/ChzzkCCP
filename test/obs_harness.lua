-- OBS 없이 OBS 스크립트의 동작(시작/대기/새로고침/종료 순서)을 확인하는 시험용 가짜 OBS 환경
local script_path = arg[1]
local failures = 0
local function check(cond, name) if cond then print("PASS " .. name) else print("FAIL " .. name); failures = failures + 1 end end

local real_execute = os.execute   -- 시험 준비(폴더 만들기)에는 진짜 os.execute를 쓰고, 스크립트에는 가짜를 줍니다.
local clock = 1000000
os.time = function() return clock end

local function mkdir(p) real_execute('mkdir -p "' .. p .. '"') end
local function write(path, text) local f = assert(io.open(path, "wb")); f:write(text); f:close() end
local seq = 0
local function new_env()
  seq = seq + 1
  local dir = "/tmp/obs-harness-" .. seq
  real_execute('rm -rf "' .. dir .. '"')
  mkdir(dir .. "/chzzkchatconplus-data")
  write(dir .. "/ChzzkChatConPlus.exe", "x")
  return dir, dir .. "/ChzzkChatConPlus.exe"
end
local function runtime(dir, port, updated)
  write(dir .. "/chzzkchatconplus-data/runtime.json", string.format('{"app":"chzzkchatconplus","port":%d,"pid":4321,"startedAt":%d,"updatedAt":%d}', port, updated, updated))
end

-- ---------- 가짜 obslua ----------
local function make_obs(opts)
  local o = { logs = {}, timers = {}, executed = {}, exec_result = 0, sources = opts and opts.sources or {}, event_cb = nil, settings = {} }
  local api = {
    LOG_INFO = 1, LOG_WARNING = 2, OBS_PATH_FILE = 0, OBS_FRONTEND_EVENT_FINISHED_LOADING = 100, OBS_FRONTEND_EVENT_EXIT = 101,
    script_log = function(level, msg) table.insert(o.logs, { level = level, msg = msg }) end,
    timer_add = function(fn, ms) table.insert(o.timers, fn) end,
    timer_remove = function(fn) for i, f in ipairs(o.timers) do if f == fn then table.remove(o.timers, i) break end end end,
    obs_enum_sources = function() return o.sources end,
    source_list_release = function() end,
    obs_source_get_unversioned_id = function(src) return src.id end,
    obs_source_get_settings = function(src) return { url = src.url } end,
    obs_data_get_string = function(t, k) return t[k] or "" end,
    obs_data_get_bool = function(t, k) if t[k] == nil then return false end return t[k] end,
    obs_data_set_default_bool = function(t, k, v) if t[k] == nil then t[k] = v end end,
    obs_data_release = function() end,
    obs_source_properties = function(src) return { src = src } end,
    obs_properties_get = function(props, name) if name == "refreshnocache" and props.src.button ~= false then return props.src end return nil end,
    obs_property_button_clicked = function(btn, src) src.refreshed = (src.refreshed or 0) + 1 end,
    obs_properties_destroy = function() end,
    obs_properties_create = function() return { added = {} } end,
    obs_properties_add_path = function(p, name) table.insert(p.added, name) end,
    obs_properties_add_bool = function(p, name) table.insert(p.added, name) end,
    obs_properties_add_button = function(p, name, label, cb) table.insert(p.added, name); p.button_cb = cb end,
    obs_frontend_add_event_callback = function(fn) o.event_cb = fn end,
  }
  o.api = api
  return o
end

local function load_script(o)
  obslua = o.api
  os.execute = function(cmd) table.insert(o.executed, cmd); return o.exec_result end
  dofile(script_path)
end
local function settings_for(path, auto_quit) return { exe_path = path, auto_quit = auto_quit } end
local function tick(o, n)
  for _ = 1, n do
    clock = clock + 1
    local copy = {}
    for i, f in ipairs(o.timers) do copy[i] = f end
    for _, f in ipairs(copy) do f() end
  end
end
local function boot(o, path, auto_quit)
  load_script(o)
  script_load({})
  local s = settings_for(path, auto_quit == nil and true or auto_quit)
  script_update(s)
  o.event_cb(obslua.OBS_FRONTEND_EVENT_FINISHED_LOADING)
end
local function count_exec(o, pattern) local n = 0; for _, c in ipairs(o.executed) do if c:find(pattern, 1, true) then n = n + 1 end end return n end

-- 1) 실행 파일 미지정 / 없는 파일
do
  local o = make_obs(); boot(o, "")
  check(#o.executed == 0, "경로가 비어 있으면 아무것도 실행하지 않는다")
  local o2 = make_obs(); boot(o2, "/tmp/없는파일.exe")
  check(#o2.executed == 0, "없는 파일이면 실행하지 않는다")
  check(o2.logs[#o2.logs].level == 2, "없는 파일이면 경고를 남긴다")
end

-- 2) 앱이 꺼져 있으면 숨김 실행 → 준비되면 해당 브라우저 소스만 새로고침
do
  local dir, exe = new_env()
  local mine = { id = "browser_source", url = "http://localhost:3939/output.html" }
  local mine2 = { id = "browser_source", url = "http://127.0.0.1:3939/output.html?preview=1" }
  local settingsPage = { id = "browser_source", url = "http://localhost:3939/input.html" }
  local other = { id = "browser_source", url = "https://example.com/output.html" }
  local otherPort = { id = "browser_source", url = "http://localhost:3000/output.html" }
  local image = { id = "image_source", url = "http://localhost:3939/output.html" }
  local o = make_obs({ sources = { mine, mine2, settingsPage, other, otherPort, image } })
  boot(o, exe)
  check(count_exec(o, "--hidden") == 1, "앱이 꺼져 있으면 --hidden으로 실행한다")
  check(o.executed[1]:find(exe, 1, true) ~= nil, "실행 명령에 실행 파일 경로가 들어 있다")
  check(#o.timers == 1, "준비될 때까지 기다리는 타이머가 켜진다")
  tick(o, 3)
  check(mine.refreshed == nil, "앱이 아직 준비되지 않았으면 새로고침하지 않는다")
  runtime(dir, 3939, clock)                      -- 앱이 시작되어 상태 파일을 씀
  tick(o, 1)
  check(mine.refreshed == 1 and mine2.refreshed == 1, "준비되면 앱 주소를 쓰는 브라우저 소스를 새로고침한다")
  check(settingsPage.refreshed == nil and other.refreshed == nil and otherPort.refreshed == nil and image.refreshed == nil, "다른 소스는 새로고침하지 않는다")
  check(#o.timers == 0, "준비되면 타이머를 끈다")
  -- 이 스크립트가 켰으므로 OBS를 끌 때 종료 요청을 보낸다
  o.event_cb(obslua.OBS_FRONTEND_EVENT_EXIT)
  check(count_exec(o, "/api/quit") == 1 and count_exec(o, "127.0.0.1:3939") == 1, "OBS를 끌 때 해당 포트로 종료 요청을 보낸다")
  check(count_exec(o, "X-Requested-With: app") == 1, "종료 요청에 전용 헤더가 들어 있다")
  script_unload()
  check(count_exec(o, "/api/quit") == 1, "종료 요청은 한 번만 보낸다")
end

-- 3) 이미 켜져 있던 앱은 건드리지 않는다
do
  local dir, exe = new_env()
  runtime(dir, 3939, clock - 3)
  local o = make_obs(); boot(o, exe)
  check(count_exec(o, "--hidden") == 0, "이미 실행 중이면 다시 실행하지 않는다")
  o.event_cb(obslua.OBS_FRONTEND_EVENT_EXIT)
  check(count_exec(o, "/api/quit") == 0, "이미 켜져 있던 앱은 OBS를 끌 때 종료하지 않는다")
end

-- 4) 오래된 상태 파일(앱이 비정상 종료됨)은 꺼진 것으로 본다
do
  local dir, exe = new_env()
  runtime(dir, 3939, clock - 600)
  local o = make_obs(); boot(o, exe)
  check(count_exec(o, "--hidden") == 1, "오래된 상태 파일이면 앱을 다시 실행한다")
  tick(o, 2)
  check(#o.timers == 1, "오래된 상태 파일로는 준비된 것으로 보지 않는다")
end

-- 5) 포트가 바뀐 경우(3940)에는 그 포트 기준으로 새로고침/종료
do
  local dir, exe = new_env()
  local a = { id = "browser_source", url = "http://localhost:3939/output.html" }
  local b = { id = "browser_source", url = "http://localhost:3940/output.html" }
  local o = make_obs({ sources = { a, b } }); boot(o, exe)
  runtime(dir, 3940, clock); tick(o, 1)
  check(a.refreshed == nil and b.refreshed == 1, "앱의 실제 포트와 같은 주소만 새로고침한다")
  o.event_cb(obslua.OBS_FRONTEND_EVENT_EXIT)
  check(count_exec(o, "127.0.0.1:3940") == 1, "종료 요청도 실제 포트로 보낸다")
end

-- 6) 앱이 끝내 시작되지 않으면 30초 뒤 포기하고 경고
do
  local dir, exe = new_env()
  local o = make_obs(); boot(o, exe)
  tick(o, 59); check(#o.timers == 1, "30초 전에는 계속 기다린다")
  tick(o, 1)
  check(#o.timers == 0 and o.logs[#o.logs].level == 2, "30초가 지나면 기다리기를 멈추고 경고한다")
end

-- 7) 종료 옵션을 끄면 종료 요청을 보내지 않는다
do
  local dir, exe = new_env()
  local o = make_obs(); boot(o, exe, false)
  runtime(dir, 3939, clock); tick(o, 1)
  o.event_cb(obslua.OBS_FRONTEND_EVENT_EXIT)
  check(count_exec(o, "/api/quit") == 0, "종료 옵션이 꺼져 있으면 앱을 끄지 않는다")
end

-- 8) 앱이 시작되기 전에 OBS를 끄면(상태 파일 없음) 아무것도 하지 않는다
do
  local dir, exe = new_env()
  local o = make_obs(); boot(o, exe)
  o.event_cb(obslua.OBS_FRONTEND_EVENT_EXIT)
  check(count_exec(o, "/api/quit") == 0, "상태 파일이 없으면 종료 요청을 보내지 않는다")
end

-- 9) OBS가 다 켜진 뒤에 실행 파일을 지정하면 바로 시작
do
  local dir, exe = new_env()
  local o = make_obs(); load_script(o); script_load({})
  script_update(settings_for("", true))
  o.event_cb(obslua.OBS_FRONTEND_EVENT_FINISHED_LOADING)
  check(#o.executed == 0, "경로가 없으면 시작하지 않는다")
  script_update(settings_for(exe, true))
  check(count_exec(o, "--hidden") == 1, "OBS가 켜진 뒤 경로를 지정하면 바로 시작한다")
end

-- 10) 속성 화면 구성과 수동 시작 버튼
do
  local dir, exe = new_env()
  local o = make_obs(); boot(o, exe)
  local props = script_properties()
  local names = table.concat(props.added, ",")
  check(names:find("exe_path") and names:find("auto_quit") and names:find("start_now"), "속성에 경로/종료 옵션/시작 버튼이 있다")
  local d2 = {}; script_defaults(d2); check(d2.auto_quit == true, "종료 옵션의 기본값은 켜짐이다")
  check(type(script_description()) == "string" and #script_description() > 10, "스크립트 설명이 있다")
  runtime(dir, 3939, clock); tick(o, 1)
  local src = { id = "browser_source", url = "http://localhost:3939/output.html" }
  o.sources[1] = src
  props.button_cb()
  check(src.refreshed == 1, "수동 버튼은 실행 중이면 브라우저 소스를 새로고침한다")
end

-- 11) 로딩 완료 알림이 없는 구형 OBS에서는 설정을 읽은 직후 시작
do
  local dir, exe = new_env()
  local o = make_obs(); o.api.OBS_FRONTEND_EVENT_FINISHED_LOADING = nil
  load_script(o); script_load({}); script_update(settings_for(exe, true))
  check(count_exec(o, "--hidden") == 1, "로딩 완료 알림이 없으면 설정을 읽은 직후 시작한다")
end

-- 12) curl 실패 시(윈도우가 아닌 환경에서는 taskkill을 쓰지 않음)
do
  local dir, exe = new_env()
  local o = make_obs(); boot(o, exe); runtime(dir, 3939, clock); tick(o, 1)
  o.exec_result = 1
  o.event_cb(obslua.OBS_FRONTEND_EVENT_EXIT)
  check(count_exec(o, "taskkill") == 0, "리눅스에서는 taskkill을 쓰지 않는다")
end

print(failures == 0 and "ALL OK" or ("FAILURES: " .. failures))
os.exit(failures == 0 and 0 or 1)

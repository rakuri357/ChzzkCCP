-- 진짜 앱 서버를 상대로 한 OBS 스크립트 전체 흐름: 실행 → 준비 대기 → 브라우저 소스 새로고침 → OBS 종료 시 앱 종료
local script_path, dir, exe = arg[1], arg[2], arg[3]
local real_execute = os.execute
local failures = 0
local function check(cond, name) if cond then print("PASS " .. name) else print("FAIL " .. name); failures = failures + 1 end end

local o = { timers = {}, refreshed = 0, logs = {} }
local src = { id = "browser_source", url = "http://localhost:" .. arg[4] .. "/output.html" }
obslua = {
  LOG_INFO = 1, LOG_WARNING = 2, OBS_PATH_FILE = 0, OBS_FRONTEND_EVENT_FINISHED_LOADING = 100, OBS_FRONTEND_EVENT_EXIT = 101,
  script_log = function(l, m) table.insert(o.logs, m) end,
  timer_add = function(fn) table.insert(o.timers, fn) end,
  timer_remove = function(fn) for i, f in ipairs(o.timers) do if f == fn then table.remove(o.timers, i) break end end end,
  obs_enum_sources = function() return { src } end, source_list_release = function() end,
  obs_source_get_unversioned_id = function(s) return s.id end,
  obs_source_get_settings = function(s) return { url = s.url } end,
  obs_data_get_string = function(t, k) return t[k] or "" end, obs_data_get_bool = function(t, k) return t[k] end,
  obs_data_set_default_bool = function() end, obs_data_release = function() end,
  obs_source_properties = function(s) return { s = s } end, obs_properties_get = function(p, n) return p.s end,
  obs_property_button_clicked = function() o.refreshed = o.refreshed + 1 end, obs_properties_destroy = function() end,
  obs_frontend_add_event_callback = function(fn) o.cb = fn end,
}
dofile(script_path)
script_load({})
script_update({ exe_path = exe, auto_quit = true })
o.cb(obslua.OBS_FRONTEND_EVENT_FINISHED_LOADING)     -- 진짜 os.execute로 앱을 숨김 실행

local waited = 0
while #o.timers > 0 and waited < 40 do               -- 0.5초 간격으로 최대 20초 기다림
  real_execute("sleep 0.5"); waited = waited + 1
  for _, f in ipairs({ unpack(o.timers) }) do f() end
end
check(o.refreshed == 1, "앱이 실제로 시작되어 브라우저 소스가 새로고침되었다 (대기 " .. waited .. "회)")

local state = io.popen("curl -s -m 3 http://127.0.0.1:" .. arg[4] .. "/api/state"):read("*a")
check(state:find('"app":"chzzkchatconplus"') ~= nil, "앱 서버가 실제로 응답한다")

o.cb(obslua.OBS_FRONTEND_EVENT_EXIT)                 -- 진짜 curl로 종료 요청
real_execute("sleep 1.5")
local after = io.popen("curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:" .. arg[4] .. "/api/state 2>/dev/null"):read("*a")
check(after == "000", "OBS를 끄자 앱이 종료되어 더 이상 응답하지 않는다 (" .. after .. ")")
local rt = io.open(dir .. "/chzzkchatconplus-data/runtime.json", "rb")
check(rt == nil, "종료 후 실행 상태 파일이 지워졌다")
if rt then rt:close() end
print(failures == 0 and "ALL OK" or ("FAILURES: " .. failures))
os.exit(failures == 0 and 0 or 1)

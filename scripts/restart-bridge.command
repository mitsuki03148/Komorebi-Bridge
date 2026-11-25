#!/bin/zsh
# Double-click to restart the Komorebi Bridge (macOS opens it in Terminal). It does not need the Bridge to be running,
# so it works when the app cannot be opened at all. Restarting also ends the CLI sessions the Bridge started.
#
#   scripts/restart-bridge.command          restart, then wait until the Bridge answers
#   scripts/restart-bridge.command --dry    only look: say what a restart would do, change nothing

root="${0:A:h:h}"
if [[ -r "$root/.env.komorebi-local" ]]; then
  set -a
  source "$root/.env.komorebi-local"
  set +a
fi
service="$root/scripts/komorebi-service.sh"
port="${KOMOREBI_PORT:-3000}"
label="com.komorebi.bridge"
log="$HOME/Library/Logs/$label.log"
dry=0; [[ "$1" == "--dry" ]] && dry=1

say() { print -r -- "$1"; }
finish() { say ""; [[ -t 0 && $dry -eq 0 ]] && { read -k 1 "?按任何鍵關閉視窗…"; say ""; }; exit "$1"; }
answers() { [[ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://localhost:$port/" 2>/dev/null)" == "200" ]]; }
service_pid() { launchctl print "gui/$(id -u)/$label" 2>/dev/null | awk '/^[[:space:]]*pid = [0-9]+$/ {print $3; exit}'; }

say "重啟 Komorebi Bridge"
say "（Bridge 開住嘅 CLI 房會結束，之後喺 App 開返個房就會用同一個 session 續接。）"
say ""

if [[ ! -x "$service" ]]; then
  say "❌ 搵唔到或者唔可以執行：$service"
  say "   請將呢個視窗嘅內容畀響睇。"
  finish 1
fi

if [[ -n "$KOMOREBI_MOUNT" && ! -d "$KOMOREBI_MOUNT" ]]; then
  say "⚠️ 外置碟 $KOMOREBI_MOUNT 未掛載。Bridge 要等佢先起得，請先接駁硬碟。"
fi

# Another Bridge on the port (for example one started by hand with `npm run dev`) would make the service refuse to start.
listener="$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1)"
mine="$(service_pid)"
if [[ -n "$listener" && "$listener" != "$mine" ]]; then
  say "⚠️ 有另一個程式（PID $listener）佔住埠 $port，唔係背景服務："
  ps -o pid,lstart,command -p "$listener" | cut -c1-140
  say "   如果係你喺終端機用 npm run dev 開嘅，請喺嗰個視窗按 Ctrl+C 停咗佢，再撳呢個。"
  say "   我唔會自動殺佢。"
  finish 1
fi

if (( dry )); then
  state="冇運行"; [[ -n "$mine" ]] && state="運行中，PID $mine"
  reply="冇回應"; answers && reply="有回應"
  say "（只係檢查）背景服務目前：$state；埠 $port：$reply。"
  say "真係重啟會執行：$service restart"
  exit 0
fi

"$service" restart
say ""
say "等 Bridge 起身…（最多 90 秒）"
for i in {1..45}; do
  answers && break
  sleep 2
done

if answers; then
  say "✅ Bridge 已經起好（http://localhost:$port）。"
  say "   喺 App 重新整理頁面就得；房間要再開返先會續接。"
  finish 0
fi

say "❌ Bridge 90 秒內都起唔到。"
say "   最後嘅日誌："
tail -n 15 "$log" 2>/dev/null | cut -c1-160
say ""
say "   請將呢個視窗嘅內容畀響睇，我幫你查。"
finish 1

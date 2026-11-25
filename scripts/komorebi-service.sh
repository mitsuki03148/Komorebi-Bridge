#!/bin/zsh
# Runs the komorebi Bridge as a background service (a launchd LaunchAgent), so it needs no Terminal window.
#
#   scripts/komorebi-service.sh install     write the service file (does not start it)
#   scripts/komorebi-service.sh start       start it (refuses if a Bridge is already listening)
#   scripts/komorebi-service.sh restart     stop and start it again
#   scripts/komorebi-service.sh stop        stop it
#   scripts/komorebi-service.sh status      is it running, and which process
#   scripts/komorebi-service.sh logs        the last lines of its log
#   scripts/komorebi-service.sh uninstall   stop it and remove the service file
#   scripts/komorebi-service.sh print-plist show the service file that install would write
#
# Stopping or restarting the Bridge also ends the CLI sessions it started; open a room again to resume it.

root="${0:A:h:h}"
label="${KOMOREBI_SERVICE_LABEL:-com.komorebi.bridge}"
port="${KOMOREBI_PORT:-3000}"
plist="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/$label.log"
domain="gui/$(id -u)"

xml() { print -rn -- "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# The tools the Bridge starts, found now, because a background service does not get the Terminal's PATH.
service_path() {
  local dirs=() tool dir
  for tool in node claude codex agy tailscale; do
    dir="$(command -v $tool 2>/dev/null)" && dirs+=("${dir:h}")
  done
  dirs+=(/opt/homebrew/bin /usr/local/bin /usr/bin /bin /usr/sbin /sbin)
  print -rn -- "${(j.:.)${(u)dirs[@]}}"
}

render_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(xml "$label")</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>$(xml "$root/scripts/start-bridge.sh")</string></array>
  <key>WorkingDirectory</key><string>$(xml "$root")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml "$(service_path)")</string>
    <key>HOME</key><string>$(xml "$HOME")</string>
    <key>LANG</key><string>en_US.UTF-8</string>
$( [[ -n "$KOMOREBI_PORT" ]] && print -r -- "    <key>KOMOREBI_PORT</key><string>$(xml "$KOMOREBI_PORT")</string>" )
$( [[ -n "$KOMOREBI_WORKSPACE" ]] && print -r -- "    <key>KOMOREBI_WORKSPACE</key><string>$(xml "$KOMOREBI_WORKSPACE")</string>" )
  </dict>
  <key>RunAtLoad</key><true/>
  <!-- Restart after a crash or a failed start, but not after a deliberate stop. -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$(xml "$log")</string>
  <key>StandardErrorPath</key><string>$(xml "$log")</string>
</dict>
</plist>
PLIST
}

loaded() { launchctl print "$domain/$label" >/dev/null 2>&1; }
listening() { lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; }
pid_of() { launchctl print "$domain/$label" 2>/dev/null | awk '/^\tpid = / {print $3}'; }

case "${1:-}" in
  print-plist) render_plist ;;
  install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    render_plist > "$plist" && chmod 600 "$plist" && plutil -lint "$plist" >/dev/null || { print -u2 "寫入服務檔失敗。"; exit 1; }
    : >> "$log"; chmod 600 "$log"
    print "已寫入 $plist（未啟動）。下一步：先停止目前在 Terminal 執行的 Bridge，再執行 scripts/komorebi-service.sh start"
    ;;
  start)
    [[ -f "$plist" ]] || { print -u2 "未安裝，請先執行 install。"; exit 1; }
    if loaded; then print "已在執行（pid $(pid_of)）。"; exit 0; fi
    if listening; then print -u2 "埠 $port 已有程式在監聽（可能是 Terminal 中執行的 Bridge）。請先停止它。"; exit 1; fi
    launchctl bootstrap "$domain" "$plist" && print "已啟動。紀錄：$log"
    ;;
  stop)
    loaded || { print "沒有在執行。"; exit 0; }
    launchctl bootout "$domain/$label" || exit 1
    for _ in {1..40}; do loaded || break; sleep 0.25; done   # bootout 是非同步
    loaded && { print -u2 "尚未完全停止，請稍後再查看 status。"; exit 1; }
    print "已停止。"
    ;;
  restart)
    if loaded; then launchctl kickstart -k "$domain/$label" && print "已重啟。"; else "$0" start; fi
    ;;
  status)
    if loaded; then print "運行中（pid ${$(pid_of):-—}），最近一次結束：$(launchctl print "$domain/$label" | awk -F' = ' '/last exit code/ {print $2; exit}')"
    else print "沒有在執行。"; fi
    listening && print "埠 $port：有程式在監聽。" || print "埠 $port：沒有程式在監聽。"
    ;;
  logs) tail -n "${2:-60}" "$log" ;;
  uninstall)
    "$0" stop >/dev/null
    rm -f "$plist" && print "已移除 $plist。"
    ;;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

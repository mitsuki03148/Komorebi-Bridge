#!/bin/zsh
# Run only as the independent com.komorebi.bridge-restart launchd job.
# No client-supplied command, path, or argument is used.

root="${0:A:h:h}"
label='com.komorebi.bridge'
job='com.komorebi.bridge-restart'
domain="gui/$(/usr/bin/id -u)"
log="$HOME/Library/Logs/com.komorebi.bridge.handover.log"
plist="$HOME/Library/LaunchAgents/com.komorebi.bridge.plist"

# Never let an inherited environment redirect the existing service script.
unset KOMOREBI_SERVICE_LABEL KOMOREBI_PORT
PATH='/usr/bin:/bin:/usr/sbin:/sbin'
export PATH

cleanup() { /bin/launchctl remove "$job" >/dev/null 2>&1 || true; }
trap cleanup EXIT
/bin/mkdir -p "$HOME/Library/Logs" || exit 1
exec >> "$log" 2>&1 || exit 1
log_line() { print -r -- "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ') $1"; }
service_pid() { /bin/launchctl print "$domain/$label" 2>/dev/null | /usr/bin/awk '/^[[:space:]]*pid = [0-9]+$/ {print $3; exit}'; }

# The port belongs to the fixed service plist, not to the caller of this job.
port=$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:KOMOREBI_PORT' "$plist" 2>/dev/null) || port=3000
if [[ ! "$port" =~ '^[0-9]{1,5}$' ]] || (( port < 1 || port > 65535 )); then
  log_line 'restart failed: invalid Bridge port in service plist'
  exit 1
fi
old_pid=$(service_pid)
/bin/sleep 3
log_line 'Bridge restart started'
if ! /bin/zsh "$root/scripts/komorebi-service.sh" restart; then
  log_line 'restart failed: service command failed'
  exit 1
fi

# A successful HTTP response alone could come from another process on the port.
# Require the new launchd process or its child to own the listening socket too.
SECONDS=0
while (( SECONDS < 60 )); do
  pid=$(service_pid)
  if [[ "$pid" =~ ^[0-9]+$ && "$pid" != "$old_pid" ]]; then
    pids=("$pid" ${(@f)$(/usr/bin/pgrep -P "$pid" 2>/dev/null)})
    for owner in "${pids[@]}"; do
      if /usr/sbin/lsof -nP -a -p "$owner" -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && \
        /usr/bin/curl --silent --show-error --fail --max-time 1 "http://127.0.0.1:$port/" >/dev/null 2>&1; then
        log_line 'Bridge restarted and is listening'
        exit 0
      fi
    done
  fi
  /bin/sleep 1
done
log_line 'restart failed: Bridge did not become ready within 60 seconds'
exit 1

#!/bin/zsh
# Starts the komorebi Bridge the way launchd needs: waits for the workspace volume, then keeps the Mac awake while it runs.
# PATH and KOMOREBI_* come from the service's plist (see komorebi-service.sh); this file holds no secrets.
cd "${0:A:h}/.." || exit 1
if [[ -r .env.komorebi-local ]]; then
  set -a
  source .env.komorebi-local
  set +a
fi

workspace="${KOMOREBI_WORKSPACE:-$HOME/Komorebi}"
[[ -z "$KOMOREBI_MOUNT" ]] && mkdir -p "$workspace"
# At login the external volume may not be mounted yet, so give it a minute before giving up.
for attempt in {1..30}; do
  [[ -d "$workspace" ]] && break
  sleep 2
done
if [[ ! -d "$workspace" ]]; then
  print -u2 "工作區 $workspace 未掛載，Bridge 未啟動。"
  exit 1
fi

# caffeinate keeps the Mac from sleeping while the Bridge runs, so phones can reach it and pushes can be sent.
exec /usr/bin/caffeinate -is node --import tsx server.ts

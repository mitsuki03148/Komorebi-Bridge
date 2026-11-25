#!/bin/zsh
# Installs the workbench hook for 瞳 (AGY). AGY takes hooks only from a plugin, so this puts a small plugin in
# ~/.gemini/config/plugins/komorebi-bench whose PreInvocation hook asks the Bridge for 瞳's new tickets.
# After a completed compact, the same PreInvocation hook can also supply the Bridge's current workbench snapshot.
# Existing installations already call this hook; no plugin reinstall is needed for this change.
# Outside a group room the Bridge answers {} and the hook does nothing.
#
#   scripts/komorebi-bench-plugin.sh install | uninstall | status
root="${0:A:h:h}"
dir="$HOME/.gemini/config/plugins/komorebi-bench"
case "$1" in
  install)
    mkdir -p "$dir"
    print -r -- '{ "name": "komorebi-bench", "displayName": "Komorebi workbench", "version": "1.0.0", "description": "Hands 瞳 the tickets other group members put in its Komorebi workbench." }' > "$dir/plugin.json"
    print -r -- "{ \"komorebi-bench\": { \"PreInvocation\": [ { \"type\": \"command\", \"command\": \"$root/scripts/bench-hook agy\", \"timeout\": 5 } ] } }" > "$dir/hooks.json"
    agy plugin validate "$dir" >/dev/null 2>&1 && print "已安裝：$dir" || { print "已寫入 $dir，但 agy plugin validate 未通過，請檢查。"; exit 1 } ;;
  uninstall) rm -rf "$dir" && print "已移除：$dir" ;;
  status) [ -f "$dir/hooks.json" ] && { print "已安裝：$dir"; cat "$dir/hooks.json" } || print "未安裝。" ;;
  *) print "用法：$0 install | uninstall | status"; exit 2 ;;
esac

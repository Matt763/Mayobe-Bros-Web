#!/bin/bash
# Uploads the exam RESULTS data to Cloudflare R2 by itself, outside any Claude session (resumable; never uploads past papers).
#   start (from Claude's Flatpak shell, on the host):  flatpak-spawn --host bash -c 'cd "/run/media/mclean/New Volume/my-site" && setsid nohup bash scripts/tools/r2-upload-detached.sh run >/dev/null 2>&1 &'
#   look: bash scripts/tools/r2-upload-detached.sh status        stop: bash scripts/tools/r2-upload-detached.sh stop
# State: ~/necta-work/r2-uploaded.json   Log: ~/necta-work/logs/r2-upload.log
export PATH="$HOME/tools/node/bin:$PATH"
SITE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; LOG="$HOME/necta-work/logs/r2-upload.log"; PIDF="$HOME/necta-work/logs/r2-upload.pid"
case "${1:-status}" in
  run)
    if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "already running"; exit 0; fi
    echo $$ > "$PIDF"; trap 'rm -f "$PIDF"' EXIT; cd "$SITE" || exit 1
    node --no-warnings scripts/tools/r2-upload-results.mjs >> "$LOG" 2>&1; echo "$(date '+%F %T') upload exit $?" >> "$LOG" ;;
  status) [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null && echo "running (pid $(cat "$PIDF"))" || echo "not running"
          node -e 'const s=require(process.env.HOME+"/necta-work/r2-uploaded.json");const v=Object.values(s);console.log(v.filter(x=>x.complete).length+" of "+v.length+" started exams complete")' 2>/dev/null; tail -n 4 "$LOG" 2>/dev/null ;;
  stop) [ -f "$PIDF" ] && pkill -P "$(cat "$PIDF")" ; [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null; rm -f "$PIDF"; echo stopped ;;
  *) echo "usage: $0 run|status|stop"; exit 2 ;;
esac

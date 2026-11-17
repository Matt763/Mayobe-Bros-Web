#!/bin/bash
# bash scripts/tools/r2-rclone-detached.sh run|status|stop  (run it on the host: flatpak-spawn --host ...)
D="$HOME/necta-work/logs"; mkdir -p "$D"; LOG="$D/r2-rclone.log"; ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
case "$1" in
  run) export PATH="$HOME/tools/node/bin:$PATH"; cd "$ROOT"; setsid nohup node scripts/tools/r2-rclone-upload.mjs >>"$LOG" 2>&1 & echo started ;;
  stop) pkill -f r2-rclone-upload.mjs; pkill -f 'rclone copy' ; echo stopped ;;
  *) pgrep -af 'r2-rclone-upload|rclone copy' | cut -c1-100; tail -5 "$LOG" ;;
esac

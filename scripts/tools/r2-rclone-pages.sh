#!/bin/bash
# Uploads the pre-made school pages (scripts/tools/results-prerender.mjs --out $HOME/mb-prerender) to the R2 bucket under pages/.
# bash scripts/tools/r2-rclone-pages.sh run|status|stop   (run it on the host: flatpak-spawn --host ...)
D="$HOME/necta-work/logs"; mkdir -p "$D"; LOG="$D/r2-pages.log"
case "$1" in
  run) setsid nohup "$HOME/tools/rclone" copy "$HOME/mb-prerender/pages" r2:mayobe-results-data/pages --checksum --transfers 96 --checkers 64 --retries 5 --low-level-retries 20 --stats 60s --stats-one-line -v --s3-no-check-bucket >>"$LOG" 2>&1 & echo started ;;
  stop) pkill -f 'rclone copy .*mb-prerender' ; echo stopped ;;
  *) pgrep -af 'rclone copy' | cut -c1-90; tail -3 "$LOG" ;;
esac

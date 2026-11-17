#!/bin/bash
# Runs the whole results follow-up BY ITSELF, outside any Claude session and its usage limit:
#   1. results-retry-failed.mjs  (asks again for the centres that failed; 1 request per second per host)
#   2. results-refresh.mjs       (packs new or stale exams, PREM files where they qualify, datasets in site.config.json, then the build)
# Keeps going while you are away. Writes ~/necta-work/logs/refresh.log and ~/necta-work/logs/refresh.state. Reads NECTA pages (polite, resumable),
# writes results-data/ (git-ignored), site.config.json and the built pages. Never commits, pushes or uploads anything.
#   start (detached):  setsid nohup bash scripts/tools/results-refresh-detached.sh run > /dev/null 2>&1 &
#   look:              bash scripts/tools/results-refresh-detached.sh status
#   stop:              bash scripts/tools/results-refresh-detached.sh stop     (safe: the importer resumes where it stopped)
# From Claude Code (a Flatpak shell) start it on the host so it outlives the session:
#   flatpak-spawn --host bash -c 'cd "/run/media/mclean/New Volume/my-site" && setsid nohup bash scripts/tools/results-refresh-detached.sh run >/dev/null 2>&1 &'
export PATH="$HOME/tools/node/bin:$PATH"
SITE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOGDIR="$HOME/necta-work/logs"; LOG="$LOGDIR/refresh.log"; STATE="$LOGDIR/refresh.state"; PIDF="$LOGDIR/refresh.pid"
mkdir -p "$LOGDIR"
say() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
case "${1:-status}" in
  run)
    if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "already running (pid $(cat "$PIDF"))"; exit 0; fi
    echo $$ > "$PIDF"; trap 'rm -f "$PIDF"' EXIT
    cd "$SITE" || exit 1
    echo "state=retrying" > "$STATE"; say "== retry failed centres"
    node --no-warnings scripts/tools/results-retry-failed.mjs ${RETRY_ARGS:-} >> "$LOG" 2>&1; say "retry exit $?"
    echo "state=refreshing" > "$STATE"; say "== refresh (pack, PREM, datasets, build)"
    # the build draws link-preview pictures with ffmpeg; a shell without ffmpeg packs the data and leaves the build for one that has it
    nb=""; command -v ffmpeg >/dev/null 2>&1 || { nb="--no-build"; say "no ffmpeg in this shell: packing only, run node scripts/build.mjs afterwards"; }
    node --no-warnings scripts/tools/results-refresh.mjs $nb >> "$LOG" 2>&1; rc=$?; say "refresh exit $rc"
    echo "state=done exit=$rc finished=$(date '+%F %T')" > "$STATE"; say "== ALL DONE"
    ;;
  status) cat "$STATE" 2>/dev/null || echo "never run"; [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null && echo "running (pid $(cat "$PIDF"))"; tail -n 8 "$LOG" 2>/dev/null ;;
  stop) [ -f "$PIDF" ] && kill -- -"$(cat "$PIDF")" 2>/dev/null; pkill -P "$(cat "$PIDF" 2>/dev/null)" 2>/dev/null; rm -f "$PIDF"; echo stopped ;;
  *) echo "usage: $0 run|status|stop"; exit 2 ;;
esac

#!/bin/zsh
# Backfill watcher. launchd runs this on a short interval; it is deliberately
# cheap when there is nothing to do — one `gh api` read of the data repo, then
# exit. Claude is only started when a phone Capture has actually landed, so in
# practice this reacts to commits rather than polling on a schedule.
set -u

PROJECT="/Users/matthijshakfoort/CODE/reading-list-design"
LIST="$PROJECT/.claude/skills/reading-list/list.mjs"
LOG="$HOME/Library/Logs/reading-list-backfill.log"

# launchd hands us a near-empty environment; node and gh both need to be found.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S') $*" >>"$LOG" }

cd "$PROJECT" || { log "cannot cd to $PROJECT"; exit 1 }

missing=$(node "$LIST" missing --json 2>>"$LOG") || { log "missing: gh read failed"; exit 1 }

count=$(print -r -- "$missing" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d));
  process.stdin.on("end", () => {
    try { console.log(JSON.parse(s).length); } catch { console.log(0); }
  });
')

[[ "$count" -gt 0 ]] || exit 0

log "Backfilling $count Item(s)"
claude -p "/reading-list backfill" \
  --allowedTools "Bash(node .claude/skills/reading-list/list.mjs:*)" "WebFetch" \
  >>"$LOG" 2>&1
status=$?
log "Backfill finished (exit $status)"
exit $status

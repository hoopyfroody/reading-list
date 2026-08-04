#!/bin/zsh
# Daily proof-of-life for the Backfill watcher. Deliberately a separate agent:
# a broken notification must never be able to stop Backfill from running.
#
# Says something useful rather than just "still alive" — an "OK" that is
# printed unconditionally is not worth reading. If the watcher is unloaded or
# its last run failed, that is what the notification says.
set -u

LABEL="nl.hoopyfroody.reading-list-backfill"
LOG="$HOME/Library/Logs/reading-list-backfill.log"

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

notify() {
  osascript -e "display notification \"$2\" with title \"$1\"" >/dev/null 2>&1
}

state=$(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null)

if [[ -z "$state" ]]; then
  notify "Reading List ⚠️" "Backfill watcher is not loaded. Run: launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/$LABEL.plist"
  exit 0
fi

exit_code=$(print -r -- "$state" | awk -F'= ' '/last exit code/ {print $2; exit}')
runs=$(print -r -- "$state" | awk -F'= ' '/^\truns/ {print $2; exit}')

# How much work it actually did in the last day, straight from the log.
since=$(date -v-1d '+%Y-%m-%d %H:%M:%S')
backfills=0
if [[ -f "$LOG" ]]; then
  backfills=$(awk -v since="$since" '$0 >= since && /Backfilling/ {n++} END {print n+0}' "$LOG")
fi

if [[ "$exit_code" != "0" && "$exit_code" != "(never exited)" ]]; then
  notify "Reading List ⚠️" "Backfill watcher last run failed (exit $exit_code). Check ~/Library/Logs/reading-list-backfill.log"
  exit 0
fi

if [[ "$backfills" -gt 0 ]]; then
  notify "Reading List ✅" "Backfill watcher running — $backfills Backfill(s) in the last day, $runs checks total."
else
  notify "Reading List ✅" "Backfill watcher running — nothing to Backfill in the last day, $runs checks total."
fi

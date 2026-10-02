#!/usr/bin/env bash
# Phase 0: end a trial whose bus has had no new event for 10 minutes, in both
# arms alike. A trial can otherwise sit until its deadline behind a hold that
# nothing in the trial will release, such as a task blocked until tomorrow.
# Usage: idle-end.sh <trial root> <org name> <cli.js>
root=$1; name=$2; cli=$3
while sleep 30; do
  bus=$(ls -t "$root/.monomind/orgs/$name"/run-*/bus.jsonl 2>/dev/null | head -1)
  [ -n "$bus" ] || continue
  age=$(( $(date +%s) - $(stat -c %Y "$bus") ))
  if [ "$age" -ge 600 ]; then
    echo "{\"ts\":\"$(date -Is)\",\"idleSeconds\":$age}" > "$root/idle-ended.json"
    (cd "$root" && node "$cli" org stop "$name" >/dev/null 2>&1)
    exit 0
  fi
done

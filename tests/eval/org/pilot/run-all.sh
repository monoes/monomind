#!/usr/bin/env bash
# The document hand-off pilot (org sections spec 9.2): 2 scenarios x 3 paired trials x 2 arms = 12
# runs, one at a time, planning allocation $8 each ($96, a soft cap).
# Usage: pilot/run-all.sh <base dir> <cli.js>
#
# Each pair runs its two arms back to back, the order alternating by trial number. After every
# trial it runs the machine checks and stops without starting another if the trial was void (inputs
# or the real ~/.monomind touched) or the spend so far passes the allocation. A crash ends that
# attempt; nothing is resumed or quietly replaced.
set -uo pipefail
base=$1; cli=$2
here=$(cd "$(dirname "$0")" && pwd)
smoke="$here/../smoke"
repo=$(cd "$here/../../../.." && pwd)
allocation=${PILOT_ALLOCATION_USD:-96}
mkdir -p "$base"
log="$base/pilot-run-all.log"
say() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$log"; }
spent() { (cd "$repo" && npx tsx "$smoke/report.cli.ts" --json "$base"/trials/* 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).spendUsd)}catch{console.log(0)}})'); }
export SMOKE_RUN_CMD="cd '$repo' && npx tsx '$here/run-org.ts'"

for sc in growth-like dev-feature-qa; do
  [ -d "$base/inputs/$sc" ] || node "$smoke/prepare.mjs" inputs --scenario "$sc" --base "$base" >/dev/null || { say "inputs failed for $sc"; exit 3; }
  for n in 1 2 3; do
    if [ $((n % 2)) -eq 1 ]; then order=(baseline treatment); else order=(treatment baseline); fi
    for arm in "${order[@]}"; do
      root=$(cd "$repo" && npx tsx "$here/prepare.ts" "$sc" "$base" "$arm" "$n") || { say "prepare failed: $sc $arm $n"; exit 3; }
      say "START $sc $arm $n"
      bash "$smoke/run-trial.sh" "$root" "$cli" > "$root/run-trial.out" 2>&1
      node "$smoke/check.mjs" "$root" > "$root/check.out" 2>&1 || say "check failed for $sc $arm $n"
      say "END $sc $arm $n: $(cat "$root/result.json" 2>/dev/null)"
      if grep -q VOID "$root/result.json" 2>/dev/null; then say "STOP: a trial was void"; exit 4; fi
      total=$(spent)
      say "spend so far: \$$total of \$$allocation"
      if node -e "process.exit(Number('$total') > Number('$allocation') ? 0 : 1)"; then say "STOP: spend passed the allocation"; exit 5; fi
    done
  done
done
say "DONE"

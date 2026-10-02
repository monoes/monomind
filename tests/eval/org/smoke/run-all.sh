#!/usr/bin/env bash
# Run the whole smoke tier, one trial at a time: 5 scenarios x 2 contenders (spec section 10).
# Usage: run-all.sh <base dir> <cli.js> [scenario ...]   (default: all five)
#
# Contender order alternates by scenario, so neither contender always goes first. After each
# trial it runs the machine checks and stops the whole run, without starting another trial, if
# the trial was void (inputs or the real ~/.monomind touched) or the spend so far passes the
# allocation. The report and the blinded review are run afterwards, by hand.
set -uo pipefail
base=$1; cli=$2; shift 2
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../../.." && pwd)
scenarios=("$@"); [ ${#scenarios[@]} -gt 0 ] || scenarios=(research-report deliberative-design dev-feature-qa sparse-dispatch growth-like)
allocation=${SMOKE_ALLOCATION_USD:-80}
mkdir -p "$base"
log="$base/run-all.log"
say() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$log"; }

spent() { (cd "$repo" && npx tsx "$here/report.cli.ts" --json "$base"/trials/* 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).spendUsd)}catch{console.log(0)}})'); }

i=0
for sc in "${scenarios[@]}"; do
  [ -d "$base/inputs/$sc" ] || node "$here/prepare.mjs" inputs --scenario "$sc" --base "$base" >/dev/null || { say "inputs failed for $sc"; exit 3; }
  if [ $((i % 2)) -eq 0 ]; then order=(current-best phase2); else order=(phase2 current-best); fi
  for c in "${order[@]}"; do
    root=$(node "$here/prepare.mjs" trial --scenario "$sc" --base "$base" --contender "$c" --trial "${SMOKE_TRIAL:-s1}") || { say "prepare failed: $sc $c"; exit 3; }
    say "START $sc $c"
    bash "$here/run-trial.sh" "$root" "$cli" > "$root/run-trial.out" 2>&1
    node "$here/check.mjs" "$root" > "$root/check.out" 2>&1 || say "check failed for $sc $c"
    say "END $sc $c: $(cat "$root/result.json" 2>/dev/null)"
    if grep -q VOID "$root/result.json" 2>/dev/null; then say "STOP: a trial was void"; exit 4; fi
    total=$(spent)
    say "spend so far: \$$total of \$$allocation"
    if node -e "process.exit(Number('$total') > Number('$allocation') ? 0 : 1)"; then say "STOP: spend passed the allocation"; exit 5; fi
  done
  i=$((i + 1))
done
say "DONE"

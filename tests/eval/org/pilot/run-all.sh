#!/usr/bin/env bash
# The document hand-off pilot (org sections spec 9.2), one trial at a time. Each scenario's arms and
# per-run allocation come from its pilot manifest (<scenario>.pilot.json): baseline and treatment, and
# a single-agent arm where the manifest lists one. Round 1: growth-like and dev-feature-qa, 2 arms each,
# $8 a run. Round 2: growth-like alone with 3 arms at $12 a run (the manifest's declared changes).
# Usage: pilot/run-all.sh <base dir> <cli.js> [scenario ...]   (default: growth-like dev-feature-qa)
#
# The arms of a trial number run back to back, the order rotating with the trial number (a Latin square). After every
# trial it runs the machine checks and stops without starting another if the trial was void (inputs
# or the real ~/.monomind touched) or the spend so far passes the allocation. A crash ends that
# attempt; nothing is resumed or quietly replaced.
set -uo pipefail
base=$1; cli=$2
here=$(cd "$(dirname "$0")" && pwd)
smoke="$here/../smoke"
repo=$(cd "$here/../../../.." && pwd)
shift 2
scenarios=("$@"); [ ${#scenarios[@]} -gt 0 ] || scenarios=(growth-like dev-feature-qa)
arms_of() { node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(p.arms.map(a=>a.id).join(" "))' "$here/$1.pilot.json"; }
planned() { node -e 'let t=0;for(const sc of process.argv.slice(2)){const p=JSON.parse(require("fs").readFileSync(process.argv[1]+"/"+sc+".pilot.json","utf8"));t+=p.trials_per_arm*p.arms.length*p.per_run_allocation_usd}console.log(t)' "$here" "$@"; }
allocation=${PILOT_ALLOCATION_USD:-$(planned "${scenarios[@]}")}
mkdir -p "$base"
log="$base/pilot-run-all.log"
say() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$log"; }
spent() { (cd "$repo" && npx tsx "$smoke/report.cli.ts" --json "$base"/trials/* 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).spendUsd)}catch{console.log(0)}})'); }
export SMOKE_RUN_CMD="cd '$repo' && npx tsx '$here/run-org.ts'"

for sc in "${scenarios[@]}"; do
  [ -d "$base/inputs/$sc" ] || node "$smoke/prepare.mjs" inputs --scenario "$sc" --base "$base" >/dev/null || { say "inputs failed for $sc"; exit 3; }
  read -ra arms <<< "$(arms_of "$sc")"
  for n in 1 2 3; do
    k=$(( (n - 1) % ${#arms[@]} ))
    order=("${arms[@]:k}" "${arms[@]:0:k}")
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

#!/usr/bin/env bash
# Run one prepared Phase 0 trial (tests/eval/org/trials/prepare.mjs trial ...).
# Usage: run-trial.sh <trial root> <cli.js> [deadline seconds, default 5400]
#
# Production approvals are resolved by mono-agent's decision service, which
# polls only the registered production org; under its "full" autonomy the
# gated built-ins (Bash, WebFetch, WebSearch, org_complete) are approved by
# rule. A trial copy has no decision service, so the same four are approved
# for the run, identically in both arms. Outbound tools are recording stubs,
# so no approval here can reach anything external.
#
# Signs the trial definition, runs it in its own foreground daemon under a
# hard deadline, and checks that the production workspace and org memory are
# byte-identical before and after. A trial that changed them is void.
set -uo pipefail
root=$(cd "$1" && pwd)
cli=$2
deadline=${3:-5400}
name=$(basename "$root")
source=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).snapshot.source)' "$root/trial.json")
workspace=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).snapshot.workspace)' "$root/trial.json")

fingerprint() {
  (cd "$workspace" && find . -type f -print0 | sort -z | xargs -0 sha256sum)
  (cd "$source/.monomind/org-memory" && find . -type f -print0 | sort -z | xargs -0 sha256sum)
}

cd "$root"
fingerprint > production-before.sha256
node "$cli" org sign "$name" --yes > sign.log 2>&1 || { echo "sign failed (see $root/sign.log)"; exit 1; }
start=$(date +%s)
# No human answers during a trial: give every blocking question the same fixed
# reply in both arms (auto-answer.mjs), instead of an hour-long idle hold.
node "$(dirname "$0")/auto-answer.mjs" "$root" "$name" "$cli" &
answerer=$!
"$(dirname "$0")/idle-end.sh" "$root" "$name" "$cli" &
idler=$!
timeout --signal=TERM --kill-after=60 "$deadline" node "$cli" org run "$name" --yes --auto-approve Bash,WebFetch,WebSearch,org_complete > run.log 2>&1
status=$?
kill "$answerer" "$idler" 2>/dev/null
end=$(date +%s)
fingerprint > production-after.sha256
if cmp -s production-before.sha256 production-after.sha256; then integrity=clean; else integrity=VOID; fi
printf '{"name":"%s","exit":%d,"timedOut":%s,"seconds":%d,"production":"%s"}\n' \
  "$name" "$status" "$([ $status -eq 124 ] && echo true || echo false)" "$((end - start))" "$integrity" | tee result.json
[ "$integrity" = clean ]

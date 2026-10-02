#!/usr/bin/env bash
# Run one prepared smoke trial (smoke/prepare.mjs trial ...).
# Usage: run-trial.sh <trial root> <cli.js> [deadline seconds; default: the trial's own]
#
# Signs the trial's own definition, runs it in its own foreground daemon under a
# hard deadline with the scenario's task (and its driver, if it has one, beside
# it), answers blocking questions and gates with one fixed reply, ends a trial
# whose bus has been silent for 10 minutes, and checks that the immutable inputs
# are byte-identical afterwards, and that nothing reached the real ~/.monomind
# (its org, broker and operator directory listings unchanged, no file naming the
# trial). A trial that changed either is void.
set -uo pipefail
root=$(cd "$1" && pwd)
cli=$2
here=$(cd "$(dirname "$0")" && pwd)
field() { node -e 'const t=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=t[process.argv[2]];process.stdout.write(v==null?"":Array.isArray(v)?v.join("\n"):String(v))' "$root/trial.json" "$2"; }
name=$(field x name)
task=$(field x task)
driver=$(field x driver)
deadline=${3:-$(field x deadlineSeconds)}
deadline=${deadline:-3600}
mapfile -t guard < <(field x guard)

fingerprint() { for d in "${guard[@]}"; do (cd "$d" && find . -type f -print0 | sort -z | xargs -0 sha256sum); done; }

t0=$(date +%s)
cd "$root"
# The runtime's own state lives in the trial root (env.mjs); HOME stays real so the
# runners' logins (claude, codex, ...) keep working. The driver inherits these too.
while IFS= read -r kv; do export "$kv"; done < <(node "$here/env.mjs" prepare "$root")
node "$here/env.mjs" fingerprint > real-state-before.json
fingerprint > guard-before.sha256
node "$cli" org sign "$name" --yes > sign.log 2>&1 || { echo "sign failed (see $root/sign.log)"; exit 1; }
start=$(date +%s)
node "$here/../trials/auto-answer.mjs" "$root" "$name" "$cli" &
answerer=$!
"$here/../trials/idle-end.sh" "$root" "$name" "$cli" &
idler=$!
if [ -n "$driver" ]; then node "$driver" "$root" "$name" "$cli" > driver.log 2>&1 & drv=$!; fi
# SMOKE_RUN_CMD replaces `org run` with a harness's own in-process runner (the document hand-off
# pilot); it sees SMOKE_ROOT, SMOKE_ORG, SMOKE_TASK and SMOKE_CLI. Everything around it is the same.
export SMOKE_ROOT="$root" SMOKE_ORG="$name" SMOKE_TASK="$task" SMOKE_CLI="$cli"
if [ -n "${SMOKE_RUN_CMD:-}" ]; then
  timeout --signal=TERM --kill-after=60 "$deadline" bash -c "$SMOKE_RUN_CMD" > run.log 2>&1
else
  timeout --signal=TERM --kill-after=60 "$deadline" node "$cli" org run "$name" --yes ${task:+--task "$task"} --auto-approve Bash,WebFetch,WebSearch,org_complete > run.log 2>&1
fi
status=$?
kill "$answerer" "$idler" ${drv:-} 2>/dev/null
end=$(date +%s)
fingerprint > guard-after.sha256
node "$here/env.mjs" fingerprint > real-state-after.json
node "$here/env.mjs" leaks "$name" "$t0" > real-state-leaks.txt
if cmp -s guard-before.sha256 guard-after.sha256; then integrity=clean; else integrity=VOID; fi
if cmp -s real-state-before.json real-state-after.json && [ ! -s real-state-leaks.txt ]; then realstate=clean; else realstate=VOID; fi
printf '{"name":"%s","exit":%d,"timedOut":%s,"seconds":%d,"inputs":"%s","realState":"%s"}\n' \
  "$name" "$status" "$([ $status -eq 124 ] && echo true || echo false)" "$((end - start))" "$integrity" "$realstate" | tee result.json
[ "$integrity" = clean ] && [ "$realstate" = clean ]

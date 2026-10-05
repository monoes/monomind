#!/usr/bin/env bash
# Containment probe for one runtime CLI (sections isolation registry, group 1: codex,
# antigravity/agy, opencode, pi, pi-rpc, crush).
#
# usage: probe.sh NAME "STAGE ..." [ENV=VAL ...] -- cmd args...
#   STAGE is a path relative to the real HOME, or "path=dest" to link it at dest under the
#   temp HOME. Staged files are symlinks to the real file; nothing is copied.
#   ENV=VAL may use @H@ for the temp HOME; the command may use @H@ and @T@ (the temp tree).
#
# The CLI runs under bubblewrap: the whole filesystem read-only, the real HOME replaced by an
# empty overlay inside the temp tree (so a hard-coded write to the real home lands there and is
# listed, and the real home cannot change), /tmp and the temp tree writable. HOME and the XDG
# bases point into the temp tree; CODEX_*, CLAUDE_*, MISE_*, MONOMIND_*, PNPM_* and provider
# variables are unset unless passed on the command line. It prints every file created under
# the temp tree (staged symlinks excluded) and the head of the CLI's stdout and stderr.
set -u
export TMPDIR=/var/tmp
REAL=${REAL_HOME:-$HOME}
name=$1; shift
stage=$1; shift
extra=()
while [ "$1" != "--" ]; do extra+=("$1"); shift; done; shift
T=$(mktemp -d /var/tmp/probe-$name-XXXXXX)
H=$T/home; mkdir -p $H/.config $H/.local/share $H/.local/state $H/.cache $T/cwd $T/realhome-overlay $T/tmp
extra=("${extra[@]//@H@/$H}"); cmd=(); for a in "$@"; do cmd+=("${a//@H@/$H}"); done; cmd=("${cmd[@]//@T@/$T}")
binds=()
for s in $stage; do
  dst=${s#*=}; s=${s%%=*}
  mkdir -p "$(dirname "$H/$dst")"; ln -s "$REAL/$s" "$H/$dst"
  binds+=(--ro-bind "$REAL/$s" "$REAL/$s")
done
before_names=$(ls -A $REAL | md5sum)
before_top=$(ls -la --time-style=full-iso $REAL | md5sum)
touch $T/.marker; sleep 1
unsetargs=(); for v in $(env | grep -E '^(MISE_|CODEX_|CLAUDE_|MONOMIND_|PNPM_|XDG_|OPENROUTER|ANTHROPIC|OPENAI|GEMINI|AGY|OPENCODE|PI_|CRUSH|GROK|XAI|COPILOT|GH_|GITHUB)' | cut -d= -f1); do unsetargs+=(-u $v); done
echo "T=$T"
( cd $T/cwd && env "${unsetargs[@]}" HOME=$H XDG_CONFIG_HOME=$H/.config XDG_DATA_HOME=$H/.local/share XDG_STATE_HOME=$H/.local/state XDG_CACHE_HOME=$H/.cache "${extra[@]}" \
  bwrap --ro-bind / / --bind $T/realhome-overlay $REAL --ro-bind $REAL/.local/share/mise $REAL/.local/share/mise "${binds[@]}" --bind $T/tmp /tmp --bind $T $T --dev-bind /dev /dev --proc /proc --die-with-parent \
  timeout 240 "${cmd[@]}" ) > $T/stdout.txt 2> $T/stderr.txt
echo "exit=$?"
after_names=$(ls -A $REAL | md5sum)
after_top=$(ls -la --time-style=full-iso $REAL | md5sum)
echo "real home top-level names same: $([ "$before_names" = "$after_names" ] && echo yes || echo NO)  full listing same: $([ "$before_top" = "$after_top" ] && echo yes || echo NO-noise)"
echo "--- files created/changed under temp tree (staged symlinks excluded):"
(cd $T && find . -newer .marker \( -type f -o -type d \) ! -name .marker | grep -v '^./stdout.txt\|^./stderr.txt' | cut -d/ -f1-${DEPTH:-5} | sort | uniq -c | head -${LIMIT:-60})
echo "--- stdout (head):"; head -c 1200 $T/stdout.txt; echo; echo "--- stderr (head):"; head -c 1500 $T/stderr.txt

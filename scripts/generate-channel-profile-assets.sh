#!/bin/bash
# Generates the shared "monoes" monkey mascot avatar + one channel-appropriate
# banner per platform (each referencing the avatar so the character stays
# visually consistent), via monoagentcli's Gemini browser crawl.
set -uo pipefail

OUT="/Volumes/media/projects/monoes/monomind/.monomind/orgs/monomind-growth/workspace/reports/channel-profiles"
mkdir -p "$OUT"

log() { echo "[$(date '+%H:%M:%S')] $*" >&2; }

gen() {
  local name="$1" prompt="$2" ref="${3:-}"
  if [ -s "$OUT/$name.png" ]; then
    log "Skipping $name, already exists"
    echo "$OUT/$name.png"
    return 0
  fi
  local cfg
  if [ -n "$ref" ]; then
    cfg=$(printf '{"prompt":"%s","referenceImagePath":"%s","maxWaitSeconds":150,"downloadDir":"%s"}' "$prompt" "$ref" "$OUT")
  else
    cfg=$(printf '{"prompt":"%s","maxWaitSeconds":150,"downloadDir":"%s"}' "$prompt" "$OUT")
  fi
  log "Generating $name: $prompt"
  local out errfile
  errfile=$(mktemp)
  out=$(monoagentcli --profile monoes node run gemini.generate_image --headless --output json --config "$cfg" 2>"$errfile")
  if [ -s "$errfile" ]; then log "  (stderr: $(cat "$errfile"))"; fi
  rm -f "$errfile"
  local path
  path=$(echo "$out" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);const img=j.main?.[0]?.json?.images?.[0];console.log(img?img.path:'');}catch(e){console.log('');}})")
  if [ -z "$path" ]; then
    log "FAILED: $name — raw output: $out"
    echo "FAIL:$name" >> "$OUT/.gen-status"
    return 1
  fi
  local final="$OUT/$name.png"
  mv "$path" "$final"
  log "OK: $name -> $final"
  echo "OK:$name:$final" >> "$OUT/.gen-status"
  echo "$final"
}

# Reference is the REAL existing monomind logo (assets/logo.png) — a soft
# 3D-rendered meditating monkey with a glowing brain, blue "M" neckerchief,
# white background. Every banner below must keep that exact character,
# rendering style, and white/clean background — only the pose/prop changes.
AVATAR="$OUT/avatar-monoes.png"
if [ ! -s "$AVATAR" ]; then log "Avatar missing at $AVATAR, aborting"; exit 1; fi
log "Using real logo as reference: $AVATAR"

# Prompt template proven to preserve the character (tested live 2026-07-24):
# "same cute 3D cartoon monkey mascot with blue M neckerchief, <action>"
log "=== Banners (same character/render style as reference, no added text) ==="
gen "banner-x-twitter"  "same cute 3D cartoon monkey mascot with blue M neckerchief, sitting at laptop" "$AVATAR"
gen "banner-linkedin"   "same cute 3D cartoon monkey mascot with blue M neckerchief, wearing a tiny tie" "$AVATAR"
gen "banner-reddit"     "same cute 3D cartoon monkey mascot with blue M neckerchief, reading a book" "$AVATAR"
gen "banner-discord"    "same cute 3D cartoon monkey mascot with blue M neckerchief, wearing headphones" "$AVATAR"
gen "banner-bluesky"    "same cute 3D cartoon monkey mascot with blue M neckerchief, holding paper airplane" "$AVATAR"
gen "banner-mastodon"   "same cute 3D cartoon monkey mascot with blue M neckerchief, watering a small plant" "$AVATAR"
gen "banner-youtube"    "same cute 3D cartoon monkey mascot with blue M neckerchief, holding small camera" "$AVATAR"
gen "banner-devto"      "same cute 3D cartoon monkey mascot with blue M neckerchief, writing in notebook" "$AVATAR"
gen "banner-newsletter" "same cute 3D cartoon monkey mascot with blue M neckerchief, holding an envelope" "$AVATAR"

log "=== Done ==="
cat "$OUT/.gen-status" 2>/dev/null

#!/usr/bin/env bash
# Monomind statusline for Antigravity (agy)
#
# agy calls this script periodically and renders its stdout in the status bar
# at the bottom of the chat window. The script delegates to the local Node.js
# statusline helper which reads .monomind/ metrics and produces ANSI output.
#
# Environment variables agy may pass:
#   ANTIGRAVITY_PROJECT_DIR  — absolute path to the open project root
#   CLAUDE_PROJECT_DIR       — legacy alias (also accepted)

PROJECT_DIR="${ANTIGRAVITY_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"

STATUSLINE_CJS="${PROJECT_DIR}/.gemini/helpers/statusline.cjs"
if [ -f "${STATUSLINE_CJS}" ]; then
  node "${STATUSLINE_CJS}" 2>/dev/null
elif [ -f "${PROJECT_DIR}/.claude/helpers/statusline.cjs" ]; then
  node "${PROJECT_DIR}/.claude/helpers/statusline.cjs" 2>/dev/null
fi

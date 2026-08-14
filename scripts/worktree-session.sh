#!/usr/bin/env bash
set -euo pipefail

# Worktree Session Helper for AI Agents & Developers
# Usage:
#   ./scripts/worktree-session.sh start <session-name>
#   ./scripts/worktree-session.sh finish <session-name> [merge|keep|discard]
#   ./scripts/worktree-session.sh list

COMMAND="${1:-list}"
SESSION_NAME="${2:-}"

WORKTREE_ROOT=".worktrees"

case "$COMMAND" in
  start)
    if [ -z "$SESSION_NAME" ]; then
      echo "Error: session name required. e.g. ./scripts/worktree-session.sh start feat-auth" >&2
      exit 1
    fi
    BRANCH_NAME="worktree/${SESSION_NAME}"
    TARGET_DIR="${WORKTREE_ROOT}/${SESSION_NAME}"

    mkdir -p "$WORKTREE_ROOT"

    if [ -d "$TARGET_DIR" ]; then
      echo "Worktree directory already exists: $TARGET_DIR"
      exit 0
    fi

    echo "Creating worktree '$BRANCH_NAME' at '$TARGET_DIR' from HEAD..."
    git worktree add -b "$BRANCH_NAME" "$TARGET_DIR" HEAD
    echo "Worktree ready at: $TARGET_DIR"
    ;;

  finish)
    if [ -z "$SESSION_NAME" ]; then
      echo "Error: session name required. e.g. ./scripts/worktree-session.sh finish feat-auth" >&2
      exit 1
    fi
    ACTION="${3:-ask}"
    BRANCH_NAME="worktree/${SESSION_NAME}"
    TARGET_DIR="${WORKTREE_ROOT}/${SESSION_NAME}"

    if [ ! -d "$TARGET_DIR" ]; then
      echo "Error: Worktree '$TARGET_DIR' does not exist." >&2
      exit 1
    fi

    if [ "$ACTION" = "ask" ]; then
      echo "Session '$SESSION_NAME' finished in worktree '$TARGET_DIR'."
      echo "Select an action:"
      echo "  1) merge   - Commit worktree changes, merge into current branch, remove worktree"
      echo "  2) keep    - Keep worktree branch, remove worktree directory"
      echo "  3) discard - Discard changes and remove worktree + branch"
      read -rp "Choice (1/2/3): " CHOICE
      case "$CHOICE" in
        1|merge) ACTION="merge" ;;
        2|keep) ACTION="keep" ;;
        3|discard) ACTION="discard" ;;
        *) echo "Aborted."; exit 1 ;;
      esac
    fi

    case "$ACTION" in
      merge)
        CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
        echo "Merging '$BRANCH_NAME' into '$CURRENT_BRANCH'..."
        git merge "$BRANCH_NAME"
        echo "Removing worktree '$TARGET_DIR'..."
        git worktree remove "$TARGET_DIR" --force
        git branch -d "$BRANCH_NAME" || true
        echo "Successfully merged and cleaned up."
        ;;
      keep)
        echo "Removing worktree directory '$TARGET_DIR' while keeping branch '$BRANCH_NAME'..."
        git worktree remove "$TARGET_DIR" --force
        echo "Branch '$BRANCH_NAME' kept for review/PR."
        ;;
      discard)
        echo "Discarding worktree '$TARGET_DIR' and branch '$BRANCH_NAME'..."
        git worktree remove "$TARGET_DIR" --force
        git branch -D "$BRANCH_NAME" || true
        echo "Worktree and branch discarded."
        ;;
      *)
        echo "Unknown action: $ACTION" >&2
        exit 1
        ;;
    esac
    ;;

  list)
    git worktree list
    ;;

  *)
    echo "Usage: $0 {start <session-name>|finish <session-name> [merge|keep|discard]|list}"
    exit 1
    ;;
esac

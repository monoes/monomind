# Universal Agent Instructions & Rules

> This file defines project-wide behavioral guidelines and protocols for all AI coding agents (**Claude Code**, **Codex**, **Antigravity / agy**, **OpenCode**, and other agent systems).

---

## 🌲 Default Git Worktree Isolation & Commit Policy

### 1. Default Worktree Isolation
- **Mandatory Default:** Unless the user explicitly states to make changes directly on the active branch (e.g. *"work directly on branch"*, *"apply directly to main"*, *"direct mode"*, *"no worktree"*), **ALL coding sessions, refactors, and feature implementations MUST operate in a dedicated git worktree**.
- **Setup & Execution:**
  - Create an isolated worktree branch under `.worktrees/<task-slug>`:
    ```bash
    git worktree add -b worktree/<task-slug> .worktrees/<task-slug> HEAD
    ```
  - Perform all edits, linting, and test runs within the worktree directory.
  - Never write directly to the primary working tree when worktree isolation is active.

### 2. End-of-Session Resolution & Commit Prompt
- Upon finishing the task and verifying all tests pass:
  - **Do NOT silently commit or merge into the base branch.**
  - Provide a clear summary of all modified files and testing status.
  - **Explicitly prompt the user** to choose how to handle the worktree changes:
    1. **Commit & Merge**: Commit changes, merge the worktree branch into the base branch, and delete the worktree.
    2. **Commit & Keep Branch**: Commit changes to the worktree branch and retain it for PR / manual review.
    3. **Discard**: Remove the worktree and discard all uncommitted / temporary changes.
  - Wait for user confirmation before executing any merge or deletion.

---

## 🛠️ Project Guidelines

- **Language & Runtime:** TypeScript / Node.js
- **Package Manager:** `pnpm`
- **Testing:** `pnpm test` (Vitest)
- **Type Checking & Linting:** `pnpm typecheck` / `pnpm lint`
- **Surgical Edits:** Keep changes concise, focused on the task, and preserve existing style and conventions.

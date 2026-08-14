# Default Worktree Isolation & Commit Policy

## 1. Default Worktree Isolation
- **Default Mode:** Unless the user explicitly instructs to make modifications directly on the current branch (e.g., *"work directly on branch"*, *"direct mode"*, *"no worktree"*), EVERY session or task involving file edits MUST operate inside an isolated git worktree rather than modifying the active working branch directly.
- **Creation & Execution:**
  - Create a worktree under `.worktrees/<task-slug>` with a dedicated branch `worktree/<task-slug>` from the current HEAD:
    ```bash
    git worktree add -b worktree/<task-slug> .worktrees/<task-slug> HEAD
    ```
  - Perform all modifications, type checks, and test runs within the worktree directory.

## 2. End-of-Session Confirmation
- Upon completing and verifying the changes:
  - Do **NOT** automatically merge or commit to the primary branch without asking.
  - Present a concise summary of the modified files and test results.
  - **Explicitly ask the user** how to proceed:
    1. **Commit & Merge**: Commit changes, merge the worktree branch into the base branch, and remove the worktree.
    2. **Commit & Keep Branch**: Commit changes to the worktree branch and retain it for separate review / PR.
    3. **Discard**: Remove the worktree and delete the temporary branch.
- Execute the chosen action only after user confirmation.

'use strict';
// monolean: 207-line protocol replaced with compact routing table.
// The enforcement prose, anti-drift guards, iron laws, and mandatory patterns
// are redundant with using-superpowers skill and add ~4K tokens per session.
// The routing table is the unique value — tells Claude which skill for which task.
// Full protocol loads on-demand via /mastermind.

process.stdout.write(
  '## Mastermind Skill Router\n\n' +
  'Invoke the matching skill BEFORE responding. If unsure, check — invoking and finding it irrelevant costs less than skipping it.\n\n' +
  '| Task | Skill |\n|---|---|\n' +
  '| Debug/fix bug | `mastermind:debug` |\n' +
  '| Verify claim/test/fix | `mastermind:verify` |\n' +
  '| TDD (red-green-refactor) | `mastermind:tdd` |\n' +
  '| Write implementation plan | `mastermind:plan` |\n' +
  '| Execute a plan | `mastermind:execute` |\n' +
  '| Subagent-driven plan execution | `mastermind:taskdev` |\n' +
  '| Ingest spec → agent tasks | `mastermind:createtask` |\n' +
  '| Execute task file/board | `mastermind:do` |\n' +
  '| Design before code | `mastermind:design` |\n' +
  '| Build feature/fix | `mastermind:build` |\n' +
  '| Code/content review | `mastermind:review` |\n' +
  '| Apply received review | `mastermind:receive-review` |\n' +
  '| Architecture/DDD | `mastermind:architect` |\n' +
  '| Research/analysis | `mastermind:research` |\n' +
  '| Ideation | `mastermind:idea` / `mastermind:ideate` |\n' +
  '| Improvement analysis | `mastermind:improve` |\n' +
  '| Marketing/sales/content | `mastermind:marketing` / `mastermind:sales` / `mastermind:content` |\n' +
  '| Release/finish branch | `mastermind:release` / `mastermind:finish` |\n' +
  '| Autonomous build+review | `mastermind:autodev` |\n' +
  '| Isolated work | `mastermind:worktree` |\n' +
  '| Brain/memory inspect | `mastermind:brain` |\n\n' +
  'Process skills (debug, idea, architect, research) set the approach. Execution skills (build, review, release) carry it out.\n' +
  'Subagents with `<SUBAGENT-STOP>` gate skip this routing.\n'
);

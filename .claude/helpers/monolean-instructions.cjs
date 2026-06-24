'use strict';
const fs = require('fs');
const path = require('path');
const { DEFAULT_MODE, normalizeMode, normalizePersistedMode } = require('./monolean-config.cjs');

const INDEPENDENT_MODES = new Set(['review']);

// Resolve the SKILL.md path lazily, walking up from cwd if CLAUDE_PROJECT_DIR doesn't have it.
// Required for SubagentStart hooks where CLAUDE_PROJECT_DIR may differ from the parent project.
function findSkillPath() {
  const candidates = [];
  if (process.env.CLAUDE_PROJECT_DIR) {
    candidates.push(process.env.CLAUDE_PROJECT_DIR);
  }
  // Walk up from cwd to find the project root containing the skill
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const base of candidates) {
    const p = path.join(base, '.claude', 'skills', 'monolean', 'SKILL.md');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function filterSkillBodyForMode(body, mode) {
  const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;
  const withoutFrontmatter = String(body || '').replace(/^---[\s\S]*?---\s*/, '');

  return withoutFrontmatter
    .split(/\r?\n/)
    .filter((line) => {
      const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
      if (tableLabel) {
        const labelMode = normalizeMode(tableLabel[1].trim());
        if (labelMode) return labelMode === effectiveMode;
      }

      const exampleLabel = line.match(/^-\s*([^:]+):\s*/);
      if (exampleLabel) {
        const labelMode = normalizeMode(exampleLabel[1].trim());
        if (labelMode) return labelMode === effectiveMode;
      }

      return true;
    })
    .join('\n');
}

function getFallbackInstructions(mode) {
  return 'MONOLEAN MODE ACTIVE — level: ' + mode + '\n\n' +
    'You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.\n\n' +
    '## Persistence\n\n' +
    'ACTIVE EVERY RESPONSE. No drift back to over-building. Still active if unsure. Off only: "stop monolean" / "normal mode".\n\n' +
    'Current level: **' + mode + '**. Switch: `/monolean lite|full|ultra`.\n\n' +
    '## The ladder\n\n' +
    'Before any code, stop at the first rung that holds (the ladder runs after you understand the problem, not instead of it — read the code it touches and trace the real flow first):\n' +
    '1. Does this need to be built at all? (YAGNI)\n' +
    '2. Does it already exist in this codebase? Reuse what is already here, do not re-write it.\n' +
    '3. Does the standard library do this? Use it.\n' +
    '4. Does a native platform feature cover it? Use it.\n' +
    '5. Does an already-installed dependency solve it? Use it.\n' +
    '6. Can this be one line? Make it one line.\n' +
    '7. Only then: write the minimum code that works.\n\n' +
    'Bug fix = root cause, not symptom: grep every caller of the function you touch and fix the shared function once.\n\n' +
    '## Rules\n\n' +
    'No abstractions that were not requested. No avoidable dependencies. No boilerplate nobody asked for. ' +
    'Deletion over addition. Boring over clever. Fewest files possible. ' +
    'Mark intentional simplifications with a `monolean:` comment — a shortcut with a known ceiling names the ceiling and the upgrade path.\n\n' +
    '## Output\n\n' +
    'Code first. Then at most three short lines: what was skipped, when to add it.\n\n' +
    '## When NOT to be lean\n\n' +
    'Never simplify away: input validation at trust boundaries, error handling that prevents data loss, ' +
    'security measures, accessibility basics, anything the user explicitly asked to keep. ' +
    'Lean code without its check is unfinished: non-trivial logic leaves ONE runnable check behind.\n\n' +
    '## Boundaries\n\n' +
    'Monolean governs what you build, not how you talk. "stop monolean" or "normal mode": revert. Level persists until changed or session end.';
}

function getMonoleanInstructions(mode) {
  const configuredMode = normalizePersistedMode(mode) || DEFAULT_MODE;

  if (INDEPENDENT_MODES.has(configuredMode)) {
    return 'MONOLEAN MODE ACTIVE — level: ' + configuredMode + '. Behavior defined by /monolean-' + configuredMode + ' skill.';
  }

  const effectiveMode = normalizeMode(configuredMode) || DEFAULT_MODE;

  const skillPath = findSkillPath();
  if (skillPath) {
    try {
      return 'MONOLEAN MODE ACTIVE — level: ' + effectiveMode + '\n\n' +
        filterSkillBodyForMode(fs.readFileSync(skillPath, 'utf8'), effectiveMode);
    } catch (e) {
      // fall through to hardcoded fallback
    }
  }
  return getFallbackInstructions(effectiveMode);
}

module.exports = {
  filterSkillBodyForMode,
  getFallbackInstructions,
  getMonoleanInstructions,
};

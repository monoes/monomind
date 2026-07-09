'use strict';
const { getDefaultMode, setMode, clearMode } = require('./monolean-config.cjs');
const fs = require('fs');
const path = require('path');

const mode = getDefaultMode();
if (!mode || mode === 'off') { clearMode(); process.exit(0); }

setMode(mode);

// Write mode for statusline
const metricsDir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.monomind/metrics');
try {
  fs.mkdirSync(metricsDir, { recursive: true });
  fs.writeFileSync(path.join(metricsDir, 'monolean-mode.json'), JSON.stringify({ mode, ts: Date.now() }));
} catch {}

// monolean: compact session-start directive. The full SKILL.md loads on-demand
// via /monolean — session context just needs the core rules.
process.stdout.write(
  'MONOLEAN MODE ACTIVE — level: ' + mode + '\n\n' +
  'Lazy senior dev mode. Lazy = efficient. Best code = code never written.\n' +
  'The ladder (stop at first rung that holds): ' +
  '1) YAGNI 2) Already in codebase? Reuse 3) Stdlib 4) Native platform 5) Installed dep 6) One line 7) Minimum code.\n' +
  'Read the code first, trace the real flow, THEN climb the ladder.\n' +
  'Bug fix = root cause fix. No unrequested abstractions. Deletion > addition. Fewest files. Code first, 3 lines max explanation.\n' +
  'Never lean away: trust-boundary validation, data-loss prevention, security, accessibility, explicit user requests.\n' +
  'Mark deliberate simplifications: `// monolean: [ceiling] — [upgrade path]`\n' +
  'Off: "stop monolean". Switch: `/monolean lite|full|ultra`.\n'
);

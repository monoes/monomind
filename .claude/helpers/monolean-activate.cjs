'use strict';
const { getDefaultMode, setMode, clearMode } = require('./monolean-config.cjs');
const { getMonoleanInstructions } = require('./monolean-instructions.cjs');
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

const instructions = getMonoleanInstructions(mode);
process.stdout.write(instructions);

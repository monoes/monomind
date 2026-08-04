'use strict';
const { VALID_MODES, setMode, clearMode, isDeactivationCommand } = require('./monolean-config.cjs');

let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  try {
    const parsed = JSON.parse(data);
    const prompt = String(parsed.prompt || '');
    if (isDeactivationCommand(prompt)) { clearMode(); process.exit(0); }
    const m = prompt.match(/^[/@$]monolean\s*(\w+)?/i);
    if (!m) process.exit(0);
    const requested = (m[1] || 'full').toLowerCase();
    if (!VALID_MODES.includes(requested)) process.exit(0);
    if (requested === 'off') clearMode();
    else setMode(requested);
  } catch { /* ignore parse errors */ }
});

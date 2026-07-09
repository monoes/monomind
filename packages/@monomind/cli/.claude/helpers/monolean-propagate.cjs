'use strict';
const { readMode } = require('./monolean-config.cjs');

const mode = readMode();
if (!mode || mode === 'off') process.exit(0);

// monolean: full manifesto replaced with compact directive. Subagents get a
// focused task — they don't need 100 lines of philosophy to write lean code.
process.stdout.write(
  'MONOLEAN MODE ACTIVE — level: ' + mode + '. ' +
  'Write the minimum code that works. Stdlib over deps. Delete over add. ' +
  'No unrequested abstractions, no scaffolding, no boilerplate.\n'
);

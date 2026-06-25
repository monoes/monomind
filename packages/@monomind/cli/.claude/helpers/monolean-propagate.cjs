'use strict';
const { readMode } = require('./monolean-config.cjs');
const { getMonoleanInstructions } = require('./monolean-instructions.cjs');

const mode = readMode();
if (!mode || mode === 'off') process.exit(0);

const instructions = getMonoleanInstructions(mode);
process.stdout.write(instructions);

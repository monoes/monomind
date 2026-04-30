'use strict';
// Runs at SessionStart — rebuilds the knowledge graph using @monomind/monograph in the background.
// Fire-and-forget: spawns detached child, logs start, exits immediately without blocking session.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const graphDir = path.join(projectDir, '.monomind', 'graph');
fs.mkdirSync(graphDir, { recursive: true });

const logPath = path.join(graphDir, 'build.log');
let logFd;
try { logFd = fs.openSync(logPath, 'a'); } catch { logFd = 'ignore'; }

// Spawn a detached node process to run buildAsync from @monomind/monograph (ESM)
const script = `import { buildAsync } from '@monomind/monograph'; await buildAsync(${JSON.stringify(projectDir)});`;
const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
  detached: true,
  stdio: ['ignore', logFd, logFd],
  cwd: projectDir,
});
child.unref();

console.log('[graph] background build started for ' + projectDir);

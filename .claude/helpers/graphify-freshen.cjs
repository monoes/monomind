'use strict';
// Runs at SessionStart — rebuilds the knowledge graph using graphify (Python) in the background.
// Fire-and-forget: spawns detached child, logs start, exits immediately without blocking session.
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const graphDir = path.join(projectDir, '.monomind', 'graph');

// Check if graphify CLI is available
try {
  execSync('graphify --help', { encoding: 'utf-8', stdio: 'ignore' });
} catch {
  console.log('[graph] skip: graphify not installed (run: uv tool install graphifyy)');
  process.exit(0);
}

fs.mkdirSync(graphDir, { recursive: true });

const logPath = path.join(graphDir, 'build.log');
let logFd;
try { logFd = fs.openSync(logPath, 'a'); } catch { logFd = 'ignore'; }

// graphify update <path> — re-extracts code files and rebuilds graph.json
const child = spawn('graphify', ['update', projectDir], {
  detached: true,
  stdio: ['ignore', logFd, logFd],
  cwd: projectDir,
});
child.unref();

console.log('[graph] background build started for ' + projectDir);

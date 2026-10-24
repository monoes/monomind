#!/usr/bin/env node
'use strict';
// SessionStart: title the Claude session with the name it has on the Monomind mesh,
// <project>-<YYYYMMDD>-<HHMMSS>, as /rename would. The MCP server claims the same name
// (<mesh dir>/sessions/<pid>.name under this process's parent and grandparent pid); whichever
// of the two runs first writes it, the other adopts it. Skips a session that already has a
// custom title. Silent on any failure.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = process.env.MONOMIND_MESH_DIR || path.join(os.homedir(), '.monomind', 'mesh');
const NAME = /^[A-Za-z0-9._-]{1,64}$/;

function parentOf(pid) {
  try {
    const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) || 0;
  } catch (_) {
    try {
      return Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', timeout: 500 }).trim()) || 0;
    } catch (__) { return 0; }
  }
}

function defaultName(projectPath) {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  const name = path.basename(projectPath).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 45) || 'project';
  return name + '-' + stamp;
}

function claim(pids, make) {
  const sessions = path.join(dir, 'sessions');
  const read = () => {
    for (const pid of pids) {
      try {
        const n = fs.readFileSync(path.join(sessions, pid + '.name'), 'utf8').trim();
        if (NAME.test(n)) return n;
      } catch (_) { /* none for this pid */ }
    }
    return null;
  };
  const existing = read();
  if (existing) return existing;
  const name = make();
  try {
    fs.mkdirSync(sessions, { recursive: true, mode: 0o700 });
    for (const pid of pids) {
      try { fs.writeFileSync(path.join(sessions, pid + '.name'), name, { flag: 'wx', mode: 0o600 }); } catch (_) { /* taken */ }
    }
  } catch (_) { /* the title is a convenience */ }
  return read() || name;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try {
    const input = raw.trim() ? JSON.parse(raw) : {};
    if (input.session_title) return; // the user already named this session
    const parent = process.ppid;
    const project = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const title = claim([parent, parentOf(parent)].filter((p) => p > 1), () => defaultName(project));
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', sessionTitle: title } }));
  } catch (_) { /* never block a session start */ }
});
setTimeout(() => process.exit(0), 2500).unref();

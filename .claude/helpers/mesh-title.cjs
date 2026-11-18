#!/usr/bin/env node
'use strict';
// SessionStart: title the Claude session with the name it has on the Monomind mesh,
// <project>-<YYYYMMDD>-<HHMMSS>, as /rename would. The MCP server claims the same name
// (<mesh dir>/sessions/<pid>.name under the pid of the agent host both run under); whichever of the
// two runs first writes it, the other adopts it. Skips a session that already has a custom title.
// Silent on any failure.

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
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

// Mirror of WRAPPER / sessionHostPid() in mesh/session-files.ts: skip `sh -c` and npx wrappers on
// the way up to the host. Never the host's own parent: that is a terminal shell or an IDE that
// outlives the session, and a name under it was handed to every later session started there.
const WRAPPER = /^(?:\S*\/)?(?:sh|bash|dash|zsh|ksh|fish)(?:\s+-[a-zA-Z]+)*?\s+-[a-zA-Z]*c[a-zA-Z]*(?:\s|$)|^npm exec\b|^(?:\S*\/)?(?:npx|pnpx|bunx)(?:\s|$)|\bnpx-cli\.js(?:\s|$)|\bnpm-cli\.js\s+(?:exec|x)(?:\s|$)|^(?:\S*\/)?pnpm\s+dlx(?:\s|$)/;

function commandOf(pid) {
  try {
    return fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').replace(/\0/g, ' ');
  } catch (_) {
    try {
      return execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8', timeout: 500 });
    } catch (__) { return ''; }
  }
}

function hostPid(from) {
  let pid = from;
  for (let i = 0; pid > 1 && i < 4; i++) {
    if (!WRAPPER.test(commandOf(pid).trim())) return pid;
    pid = parentOf(pid);
  }
  return from;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Files of sessions that died without saying goodbye, so a reused pid does not inherit a name.
function sweepDead() {
  const sessions = path.join(dir, 'sessions');
  try {
    for (const f of fs.readdirSync(sessions)) {
      const pid = Number(f.replace(/\.(json|shown|name)$/, ''));
      if (Number.isInteger(pid) && pid > 1 && !alive(pid)) {
        try { fs.unlinkSync(path.join(sessions, f)); } catch (_) { /* gone already */ }
      }
    }
  } catch (_) { /* no sessions dir yet */ }
}

function defaultName(projectPath) {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  const name = path.basename(projectPath).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 45) || 'project';
  return name + '-' + stamp;
}

// Mirror of projectIdFor() in mesh/project-id.ts: <basename>-<16 hex of sha256(realpath)>.
function projectId(projectPath) {
  let real = projectPath;
  try { real = fs.realpathSync(projectPath); } catch (_) { /* keep the given path */ }
  const name = path.basename(real).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64) || 'project';
  return name + '-' + crypto.createHash('sha256').update(real).digest('hex').slice(0, 16);
}

// Aliases already live in this project, so the title is never a name the MCP join would have to
// suffix. Best effort: no hub, or a slow one, means no names are known.
function takenAliases(projectPath, done) {
  const names = new Set();
  let finished = false;
  let sock;
  const finish = () => { if (!finished) { finished = true; if (sock) sock.destroy(); done(names); } };
  try {
    sock = net.connect(path.join(dir, 'hub.sock'));
  } catch (_) { return finish(); }
  let buf = '';
  sock.setTimeout(500, finish);
  sock.on('error', finish);
  sock.on('data', (c) => {
    buf += c;
    const nl = buf.indexOf('\n');
    if (nl < 0) return;
    try {
      const r = JSON.parse(buf.slice(0, nl));
      if (r && r.ok && Array.isArray(r.agents)) r.agents.forEach((a) => { if (a.alias) names.add(a.alias); });
    } catch (_) { /* unreadable reply: no names */ }
    finish();
  });
  sock.on('connect', () => {
    sock.write(JSON.stringify({ op: 'who', id: 'title-' + Date.now(), project: projectId(projectPath) }) + '\n');
  });
}

function freeName(base, taken) {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : base + '-' + n;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
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
    if (input.session_title) process.exit(0); // the user already named this session
    const host = hostPid(process.ppid);
    const project = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    takenAliases(project, (taken) => {
      try {
        sweepDead();
        const title = claim([host].filter((p) => p > 1), () => freeName(defaultName(project), taken));
        console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', sessionTitle: title } }));
      } catch (_) { /* never block a session start */ }
      process.exit(0);
    });
  } catch (_) { process.exit(0); }
});
setTimeout(() => process.exit(0), 2500).unref();

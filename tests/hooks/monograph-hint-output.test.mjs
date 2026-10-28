/**
 * #409: [MONOGRAPH_HINT]s from the PreToolUse pre-search / pre-bash hooks
 * must reach the model. Claude Code only feeds PreToolUse stdout to the model
 * when it is a JSON object carrying hookSpecificOutput.additionalContext, so
 * plain console.log hints were invisible — yet they were credited as
 * "$ saved" in the status line. These tests pin the JSON contract, the
 * one-time graph nudge (#413), and the removal of the synthetic "$".
 */

import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const HELPERS = path.resolve(__dirname, '../../.claude/helpers');
const HANDLER = path.join(HELPERS, 'hook-handler.cjs');
const STATUSLINE = path.join(HELPERS, 'statusline.cjs');

let tmp;

function git(...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd: tmp,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

// A fresh graph (index_meta = HEAD) holding one symbol, plus a stub
// @monoes/monograph whose openDb() is node:sqlite — enough for the hooks.
function freshGraphProject() {
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'c0');
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.join(tmp, '.monomind'), { recursive: true });
  const db = new DatabaseSync(path.join(tmp, '.monomind', 'monograph.db'));
  db.exec('CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT)');
  db.exec(
    'CREATE TABLE nodes (id TEXT, name TEXT, label TEXT, file_path TEXT, start_line INTEGER)',
  );
  db.prepare("INSERT INTO index_meta VALUES ('last_commit_hash', ?)").run(git('rev-parse', 'HEAD'));
  db.prepare(
    "INSERT INTO nodes VALUES ('1', 'computeWidgetScore', 'Function', 'src/widget.ts', 42)",
  ).run();
  db.close();
  const pkg = path.join(tmp, 'node_modules', '@monoes', 'monograph');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: '@monoes/monograph', version: '0.0.0', main: 'index.cjs' }),
  );
  fs.writeFileSync(
    path.join(pkg, 'index.cjs'),
    "const { DatabaseSync } = require('node:sqlite');\n" +
      'exports.openDb = (p) => new DatabaseSync(p, { readOnly: true });\n',
  );
}

function runHook(command, input) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: tmp };
  delete env.MONOMIND_HOOK_QUIET;
  delete env.MONOMIND_SDK_AGENT;
  delete env.MONOMIND_GRAPH_GATE;
  return spawnSync(process.execPath, [HANDLER, command], {
    cwd: tmp,
    env,
    input: JSON.stringify(input),
    encoding: 'utf-8',
    timeout: 15000,
  });
}

function usage() {
  return JSON.parse(
    fs.readFileSync(path.join(tmp, '.monomind', 'metrics', 'graph-usage.json'), 'utf-8'),
  );
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hint-out-')));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('pre-search / pre-bash hints reach the model (#409)', () => {
  it('pre-search emits one PreToolUse JSON document carrying the hint as additionalContext', () => {
    freshGraphProject();
    const r = runHook('pre-search', {
      tool_name: 'Grep',
      tool_input: { pattern: 'computeWidgetScore' },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.additionalContext).toContain(
      '[MONOGRAPH_HINT] computeWidgetScore found at src/widget.ts:42',
    );
  });

  it('pre-bash grep emits the hint as PreToolUse JSON too', () => {
    freshGraphProject();
    const r = runHook('pre-bash', {
      tool_name: 'Bash',
      tool_input: { command: 'grep -rn "computeWidgetScore" src' },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.additionalContext).toContain(
      '[MONOGRAPH_HINT] computeWidgetScore',
    );
  });

  it('folds the one-time graph nudge into the same JSON document as the hint', () => {
    freshGraphProject();
    const r = runHook('pre-search', {
      session_id: 's1',
      tool_name: 'Grep',
      tool_input: { pattern: 'computeWidgetScore' },
    });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('"decision"');
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toContain('[MONOGRAPH_REMINDER]');
    expect(ctx).toContain('[MONOGRAPH_HINT] computeWidgetScore');
  });

  it('keeps the destructive-ops block on stderr with exit 2 and a clean stdout', () => {
    freshGraphProject();
    const r = runHook('pre-bash', { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });

  it('prints nothing on stdout when there is no hint', () => {
    freshGraphProject();
    const r = runHook('pre-search', {
      tool_name: 'Grep',
      tool_input: { pattern: 'noSuchSymbolAnywhere' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('does not credit synthetic saved tokens/$ for a hint', () => {
    freshGraphProject();
    runHook('pre-search', { tool_name: 'Grep', tool_input: { pattern: 'computeWidgetScore' } });
    const d = usage();
    expect(d.graph_assist_search).toBe(1);
    expect(d.tokens_saved).toBeUndefined();
    expect(d.dollars_saved).toBeUndefined();
  });
});

// #413: the graph gate used to hard-block the first grep/search of a session
// until a monograph tool was called. It is now a one-time, non-blocking nudge.
describe('graph gate is a one-time nudge, never a block (#413)', () => {
  const grep = (session_id, command) =>
    runHook('pre-bash', { session_id, tool_name: 'Bash', tool_input: { command } });
  const nudgeOf = (r) =>
    r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';

  it('first grep with a fresh graph passes (exit 0) and carries the nudge', () => {
    freshGraphProject();
    const r = grep('n1', 'grep -rn "noSuchSymbolAnywhere" src');
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('"decision"');
    const ctx = nudgeOf(r);
    expect(ctx).toContain('[MONOGRAPH_REMINDER]');
    expect(ctx).toContain('monograph_query');
    expect(ctx).not.toMatch(/block/i);
  });

  it('shows the nudge only once per session', () => {
    freshGraphProject();
    expect(nudgeOf(grep('n2', 'grep -rn "noSuchSymbolAnywhere" src'))).toContain(
      '[MONOGRAPH_REMINDER]',
    );
    const second = grep('n2', 'grep -rn "anotherMissingSymbol" src');
    expect(second.status).toBe(0);
    expect(second.stdout).toBe('');
    const search = runHook('pre-search', {
      session_id: 'n2',
      tool_name: 'Grep',
      tool_input: { pattern: 'anotherMissingSymbol' },
    });
    expect(search.status).toBe(0);
    expect(search.stdout).toBe('');
  });

  it('never nudges a piped grep, and a piped grep does not use up the nudge', () => {
    freshGraphProject();
    const piped = grep('n3', 'git log --oneline | grep "noSuchSymbolAnywhere"');
    expect(piped.status).toBe(0);
    expect(piped.stdout).toBe('');
    expect(nudgeOf(grep('n3', 'grep -rn "noSuchSymbolAnywhere" src'))).toContain(
      '[MONOGRAPH_REMINDER]',
    );
  });

  it('never nudges a search over non-source paths', () => {
    freshGraphProject();
    for (const cmd of [
      'grep -rn "noSuchSymbolAnywhere" node_modules/foo',
      'grep -n "noSuchSymbolAnywhere" server.log',
      'grep -rn "noSuchSymbolAnywhere" /var/log',
      'rg "noSuchSymbolAnywhere" --glob=*.md',
      'find ~/Downloads -name "noSuchSymbolAnywhere"',
    ]) {
      const r = grep('n4', cmd);
      expect(r.status, cmd).toBe(0);
      expect(r.stdout, cmd).toBe('');
    }
    const search = runHook('pre-search', {
      session_id: 'n4',
      tool_name: 'Grep',
      tool_input: { pattern: 'noSuchSymbolAnywhere', path: 'node_modules/foo' },
    });
    expect(search.stdout).toBe('');
    expect(nudgeOf(grep('n4', 'grep -rn "noSuchSymbolAnywhere" src'))).toContain(
      '[MONOGRAPH_REMINDER]',
    );
  });

  it('does not nudge once monograph has been called this session', () => {
    freshGraphProject();
    runHook('post-graph-tool', { session_id: 'n5', tool_name: 'mcp__monomind__monograph_query' });
    const r = grep('n5', 'grep -rn "noSuchSymbolAnywhere" src');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('still nudges under MONOMIND_HOOK_QUIET=1 (init default): QUIET silences the terminal, not additionalContext', () => {
    freshGraphProject();
    const env = { ...process.env, CLAUDE_PROJECT_DIR: tmp, MONOMIND_HOOK_QUIET: '1' };
    delete env.MONOMIND_SDK_AGENT;
    delete env.MONOMIND_GRAPH_GATE;
    const run = (cmd, input) =>
      spawnSync(process.execPath, [HANDLER, cmd], {
        cwd: tmp,
        env,
        input: JSON.stringify(input),
        encoding: 'utf-8',
        timeout: 15000,
      });
    const bash = run('pre-bash', {
      session_id: 'q1',
      tool_name: 'Bash',
      tool_input: { command: 'grep -rn "noSuchSymbolAnywhere" src' },
    });
    expect(bash.status).toBe(0);
    expect(JSON.parse(bash.stdout).hookSpecificOutput.additionalContext).toContain(
      '[MONOGRAPH_REMINDER]',
    );
    const search = run('pre-search', {
      session_id: 'q2',
      tool_name: 'Grep',
      tool_input: { pattern: 'noSuchSymbolAnywhere', path: 'src' },
    });
    expect(JSON.parse(search.stdout).hookSpecificOutput.additionalContext).toContain(
      '[MONOGRAPH_REMINDER]',
    );
  });

  it('does not nudge when the graph is empty', () => {
    freshGraphProject();
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(tmp, '.monomind', 'monograph.db'));
    db.exec('DELETE FROM nodes');
    db.close();
    const r = grep('n6', 'grep -rn "noSuchSymbolAnywhere" src');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('the security gate still blocks rm -rf in a session that was never nudged', () => {
    freshGraphProject();
    const r = runHook('pre-bash', {
      session_id: 'n7',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
  });
});

describe('status line no longer shows unmeasured "$ saved" (#409)', () => {
  it('renders hint counts instead of dollars from graph-usage.json', () => {
    fs.mkdirSync(path.join(tmp, '.monomind', 'metrics'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.monomind', 'metrics', 'graph-usage.json'),
      JSON.stringify({
        graph_assist_search: 7,
        grep_call: 3,
        tokens_saved: 11900,
        dollars_saved: 3.21,
      }),
    );
    const out = execFileSync(process.execPath, [STATUSLINE], {
      cwd: tmp,
      env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
      encoding: 'utf-8',
      timeout: 20000,
    });
    expect(out).not.toContain('3.21');
    expect(out).not.toContain('💰');
    expect(out).toContain('7 hints');
  });
});

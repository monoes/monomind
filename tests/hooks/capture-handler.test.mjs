/**
 * Tests for .claude/helpers/handlers/capture-handler.cjs
 * Covers deriveSubagentSuccess and parseJSONLForData's lastToolError signal —
 * the fix for the routing-feedback success flag being permanently 100% true
 * (deriveSubagentSuccess previously only matched literal keywords in the
 * subagent's final text message, which real failures rarely use) — plus
 * handleSubagentStop's cross-subagent scoping fix (a sibling subagent's
 * transcript created concurrently used to get folded into this subagent's
 * own success/failure record under the project's default multi-agent
 * swarm topology).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CH_PATH = path.resolve(__dirname, '../../.claude/helpers/handlers/capture-handler.cjs');

function loadCH() {
  delete require.cache[CH_PATH];
  return require(CH_PATH);
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTranscript(lines) {
  const p = path.join(tmpDir, 'transcript.jsonl');
  fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  return p;
}

describe('deriveSubagentSuccess', () => {
  it('returns true for an empty summary with no tool error', () => {
    const { deriveSubagentSuccess } = loadCH();
    expect(deriveSubagentSuccess('', false)).toBe(true);
  });

  it('returns false when the summary contains a failure keyword', () => {
    const { deriveSubagentSuccess } = loadCH();
    expect(deriveSubagentSuccess('The build failed', false)).toBe(false);
  });

  it('returns false when lastToolError is true even without keywords', () => {
    const { deriveSubagentSuccess } = loadCH();
    expect(deriveSubagentSuccess('I was unable to locate the config file', true)).toBe(false);
  });

  it('returns true when summary has no keywords and no tool error', () => {
    const { deriveSubagentSuccess } = loadCH();
    expect(deriveSubagentSuccess('Implemented the feature and added tests', false)).toBe(true);
  });
});

describe('parseJSONLForData lastToolError', () => {
  it('is true when the last tool_result in the transcript is an error', () => {
    const { parseJSONLForData } = loadCH();
    const p = writeTranscript([
      { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } },
      { message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'fatal: lock exists' }] } },
    ]);
    expect(parseJSONLForData(p).lastToolError).toBe(true);
  });

  it('is false when the last tool_result succeeded, even if an earlier one errored', () => {
    const { parseJSONLForData } = loadCH();
    const p = writeTranscript([
      { message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'first attempt failed' }] } },
      { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } },
      { message: { role: 'user', content: [{ type: 'tool_result', is_error: false, content: 'ok' }] } },
    ]);
    expect(parseJSONLForData(p).lastToolError).toBe(false);
  });

  it('is false when the transcript has no tool_result blocks', () => {
    const { parseJSONLForData } = loadCH();
    const p = writeTranscript([
      { message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
    ]);
    expect(parseJSONLForData(p).lastToolError).toBe(false);
  });
});

describe('handleSubagentStop cross-subagent scoping', () => {
  let projectDir, fakeHome, claudeDir;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-proj-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-home-'));
    const encoded = projectDir.replace(/\//g, '-');
    claudeDir = path.join(fakeHome, '.claude', 'projects', encoded);
    fs.mkdirSync(claudeDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  function runHook(eventType, hookInput) {
    return execFileSync('node', [CH_PATH, eventType], {
      input: JSON.stringify(hookInput),
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, HOME: fakeHome, USERPROFILE: fakeHome },
      encoding: 'utf-8',
    });
  }

  function readOutcomes() {
    const p = path.join(projectDir, '.monomind', 'data', 'intelligence-outcomes.jsonl');
    if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  }

  it('does not let a concurrent sibling subagent\'s failure contaminate this subagent\'s success record', () => {
    const transcriptA = path.join(claudeDir, 'agent-A.jsonl');
    const transcriptB = path.join(claudeDir, 'agent-B.jsonl');

    // A starts — snapshot taken before either transcript file exists.
    runHook('subagent-start', { transcript_path: transcriptA, agentType: 'coder', agentDesc: 'task A' });

    // Sibling B's transcript appears (created after A's snapshot) — B FAILS.
    fs.writeFileSync(transcriptB, [
      { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } },
      { message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'B failed' }] } },
      { message: { role: 'assistant', content: [{ type: 'text', text: 'B is done.' }] } },
    ].map(l => JSON.stringify(l)).join('\n') + '\n');

    // A's own transcript appears too — A SUCCEEDS.
    fs.writeFileSync(transcriptA, [
      { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } },
      { message: { role: 'user', content: [{ type: 'tool_result', is_error: false, content: 'A succeeded' }] } },
      { message: { role: 'assistant', content: [{ type: 'text', text: 'A finished successfully.' }] } },
    ].map(l => JSON.stringify(l)).join('\n') + '\n');

    // A stops. Both files are "new" relative to A's start-snapshot — this must
    // only attribute A's own transcript, not sibling B's, to A's record.
    runHook('subagent-stop', { transcript_path: transcriptA });

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].success).toBe(true);
  });

  it('falls back to the directory-wide new-files diff when transcript_path is absent', () => {
    // Older Claude Code payload shape (no transcript_path) — single-subagent
    // case should still work via the fallback path.
    runHook('subagent-start', {});
    const transcript = path.join(claudeDir, 'solo-agent.jsonl');
    fs.writeFileSync(transcript, [
      { message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } },
      { message: { role: 'user', content: [{ type: 'tool_result', is_error: false, content: 'ok' }] } },
      { message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } },
    ].map(l => JSON.stringify(l)).join('\n') + '\n');
    runHook('subagent-stop', {});

    const outcomes = readOutcomes();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].success).toBe(true);
  });
});

/**
 * Tests for .claude/helpers/handlers/capture-handler.cjs
 * Covers deriveSubagentSuccess and parseJSONLForData's lastToolError signal —
 * the fix for the routing-feedback success flag being permanently 100% true
 * (deriveSubagentSuccess previously only matched literal keywords in the
 * subagent's final text message, which real failures rarely use).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
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

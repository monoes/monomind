/**
 * i-055-cli review finding 2: `question()`'s promise only ever resolved via
 * `rl.question`'s callback. On EOF (Ctrl-D) readline emits 'close' but never
 * invokes that callback, so every prompt in the CLI — not just the crash
 * consent one — hung until some *external* fallback fired. For the crash
 * consent prompt specifically, that meant a user hitting Ctrl-D at a crashed
 * CLI watched it sit there for the full 15s prompt timeout before exiting:
 * a crash that looks like a hang reads as broken, and the response is
 * `kill -9`.
 *
 * `node:readline` is mocked with a bare EventEmitter standing in for the
 * Interface: it exposes exactly what PromptManager touches (question, close,
 * on/once/removeListener via EventEmitter) and never invokes the `question`
 * callback, so this fails the old way if the fix regresses -- the promise
 * would simply never settle and the test would time out, not report a wrong
 * value.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

class FakeReadlineInterface extends EventEmitter {
  question(_prompt: string, _callback: (answer: string) => void): void {
    // Deliberately never calls back -- simulates EOF/Ctrl-D arriving before
    // any line was typed, which is exactly the case readline's own callback
    // API cannot represent.
  }
  close(): void {
    this.emit('close');
  }
}

let fakeRl: FakeReadlineInterface;
vi.mock('node:readline', () => ({
  createInterface: () => fakeRl,
}));

describe('PromptManager — EOF resolves immediately, not via a fallback timeout', () => {
  it('confirm() resolves to its default the instant readline emits close, with no answer', async () => {
    vi.resetModules();
    fakeRl = new FakeReadlineInterface();
    const { confirm } = await import('../prompt.js');

    const pending = confirm({ message: 'Report this crash publicly?', default: false });
    // Simulate Ctrl-D: readline closes without ever answering `question()`.
    fakeRl.emit('close');

    await expect(pending).resolves.toBe(false);
  });

  it('confirm() defaulting to true on EOF still resolves true, proving it reads the real default (not a hardcoded false)', async () => {
    vi.resetModules();
    fakeRl = new FakeReadlineInterface();
    const { confirm } = await import('../prompt.js');

    const pending = confirm({ message: 'Proceed?', default: true });
    fakeRl.emit('close');

    await expect(pending).resolves.toBe(true);
  });
});

import { describe, it, expect, vi } from 'vitest';

import { CLISink } from '../../packages/@monobrain/hooks/src/observability/sinks/cli-sink.js';

describe('CLISink', () => {
  it('writes event to stdout when enabled', () => {
    const sink = new CLISink(true);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    sink.handle({ type: 'agent.start', traceId: 't1', spanId: 's1', agentSlug: 'coder', taskId: 'task1', timestampMs: Date.now() });
    expect(writeSpy).toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('does not write when disabled', () => {
    const sink = new CLISink(false);
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    sink.handle({ type: 'agent.start', traceId: 't1', spanId: 's1', agentSlug: 'coder', taskId: 'task1', timestampMs: Date.now() });
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});

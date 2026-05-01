import { describe, it, expect } from 'vitest';
import { createJobRegistry } from '../../web/async-jobs.js';

describe('JobRegistry SSE progress', () => {
  it('emitProgress stores progress events on the job', () => {
    const reg = createJobRegistry();
    const job = reg.create('analyze', {});
    reg.emitProgress(job.id, { phase: 'scan', percent: 10, message: 'scanning' });
    reg.emitProgress(job.id, { phase: 'parse', percent: 50 });
    const events = reg.getProgress(job.id);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ phase: 'scan', percent: 10 });
    expect(events[1]).toMatchObject({ phase: 'parse', percent: 50 });
  });

  it('getProgress returns empty array for unknown job', () => {
    const reg = createJobRegistry();
    expect(reg.getProgress('nonexistent')).toEqual([]);
  });

  it('emitProgress is a no-op for unknown job', () => {
    const reg = createJobRegistry();
    expect(() => reg.emitProgress('nonexistent', { phase: 'scan' })).not.toThrow();
  });
});

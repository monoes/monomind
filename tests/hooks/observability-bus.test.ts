import { describe, it, expect } from 'vitest';

import { ObservabilityBus } from '../../packages/@monomind/hooks/src/observability/bus.js';
import type { ObservabilityEvent } from '../../packages/@monomind/hooks/src/observability/bus.js';

describe('ObservabilityBus', () => {
  it('delivers event to all subscribers', async () => {
    const bus = new ObservabilityBus();
    const received: ObservabilityEvent[] = [];
    bus.subscribe(e => { received.push(e); });
    await bus.publishSync({ type: 'session.start', sessionId: 'test', timestampMs: Date.now() });
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('session.start');
  });

  it('delivers event to all sinks', async () => {
    const bus = new ObservabilityBus();
    const events: ObservabilityEvent[] = [];
    bus.addSink({ name: 'test', handle: (e) => { events.push(e); } });
    await bus.publishSync({ type: 'session.start', sessionId: 'test', timestampMs: Date.now() });
    expect(events).toHaveLength(1);
  });

  it('unsubscribe stops delivery', async () => {
    const bus = new ObservabilityBus();
    const received: ObservabilityEvent[] = [];
    const unsub = bus.subscribe(e => { received.push(e); });
    unsub();
    await bus.publishSync({ type: 'session.start', sessionId: 'test', timestampMs: Date.now() });
    expect(received).toHaveLength(0);
  });

  it('replay delivers buffered events to late subscriber', async () => {
    const bus = new ObservabilityBus();
    await bus.publishSync({ type: 'session.start', sessionId: 'test', timestampMs: Date.now() });
    const replayed: ObservabilityEvent[] = [];
    bus.replay(e => { replayed.push(e); });
    expect(replayed).toHaveLength(1);
  });

  it('buffers up to maxBufferSize events', async () => {
    const bus = new ObservabilityBus(3);
    for (let i = 0; i < 5; i++) {
      await bus.publishSync({ type: 'session.start', sessionId: `s${i}`, timestampMs: Date.now() });
    }
    const replayed: ObservabilityEvent[] = [];
    bus.replay(e => { replayed.push(e); });
    expect(replayed).toHaveLength(3); // oldest 2 evicted
  });

  it('removeSink stops delivery to that sink', async () => {
    const bus = new ObservabilityBus();
    const events: ObservabilityEvent[] = [];
    bus.addSink({ name: 'removable', handle: (e) => { events.push(e); } });
    bus.removeSink('removable');
    await bus.publishSync({ type: 'session.start', sessionId: 'test', timestampMs: Date.now() });
    expect(events).toHaveLength(0);
  });

  it('subscriber errors do not break other subscribers', async () => {
    const bus = new ObservabilityBus();
    const received: ObservabilityEvent[] = [];
    bus.subscribe(() => { throw new Error('boom'); });
    bus.subscribe(e => { received.push(e); });
    await bus.publishSync({ type: 'session.start', sessionId: 'test', timestampMs: Date.now() });
    expect(received).toHaveLength(1);
  });
});

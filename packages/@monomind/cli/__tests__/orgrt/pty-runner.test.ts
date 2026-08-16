/**
 * Unit tests for pty-runner.ts's transport-independent pieces: the client→
 * server frame codec, the attach relay logic (against a fake PtyLike + fake
 * duplex socket), and the node-pty→SpawnedProcess adapter. None of these
 * need a real terminal or the native node-pty module installed.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  FrameDecoder,
  encodeDataFrame,
  encodeResizeFrame,
  PtyAttachHub,
  ptyToSpawnedProcess,
  type PtyLike,
} from '../../src/orgrt/pty-runner.js';

describe('frame codec', () => {
  it('round-trips a single data frame', () => {
    const decoder = new FrameDecoder();
    const frames = decoder.feed(encodeDataFrame(Buffer.from('hello')));
    expect(frames).toEqual([{ kind: 'data', payload: Buffer.from('hello') }]);
  });

  it('round-trips a resize frame', () => {
    const decoder = new FrameDecoder();
    const frames = decoder.feed(encodeResizeFrame(120, 40));
    expect(frames).toEqual([{ kind: 'resize', cols: 120, rows: 40 }]);
  });

  it('decodes multiple frames delivered in one chunk', () => {
    const decoder = new FrameDecoder();
    const chunk = Buffer.concat([encodeDataFrame(Buffer.from('a')), encodeResizeFrame(80, 24)]);
    const frames = decoder.feed(chunk);
    expect(frames).toEqual([
      { kind: 'data', payload: Buffer.from('a') },
      { kind: 'resize', cols: 80, rows: 24 },
    ]);
  });

  it('reassembles a frame split across multiple feed() calls', () => {
    const decoder = new FrameDecoder();
    const whole = encodeDataFrame(Buffer.from('split-me'));
    const first = decoder.feed(whole.subarray(0, 3));
    expect(first).toEqual([]);
    const second = decoder.feed(whole.subarray(3));
    expect(second).toEqual([{ kind: 'data', payload: Buffer.from('split-me') }]);
  });

  it('retains a trailing partial frame across calls without dropping the next complete one', () => {
    const decoder = new FrameDecoder();
    const f1 = encodeDataFrame(Buffer.from('one'));
    const f2 = encodeDataFrame(Buffer.from('two'));
    decoder.feed(Buffer.concat([f1, f2.subarray(0, 2)]));
    const frames = decoder.feed(f2.subarray(2));
    expect(frames).toEqual([{ kind: 'data', payload: Buffer.from('two') }]);
  });

  it('drops an unknown frame tag without desyncing the stream', () => {
    const decoder = new FrameDecoder();
    const unknown = Buffer.concat([Buffer.from([0x9, 0, 0, 0, 2]), Buffer.from('xx')]);
    const known = encodeDataFrame(Buffer.from('ok'));
    const frames = decoder.feed(Buffer.concat([unknown, known]));
    expect(frames).toEqual([{ kind: 'data', payload: Buffer.from('ok') }]);
  });

  it('handles an empty-payload data frame', () => {
    const decoder = new FrameDecoder();
    const frames = decoder.feed(encodeDataFrame(Buffer.alloc(0)));
    expect(frames).toEqual([{ kind: 'data', payload: Buffer.alloc(0) }]);
  });
});

function fakePty(): PtyLike & { emitData: (s: string) => void; emitExit: (code: number) => void } {
  const emitter = new EventEmitter();
  const pty: PtyLike & { emitData: (s: string) => void; emitExit: (code: number) => void } = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (cb) => emitter.on('data', cb),
    onExit: (cb) => emitter.on('exit', cb),
    emitData: (s: string) => emitter.emit('data', s),
    emitExit: (code: number) => emitter.emit('exit', { exitCode: code }),
  };
  return pty;
}

function fakeSocket() {
  const emitter = new EventEmitter();
  const written: Buffer[] = [];
  return {
    on: (event: 'data' | 'close', cb: (chunk?: Buffer) => void) => emitter.on(event, cb),
    write: (chunk: Buffer) => { written.push(chunk); },
    written,
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
  };
}

describe('PtyAttachHub', () => {
  it('relays pty output to the attached client as raw bytes', () => {
    const pty = fakePty();
    const hub = new PtyAttachHub(pty);
    const client = fakeSocket();
    hub.attach(client);

    pty.emitData('hello from the agent');
    expect(client.written).toEqual([Buffer.from('hello from the agent', 'utf8')]);
  });

  it('writes decoded data frames from the client into the pty', () => {
    const pty = fakePty();
    const hub = new PtyAttachHub(pty);
    const client = fakeSocket();
    hub.attach(client);

    client.emit('data', encodeDataFrame(Buffer.from('ls -la\n')));
    expect(pty.write).toHaveBeenCalledWith('ls -la\n');
  });

  it('applies resize frames from the client to the pty', () => {
    const pty = fakePty();
    const hub = new PtyAttachHub(pty);
    const client = fakeSocket();
    hub.attach(client);

    client.emit('data', encodeResizeFrame(100, 30));
    expect(pty.resize).toHaveBeenCalledWith(100, 30);
  });

  it('rebind() keeps the attached client but relays from the new pty (multi-turn subprocess runners spawn a fresh process per turn)', () => {
    const turn1 = fakePty();
    const hub = new PtyAttachHub(turn1);
    const client = fakeSocket();
    hub.attach(client);

    turn1.emitData('turn 1 output');
    expect(client.written).toEqual([Buffer.from('turn 1 output', 'utf8')]);

    const turn2 = fakePty();
    hub.rebind(turn2);
    client.emit('data', encodeDataFrame(Buffer.from('keystroke for turn 2')));
    expect(turn2.write).toHaveBeenCalledWith('keystroke for turn 2');
    expect(turn1.write).not.toHaveBeenCalled();

    turn2.emitData('turn 2 output');
    expect(client.written).toEqual([
      Buffer.from('turn 1 output', 'utf8'),
      Buffer.from('turn 2 output', 'utf8'),
    ]);
  });

  it('detach() stops forwarding without touching the underlying pty', () => {
    const pty = fakePty();
    const hub = new PtyAttachHub(pty);
    const client = fakeSocket();
    const detach = hub.attach(client);
    detach();

    pty.emitData('after detach');
    expect(client.written).toEqual([]);
    expect(pty.kill).not.toHaveBeenCalled();
  });
});

describe('ptyToSpawnedProcess', () => {
  it('forwards pty output through stdout as an async-iterable byte stream', async () => {
    const pty = fakePty();
    const proc = ptyToSpawnedProcess(pty);

    const chunks: Buffer[] = [];
    const reader = (async () => {
      for await (const chunk of proc.stdout as AsyncIterable<Buffer>) chunks.push(chunk as Buffer);
    })();

    pty.emitData('some output');
    pty.emitExit(0);
    await reader;

    expect(Buffer.concat(chunks).toString('utf8')).toBe('some output');
  });

  it('emits a close event with the exit code when the pty exits', async () => {
    const pty = fakePty();
    const proc = ptyToSpawnedProcess(pty);
    const closed = new Promise<number>((resolve) => proc.on('close', (code: unknown) => resolve(code as number)));
    pty.emitExit(7);
    expect(await closed).toBe(7);
  });

  it('stderr is always empty (PTYs merge stdout+stderr)', async () => {
    const pty = fakePty();
    const proc = ptyToSpawnedProcess(pty);
    const chunks: Buffer[] = [];
    for await (const chunk of proc.stderr as AsyncIterable<Buffer>) chunks.push(chunk as Buffer);
    expect(chunks).toEqual([]);
  });

  it('kill() delegates to the underlying pty', () => {
    const pty = fakePty();
    const proc = ptyToSpawnedProcess(pty);
    proc.kill('SIGTERM');
    expect(pty.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('surfaces a provided spawn error asynchronously on the error event', async () => {
    const pty = fakePty();
    const err = new Error('boom');
    const proc = ptyToSpawnedProcess(pty, err);
    const caught = await new Promise<Error>((resolve) => proc.on('error', (e: unknown) => resolve(e as Error)));
    expect(caught).toBe(err);
  });
});

// The upstream ONNX for cross-encoder/ettin-reranker-32m-v1 contains only the
// ModernBERT encoder (no logits). Its classifier head ships as three small
// sentence-transformers safetensors files. These tests cover the pure-JS head
// that replaces the PyTorch export step, and the source selection that keeps
// the reranker from loading (and costing ~2s per search) when it cannot score.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ETTIN_HEAD_FILES,
  ettinHeadLogit,
  parseSafetensorsF32,
  resolveRerankerSource,
} from '../memory/reranker-head.js';

function safetensors(tensors: Record<string, { shape: number[]; data: number[] }>, dtype = 'F32') {
  let offset = 0;
  const header: Record<string, unknown> = {};
  const parts: Buffer[] = [];
  for (const [name, t] of Object.entries(tensors)) {
    const bytes = Buffer.from(new Float32Array(t.data).buffer);
    header[name] = { dtype, shape: t.shape, data_offsets: [offset, offset + bytes.length] };
    offset += bytes.length;
    parts.push(bytes);
  }
  const json = Buffer.from(JSON.stringify(header));
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(json.length));
  return Buffer.concat([len, json, ...parts]);
}

describe('parseSafetensorsF32', () => {
  it('reads float32 tensors with their shapes', () => {
    const buf = safetensors({ 'linear.weight': { shape: [2, 2], data: [1, 2, 3, 4] } });
    const t = parseSafetensorsF32(buf)['linear.weight'];
    expect(t.shape).toEqual([2, 2]);
    expect(Array.from(t.data)).toEqual([1, 2, 3, 4]);
  });

  it('rejects non-float32 tensors instead of misreading their bytes', () => {
    const buf = safetensors({ w: { shape: [1], data: [1] } }, 'F16');
    expect(() => parseSafetensorsF32(buf)).toThrow(/F16/);
  });
});

describe('ettinHeadLogit', () => {
  // Hand-computed for H=2: dense1 = identity, GELU, LayerNorm(weight=1,bias=0), dense2 = [1, -1], bias 0.5.
  const head = {
    dense1: { shape: [2, 2], data: new Float32Array([1, 0, 0, 1]) },
    lnWeight: new Float32Array([1, 1]),
    lnBias: new Float32Array([0, 0]),
    dense2: new Float32Array([1, -1]),
    dense2Bias: 0.5,
  };

  it('applies Linear → exact GELU → LayerNorm(eps 1e-5) → Linear to the CLS vector', () => {
    const gelu = (x: number) => 0.5 * x * (1 + erfRef(x / Math.SQRT2));
    const [g0, g1] = [gelu(2), gelu(-1)];
    const mean = (g0 + g1) / 2;
    const sd = Math.sqrt(((g0 - mean) ** 2 + (g1 - mean) ** 2) / 2 + 1e-5);
    const expected = 0.5 + (g0 - mean) / sd - (g1 - mean) / sd;
    expect(ettinHeadLogit(head, new Float32Array([2, -1]))).toBeCloseTo(expected, 5);
  });

  it('reads only the first H values (the CLS token) of a longer hidden-state buffer', () => {
    const cls = new Float32Array([2, -1, 99, 99, 99, 99]);
    expect(ettinHeadLogit(head, cls)).toBeCloseTo(
      ettinHeadLogit(head, new Float32Array([2, -1])),
      6,
    );
  });
});

describe('resolveRerankerSource', () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns null when neither a full export nor the head files are present — the reranker must not load', () => {
    root = mkdtempSync(join(process.cwd(), '.tmp-reranker-src-'));
    expect(resolveRerankerSource(root)).toBeNull();
  });

  it('prefers a full ONNX export with logits when one exists', () => {
    root = mkdtempSync(join(process.cwd(), '.tmp-reranker-src-'));
    mkdirSync(join(root, 'ettin-reranker-32m-v1-onnx', 'onnx'), { recursive: true });
    writeFileSync(join(root, 'ettin-reranker-32m-v1-onnx', 'onnx', 'model.onnx'), 'x');
    expect(resolveRerankerSource(root)).toEqual({
      kind: 'export',
      dir: join(root, 'ettin-reranker-32m-v1-onnx'),
    });
  });

  it('uses the JS head only when all three head files are present', () => {
    root = mkdtempSync(join(process.cwd(), '.tmp-reranker-src-'));
    const headDir = join(root, 'ettin-reranker-32m-v1-head');
    for (const [i, rel] of ETTIN_HEAD_FILES.entries()) {
      if (i === 2) break;
      mkdirSync(join(headDir, rel, '..'), { recursive: true });
      writeFileSync(join(headDir, rel), 'x');
    }
    expect(resolveRerankerSource(root)).toBeNull();
    mkdirSync(join(headDir, ETTIN_HEAD_FILES[2], '..'), { recursive: true });
    writeFileSync(join(headDir, ETTIN_HEAD_FILES[2]), 'x');
    expect(resolveRerankerSource(root)).toEqual({ kind: 'head', dir: headDir });
  });
});

/** Reference erf (W. J. Cody rational approximation, |error| < 1e-7) — independent of the implementation's. */
function erfRef(x: number): number {
  const sign = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

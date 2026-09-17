/**
 * Pure-JS classifier head for cross-encoder/ettin-reranker-32m-v1.
 *
 * The upstream ONNX contains only the ModernBERT encoder (last_hidden_state, no
 * logits). The sentence-transformers head ships as three small safetensors
 * files: 2_Dense (Linear 384→384, no bias, GELU), 3_LayerNorm, 4_Dense
 * (Linear 384→1 with bias). Applying them here to the CLS vector reproduces the
 * model card's reference scores without a PyTorch export step.
 *
 * @module v1/cli/memory/reranker-head
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const ETTIN_EXPORT_DIRNAME = 'ettin-reranker-32m-v1-onnx';
export const ETTIN_HEAD_DIRNAME = 'ettin-reranker-32m-v1-head';
export const ETTIN_HEAD_FILES = [
  '2_Dense/model.safetensors',
  '3_LayerNorm/model.safetensors',
  '4_Dense/model.safetensors',
] as const;

export interface F32Tensor {
  shape: number[];
  data: Float32Array;
}

export interface EttinHead {
  dense1: F32Tensor;
  lnWeight: Float32Array;
  lnBias: Float32Array;
  dense2: Float32Array;
  dense2Bias: number;
}

export type RerankerSource = { kind: 'export' | 'head'; dir: string };

/** Which reranker can actually produce scores, or null when none can. */
export function resolveRerankerSource(modelsDir: string): RerankerSource | null {
  const exportDir = path.join(modelsDir, ETTIN_EXPORT_DIRNAME);
  if (fs.existsSync(path.join(exportDir, 'onnx', 'model.onnx')))
    return { kind: 'export', dir: exportDir };
  const headDir = path.join(modelsDir, ETTIN_HEAD_DIRNAME);
  if (ETTIN_HEAD_FILES.every((f) => fs.existsSync(path.join(headDir, f))))
    return { kind: 'head', dir: headDir };
  return null;
}

/** Parse a safetensors buffer holding only float32 tensors. */
export function parseSafetensorsF32(buf: Buffer): Record<string, F32Tensor> {
  const headerLen = Number(buf.readBigUInt64LE(0));
  const header = JSON.parse(buf.subarray(8, 8 + headerLen).toString('utf8')) as Record<
    string,
    { dtype: string; shape: number[]; data_offsets: [number, number] }
  >;
  const out: Record<string, F32Tensor> = {};
  for (const [name, t] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    if (t.dtype !== 'F32')
      throw new Error(`safetensors tensor ${name}: unsupported dtype ${t.dtype}`);
    const [start, end] = t.data_offsets;
    const bytes = buf.subarray(8 + headerLen + start, 8 + headerLen + end);
    // Copy: the tensor bytes are not guaranteed to sit on a 4-byte boundary.
    out[name] = { shape: t.shape, data: new Float32Array(new Uint8Array(bytes).buffer) };
  }
  return out;
}

export function loadEttinHead(headDir: string): EttinHead {
  const read = (rel: string) => parseSafetensorsF32(fs.readFileSync(path.join(headDir, rel)));
  const [d1, ln, d2] = ETTIN_HEAD_FILES.map(read);
  return {
    dense1: d1['linear.weight'],
    lnWeight: ln['norm.weight'].data,
    lnBias: ln['norm.bias'].data,
    dense2: d2['linear.weight'].data,
    dense2Bias: d2['linear.bias'].data[0],
  };
}

/** erf via the Numerical Recipes erfc Chebyshev fit (|error| < 1.2e-7). */
function erf(x: number): number {
  const t = 1 / (1 + 0.5 * Math.abs(x));
  const y =
    1 -
    t *
      Math.exp(
        -x * x -
          1.26551223 +
          t *
            (1.00002368 +
              t *
                (0.37409196 +
                  t *
                    (0.09678418 +
                      t *
                        (-0.18628806 +
                          t *
                            (0.27886807 +
                              t *
                                (-1.13520398 +
                                  t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
      );
  return x >= 0 ? y : -y;
}

/** Logit for one query/passage pair from its hidden states (CLS token first). */
export function ettinHeadLogit(head: EttinHead, hidden: Float32Array): number {
  const h = head.dense1.shape[1];
  const out = head.dense1.shape[0];
  const x = new Float32Array(out);
  for (let i = 0; i < out; i++) {
    let s = 0;
    for (let j = 0; j < h; j++) s += head.dense1.data[i * h + j] * hidden[j];
    x[i] = 0.5 * s * (1 + erf(s / Math.SQRT2)); // exact GELU (torch.nn.GELU default)
  }
  let mean = 0;
  for (let i = 0; i < out; i++) mean += x[i];
  mean /= out;
  let variance = 0;
  for (let i = 0; i < out; i++) variance += (x[i] - mean) ** 2;
  const sd = Math.sqrt(variance / out + 1e-5); // torch.nn.LayerNorm default eps
  let logit = head.dense2Bias;
  for (let i = 0; i < out; i++)
    logit += head.dense2[i] * (((x[i] - mean) / sd) * head.lnWeight[i] + head.lnBias[i]);
  return logit;
}

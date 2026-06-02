//! WebAssembly bindings for RuVector GNN

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

// ── Inline GNN core types ─────────────────────────────────────────────────────

#[derive(Clone)]
pub struct RuvectorLayer {
    input_dim: usize,
    hidden_dim: usize,
    heads: usize,
    // Weight matrices (identity-initialized for simplicity)
    w_q: Vec<f32>,
    w_k: Vec<f32>,
    w_v: Vec<f32>,
}

impl RuvectorLayer {
    pub fn new(input_dim: usize, hidden_dim: usize, heads: usize, _dropout: f32) -> Result<Self, String> {
        if heads == 0 || hidden_dim % heads != 0 {
            return Err(format!("hidden_dim {} must be divisible by heads {}", hidden_dim, heads));
        }
        let size = input_dim * hidden_dim;
        // Initialize with scaled identity-like weights
        let scale = (input_dim as f32).sqrt().recip();
        let w_q: Vec<f32> = (0..size).map(|i| if i % (input_dim + 1) == 0 { scale } else { 0.0 }).collect();
        let w_k = w_q.clone();
        let w_v = w_q.clone();
        Ok(Self { input_dim, hidden_dim, heads, w_q, w_k, w_v })
    }

    fn project(&self, input: &[f32], weight: &[f32]) -> Vec<f32> {
        let out_dim = self.hidden_dim;
        let in_dim = self.input_dim;
        (0..out_dim).map(|o| {
            input.iter().enumerate().take(in_dim).map(|(i, x)| {
                let wi = o * in_dim + i;
                x * weight.get(wi).copied().unwrap_or(0.0)
            }).sum()
        }).collect()
    }

    pub fn forward(&self, node: &[f32], neighbors: &[Vec<f32>], edge_weights: &[f32]) -> Vec<f32> {
        let scale = (self.hidden_dim as f32).sqrt().recip();
        let q = self.project(node, &self.w_q);
        if neighbors.is_empty() {
            return q;
        }
        // Attention-weighted aggregation
        let mut scores: Vec<f32> = neighbors.iter().map(|nb| {
            let k = self.project(nb, &self.w_k);
            q.iter().zip(&k).map(|(a, b)| a * b).sum::<f32>() * scale
        }).collect();
        // Incorporate edge weights
        for (s, ew) in scores.iter_mut().zip(edge_weights) { *s += ew.ln().max(-10.0); }
        // Softmax
        let max = scores.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let exps: Vec<f32> = scores.iter().map(|s| (s - max).exp()).collect();
        let sum: f32 = exps.iter().sum::<f32>().max(1e-7);
        let weights: Vec<f32> = exps.iter().map(|e| e / sum).collect();
        // Aggregate values
        let mut agg = vec![0.0f32; self.hidden_dim];
        for (nb, w) in neighbors.iter().zip(&weights) {
            let v = self.project(nb, &self.w_v);
            for (a, vi) in agg.iter_mut().zip(&v) { *a += w * vi; }
        }
        // Residual: project node + aggregation (truncate/pad to hidden_dim)
        let mut out = q.clone();
        for (o, a) in out.iter_mut().zip(&agg) { *o += a; }
        out
    }
}

// ── Tensor compression ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "level", content = "data")]
pub enum CompressedTensor {
    None { data: Vec<f32> },
    Half { data: Vec<u16>, scale: f32 },
    PQ8 { data: Vec<u8>, subvectors: usize, centroids: u8, dim: usize },
    PQ4 { data: Vec<u8>, subvectors: usize, dim: usize },
    Binary { data: Vec<u8>, threshold: f32, dim: usize },
}

#[derive(Debug, Clone)]
pub enum CompressionLevel {
    None,
    Half { scale: f32 },
    PQ8 { subvectors: usize, centroids: u8 },
    PQ4 { subvectors: usize, outlier_threshold: f32 },
    Binary { threshold: f32 },
}

pub struct TensorCompress;

impl TensorCompress {
    pub fn new() -> Self { Self }

    pub fn compress(&self, embedding: &[f32], access_freq: f32) -> Result<CompressedTensor, String> {
        let level = if access_freq > 0.8 {
            CompressionLevel::None
        } else if access_freq > 0.4 {
            CompressionLevel::Half { scale: 1.0 }
        } else if access_freq > 0.1 {
            CompressionLevel::PQ8 { subvectors: 8, centroids: 16 }
        } else if access_freq > 0.01 {
            CompressionLevel::PQ4 { subvectors: 8, outlier_threshold: 3.0 }
        } else {
            CompressionLevel::Binary { threshold: 0.0 }
        };
        self.compress_with_level(embedding, &level)
    }

    pub fn compress_with_level(&self, embedding: &[f32], level: &CompressionLevel) -> Result<CompressedTensor, String> {
        Ok(match level {
            CompressionLevel::None => CompressedTensor::None { data: embedding.to_vec() },
            CompressionLevel::Half { scale } => {
                let data: Vec<u16> = embedding.iter().map(|&x| {
                    let v = (x / scale).clamp(-65504.0, 65504.0);
                    // Simple f32 -> f16-like u16 via bit manipulation
                    let bits = v.to_bits();
                    let sign = ((bits >> 16) & 0x8000) as u16;
                    let exp = ((bits >> 23) & 0xFF) as i32 - 127 + 15;
                    let mantissa = (bits >> 13) & 0x3FF;
                    if exp <= 0 { sign } else if exp >= 31 { sign | 0x7C00 } else { sign | ((exp as u16) << 10) | mantissa as u16 }
                }).collect();
                CompressedTensor::Half { data, scale: *scale }
            }
            CompressionLevel::PQ8 { subvectors, centroids } => {
                let data: Vec<u8> = embedding.iter().map(|&x| {
                    (x.clamp(-1.0, 1.0) * 127.0 + 127.0) as u8
                }).collect();
                CompressedTensor::PQ8 { data, subvectors: *subvectors, centroids: *centroids, dim: embedding.len() }
            }
            CompressionLevel::PQ4 { subvectors, .. } => {
                let packed: Vec<u8> = embedding.chunks(2).map(|chunk| {
                    let a = ((chunk[0].clamp(-1.0, 1.0) * 7.0 + 7.0) as u8) & 0x0F;
                    let b = if chunk.len() > 1 { ((chunk[1].clamp(-1.0, 1.0) * 7.0 + 7.0) as u8) & 0x0F } else { 0 };
                    (a << 4) | b
                }).collect();
                CompressedTensor::PQ4 { data: packed, subvectors: *subvectors, dim: embedding.len() }
            }
            CompressionLevel::Binary { threshold } => {
                let packed: Vec<u8> = embedding.chunks(8).map(|chunk| {
                    chunk.iter().enumerate().fold(0u8, |acc, (i, &x)| {
                        if x > *threshold { acc | (1 << i) } else { acc }
                    })
                }).collect();
                CompressedTensor::Binary { data: packed, threshold: *threshold, dim: embedding.len() }
            }
        })
    }

    pub fn decompress(&self, compressed: &CompressedTensor) -> Result<Vec<f32>, String> {
        Ok(match compressed {
            CompressedTensor::None { data } => data.clone(),
            CompressedTensor::Half { data, scale } => {
                data.iter().map(|&h| {
                    let sign = if h & 0x8000 != 0 { -1.0f32 } else { 1.0 };
                    let exp = ((h >> 10) & 0x1F) as i32 - 15;
                    let mantissa = (h & 0x3FF) as f32 / 1024.0;
                    if (h >> 10) & 0x1F == 0 { 0.0 } else { sign * (1.0 + mantissa) * 2f32.powi(exp) * scale }
                }).collect()
            }
            CompressedTensor::PQ8 { data, .. } => {
                data.iter().map(|&b| (b as f32 - 127.0) / 127.0).collect()
            }
            CompressedTensor::PQ4 { data, dim, .. } => {
                let mut out = Vec::with_capacity(*dim);
                for &byte in data {
                    let a = ((byte >> 4) & 0x0F) as f32;
                    let b = (byte & 0x0F) as f32;
                    out.push((a - 7.0) / 7.0);
                    if out.len() < *dim { out.push((b - 7.0) / 7.0); }
                }
                out.truncate(*dim);
                out
            }
            CompressedTensor::Binary { data, threshold: _, dim } => {
                let mut out = Vec::with_capacity(*dim);
                for &byte in data {
                    for bit in 0..8 {
                        if out.len() >= *dim { break; }
                        out.push(if (byte >> bit) & 1 == 1 { 1.0 } else { -1.0 });
                    }
                }
                out
            }
        })
    }
}

// ── Standalone functions (inline replacements for ruvector_gnn exports) ───────

pub fn differentiable_search(
    query: &[f32],
    candidates: &[Vec<f32>],
    k: usize,
    temperature: f32,
) -> (Vec<usize>, Vec<f32>) {
    if candidates.is_empty() { return (vec![], vec![]); }
    let scores: Vec<f32> = candidates.iter().map(|c| {
        query.iter().zip(c).map(|(a, b)| a * b).sum::<f32>() / temperature
    }).collect();
    let max = scores.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = scores.iter().map(|s| (s - max).exp()).collect();
    let sum: f32 = exps.iter().sum::<f32>().max(1e-7);
    let weights: Vec<f32> = exps.iter().map(|e| e / sum).collect();
    // Top-k by weight
    let mut indexed: Vec<(usize, f32)> = weights.iter().cloned().enumerate().collect();
    indexed.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let k = k.min(indexed.len());
    let indices: Vec<usize> = indexed[..k].iter().map(|(i, _)| *i).collect();
    let top_weights: Vec<f32> = indexed[..k].iter().map(|(_, w)| *w).collect();
    (indices, top_weights)
}

pub fn hierarchical_forward(
    query: &[f32],
    layer_embeddings: &[Vec<Vec<f32>>],
    layers: &[RuvectorLayer],
) -> Vec<f32> {
    let mut current = query.to_vec();
    for (layer_embs, layer) in layer_embeddings.iter().zip(layers) {
        if layer_embs.is_empty() { continue; }
        let uniform_weight = 1.0 / layer_embs.len() as f32;
        let edge_weights: Vec<f32> = vec![uniform_weight; layer_embs.len()];
        current = layer.forward(&current, layer_embs, &edge_weights);
    }
    current
}

// ── WASM module init ──────────────────────────────────────────────────────────

#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

// ── Type Definitions for WASM ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen]
pub struct SearchConfig {
    pub k: usize,
    pub temperature: f32,
}

#[wasm_bindgen]
impl SearchConfig {
    #[wasm_bindgen(constructor)]
    pub fn new(k: usize, temperature: f32) -> Self {
        Self { k, temperature }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SearchResultInternal {
    indices: Vec<usize>,
    weights: Vec<f32>,
}

// ── JsRuvectorLayer ───────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct JsRuvectorLayer {
    inner: RuvectorLayer,
    hidden_dim: usize,
}

#[wasm_bindgen]
impl JsRuvectorLayer {
    #[wasm_bindgen(constructor)]
    pub fn new(input_dim: usize, hidden_dim: usize, heads: usize, dropout: f32) -> Result<JsRuvectorLayer, JsValue> {
        let inner = RuvectorLayer::new(input_dim, hidden_dim, heads, dropout)
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(JsRuvectorLayer { inner, hidden_dim })
    }

    #[wasm_bindgen]
    pub fn forward(&self, node_embedding: Vec<f32>, neighbor_embeddings: JsValue, edge_weights: Vec<f32>) -> Result<Vec<f32>, JsValue> {
        let neighbors: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(neighbor_embeddings)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse neighbor embeddings: {}", e)))?;
        if neighbors.len() != edge_weights.len() {
            return Err(JsValue::from_str(&format!(
                "Number of neighbors ({}) must match number of edge weights ({})",
                neighbors.len(), edge_weights.len()
            )));
        }
        Ok(self.inner.forward(&node_embedding, &neighbors, &edge_weights))
    }

    #[wasm_bindgen(getter, js_name = outputDim)]
    pub fn output_dim(&self) -> usize { self.hidden_dim }
}

// ── JsTensorCompress ──────────────────────────────────────────────────────────

#[wasm_bindgen]
pub struct JsTensorCompress {
    inner: TensorCompress,
}

#[wasm_bindgen]
impl JsTensorCompress {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self { Self { inner: TensorCompress::new() } }

    #[wasm_bindgen]
    pub fn compress(&self, embedding: Vec<f32>, access_freq: f32) -> Result<JsValue, JsValue> {
        let compressed = self.inner.compress(&embedding, access_freq)
            .map_err(|e| JsValue::from_str(&format!("Compression failed: {}", e)))?;
        serde_wasm_bindgen::to_value(&compressed)
            .map_err(|e| JsValue::from_str(&format!("Serialization failed: {}", e)))
    }

    #[wasm_bindgen(js_name = compressWithLevel)]
    pub fn compress_with_level(&self, embedding: Vec<f32>, level: &str) -> Result<JsValue, JsValue> {
        let compression_level = match level {
            "none" => CompressionLevel::None,
            "half" => CompressionLevel::Half { scale: 1.0 },
            "pq8" => CompressionLevel::PQ8 { subvectors: 8, centroids: 16 },
            "pq4" => CompressionLevel::PQ4 { subvectors: 8, outlier_threshold: 3.0 },
            "binary" => CompressionLevel::Binary { threshold: 0.0 },
            _ => return Err(JsValue::from_str(&format!("Unknown compression level: {}", level))),
        };
        let compressed = self.inner.compress_with_level(&embedding, &compression_level)
            .map_err(|e| JsValue::from_str(&format!("Compression failed: {}", e)))?;
        serde_wasm_bindgen::to_value(&compressed)
            .map_err(|e| JsValue::from_str(&format!("Serialization failed: {}", e)))
    }

    #[wasm_bindgen]
    pub fn decompress(&self, compressed: JsValue) -> Result<Vec<f32>, JsValue> {
        let ct: CompressedTensor = serde_wasm_bindgen::from_value(compressed)
            .map_err(|e| JsValue::from_str(&format!("Deserialization failed: {}", e)))?;
        self.inner.decompress(&ct)
            .map_err(|e| JsValue::from_str(&format!("Decompression failed: {}", e)))
    }

    #[wasm_bindgen(js_name = getCompressionRatio)]
    pub fn get_compression_ratio(&self, access_freq: f32) -> f32 {
        if access_freq > 0.8 { 1.0 }
        else if access_freq > 0.4 { 2.0 }
        else if access_freq > 0.1 { 4.0 }
        else if access_freq > 0.01 { 8.0 }
        else { 32.0 }
    }
}

// ── Standalone WASM Functions ─────────────────────────────────────────────────

#[wasm_bindgen(js_name = differentiableSearch)]
pub fn differentiable_search_wasm(
    query: Vec<f32>,
    candidate_embeddings: JsValue,
    config: &SearchConfig,
) -> Result<JsValue, JsValue> {
    let candidates: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(candidate_embeddings)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse candidate embeddings: {}", e)))?;
    let (indices, weights) = differentiable_search(&query, &candidates, config.k, config.temperature);
    let result = SearchResultInternal { indices, weights };
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize result: {}", e)))
}

#[wasm_bindgen(js_name = hierarchicalForward)]
pub fn hierarchical_forward_wasm(
    query: Vec<f32>,
    layer_embeddings: JsValue,
    gnn_layers: Vec<JsRuvectorLayer>,
) -> Result<Vec<f32>, JsValue> {
    let embeddings: Vec<Vec<Vec<f32>>> = serde_wasm_bindgen::from_value(layer_embeddings)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse layer embeddings: {}", e)))?;
    let core_layers: Vec<RuvectorLayer> = gnn_layers.iter().map(|l| l.inner.clone()).collect();
    Ok(hierarchical_forward(&query, &embeddings, &core_layers))
}

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[wasm_bindgen(js_name = cosineSimilarity)]
pub fn cosine_similarity(a: Vec<f32>, b: Vec<f32>) -> Result<f32, JsValue> {
    if a.len() != b.len() {
        return Err(JsValue::from_str(&format!("Vector dimensions must match: {} vs {}", a.len(), b.len())));
    }
    let dot: f32 = a.iter().zip(&b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 { Ok(0.0) } else { Ok(dot / (na * nb)) }
}

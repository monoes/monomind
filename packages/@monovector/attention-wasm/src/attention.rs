use wasm_bindgen::prelude::*;

// ── Helpers ──────────────────────────────────────────────────────────────────

fn softmax(scores: &[f32]) -> Vec<f32> {
    let max = scores.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = scores.iter().map(|s| (s - max).exp()).collect();
    let sum: f32 = exps.iter().sum();
    exps.iter().map(|e| e / sum).collect()
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn attend(query: &[f32], keys: &[&[f32]], values: &[&[f32]], scale: f32) -> Result<Vec<f32>, String> {
    if keys.is_empty() { return Err("no keys".into()); }
    let dim = values[0].len();
    let scores: Vec<f32> = keys.iter().map(|k| dot(query, k) * scale).collect();
    let weights = softmax(&scores);
    let mut out = vec![0.0f32; dim];
    for (w, v) in weights.iter().zip(values) {
        for (o, vi) in out.iter_mut().zip(*v) { *o += w * vi; }
    }
    Ok(out)
}

// ── Scaled Dot-Product Attention ─────────────────────────────────────────────

struct ScaledDotProductAttention { dim: usize }

impl ScaledDotProductAttention {
    fn new(dim: usize) -> Self { Self { dim } }
    fn compute(&self, query: &[f32], keys: &[&[f32]], values: &[&[f32]]) -> Result<Vec<f32>, String> {
        attend(query, keys, values, 1.0 / (self.dim as f32).sqrt())
    }
}

// ── Multi-Head Attention ─────────────────────────────────────────────────────

struct MultiHeadAttention { dim: usize, num_heads: usize }

impl MultiHeadAttention {
    fn new(dim: usize, num_heads: usize) -> Self { Self { dim, num_heads } }
    fn num_heads(&self) -> usize { self.num_heads }
    fn dim(&self) -> usize { self.dim }
    fn compute(&self, query: &[f32], keys: &[&[f32]], values: &[&[f32]]) -> Result<Vec<f32>, String> {
        let head_dim = self.dim / self.num_heads;
        let scale = 1.0 / (head_dim as f32).sqrt();
        let mut out = vec![0.0f32; self.dim];
        for h in 0..self.num_heads {
            let start = h * head_dim;
            let end = start + head_dim;
            let q_head = &query[start.min(query.len())..end.min(query.len())];
            let k_heads: Vec<Vec<f32>> = keys.iter().map(|k| k[start.min(k.len())..end.min(k.len())].to_vec()).collect();
            let v_heads: Vec<Vec<f32>> = values.iter().map(|v| v[start.min(v.len())..end.min(v.len())].to_vec()).collect();
            let k_refs: Vec<&[f32]> = k_heads.iter().map(|k| k.as_slice()).collect();
            let v_refs: Vec<&[f32]> = v_heads.iter().map(|v| v.as_slice()).collect();
            if !k_refs.is_empty() {
                let head_out = attend(q_head, &k_refs, &v_refs, scale)?;
                for (i, val) in head_out.iter().enumerate() {
                    if start + i < out.len() { out[start + i] = *val; }
                }
            }
        }
        Ok(out)
    }
}

// ── Hyperbolic Attention ─────────────────────────────────────────────────────

#[derive(Default)]
struct HyperbolicAttentionConfig { dim: usize, curvature: f32 }

struct HyperbolicAttention { config: HyperbolicAttentionConfig }

impl HyperbolicAttention {
    fn new(config: HyperbolicAttentionConfig) -> Self { Self { config } }
    fn compute(&self, query: &[f32], keys: &[&[f32]], values: &[&[f32]]) -> Result<Vec<f32>, String> {
        // Use Minkowski inner product for hyperbolic space scoring
        let c = self.config.curvature;
        let scores: Vec<f32> = keys.iter().map(|k| {
            let raw = dot(query, k);
            raw / (1.0 + c * raw.abs()).max(1e-7) // Mobius-inspired scaling
        }).collect();
        if scores.is_empty() { return Err("no keys".into()); }
        let weights = softmax(&scores);
        let dim = values[0].len();
        let mut out = vec![0.0f32; dim];
        for (w, v) in weights.iter().zip(values) {
            for (o, vi) in out.iter_mut().zip(*v) { *o += w * vi; }
        }
        Ok(out)
    }
}

// ── Linear Attention ─────────────────────────────────────────────────────────

struct LinearAttention { dim: usize, _num_features: usize }

impl LinearAttention {
    fn new(dim: usize, num_features: usize) -> Self { Self { dim, _num_features: num_features } }
    fn compute(&self, query: &[f32], keys: &[&[f32]], values: &[&[f32]]) -> Result<Vec<f32>, String> {
        // ELU(x)+1 kernel feature map for O(n) attention
        let phi = |x: f32| -> f32 { if x > 0.0 { x + 1.0 } else { x.exp() } };
        let phi_q: Vec<f32> = query.iter().map(|&x| phi(x)).collect();
        let scale = 1.0 / (self.dim as f32).sqrt();
        let scores: Vec<f32> = keys.iter().map(|k| {
            let phi_k: Vec<f32> = k.iter().map(|&x| phi(x)).collect();
            dot(&phi_q, &phi_k) * scale
        }).collect();
        if scores.is_empty() { return Err("no keys".into()); }
        let sum: f32 = scores.iter().sum::<f32>().max(1e-7);
        let weights: Vec<f32> = scores.iter().map(|s| s / sum).collect();
        let dim = values[0].len();
        let mut out = vec![0.0f32; dim];
        for (w, v) in weights.iter().zip(values) {
            for (o, vi) in out.iter_mut().zip(*v) { *o += w * vi; }
        }
        Ok(out)
    }
}

// ── Flash Attention ──────────────────────────────────────────────────────────

struct FlashAttention { dim: usize, block_size: usize }

impl FlashAttention {
    fn new(dim: usize, block_size: usize) -> Self { Self { dim, block_size } }
    fn compute(&self, query: &[f32], keys: &[&[f32]], values: &[&[f32]]) -> Result<Vec<f32>, String> {
        if keys.is_empty() { return Err("no keys".into()); }
        let scale = 1.0 / (self.dim as f32).sqrt();
        let n = keys.len();
        let val_dim = values[0].len();
        let mut out = vec![0.0f32; val_dim];
        let mut m = f32::NEG_INFINITY; // running max
        let mut d = 0.0f32;           // running denominator

        // Tiled online softmax (simplified block loop)
        let block = self.block_size.max(1);
        let mut i = 0;
        while i < n {
            let end = (i + block).min(n);
            let scores: Vec<f32> = keys[i..end].iter().map(|k| dot(query, k) * scale).collect();
            let m_new = scores.iter().cloned().fold(m, f32::max);
            let scale_old = (m - m_new).exp();
            d = d * scale_old + scores.iter().map(|s| (s - m_new).exp()).sum::<f32>();
            // rescale existing out
            for o in out.iter_mut() { *o *= scale_old; }
            for (j, s) in scores.iter().enumerate() {
                let w = (s - m_new).exp();
                let v = values[i + j];
                for (o, vi) in out.iter_mut().zip(v) { *o += w * vi; }
            }
            m = m_new;
            i = end;
        }
        let d = d.max(1e-7);
        for o in out.iter_mut() { *o /= d; }
        Ok(out)
    }
}

// ── Local-Global Attention ───────────────────────────────────────────────────

struct LocalGlobalAttention { dim: usize, local_window: usize, global_tokens: usize }

impl LocalGlobalAttention {
    fn new(dim: usize, local_window: usize, global_tokens: usize) -> Self {
        Self { dim, local_window, global_tokens }
    }
    fn compute(&self, query: &[f32], keys: &[&[f32]], values: &[&[f32]]) -> Result<Vec<f32>, String> {
        if keys.is_empty() { return Err("no keys".into()); }
        let scale = 1.0 / (self.dim as f32).sqrt();
        // Use global tokens + a local window around the midpoint
        let n = keys.len();
        let mid = n / 2;
        let local_start = mid.saturating_sub(self.local_window / 2);
        let local_end = (local_start + self.local_window).min(n);
        let global_end = self.global_tokens.min(n);

        let mut selected: Vec<usize> = (0..global_end).collect();
        for idx in local_start..local_end {
            if !selected.contains(&idx) { selected.push(idx); }
        }
        selected.sort_unstable();

        let sel_keys: Vec<&[f32]> = selected.iter().map(|&i| keys[i]).collect();
        let sel_vals: Vec<&[f32]> = selected.iter().map(|&i| values[i]).collect();
        attend(query, &sel_keys, &sel_vals, scale)
    }
}

// ── MoE Attention ────────────────────────────────────────────────────────────

struct MoEConfig { dim: usize, num_experts: usize, top_k: usize }

struct MoEConfigBuilder { dim: usize, num_experts: usize, top_k: usize }

impl MoEConfigBuilder {
    fn dim(mut self, v: usize) -> Self { self.dim = v; self }
    fn num_experts(mut self, v: usize) -> Self { self.num_experts = v; self }
    fn top_k(mut self, v: usize) -> Self { self.top_k = v; self }
    fn build(self) -> MoEConfig { MoEConfig { dim: self.dim, num_experts: self.num_experts, top_k: self.top_k } }
}

impl MoEConfig {
    fn builder() -> MoEConfigBuilder { MoEConfigBuilder { dim: 64, num_experts: 4, top_k: 2 } }
}

struct MoEAttention { config: MoEConfig }

impl MoEAttention {
    fn new(config: MoEConfig) -> Self { Self { config } }
    fn compute(&self, query: &[f32], keys: &[&[f32]], values: &[&[f32]]) -> Result<Vec<f32>, String> {
        if keys.is_empty() { return Err("no keys".into()); }
        let scale = 1.0 / (self.config.dim as f32).sqrt();
        // Partition keys/values into experts and pick top-k chunks
        let n = keys.len();
        let chunk_size = (n / self.config.num_experts).max(1);
        let mut expert_scores: Vec<(usize, f32)> = (0..self.config.num_experts).map(|e| {
            let start = e * chunk_size;
            let end = (start + chunk_size).min(n);
            let avg_score: f32 = if start < end {
                keys[start..end].iter().map(|k| dot(query, k) * scale).sum::<f32>() / (end - start) as f32
            } else { f32::NEG_INFINITY };
            (e, avg_score)
        }).collect();
        expert_scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let top_k = self.config.top_k.min(expert_scores.len());
        let mut selected_keys: Vec<&[f32]> = vec![];
        let mut selected_vals: Vec<&[f32]> = vec![];
        for &(e, _) in &expert_scores[..top_k] {
            let start = e * chunk_size;
            let end = (start + chunk_size).min(n);
            for i in start..end {
                selected_keys.push(keys[i]);
                selected_vals.push(values[i]);
            }
        }
        attend(query, &selected_keys, &selected_vals, scale)
    }
}

// ── WASM bindings ────────────────────────────────────────────────────────────

/// Compute scaled dot-product attention
#[wasm_bindgen]
pub fn scaled_dot_attention(
    query: &[f32],
    keys: JsValue,
    values: JsValue,
    scale: Option<f32>,
) -> Result<Vec<f32>, JsError> {
    let keys_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(keys)
        .map_err(|e| JsError::new(&format!("Failed to parse keys: {}", e)))?;
    let values_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(values)
        .map_err(|e| JsError::new(&format!("Failed to parse values: {}", e)))?;

    let keys_refs: Vec<&[f32]> = keys_vec.iter().map(|k| k.as_slice()).collect();
    let values_refs: Vec<&[f32]> = values_vec.iter().map(|v| v.as_slice()).collect();

    let dim = query.len();
    let s = scale.unwrap_or(1.0 / (dim as f32).sqrt());
    attend(query, &keys_refs, &values_refs, s)
        .map_err(|e| JsError::new(&e))
}

/// Multi-head attention mechanism
#[wasm_bindgen]
pub struct WasmMultiHeadAttention {
    inner: MultiHeadAttention,
}

#[wasm_bindgen]
impl WasmMultiHeadAttention {
    #[wasm_bindgen(constructor)]
    pub fn new(dim: usize, num_heads: usize) -> Result<WasmMultiHeadAttention, JsError> {
        if dim % num_heads != 0 {
            return Err(JsError::new(&format!(
                "Dimension {} must be divisible by number of heads {}",
                dim, num_heads
            )));
        }
        Ok(Self {
            inner: MultiHeadAttention::new(dim, num_heads),
        })
    }

    pub fn compute(&self, query: &[f32], keys: JsValue, values: JsValue) -> Result<Vec<f32>, JsError> {
        let keys_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(keys)?;
        let values_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(values)?;
        let keys_refs: Vec<&[f32]> = keys_vec.iter().map(|k| k.as_slice()).collect();
        let values_refs: Vec<&[f32]> = values_vec.iter().map(|v| v.as_slice()).collect();
        self.inner.compute(query, &keys_refs, &values_refs).map_err(|e| JsError::new(&e))
    }

    #[wasm_bindgen(getter)]
    pub fn num_heads(&self) -> usize { self.inner.num_heads() }

    #[wasm_bindgen(getter)]
    pub fn dim(&self) -> usize { self.inner.dim() }
}

/// Hyperbolic attention mechanism
#[wasm_bindgen]
pub struct WasmHyperbolicAttention {
    inner: HyperbolicAttention,
    curvature_value: f32,
}

#[wasm_bindgen]
impl WasmHyperbolicAttention {
    #[wasm_bindgen(constructor)]
    pub fn new(dim: usize, curvature: f32) -> WasmHyperbolicAttention {
        let config = HyperbolicAttentionConfig { dim, curvature };
        Self { inner: HyperbolicAttention::new(config), curvature_value: curvature }
    }

    pub fn compute(&self, query: &[f32], keys: JsValue, values: JsValue) -> Result<Vec<f32>, JsError> {
        let keys_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(keys)?;
        let values_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(values)?;
        let keys_refs: Vec<&[f32]> = keys_vec.iter().map(|k| k.as_slice()).collect();
        let values_refs: Vec<&[f32]> = values_vec.iter().map(|v| v.as_slice()).collect();
        self.inner.compute(query, &keys_refs, &values_refs).map_err(|e| JsError::new(&e))
    }

    #[wasm_bindgen(getter)]
    pub fn curvature(&self) -> f32 { self.curvature_value }
}

/// Linear attention (Performer-style)
#[wasm_bindgen]
pub struct WasmLinearAttention {
    inner: LinearAttention,
}

#[wasm_bindgen]
impl WasmLinearAttention {
    #[wasm_bindgen(constructor)]
    pub fn new(dim: usize, num_features: usize) -> WasmLinearAttention {
        Self { inner: LinearAttention::new(dim, num_features) }
    }

    pub fn compute(&self, query: &[f32], keys: JsValue, values: JsValue) -> Result<Vec<f32>, JsError> {
        let keys_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(keys)?;
        let values_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(values)?;
        let keys_refs: Vec<&[f32]> = keys_vec.iter().map(|k| k.as_slice()).collect();
        let values_refs: Vec<&[f32]> = values_vec.iter().map(|v| v.as_slice()).collect();
        self.inner.compute(query, &keys_refs, &values_refs).map_err(|e| JsError::new(&e))
    }
}

/// Flash attention mechanism
#[wasm_bindgen]
pub struct WasmFlashAttention {
    inner: FlashAttention,
}

#[wasm_bindgen]
impl WasmFlashAttention {
    #[wasm_bindgen(constructor)]
    pub fn new(dim: usize, block_size: usize) -> WasmFlashAttention {
        Self { inner: FlashAttention::new(dim, block_size) }
    }

    pub fn compute(&self, query: &[f32], keys: JsValue, values: JsValue) -> Result<Vec<f32>, JsError> {
        let keys_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(keys)?;
        let values_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(values)?;
        let keys_refs: Vec<&[f32]> = keys_vec.iter().map(|k| k.as_slice()).collect();
        let values_refs: Vec<&[f32]> = values_vec.iter().map(|v| v.as_slice()).collect();
        self.inner.compute(query, &keys_refs, &values_refs).map_err(|e| JsError::new(&e))
    }
}

/// Local-global attention mechanism
#[wasm_bindgen]
pub struct WasmLocalGlobalAttention {
    inner: LocalGlobalAttention,
}

#[wasm_bindgen]
impl WasmLocalGlobalAttention {
    #[wasm_bindgen(constructor)]
    pub fn new(dim: usize, local_window: usize, global_tokens: usize) -> WasmLocalGlobalAttention {
        Self { inner: LocalGlobalAttention::new(dim, local_window, global_tokens) }
    }

    pub fn compute(&self, query: &[f32], keys: JsValue, values: JsValue) -> Result<Vec<f32>, JsError> {
        let keys_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(keys)?;
        let values_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(values)?;
        let keys_refs: Vec<&[f32]> = keys_vec.iter().map(|k| k.as_slice()).collect();
        let values_refs: Vec<&[f32]> = values_vec.iter().map(|v| v.as_slice()).collect();
        self.inner.compute(query, &keys_refs, &values_refs).map_err(|e| JsError::new(&e))
    }
}

/// Mixture of Experts (MoE) attention
#[wasm_bindgen]
pub struct WasmMoEAttention {
    inner: MoEAttention,
}

#[wasm_bindgen]
impl WasmMoEAttention {
    #[wasm_bindgen(constructor)]
    pub fn new(dim: usize, num_experts: usize, top_k: usize) -> WasmMoEAttention {
        let config = MoEConfig::builder()
            .dim(dim)
            .num_experts(num_experts)
            .top_k(top_k)
            .build();
        Self { inner: MoEAttention::new(config) }
    }

    pub fn compute(&self, query: &[f32], keys: JsValue, values: JsValue) -> Result<Vec<f32>, JsError> {
        let keys_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(keys)?;
        let values_vec: Vec<Vec<f32>> = serde_wasm_bindgen::from_value(values)?;
        let keys_refs: Vec<&[f32]> = keys_vec.iter().map(|k| k.as_slice()).collect();
        let values_refs: Vec<&[f32]> = values_vec.iter().map(|v| v.as_slice()).collect();
        self.inner.compute(query, &keys_refs, &values_refs).map_err(|e| JsError::new(&e))
    }
}

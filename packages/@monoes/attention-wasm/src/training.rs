use wasm_bindgen::prelude::*;

// ── Inline implementations (ruvector_attention crate is not in WASM build) ──

struct InfoNCELoss {
    temperature: f32,
}

impl InfoNCELoss {
    fn new(temperature: f32) -> Self {
        Self { temperature }
    }

    fn compute(&self, anchor: &[f32], positive: &[f32], negatives: &[&[f32]]) -> f32 {
        let dot = |a: &[f32], b: &[f32]| -> f32 { a.iter().zip(b).map(|(x, y)| x * y).sum() };
        let pos_sim = dot(anchor, positive) / self.temperature;
        let neg_sims: Vec<f32> = negatives.iter().map(|n| dot(anchor, n) / self.temperature).collect();
        let max_sim = neg_sims.iter().cloned().fold(pos_sim, f32::max);
        let denom = (pos_sim - max_sim).exp()
            + neg_sims.iter().map(|s| (s - max_sim).exp()).sum::<f32>();
        -((pos_sim - max_sim).exp() / denom).ln()
    }
}

struct Adam {
    param_count: usize,
    lr: f32,
    beta1: f32,
    beta2: f32,
    eps: f32,
    m: Vec<f32>,
    v: Vec<f32>,
    t: usize,
}

impl Adam {
    fn new(param_count: usize, learning_rate: f32) -> Self {
        Self {
            param_count,
            lr: learning_rate,
            beta1: 0.9,
            beta2: 0.999,
            eps: 1e-8,
            m: vec![0.0; param_count],
            v: vec![0.0; param_count],
            t: 0,
        }
    }

    fn step(&mut self, params: &mut [f32], gradients: &[f32]) {
        self.t += 1;
        let bc1 = 1.0 - self.beta1.powi(self.t as i32);
        let bc2 = 1.0 - self.beta2.powi(self.t as i32);
        for i in 0..self.param_count.min(params.len()).min(gradients.len()) {
            self.m[i] = self.beta1 * self.m[i] + (1.0 - self.beta1) * gradients[i];
            self.v[i] = self.beta2 * self.v[i] + (1.0 - self.beta2) * gradients[i] * gradients[i];
            let m_hat = self.m[i] / bc1;
            let v_hat = self.v[i] / bc2;
            params[i] -= self.lr * m_hat / (v_hat.sqrt() + self.eps);
        }
    }

    fn reset(&mut self) {
        self.m.fill(0.0);
        self.v.fill(0.0);
        self.t = 0;
    }

    fn learning_rate(&self) -> f32 { self.lr }
    fn set_learning_rate(&mut self, lr: f32) { self.lr = lr; }
}

struct AdamW {
    inner: Adam,
    weight_decay: f32,
}

impl AdamW {
    fn new(param_count: usize, learning_rate: f32) -> Self {
        Self { inner: Adam::new(param_count, learning_rate), weight_decay: 0.01 }
    }

    fn with_weight_decay(mut self, wd: f32) -> Self {
        self.weight_decay = wd;
        self
    }

    fn step(&mut self, params: &mut [f32], gradients: &[f32]) {
        // Apply weight decay before Adam update
        let wd = self.weight_decay;
        let lr = self.inner.lr;
        for p in params.iter_mut() {
            *p -= lr * wd * *p;
        }
        self.inner.step(params, gradients);
    }

    fn reset(&mut self) { self.inner.reset(); }
    fn learning_rate(&self) -> f32 { self.inner.lr }
    fn set_learning_rate(&mut self, lr: f32) { self.inner.set_learning_rate(lr); }
}

struct SGD {
    param_count: usize,
    lr: f32,
    momentum: f32,
    velocity: Vec<f32>,
}

impl SGD {
    fn new(param_count: usize, learning_rate: f32) -> Self {
        Self { param_count, lr: learning_rate, momentum: 0.0, velocity: vec![0.0; param_count] }
    }

    fn with_momentum(mut self, m: f32) -> Self {
        self.momentum = m;
        self
    }

    fn step(&mut self, params: &mut [f32], gradients: &[f32]) {
        for i in 0..self.param_count.min(params.len()).min(gradients.len()) {
            self.velocity[i] = self.momentum * self.velocity[i] + gradients[i];
            params[i] -= self.lr * self.velocity[i];
        }
    }

    fn reset(&mut self) { self.velocity.fill(0.0); }
    fn learning_rate(&self) -> f32 { self.lr }
    fn set_learning_rate(&mut self, lr: f32) { self.lr = lr; }
}

// ── WASM bindings ────────────────────────────────────────────────────────────

/// InfoNCE contrastive loss for training
#[wasm_bindgen]
pub struct WasmInfoNCELoss {
    inner: InfoNCELoss,
}

#[wasm_bindgen]
impl WasmInfoNCELoss {
    /// Create a new InfoNCE loss instance
    #[wasm_bindgen(constructor)]
    pub fn new(temperature: f32) -> WasmInfoNCELoss {
        Self {
            inner: InfoNCELoss::new(temperature),
        }
    }

    /// Compute InfoNCE loss
    pub fn compute(
        &self,
        anchor: &[f32],
        positive: &[f32],
        negatives: JsValue,
    ) -> Result<f32, JsError> {
        let array = js_sys::Array::from(&negatives);
        let mut negatives_vec: Vec<Vec<f32>> = Vec::with_capacity(array.length() as usize);
        for i in 0..array.length() {
            let typed_arr = js_sys::Float32Array::new(&array.get(i));
            negatives_vec.push(typed_arr.to_vec());
        }
        let negatives_refs: Vec<&[f32]> = negatives_vec.iter().map(|n| n.as_slice()).collect();
        Ok(self.inner.compute(anchor, positive, &negatives_refs))
    }
}

/// Adam optimizer
#[wasm_bindgen]
pub struct WasmAdam {
    inner: Adam,
}

#[wasm_bindgen]
impl WasmAdam {
    #[wasm_bindgen(constructor)]
    pub fn new(param_count: usize, learning_rate: f32) -> WasmAdam {
        Self {
            inner: Adam::new(param_count, learning_rate),
        }
    }

    pub fn step(&mut self, params: &mut [f32], gradients: &[f32]) {
        self.inner.step(params, gradients);
    }

    pub fn reset(&mut self) {
        self.inner.reset();
    }

    #[wasm_bindgen(getter)]
    pub fn learning_rate(&self) -> f32 {
        self.inner.learning_rate()
    }

    #[wasm_bindgen(setter)]
    pub fn set_learning_rate(&mut self, lr: f32) {
        self.inner.set_learning_rate(lr);
    }
}

/// AdamW optimizer (Adam with decoupled weight decay)
#[wasm_bindgen]
pub struct WasmAdamW {
    inner: AdamW,
    wd: f32,
}

#[wasm_bindgen]
impl WasmAdamW {
    #[wasm_bindgen(constructor)]
    pub fn new(param_count: usize, learning_rate: f32, weight_decay: f32) -> WasmAdamW {
        let optimizer = AdamW::new(param_count, learning_rate).with_weight_decay(weight_decay);
        Self {
            inner: optimizer,
            wd: weight_decay,
        }
    }

    pub fn step(&mut self, params: &mut [f32], gradients: &[f32]) {
        self.inner.step(params, gradients);
    }

    pub fn reset(&mut self) {
        self.inner.reset();
    }

    #[wasm_bindgen(getter)]
    pub fn learning_rate(&self) -> f32 {
        self.inner.learning_rate()
    }

    #[wasm_bindgen(setter)]
    pub fn set_learning_rate(&mut self, lr: f32) {
        self.inner.set_learning_rate(lr);
    }

    #[wasm_bindgen(getter)]
    pub fn weight_decay(&self) -> f32 {
        self.wd
    }
}

/// SGD optimizer with momentum
#[wasm_bindgen]
pub struct WasmSGD {
    inner: SGD,
}

#[wasm_bindgen]
impl WasmSGD {
    #[wasm_bindgen(constructor)]
    pub fn new(param_count: usize, learning_rate: f32, momentum: Option<f32>) -> WasmSGD {
        let mut optimizer = SGD::new(param_count, learning_rate);
        if let Some(m) = momentum {
            optimizer = optimizer.with_momentum(m);
        }
        Self { inner: optimizer }
    }

    pub fn step(&mut self, params: &mut [f32], gradients: &[f32]) {
        self.inner.step(params, gradients);
    }

    pub fn reset(&mut self) {
        self.inner.reset();
    }

    #[wasm_bindgen(getter)]
    pub fn learning_rate(&self) -> f32 {
        self.inner.learning_rate()
    }

    #[wasm_bindgen(setter)]
    pub fn set_learning_rate(&mut self, lr: f32) {
        self.inner.set_learning_rate(lr);
    }
}

/// Learning rate scheduler
#[wasm_bindgen]
pub struct WasmLRScheduler {
    initial_lr: f32,
    current_step: usize,
    warmup_steps: usize,
    total_steps: usize,
}

#[wasm_bindgen]
impl WasmLRScheduler {
    #[wasm_bindgen(constructor)]
    pub fn new(initial_lr: f32, warmup_steps: usize, total_steps: usize) -> WasmLRScheduler {
        Self {
            initial_lr,
            current_step: 0,
            warmup_steps,
            total_steps,
        }
    }

    pub fn get_lr(&self) -> f32 {
        if self.current_step < self.warmup_steps {
            self.initial_lr * (self.current_step as f32 / self.warmup_steps as f32)
        } else {
            let progress = (self.current_step - self.warmup_steps) as f32
                / (self.total_steps - self.warmup_steps) as f32;
            let cosine = 0.5 * (1.0 + (std::f32::consts::PI * progress).cos());
            self.initial_lr * cosine
        }
    }

    pub fn step(&mut self) {
        self.current_step += 1;
    }

    pub fn reset(&mut self) {
        self.current_step = 0;
    }
}

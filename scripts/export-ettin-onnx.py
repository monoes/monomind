#!/usr/bin/env python3
"""Export cross-encoder/ettin-reranker-32m-v1 to a single ONNX with logits output.

The upstream HF ONNX only contains the base ModernBERT encoder (outputs
last_hidden_state). The sentence-transformers classifier head lives in separate
module safetensors files. This script bakes everything into one ONNX:

  base encoder -> CLS pooling -> Dense(384,384)+GELU -> LayerNorm(384) -> Dense(384,1) -> logits

Usage:
  pip install torch transformers safetensors huggingface_hub onnx
  python scripts/export-ettin-onnx.py [--output ~/.monomind/models/ettin-reranker-32m-v1-onnx]

The output directory is ready for transformers.js AutoModelForSequenceClassification.
"""

import argparse
import json
import os
import shutil

import torch
import torch.nn as nn
from huggingface_hub import hf_hub_download
from safetensors.torch import load_file
from transformers import AutoModel

MODEL_ID = "cross-encoder/ettin-reranker-32m-v1"
DEFAULT_OUT = os.path.join(os.path.expanduser("~"), ".monomind", "models", "ettin-reranker-32m-v1-onnx")


class EttinReranker(nn.Module):
    """Combined base encoder + sentence-transformers classifier head."""

    def __init__(self, base_model, dense1_weights, ln_weights, dense2_weights):
        super().__init__()
        self.base = base_model
        # 2_Dense: Linear(384->384, no bias) + GELU
        self.dense1 = nn.Linear(384, 384, bias=False)
        self.dense1.weight = nn.Parameter(dense1_weights["linear.weight"])
        self.gelu = nn.GELU()
        # 3_LayerNorm: LayerNorm(384)
        self.ln = nn.LayerNorm(384)
        self.ln.weight = nn.Parameter(ln_weights["norm.weight"])
        self.ln.bias = nn.Parameter(ln_weights["norm.bias"])
        # 4_Dense: Linear(384->1, bias) + Identity
        self.dense2 = nn.Linear(384, 1, bias=True)
        self.dense2.weight = nn.Parameter(dense2_weights["linear.weight"])
        self.dense2.bias = nn.Parameter(dense2_weights["linear.bias"])

    def forward(self, input_ids, attention_mask):
        out = self.base(input_ids=input_ids, attention_mask=attention_mask)
        cls = out.last_hidden_state[:, 0, :]  # CLS pooling
        x = self.gelu(self.dense1(cls))
        x = self.ln(x)
        return self.dense2(x)  # logits [batch, 1]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", default=DEFAULT_OUT, help="Output directory")
    parser.add_argument("--opset", type=int, default=17, help="ONNX opset version")
    args = parser.parse_args()

    out_dir = args.output
    onnx_dir = os.path.join(out_dir, "onnx")
    os.makedirs(onnx_dir, exist_ok=True)

    print(f"Loading base model from {MODEL_ID}...")
    base = AutoModel.from_pretrained(MODEL_ID)

    print("Loading classifier head weights...")
    d1 = load_file(hf_hub_download(MODEL_ID, "2_Dense/model.safetensors"))
    ln = load_file(hf_hub_download(MODEL_ID, "3_LayerNorm/model.safetensors"))
    d2 = load_file(hf_hub_download(MODEL_ID, "4_Dense/model.safetensors"))

    combined = EttinReranker(base, d1, ln, d2)
    combined.eval()

    # Sanity check
    dummy_ids = torch.tensor([[101, 2023, 2003, 1037, 3231, 102, 2023, 2003, 1037, 6251, 102]])
    dummy_mask = torch.ones_like(dummy_ids)
    with torch.no_grad():
        logits = combined(dummy_ids, dummy_mask)
    print(f"Sanity check: logits={logits.item():.4f}, sigmoid={torch.sigmoid(logits).item():.4f}")

    # Export
    onnx_path = os.path.join(onnx_dir, "model.onnx")
    print(f"Exporting ONNX to {onnx_path}...")
    torch.onnx.export(
        combined,
        (dummy_ids, dummy_mask),
        onnx_path,
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "logits": {0: "batch"},
        },
        opset_version=args.opset,
        do_constant_folding=True,
    )

    # Verify
    import onnx
    m = onnx.load(onnx_path)
    outputs = [o.name for o in m.graph.output]
    assert "logits" in outputs, f"Expected 'logits' in outputs, got {outputs}"
    size_mb = os.path.getsize(onnx_path) / 1024 / 1024
    print(f"ONNX OK: outputs={outputs}, size={size_mb:.1f} MB")

    # Copy tokenizer + patched config
    for f in ["tokenizer.json", "tokenizer_config.json"]:
        shutil.copy2(hf_hub_download(MODEL_ID, f), os.path.join(out_dir, f))

    config_src = hf_hub_download(MODEL_ID, "config.json")
    with open(config_src) as fh:
        config = json.load(fh)
    config["num_labels"] = 1
    config["architectures"] = ["ModernBertForSequenceClassification"]
    with open(os.path.join(out_dir, "config.json"), "w") as fh:
        json.dump(config, fh, indent=2)

    print(f"\nDone. Model ready at {out_dir}")


if __name__ == "__main__":
    main()

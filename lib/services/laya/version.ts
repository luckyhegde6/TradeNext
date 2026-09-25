/**
 * Laya checkpoint provenance + Python package version (spec 18, P1).
 *
 * Mirrors `laya/__init__.py` `__version__` and pins the exact HF checkpoint the
 * real inference path (P3) loads, so a weights re-fetch can never silently swap
 * in a different model.
 */

/** Python `laya.__version__` (raw.githubusercontent.com/NandhaKishorM/laya @ c7527708). */
export const LAYA_VERSION = "0.3.6";

/** HF repo + subfolder the runtime weights home (`lib/services/laya/weights/`) is populated from. */
export const LAYA_CHECKPOINT = {
  pythonVersion: LAYA_VERSION,
  hfRepo: "nvkudva/laya-web-q8",
  subfolder: "v1",
  modelName: "rl-agent", // rl_agent_config.json "model_name"
  encoder: "answerdotai/ModernBERT-large", // rl_agent_config.json "encoder"
  artifacts: [
    "encoder_q8.onnx",
    "encoder_q8.onnx.data",
    "head_q8.onnx",
    "head_q8.onnx.data",
    "tokenizer.json",
    "tokenizer_config.json",
    "rl_agent_config.json",
  ] as const,
} as const;

export type LayaArtifactName = (typeof LAYA_CHECKPOINT.artifacts)[number];
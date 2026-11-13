/**
 * 离线音素级 GOP（Goodness of Pronunciation）声学模型配置。
 *
 * 采用 `onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX`（4-bit 量化版 ~230 MB + IPA vocab.json），
 * 在本地通过 onnxruntime-node 对 16kHz PCM 音频输出帧级 IPA 音素后验概率，
 * 再做 CTC 强制对齐与音素准确度评分。
 */

export const PHONEME_GOP_MODEL_DIRECTORY = 'wav2vec2-lv-60-espeak-cv-ft-onnx';
export const PHONEME_GOP_MODEL_FILE = 'model_q4.onnx';
export const PHONEME_GOP_VOCAB_FILE = 'vocab.json';

export const PHONEME_GOP_REQUIRED_FILES = [
    PHONEME_GOP_MODEL_FILE,
    PHONEME_GOP_VOCAB_FILE,
] as const;

export const PHONEME_GOP_MODEL_URLS = [
    'https://hf-mirror.com/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX/resolve/main/onnx/model_q4.onnx',
    'https://huggingface.co/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX/resolve/main/onnx/model_q4.onnx',
] as const;

export const PHONEME_GOP_VOCAB_URLS = [
    'https://hf-mirror.com/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX/resolve/main/vocab.json',
    'https://huggingface.co/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX/resolve/main/vocab.json',
] as const;

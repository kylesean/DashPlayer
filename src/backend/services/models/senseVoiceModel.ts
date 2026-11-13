/**
 * 离线多语种（中文 + 英文 + 粤/日/韩）对话语音识别模型配置。
 *
 * 采用 FunAudioLLM **SenseVoiceSmall** INT8（`csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`）：
 * - 直接由随应用分发的 `sherpa-onnx-offline` 执行（无需额外二进制）；
 * - 原生支持中英混说（code-switching）与逆文本正则化（标点与数字格式）；
 * - 总体积约 228 MB（`model.int8.onnx` + `tokens.txt`），优先走 `hf-mirror.com` 国内镜像。
 */

export const SENSE_VOICE_MODEL_DIRECTORY = 'sense-voice-zh-en-ja-ko-yue-2024-07-17';
export const SENSE_VOICE_MODEL_FILE = 'model.int8.onnx';
export const SENSE_VOICE_TOKENS_FILE = 'tokens.txt';

export const SENSE_VOICE_REQUIRED_FILES = [
    SENSE_VOICE_MODEL_FILE,
    SENSE_VOICE_TOKENS_FILE,
] as const;

export const SENSE_VOICE_MODEL_URLS = [
    'https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx',
    'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx',
] as const;

export const SENSE_VOICE_TOKENS_URLS = [
    'https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt',
    'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt',
] as const;

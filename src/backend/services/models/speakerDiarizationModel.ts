/**
 * 说话人分离模型的固定安装信息。
 *
 * 两个文件缺一不可：Pyannote 分割模型负责「哪里是语音」，3D-Speaker 声纹
 * 嵌入模型负责「这段是谁」。只有分割模型时无法聚类，只有嵌入模型时无法
 * 切出可比较的语音段。
 */

/** 分割模型（Pyannote segmentation 3.0）安装目录名。 */
export const DIARIZATION_SEGMENTATION_DIRECTORY = 'sherpa-onnx-pyannote-segmentation-3-0';

/** 分割模型文件名；官方归档内同时提供 model.onnx 与 model.int8.onnx，用完整精度版保证聚类稳定性。 */
export const DIARIZATION_SEGMENTATION_FILE = 'model.onnx';

/** 分割模型归档文件名。 */
export const DIARIZATION_SEGMENTATION_ARCHIVE_NAME = 'sherpa-onnx-pyannote-segmentation-3-0.tar.bz2';

/** 分割模型归档的 SHA256（下载后校验，防止镜像或代理被篡改）。 */
export const DIARIZATION_SEGMENTATION_ARCHIVE_SHA256 = '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488';

/** 分割模型归档下载地址。 */
export const DIARIZATION_SEGMENTATION_DOWNLOAD_URL =
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2';

/** 声纹嵌入模型安装目录名（与分割模型分开放，便于各自替换）。 */
export const DIARIZATION_EMBEDDING_DIRECTORY = '3dspeaker-eres2net-base-16k';

/** 声纹嵌入模型文件名。 */
export const DIARIZATION_EMBEDDING_FILE = '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx';

/** 声纹嵌入模型精确字节数，用于完整性校验。 */
export const DIARIZATION_EMBEDDING_BYTES = 39593761;

/** 声纹嵌入模型 SHA256。 */
export const DIARIZATION_EMBEDDING_SHA256 = '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b';

/** 声纹嵌入模型下载地址。 */
export const DIARIZATION_EMBEDDING_DOWNLOAD_URL =
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx';

/** 声纹嵌入模型下载工作目录名（断点续传依赖固定路径）。 */
export const DIARIZATION_EMBEDDING_WORK_DIRECTORY = '.diarization-embedding-download';

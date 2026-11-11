import { z } from 'zod';

import type { SimpleClipQuery } from '@/common/api/dto';import {
    APPEARANCE_THEME_FAMILIES,
    type AppearanceSettingVO,
} from '@/common/contracts/appearance-setting-vo';
import type { MobileAccessSettingSaveVO } from '@/common/contracts/mobile-access-setting-vo';
import type { ProxySettingSaveVO } from '@/common/contracts/proxy-setting-vo';
import type { RuntimeSettingSaveRequest } from '@/common/contracts/runtime-settings';
import type {
    SentencePracticeDictationParams,
    SentencePracticeShadowingParams,
} from '@/common/contracts/sentence-practice';
import type { StorageSettingVO } from '@/common/contracts/storage-setting-vo';
import type { SubtitleTimestampAdjustmentInput } from '@/common/contracts/subtitle-timestamp-adjustment';
import { TRANSCRIPTION_ENGINES, type TranscriptionEngine } from '@/common/contracts/transcription-engine';
import type { YoutubeImportSettingSaveVO } from '@/common/contracts/youtube-import';
import type { AnalysisStartParams } from '@/common/types/analysis';
import type {
    ChatSendMessageParams,
    ChatSessionCloseParams,
    ChatSessionCreateParams,
    ChatSessionStopParams,
    CompleteSentenceParams,
} from '@/common/types/chat';
import { ClipSrtLineSchema } from '@/common/types/clipMeta/ClipMetaDataV1';
import type { WindowState } from '@/common/types/Types';
import type { EngineSelectionSettingVO } from '@/common/types/vo/engine-selection-setting-vo';
import type { ServiceCredentialSettingSaveVO } from '@/common/types/vo/service-credentials-setting-vo';
import type { ShortcutSettingSaveVO } from '@/common/types/vo/shortcut-setting-vo';
import { AI_API_FORMATS, type AiApiFormat } from '@/common/utils/cloud-ai-api-format';

/** 非空字符串基础校验。 */
export const nonEmptyStringSchema = z.string().min(1);

/** 正整数 ID 基础校验。 */
export const positiveIntSchema = z.number().int().positive();

/** 有限非负浮点数（秒/毫秒位置）基础校验。 */
export const finiteNonNegativeNumberSchema = z.number().finite().min(0);

/** 云端 API 格式枚举校验。 */
const aiApiFormatSchema: z.ZodType<AiApiFormat> = z.enum(
    AI_API_FORMATS as unknown as [AiApiFormat, ...AiApiFormat[]],
);

/** 主窗口目标状态校验。 */
export const windowStateSchema: z.ZodType<WindowState> = z.enum([
    'normal',
    'maximized',
    'minimized',
    'fullscreen',
    'closed',
    'home',
    'player',
]);

/** 运行时单键设置保存请求校验架构。 */
export const runtimeSettingSaveSchema: z.ZodType<RuntimeSettingSaveRequest> = z.object({
    key: z.enum([
        'appearance.theme',
        'appearance.themeFamily',
        'appearance.transcriptPosition',
        'player.autoPlayNext',
        'player.pauseOnWordHover',
        'player.vocabularyGuidance',
        'player.adaptiveChinese',
        'userSelect.playbackRateStack',
    ]),
    value: z.string(),
});

/** 云端服务凭据保存请求校验架构。 */
export const serviceCredentialSaveSchema: z.ZodType<ServiceCredentialSettingSaveVO> = z.object({
    openai: z.object({
        key: z.string(),
        endpoint: z.string(),
        apiFormat: aiApiFormatSchema,
        models: z.array(z.string()),
    }),
    tencent: z.object({
        secretId: z.string(),
        secretKey: z.string(),
    }),
});

/** 功能与引擎选择保存请求校验架构。 */
export const engineSelectionSaveSchema: z.ZodType<EngineSelectionSettingVO> = z.object({
    openai: z.object({
        enableSentenceLearning: z.boolean(),
        subtitleTranslationMode: z.enum(['zh', 'simple_en', 'custom', 'invalid']),
        subtitleCustomStyle: z.string(),
        featureModels: z.object({
            sentenceLearning: z.string(),
            subtitleTranslation: z.string(),
            dictionary: z.string(),
        }),
    }),
    providers: z.object({
        subtitleTranslationEngine: z.enum(['openai', 'local', 'local-mt', 'tencent', 'none', 'invalid']),
        dictionaryEngine: z.enum(['openai', 'local', 'none', 'invalid']),
    }),
    invalidValues: z.object({
        'providers.subtitleTranslation': z.string().optional(),
        'providers.dictionary': z.string().optional(),
        'features.openai.subtitleTranslationMode': z.string().optional(),
    }),
});

/** 转录引擎枚举校验架构。 */
export const transcriptionEngineSchema: z.ZodType<TranscriptionEngine> = z.enum(
    TRANSCRIPTION_ENGINES as unknown as [TranscriptionEngine, ...TranscriptionEngine[]],
);

/** 快捷键设置保存请求校验架构。 */
export const shortcutSettingSaveSchema: z.ZodType<ShortcutSettingSaveVO> = z.object({
    previousSentence: z.string(),
    nextSentence: z.string(),
    repeatSentence: z.string(),
    playPause: z.string(),
    repeatSingleSentence: z.string(),
    autoPause: z.string(),
    toggleEnglishDisplay: z.string(),
    toggleChineseDisplay: z.string(),
    toggleBilingualDisplay: z.string(),
    toggleWordLevelDisplay: z.string(),
    nextTheme: z.string(),
    adjustBeginMinus: z.string(),
    adjustBeginPlus: z.string(),
    adjustEndMinus: z.string(),
    adjustEndPlus: z.string(),
    clearAdjust: z.string(),
    nextPlaybackRate: z.string(),
    aiChat: z.string(),
    openControlPanel: z.string(),
    volumeUp: z.string(),
    volumeDown: z.string(),
    seekBackward: z.string(),
    seekForward: z.string(),
});

/** 外观设置保存请求校验架构。 */
export const appearanceSettingSchema: z.ZodType<AppearanceSettingVO> = z.object({
    theme: z.enum(['dark', 'light', 'system']),
    themeFamily: z.enum(APPEARANCE_THEME_FAMILIES).optional(),
    fontSize: z.enum(['fontSizeSmall', 'fontSizeMedium', 'fontSizeLarge']),
    language: z.enum(['system', 'zh-CN', 'en-US']),
    transcriptPosition: z.enum(['right', 'left']).optional(),
});

/** 存储路径设置保存请求校验架构。 */
export const storageSettingSchema: z.ZodType<StorageSettingVO> = z.object({
    path: z.string(),
});

/** 代理设置保存请求校验架构。 */
export const proxySettingSaveSchema: z.ZodType<ProxySettingSaveVO> = z.object({
    mode: z.enum(['system', 'custom', 'none']),
    url: z.string(),
    bypassRules: z.string(),
});

/** 手机端访问设置保存请求校验架构。 */
export const mobileAccessSettingSaveSchema: z.ZodType<MobileAccessSettingSaveVO> = z.object({
    enabled: z.boolean(),
    port: z.number().int().min(1).max(65535),
});

/** YouTube 导入设置保存请求校验架构。 */
export const youtubeImportSettingSaveSchema: z.ZodType<YoutubeImportSettingSaveVO> = z.object({
    enabled: z.boolean(),
    cookiesFilePath: z.string(),
});

/** 整句学习会话创建请求校验架构。 */
export const chatSessionCreateSchema: z.ZodType<ChatSessionCreateParams> = z.object({
    videoId: nonEmptyStringSchema,
    originalTopic: z.string(),
    paragraphLines: z.array(z.string()),
    subtitleFileHash: nonEmptyStringSchema,
    anchorSentenceIndex: z.number().int().min(0),
});

/** 整句学习发送消息请求校验架构。 */
export const chatSendMessageSchema: z.ZodType<ChatSendMessageParams> = z.object({
    sessionId: nonEmptyStringSchema,
    content: nonEmptyStringSchema,
});

/** 整句学习关闭会话请求校验架构。 */
export const chatSessionCloseSchema: z.ZodType<ChatSessionCloseParams> = z.object({
    sessionId: nonEmptyStringSchema,
});

/** 整句学习停止生成请求校验架构。 */
export const chatSessionStopSchema: z.ZodType<ChatSessionStopParams> = z.object({
    sessionId: nonEmptyStringSchema,
});

/** 结构化句子分析启动请求校验架构。 */
export const analysisStartSchema: z.ZodType<AnalysisStartParams> = z.object({
    sessionId: nonEmptyStringSchema,
});

/** 完整句补全请求校验架构。 */
export const completeSentenceSchema: z.ZodType<CompleteSentenceParams> = z.object({
    text: z.string(),
    precedingLines: z.array(z.string()),
    followingLines: z.array(z.string()),
});

/** 视频学习片段分页检索条件校验架构。 */
export const simpleClipQuerySchema: z.ZodType<SimpleClipQuery> = z.object({
    word: z.string(),
    page: positiveIntSchema.optional(),
    pageSize: positiveIntSchema.optional(),
});

/** 收藏/视频学习片段字幕行集合校验架构。 */
export const clipContentLinesSchema = z.array(ClipSrtLineSchema);

/** 字幕时间戳调整写入请求校验架构。 */
export const subtitleTimestampAdjustmentInputSchema: z.ZodType<SubtitleTimestampAdjustmentInput> = z.object({
    id: z.number().int().optional(),
    key: nonEmptyStringSchema,
    subtitle_path: z.string().nullable().optional(),
    subtitle_hash: z.string().nullable().optional(),
    start_at: z.number().finite().nullable().optional(),
    end_at: z.number().finite().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
});

/** 跟读录音评分请求校验架构。 */
export const shadowingParamsSchema: z.ZodType<SentencePracticeShadowingParams> = z.object({
    fileHash: nonEmptyStringSchema,
    sentenceIndex: z.number().int().min(0),
    resegmented: z.boolean(),
    audio: z.instanceof(Uint8Array),
    expectedText: z.string(),
});

/** 听写文本评分请求校验架构。 */
export const dictationParamsSchema: z.ZodType<SentencePracticeDictationParams> = z.object({
    fileHash: nonEmptyStringSchema,
    sentenceIndex: z.number().int().min(0),
    resegmented: z.boolean(),
    typedText: z.string(),
    expectedText: nonEmptyStringSchema,
});

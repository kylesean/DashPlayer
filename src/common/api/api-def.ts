import type {DpTask} from '@/common/contracts/dp-task';
import type { YoutubeImportSettingDetailVO, YoutubeImportSettingSaveVO, YoutubeImportStartResult } from '@/common/contracts/youtube-import';
import type { LocalAiSpeedTestResult, LocalAiStatus } from '@/common/contracts/local-ai';
import type { ResourceFallbackSnapshot } from '@/common/contracts/resource-fallback';
import type { ResourceStatusSnapshot } from '@/common/contracts/resource-status';
import type { MigrationFailureDetail } from '@/common/contracts/migration-failure';
import type { GpuAcceleration } from '@/common/contracts/system-info';
import type { SubtitleResolution } from '@/common/contracts/subtitle-resolution';
import type { ImportedDictionaryVO } from '@/common/contracts/imported-dictionary';
import type { EnglishDictionaryStatusVO } from '@/common/contracts/english-dictionary';
import type {OpenAIDictionaryResult} from '@/common/types/DictionaryResult';
import type {
    WordContextInsightParams,
    WordContextInsightResponse,
} from '@/common/types/wordInsight';
import type {SrtSentence} from '@/common/types/SentenceC';
import type {SentenceStruct} from '@/common/types/SentenceStruct';
import type {WindowState} from '@/common/types/Types';
import type {SubtitleTimestampAdjustmentInput} from '@/common/contracts/subtitle-timestamp-adjustment';
import type { UpdateCheckResult } from '@/common/types/update-check';

import type {SimpleClipQuery} from '@/common/api/dto';
import type {ClipMeta} from '@/common/types/clipMeta';
import type WatchHistoryVO from '@/common/types/WatchHistoryVO';
import type {VideoLearningClipPage} from '@/common/types/vo/VideoLearningClipVO';
import type { GlobalVideoLearningClipQueueStatusVO, VideoLearningClipStatusVO } from '@/common/types/vo/VideoLearningClipStatusVO';
import type { SentenceVocabularyVO } from '@/common/types/vo/SentenceVocabularyVO';
import type { ContextPackParams, ContextPackVO } from '@/common/types/contextPack';
import type {
    SubtitleComprehensionParams,
    SubtitleComprehensionVO,
} from '@/common/types/subtitleComprehension';
import type { SceneBoundary, SceneSentence } from '@/common/learning/sceneSegmentation';
import type {
    WordEncounterAction,
    WordStatus,
} from '@/common/types/vocabulary';
import type {
    ReviewQueueVO,
    ReviewRateParams,
    ReviewRateResultVO,
    ReviewRating,
} from '@/common/types/review';
import type { LearningSessionSummaryParams, LearningSessionSummaryVO } from '@/common/types/learningSession';
import type {
    LearningRecapParams,
    LearningRecapVO,
    ProductionPracticeListParams,
    ProductionPracticeRecordVO,
    RetellEvaluationParams,
    RetellEvaluationVO,
    RolePlayFeedbackParams,
    RolePlayFeedbackVO,
} from '@/common/types/learningRecap';
import type { MemoryMapParams, MemoryMapVO } from '@/common/types/memoryMap';
import type { LearningMetricsParams, LearningMetricsVO } from '@/common/types/learningMetrics';
import type {
    ContentCompassEventParams,
    ContentCompassListParams,
    ContentCompassStatsParams,
    ContentCompassStatsVO,
    ContentCompassVO,
} from '@/common/types/contentCompass';
import type {
    LearningDataExportResultVO,
    LearningDataImportResultVO,
    LearningDataResetResultVO,
} from '@/common/types/learningData';
import type {
    ChatSessionCloseParams,
    ChatSessionCreateParams,
    ChatSessionCreateResult,
    ChatSessionStopParams,
    ChatSendMessageParams,
    ChatSendMessageResult,
    CompleteSentenceParams,
    CompleteSentenceResult,
} from '@/common/types/chat';
import type { AnalysisStartParams, AnalysisStartResult } from '@/common/types/analysis';
import type {
    ServiceCredentialSettingDetailVO,
    ServiceCredentialSettingSaveVO,
} from '@/common/types/vo/service-credentials-setting-vo';
import type { EngineSelectionSettingVO } from '@/common/types/vo/engine-selection-setting-vo';
import type { TranscriptionEngine } from '@/common/contracts/transcription-engine';
import type { ShortcutSettingDetailVO, ShortcutSettingSaveVO } from '@/common/types/vo/shortcut-setting-vo';
import type { ProxySettingDetailVO, ProxySettingSaveVO } from '@/common/contracts/proxy-setting-vo';
import type { AppearanceSettingVO } from '@/common/contracts/appearance-setting-vo';
import type { StorageSettingVO } from '@/common/contracts/storage-setting-vo';
import type {
    MobileAccessSettingDetailVO,
    MobileAccessSettingSaveVO,
} from '@/common/contracts/mobile-access-setting-vo';
import type { StorageUsageVO } from '@/common/contracts/storage-usage-vo';
import type {
    RuntimeSettingSaveRequest,
    RuntimeSettingsSnapshot,
} from '@/common/contracts/runtime-settings';
import type { ModelInstallationStatusVO } from '@/common/types/vo/model-installation-vo';
import type { VideoInfo } from '@/common/types/video-info';
import type { StorageStatusVO } from '@/common/types/vo/StorageStatusVO';
import type { SentencePracticeDictationParams, SentencePracticeRecordVO, SentencePracticeResultVO, SentencePracticeShadowingParams, SentencePracticeSummaryVO } from '@/common/contracts/sentence-practice';

/** 跨进程请求与返回值契约。 */
interface ApiDefinition {
    'local-ai/status': { params: void, return: LocalAiStatus };
    'local-ai/use': { params: { modelId: string }, return: void };
    'local-ai/download': { params: { modelId: string }, return: void };
    'local-ai/cancel-download': { params: void, return: void };
    'local-ai/delete': { params: { modelId: string }, return: void };
    'local-ai/speed-test': { params: { modelId: string }, return: LocalAiSpeedTestResult };
    'local-ai/embedding-status': {
        params: void;
        return: {
            ready: boolean;
            name: string;
            sizeLabel: string;
            bytes: number;
            /** 多模态投影是否就绪；未安装时图像/音频向量不可用。 */
            multimodalReady: boolean;
            /** 多模态投影体积。 */
            multimodalBytes: number;
        };
    };
    'local-ai/embedding-download': { params: void; return: void };
    /** 下载多模态投影（图像/音频向量）；文本推荐不依赖它。 */
    'local-ai/embedding-multimodal-download': { params: void; return: void };
    /** 删除已安装的语义模型与多模态投影。 */
    'local-ai/embedding-remove': { params: void; return: number };
}

// 定义额外的接口
interface AiFuncDef {
    'ai-func/tts': { params: string, return: string };
}

interface SherpaTtsModelDef {
    'sherpa-tts/models/status': { params: void, return: ModelInstallationStatusVO };
    'sherpa-tts/models/download': { params: void, return: { success: boolean; message: string } };
    'sherpa-tts/models/cancel-download': { params: void, return: { cancelled: boolean } };
    'sherpa-tts/models/delete': { params: void, return: { success: boolean; message: string } };
}

interface DpTaskDef {
    'dp-task/detail': { params: number, return: DpTask | null };
    'dp-task/cancel': { params: number, return: void };
}

interface SystemDef {
    'system/info': {
        params: void, return: {
            isWindows: boolean,
            isMac: boolean,
            isLinux: boolean,
            pathSeparator: string,
            /** 物理内存总量（GB，保留一位小数）。 */
            totalMemoryGb: number,
            /** 逻辑 CPU 核数。 */
            cpuCount: number,
            /** 可用的 GPU 推理后端；none 表示会走 CPU 推理。 */
            gpuAcceleration: GpuAcceleration,
            /**
             * 是否为开发/未打包运行（与 main 进程 `isDevelopmentMode()` 同源）。
             * renderer 没有同步可知的 dev 标志，调试/QA 能力一律以它为准，生产构建为 false。
             */
            devMode: boolean,
        }
    };
    'system/select-file': {
        params: string[],
        return: string[]
    };
    'system/select-folder': {
        params: { defaultPath?: string, createDirectory?: boolean },
        return: string[]
    };
    'system/path-info': {
        params: string, return: {
            /**
             * e.g. 'index.html'
             */
            baseName: string,
            /**
             * e.g. '/home/user/dir'
             */
            dirName: string,
            /**
             * e.g. '.html'
             */
            extName: string
        }
    };
    'system/reset-db': { params: void, return: void };
    'system/open-folder': { params: { path: string; createDirectory?: boolean }, return: void };
    'system/open-folder/cache': { params: void, return: void };
    'system/window-size/change': { params: WindowState, return: void };
    'system/window-size': { params: void, return: WindowState };
    'system/window-buttons/visibility': { params: boolean, return: void };
    'system/check-update': { params: { mode?: 'toast' } | undefined, return: UpdateCheckResult };
    'system/open-url': { params: string, return: void };
    'system/app-version': { params: void, return: string };
    /**
     * 确保 macOS 麦克风授权已就绪（未决定时主进程弹系统授权框）；仅 'granted' 表示可以录音。
     */
    'system/ensure-microphone': {
        params: void,
        return: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';
    };
    'system/config/get': { params: string, return: string | null };
    'system/config/set': { params: { key: string; value: string }, return: void };
}

interface AiTransDef {
    'ai-trans/word': {
        params: { word: string; forceRefresh?: boolean; requestId?: string; context?: string },
        return: OpenAIDictionaryResult | null
    };
    /** 结合当前字幕句解释单词在该句中的含义与用法；仅由用户主动请求触发。 */
    'ai-trans/word-insight': {
        params: WordContextInsightParams,
        return: WordContextInsightResponse
    };
    /** 更新当前字幕播放位置，后端异步处理当前批次与预取批次。 */
    'ai-trans/update-subtitle-demand': {
        params: {
            fileHash: string,
            currentIndex: number,
            demandId: number,
            rendererSessionId: string,
        },
        return: void
    };
    /** 释放字幕文件对应的后端翻译会话。 */
    'ai-trans/release-subtitle-session': {
        params: {
            fileHash: string,
            rendererSessionId: string,
        },
        return: void
    };
    /** 清除当前字幕翻译配置（引擎、模型、风格一致）的翻译缓存。 */
    'ai-trans/clear-subtitle-translation-cache': { params: void, return: { deleted: number } };
    /** 清除当前词典配置的查询缓存。 */
    'ai-trans/clear-dictionary-cache': { params: void, return: { deleted: number } };
}

interface ChatDef {
    'chat/session/create': { params: ChatSessionCreateParams, return: ChatSessionCreateResult };
    'chat/session/close': { params: ChatSessionCloseParams, return: void };
    'chat/session/stop': { params: ChatSessionStopParams, return: void };
    'chat/send-message': { params: ChatSendMessageParams, return: ChatSendMessageResult };
    /** 补全被换行截断的字幕为完整句；仅云端整句学习启用时可用。 */
    'chat/complete-sentence': { params: CompleteSentenceParams, return: CompleteSentenceResult };
    /** 整句讲解当前是否可用（功能已启用且云端模型已配好），供学习页决定入口是否置灰。 */
    'chat/learning/available': { params: void, return: boolean };
}

interface ChatAnalysisDef {
    'chat/analysis/start': { params: AnalysisStartParams, return: AnalysisStartResult };
}

interface WatchHistoryDef {
    'watch-history/list': { params: string | undefined, return: WatchHistoryVO[] };
    'watch-history/list/basic': { params: string | undefined, return: WatchHistoryVO[] };
    'watch-history/progress/update': {
        params: { file: string, currentPosition: number },
        return: void
    };
    'watch-history/create': { params: string[], return: string[] };
    'watch-history/create/from-library': { params: string[], return: string[] };
    'watch-history/group-delete': { params: string, return: void };
    'watch-history/detail': { params: string, return: WatchHistoryVO | null };
    'watch-history/player-detail': { params: string, return: WatchHistoryVO | null };
    'watch-history/player-subtitle': { params: string, return: SubtitleResolution };
    'watch-history/attach-srt': { params: { videoPath: string, srtPath: string | 'same' }, return: void };
    'watch-history/get-next-video': { params: string, return: WatchHistoryVO | null };
    'watch-history/set-podcast-mode-preference': {
        params: { videoId: string, podcastMode: boolean },
        return: void
    };
}

interface SubtitleControllerDef {
    'subtitle/srt/parse-to-sentences': {
        params: {
            subtitlePath: string | null;
            videoId: string;
            playbackSessionId: string;
        };
        return: SrtSentence | null;
    };
    'subtitle/srt/match-vocabulary': {
        params: {
            fileHash: string;
            videoId: string;
            playbackSessionId: string;
        };
        return: {
            videoId: string;
            playbackSessionId: string;
            fileHash: string;
            vocabularyWords: string[];
            wordStates: Record<string, WordStatus>;
            cancelled: boolean;
        };
    };
    'subtitle/text/parse-structs': {
        params: string[];
        return: SentenceStruct[];
    };
    'subtitle/comprehension': {
        params: SubtitleComprehensionParams;
        return: SubtitleComprehensionVO;
    };
    /** 读取或计算字幕场景边界；结果按字幕哈希与算法版本持久化。 */
    'subtitle/scene-boundaries': {
        params: { sentences: SceneSentence[]; videoPath?: string };
        return: SceneBoundary[];
    };
}

interface SubtitleTimestampAdjustmentControllerDef {
    'subtitle-timestamp/delete/by-file-hash': { params: string, return: void };
    'subtitle-timestamp/delete/by-key': { params: string, return: void };
    'subtitle-timestamp/update': { params: SubtitleTimestampAdjustmentInput, return: void };
}

interface SubtitleGenerationDef {
    /** 为无字幕视频启动本地 ASR 字幕生成；返回后台任务 ID。 */
    'subtitle-generation/start': { params: { videoId: string }, return: number };
    /** 取消字幕生成任务。 */
    'subtitle-generation/cancel': { params: { taskId: number }, return: void };
}

interface DictionaryImportDef {
    /** 列出用户导入的词典。 */
    'dictionary/list': { params: void, return: ImportedDictionaryVO[] };
    /** 导入一个用户自备的词典文件。 */
    'dictionary/import': { params: { filePath: string }, return: ImportedDictionaryVO };
    /** 删除一个导入词典。 */
    'dictionary/remove': { params: { id: string }, return: void };
    /** 启用或停用导入词典。 */
    'dictionary/set-enabled': { params: { id: string, enabled: boolean }, return: void };
}

interface EnglishDictionaryDef {
    /** 英英释义增强包状态。 */
    'dictionary-enhancement/status': { params: void, return: EnglishDictionaryStatusVO };
    /** 下载并安装增强包；返回后台任务 ID。 */
    'dictionary-enhancement/install': { params: void, return: number };
    /** 取消安装任务。 */
    'dictionary-enhancement/cancel': { params: { taskId: number }, return: void };
    /** 删除已安装的增强包。 */
    'dictionary-enhancement/remove': { params: void, return: void };
}

interface StorageDef {
    'storage/usage': { params: void, return: StorageUsageVO };
    'storage/status': { params: void, return: StorageStatusVO };
    'storage/collection/paths': { params: void, return: string[] };
}

interface SettingsDef {
    'settings/runtime/detail': { params: void, return: RuntimeSettingsSnapshot };
    'settings/runtime/save': { params: RuntimeSettingSaveRequest, return: void };
    'settings/service-credentials/detail': { params: void, return: ServiceCredentialSettingDetailVO };
    'settings/service-credentials/save': { params: ServiceCredentialSettingSaveVO, return: void };
    'settings/service-credentials/test-openai': { params: { model: string }, return: { success: boolean, message: string } };
    'settings/service-credentials/test-tencent': { params: void, return: { success: boolean, message: string } };
    'settings/engine-selection/detail': { params: void, return: EngineSelectionSettingVO };
    'settings/resource-fallback/detail': { params: void, return: ResourceFallbackSnapshot };
    'settings/resource-status/detail': { params: void, return: ResourceStatusSnapshot };
    'settings/engine-selection/save': { params: EngineSelectionSettingVO, return: void };
    'settings/transcription-engine/save': { params: TranscriptionEngine, return: void };
    'migration-failure/detail': { params: void, return: MigrationFailureDetail };
    'migration-failure/retry': { params: void, return: void };
    'migration-failure/reset-and-relaunch': { params: void, return: void };
    'settings/shortcuts/detail': { params: void, return: ShortcutSettingDetailVO };
    'settings/shortcuts/save': { params: ShortcutSettingSaveVO, return: void };
    'settings/appearance/detail': { params: void, return: AppearanceSettingVO };
    'settings/appearance/save': { params: AppearanceSettingVO, return: void };
    'settings/storage/detail': { params: void, return: StorageSettingVO };
    'settings/storage/save': { params: StorageSettingVO, return: void };
    'settings/proxy/detail': { params: void, return: ProxySettingDetailVO };
    'settings/proxy/save': { params: ProxySettingSaveVO, return: void };
    'settings/mobile-access/detail': { params: void, return: MobileAccessSettingDetailVO };
    'settings/mobile-access/save': { params: MobileAccessSettingSaveVO, return: void };
    'settings/mobile-access/regenerate-token': { params: void, return: string };
}

interface ParakeetModelDef {
    'parakeet/models/status': { params: void, return: ModelInstallationStatusVO };
    'parakeet/models/download': { params: void, return: { success: boolean; message: string } };
    'parakeet/models/cancel-download': { params: void, return: { cancelled: boolean } };
    'parakeet/models/delete': { params: void, return: { success: boolean; message: string } };
}

interface SpeakerDiarizationModelDef {
    'speaker-diarization/models/status': {
        params: void;
        return: {
            segmentationReady: boolean;
            embeddingReady: boolean;
            ready: boolean;
            segmentationUrls: string[];
            embeddingUrls: string[];
        };
    };
    'speaker-diarization/models/download': { params: void, return: { success: boolean; message: string } };
    'speaker-diarization/models/cancel-download': { params: void, return: { cancelled: boolean } };
    'speaker-diarization/models/delete': { params: void, return: { success: boolean; message: string } };
}

interface YoutubeImportDef {
    'youtube-import/start': { params: { url: string }, return: YoutubeImportStartResult };
    'youtube-import/cancel': { params: { taskId: number }, return: { cancelled: boolean } };
    'youtube-import/setting-detail': { params: void, return: YoutubeImportSettingDetailVO };
    'youtube-import/setting-save': { params: YoutubeImportSettingSaveVO, return: YoutubeImportSettingDetailVO };
}

interface WhisperCppModelDef {
    'whisper-cpp/models/status': { params: void, return: ModelInstallationStatusVO };
    'whisper-cpp/models/download': { params: void, return: { success: boolean; message: string } };
    'whisper-cpp/models/cancel-download': { params: void, return: { cancelled: boolean } };
    'whisper-cpp/models/delete': { params: void, return: { success: boolean; message: string } };
}

/** 通用媒体信息和缩略图 IPC 定义。 */
interface MediaDef {
    'media/thumbnail': {
        params: {
            filePath: string,
            time: number,
            quality?: 'low' | 'medium' | 'high' | 'ultra',
            width?: number,
            format?: 'jpg' | 'png'
        },
        return: string
    };
    'media/duration': { params: string, return: number };
    'media/info': { params: string, return: VideoInfo };
}

interface VocabularyDef {
    'vocabulary/get-all': {
        params: { search?: string; page?: number; pageSize?: number },
        return: { success: boolean; data?: unknown[]; error?: string }
    };
    'vocabulary/export-template': {
        params: void,
        return: { success: boolean; data?: string; error?: string }
    };
    'vocabulary/import': {
        params: { filePath: string },
        return: { success: boolean; message?: string; error?: string }
    };
    'vocabulary/favorite': {
        params: { word: string; translate?: string },
        return: {
            success: boolean;
            data?: { word: string; translate: string; alreadyExists: boolean };
            error?: string
        }
    };
    'vocabulary/update': {
        params: { oldWord: string; word: string; translate: string },
        return: { success: boolean; error?: string }
    };
    'vocabulary/update-state': {
        params: { word: string; status: WordStatus },
        return: {
            success: boolean;
            data?: { word: string; status: WordStatus };
            error?: string
        }
    };
    'vocabulary/record-encounter': {
        params: {
            word: string;
            action: WordEncounterAction;
            videoId?: string;
            fileHash?: string;
            sentenceIndex?: number;
            sentenceHash?: string;
            context?: string;
            score?: number;
            rating?: ReviewRating;
        },
        return: void
    };
    'vocabulary/review-queue': {
        params: { limit?: number },
        return: ReviewQueueVO
    };
    'vocabulary/rate-review': {
        params: ReviewRateParams,
        return: ReviewRateResultVO
    };
    'vocabulary/delete': {
        params: { word: string },
        return: { success: boolean; data?: { word: string }; error?: string }
    };
    'vocabulary/generate-definition': {
        params: { word: string },
        return: { success: boolean; data?: string; error?: string }
    };
    'vocabulary/pick-sentence': {
        params: { text: string },
        return: SentenceVocabularyVO
    };
    'vocabulary/context-pack': {
        params: ContextPackParams,
        return: ContextPackVO
    };
}

interface LearningDataDef {
    'learning-data/session-summary': {
        params: LearningSessionSummaryParams,
        return: LearningSessionSummaryVO
    };
    'learning-data/export': {
        params: void,
        return: LearningDataExportResultVO
    };
    /** 从备份 JSON 恢复学习数据；默认词表不受影响。 */
    'learning-data/import': {
        params: void,
        return: LearningDataImportResultVO
    };
    'learning-data/reset': {
        params: void,
        return: LearningDataResetResultVO
    };
    /** 生成本次播放会话的学习复盘；AI 不可用时返回本地确定性摘要。 */
    'learning-data/recap': {
        params: LearningRecapParams,
        return: LearningRecapVO
    };
    /** 检查用户对原句的复述；关键词覆盖始终由本地计算。 */
    'learning-data/retell-feedback': {
        params: RetellEvaluationParams,
        return: RetellEvaluationVO
    };
    /** 检查用户对场景开场白的书面回应；目标表达使用始终由本地计算。 */
    'learning-data/role-play-feedback': {
        params: RolePlayFeedbackParams,
        return: RolePlayFeedbackVO
    };
    /** 读取某个视频下最近的复述 / 角色扮演结果。 */
    'learning-data/production-practice': {
        params: ProductionPracticeListParams,
        return: ProductionPracticeRecordVO[]
    };
    /** 汇总本地词表、上下文与复习状态，生成个人记忆图谱。 */
    'learning-data/memory-map': {
        params: MemoryMapParams,
        return: MemoryMapVO
    };
    /** 学习指标看板：北极星指标与辅助指标。 */
    'learning-data/metrics': {
        params: LearningMetricsParams,
        return: LearningMetricsVO
    };
}

interface ContentCompassDef {
    /** 从本地媒体库推荐下一段适合学习的内容。 */
    'content-compass/list': {
        params: ContentCompassListParams,
        return: ContentCompassVO
    };
    /** 记录推荐曝光、打开或不感兴趣。 */
    'content-compass/event': {
        params: ContentCompassEventParams,
        return: void
    };
    /** 汇总推荐打开率、忽略率与复习回忆率。 */
    'content-compass/stats': {
        params: ContentCompassStatsParams,
        return: ContentCompassStatsVO
    };
}

interface VideoLearningDef {
    'video-learning/detect-clip-status': {
        params: { videoPath: string; srtKey: string; srtPath?: string },
        return: VideoLearningClipStatusVO
    };
    'video-learning/clip-queue-status': {
        params: void,
        return: GlobalVideoLearningClipQueueStatusVO
    };
    'video-learning/auto-clip': {
        params: { videoPath: string; srtKey: string; srtPath?: string },
        return: { success: boolean }
    };
    'video-learning/cancel-auto-clip-all': {
        params: void,
        return: { success: boolean; clearedCount: number }
    };
    'video-learning/delete': {
        params: { key: string },
        return: { success: boolean }
    };
    'video-learning/search': {
        params: SimpleClipQuery,
        return: { success: boolean; data: VideoLearningClipPage }
    };
    'video-learning/resolve-clip-vocabulary': {
        params: { lines: ClipMeta['clip_content']; words: string[] },
        return: { success: boolean; data: VideoLearningClipPage['items'][number]['vocabulary'] }
    };
    'video-learning/sync-from-oss': {
        params: void,
        return: { success: boolean }
    };
    'video-learning/word-clip-stats': {
        params: void,
        return: { success: boolean; data: Record<string, { count: number; lastAddedAt: string }> }
    };
}

interface PracticeDef {
    /** 跟读评分:录音上传 → 本地 ASR 转写 → 词级对齐评分,结果同时落库。 */
    'practice/score-shadowing': {
        params: SentencePracticeShadowingParams,
        return: SentencePracticeResultVO
    };
    /** 听写评分:键入文本与原句对齐评分,结果同时落库。 */
    'practice/score-dictation': {
        params: SentencePracticeDictationParams,
        return: SentencePracticeResultVO
    };
    /** 查询单个意群的练习历史,按时间倒序。 */
    'practice/list-by-sentence': {
        params: { fileHash: string; sentenceIndex: number; resegmented: boolean },
        return: SentencePracticeRecordVO[]
    };
    /** 查询整片各意群的练习汇总(最高分与次数),驱动进度条与薄弱句筛选。 */
    'practice/list-by-file': {
        params: { fileHash: string; resegmented: boolean },
        return: SentencePracticeSummaryVO[]
    };
}

// 使用交叉类型合并 ApiDefinitions 和 ExtraApiDefinition
export type ApiDefinitions = ApiDefinition
    & AiFuncDef
    & DpTaskDef
    & SystemDef
    & AiTransDef
    & ChatDef
    & ChatAnalysisDef
    & WatchHistoryDef
    & SubtitleControllerDef
    & SherpaTtsModelDef
    & MediaDef
    & SubtitleTimestampAdjustmentControllerDef
    & SubtitleGenerationDef
    & DictionaryImportDef
    & EnglishDictionaryDef
    & StorageDef
    & SettingsDef
    & ParakeetModelDef
    & SpeakerDiarizationModelDef
    & YoutubeImportDef
    & WhisperCppModelDef
    & VocabularyDef
    & LearningDataDef
    & ContentCompassDef
    & VideoLearningDef
    & PracticeDef;

// 更新 ApiMap 类型以使用 CombinedApiDefinitions
export type ApiMap = {
    [K in keyof ApiDefinitions]: ApiFunction<ApiDefinitions[K]['params'], Promise<ApiDefinitions[K]['return']>>;
}

// 定义函数类型
type ApiFunction<P, R> = (params: P) => R;


/**
 * 全部 IPC 路由路径的运行时清单。
 *
 * 与 ApiMap 的对齐由两条编译期哨兵强制：
 * - satisfies 约束清单里不允许出现 ApiMap 不存在的键（防拼写漂移）；
 * - 下方 AssertNever 哨兵要求清单覆盖 ApiMap 的每一个键（防新增路由漏登记）。
 * routeContract 契约测试再在运行时校验「全部控制器实际注册的路径集合 == 本清单」。
 */
export const API_ROUTE_KEYS = [
    'ai-func/tts',
    'ai-trans/clear-dictionary-cache',
    'ai-trans/clear-subtitle-translation-cache',
    'ai-trans/release-subtitle-session',
    'ai-trans/update-subtitle-demand',
    'ai-trans/word',
    'ai-trans/word-insight',
    'chat/analysis/start',
    'chat/complete-sentence',
    'chat/learning/available',
    'chat/send-message',
    'chat/session/close',
    'chat/session/create',
    'chat/session/stop',
    'content-compass/event',
    'content-compass/list',
    'content-compass/stats',
    'dictionary-enhancement/cancel',
    'dictionary-enhancement/install',
    'dictionary-enhancement/remove',
    'dictionary-enhancement/status',
    'dictionary/import',
    'dictionary/list',
    'dictionary/remove',
    'dictionary/set-enabled',
    'dp-task/cancel',
    'dp-task/detail',
    'learning-data/export',
    'learning-data/import',
    'learning-data/memory-map',
    'learning-data/metrics',
    'learning-data/production-practice',
    'learning-data/recap',
    'learning-data/reset',
    'learning-data/retell-feedback',
    'learning-data/role-play-feedback',
    'learning-data/session-summary',
    'local-ai/cancel-download',
    'local-ai/delete',
    'local-ai/download',
    'local-ai/embedding-download',
    'local-ai/embedding-multimodal-download',
    'local-ai/embedding-remove',
    'local-ai/embedding-status',
    'local-ai/speed-test',
    'local-ai/status',
    'local-ai/use',
    'media/duration',
    'media/info',
    'media/thumbnail',
    'migration-failure/detail',
    'migration-failure/reset-and-relaunch',
    'migration-failure/retry',
    'parakeet/models/cancel-download',
    'parakeet/models/delete',
    'parakeet/models/download',
    'parakeet/models/status',
    'practice/list-by-file',
    'practice/list-by-sentence',
    'practice/score-dictation',
    'practice/score-shadowing',
    'settings/appearance/detail',
    'settings/appearance/save',
    'settings/engine-selection/detail',
    'settings/engine-selection/save',
    'settings/mobile-access/detail',
    'settings/mobile-access/regenerate-token',
    'settings/mobile-access/save',
    'settings/proxy/detail',
    'settings/proxy/save',
    'settings/resource-fallback/detail',
    'settings/resource-status/detail',
    'settings/runtime/detail',
    'settings/runtime/save',
    'settings/service-credentials/detail',
    'settings/service-credentials/save',
    'settings/service-credentials/test-openai',
    'settings/service-credentials/test-tencent',
    'settings/shortcuts/detail',
    'settings/shortcuts/save',
    'settings/storage/detail',
    'settings/storage/save',
    'settings/transcription-engine/save',
    'speaker-diarization/models/cancel-download',
    'speaker-diarization/models/delete',
    'speaker-diarization/models/download',
    'speaker-diarization/models/status',
    'sherpa-tts/models/cancel-download',
    'sherpa-tts/models/delete',
    'sherpa-tts/models/download',
    'sherpa-tts/models/status',
    'storage/collection/paths',
    'storage/status',
    'storage/usage',
    'subtitle-generation/cancel',
    'subtitle-generation/start',
    'subtitle-timestamp/delete/by-file-hash',
    'subtitle-timestamp/delete/by-key',
    'subtitle-timestamp/update',
    'subtitle/comprehension',
    'subtitle/scene-boundaries',
    'subtitle/srt/match-vocabulary',
    'subtitle/srt/parse-to-sentences',
    'subtitle/text/parse-structs',
    'system/app-version',
    'system/check-update',
    'system/config/get',
    'system/config/set',
    'system/ensure-microphone',
    'system/info',
    'system/open-folder',
    'system/open-folder/cache',
    'system/open-url',
    'system/path-info',
    'system/reset-db',
    'system/select-file',
    'system/select-folder',
    'system/window-buttons/visibility',
    'system/window-size',
    'system/window-size/change',
    'video-learning/auto-clip',
    'video-learning/cancel-auto-clip-all',
    'video-learning/clip-queue-status',
    'video-learning/delete',
    'video-learning/detect-clip-status',
    'video-learning/resolve-clip-vocabulary',
    'video-learning/search',
    'video-learning/sync-from-oss',
    'video-learning/word-clip-stats',
    'vocabulary/context-pack',
    'vocabulary/delete',
    'vocabulary/export-template',
    'vocabulary/favorite',
    'vocabulary/generate-definition',
    'vocabulary/get-all',
    'vocabulary/import',
    'vocabulary/pick-sentence',
    'vocabulary/rate-review',
    'vocabulary/record-encounter',
    'vocabulary/review-queue',
    'vocabulary/update',
    'vocabulary/update-state',
    'watch-history/attach-srt',
    'watch-history/create',
    'watch-history/create/from-library',
    'watch-history/detail',
    'watch-history/get-next-video',
    'watch-history/group-delete',
    'watch-history/list',
    'watch-history/list/basic',
    'watch-history/player-detail',
    'watch-history/player-subtitle',
    'watch-history/progress/update',
    'watch-history/set-podcast-mode-preference',
    'whisper-cpp/models/cancel-download',
    'whisper-cpp/models/delete',
    'whisper-cpp/models/download',
    'whisper-cpp/models/status',
    'youtube-import/cancel',
    'youtube-import/setting-detail',
    'youtube-import/setting-save',
    'youtube-import/start',
] as const satisfies readonly (keyof ApiMap)[];

/** 穷尽性哨兵：API_ROUTE_KEYS 漏写任一 ApiMap 键时，Exclude 结果非 never，typecheck 在此报错。 */
type AssertNever<T extends never> = T;
declare const _API_ROUTE_KEYS_EXHAUSTIVE: AssertNever<Exclude<keyof ApiMap, (typeof API_ROUTE_KEYS)[number]>>;

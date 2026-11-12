import { backendClient } from '@/fronted/infrastructure/electron/backendClient';
import type {
    SentencePracticeDictationParams,
    SentencePracticeShadowingParams,
} from '@/common/contracts/sentence-practice';

/**
 * 句子练习的前端 API 封装:跟读评分(携带录音字节)、听写评分、单句练习历史。
 */
export const practiceApi = {
    scoreShadowing: (params: SentencePracticeShadowingParams) =>
        backendClient.call('practice/score-shadowing', params),
    scoreDictation: (params: SentencePracticeDictationParams) =>
        backendClient.call('practice/score-dictation', params),
    listBySentence: (params: { fileHash: string; sentenceIndex: number }) =>
        backendClient.call('practice/list-by-sentence', params),
    listByFile: (params: { fileHash: string }) =>
        backendClient.call('practice/list-by-file', params),
    /**
     * 同一意群跨次练习的节奏趋势。
     */
    getRhythmTrend: (params: { fileHash: string; sentenceIndex: number }) =>
        backendClient.call('practice/rhythm-trend', params),
    /** 确保 macOS 麦克风授权已就绪(Linux/Windows 恒 granted);仅 'granted' 可录音。 */
    ensureMicrophone: () => backendClient.call('system/ensure-microphone'),
};

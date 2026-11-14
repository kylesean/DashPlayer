import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// translationStore 的依赖面替身：playerApi（需求提交/会话释放）、toast、i18n、日志、会话标识。
const { playerApiMock } = vi.hoisted(() => ({
    playerApiMock: {
        updateSubtitleTranslationDemand: vi.fn().mockResolvedValue(undefined),
        releaseSubtitleTranslationSession: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('@/frontend/features/player/playerApi', () => ({
    playerApi: playerApiMock,
}));

vi.mock('@/frontend/log/simple-logger', () => ({
    getRendererLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/frontend/infrastructure/electron/rendererSession', () => ({
    rendererSessionId: 'test-session',
}));

vi.mock('@/frontend/components/shared/toasts/notification', () => ({
    showNotification: vi.fn(),
}));

vi.mock('@/frontend/i18n', () => ({
    default: { t: (key: string) => key },
}));

import { showNotification } from '@/frontend/components/shared/toasts/notification';
import useTranslation from '../translationStore';

const flushDebounce = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(150);
};

/** 摆出「openai 引擎 + 字幕 h1 已激活」的基线。 */
const seedActiveOpenAi = (fileHash = 'h1'): void => {
    useTranslation.setState({
        engine: 'openai',
        openAiMode: 'zh',
        activeFileHash: fileHash,
        translations: new Map(),
    });
};

describe('translationStore 需求防抖与会话生命周期（特征化钉住）', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        playerApiMock.updateSubtitleTranslationDemand.mockClear().mockResolvedValue(undefined);
        playerApiMock.releaseSubtitleTranslationSession.mockClear().mockResolvedValue(undefined);
        vi.mocked(showNotification).mockClear();
        useTranslation.setState({
            engine: 'none',
            openAiMode: 'zh',
            activeFileHash: null,
            translations: new Map(),
        });
        // 清掉上一个用例可能遗留的防抖挂起（activeFileHash 为 null 时释放是空操作）
        useTranslation.getState().clearTranslations();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('engine 为 none 或文件不匹配：请求被状态守卫跳过，不产生 IPC', async () => {
        useTranslation.setState({ engine: 'none', activeFileHash: 'h1' });
        useTranslation.getState().requestTranslation('h1', 3);
        await flushDebounce();
        expect(playerApiMock.updateSubtitleTranslationDemand).not.toHaveBeenCalled();

        useTranslation.setState({ engine: 'openai', activeFileHash: 'other' });
        useTranslation.getState().requestTranslation('h1', 3);
        await flushDebounce();
        expect(playerApiMock.updateSubtitleTranslationDemand).not.toHaveBeenCalled();
    });

    it('150ms trailing 防抖：连续快跳只发送停稳后的最后一个目标句', async () => {
        seedActiveOpenAi();
        useTranslation.getState().requestTranslation('h1', 1);
        await vi.advanceTimersByTimeAsync(50);
        useTranslation.getState().requestTranslation('h1', 2);
        await vi.advanceTimersByTimeAsync(50);
        useTranslation.getState().requestTranslation('h1', 5);
        await flushDebounce();

        expect(playerApiMock.updateSubtitleTranslationDemand).toHaveBeenCalledTimes(1);
        const [fileHash, index, , sessionId] = playerApiMock.updateSubtitleTranslationDemand.mock.calls[0];
        expect(fileHash).toBe('h1');
        expect(index).toBe(5);
        expect(sessionId).toBe('test-session');
    });

    it('防抖窗口内切走字幕文件：定时器触发时复验丢弃旧文件需求', async () => {
        seedActiveOpenAi();
        useTranslation.getState().requestTranslation('h1', 3);
        useTranslation.getState().setActiveFileHash('h2');
        await flushDebounce();

        expect(playerApiMock.updateSubtitleTranslationDemand).not.toHaveBeenCalled();
        expect(playerApiMock.releaseSubtitleTranslationSession).toHaveBeenCalledWith('h1', 'test-session');
    });

    it('demandId 随每次实际发送单调递增（防抖合并不产生中间 demandId）', async () => {
        seedActiveOpenAi();
        useTranslation.getState().requestTranslation('h1', 1);
        await flushDebounce();
        useTranslation.getState().requestTranslation('h1', 2);
        await flushDebounce();

        const calls = playerApiMock.updateSubtitleTranslationDemand.mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[0]?.[2]).toBeLessThan(calls[1]?.[2] as number);
    });

    it('迟到结果按 provider+fileHash+mode 过滤：不匹配的批次不写入译文表', () => {
        seedActiveOpenAi('h1');
        useTranslation.getState().updateTranslations([
            { key: 'k1', translation: '对', provider: 'openai', fileHash: 'h1', mode: 'zh' },
            { key: 'k2', translation: '引擎不符', provider: 'tencent', fileHash: 'h1' },
            { key: 'k3', translation: '文件不符', provider: 'openai', fileHash: 'h2', mode: 'zh' },
            { key: 'k4', translation: '模式不符', provider: 'openai', fileHash: 'h1', mode: 'simple_en' },
        ]);

        const translations = useTranslation.getState().translations;
        expect(translations.get('k1')).toBe('对');
        expect(translations.has('k2')).toBe(false);
        expect(translations.has('k3')).toBe(false);
        expect(translations.has('k4')).toBe(false);
    });

    it('setEngine 切换：取消挂起防抖、释放旧会话、清空译文', async () => {
        seedActiveOpenAi();
        useTranslation.getState().requestTranslation('h1', 1);
        useTranslation.getState().setEngine('tencent');
        await flushDebounce();

        expect(playerApiMock.releaseSubtitleTranslationSession).toHaveBeenCalledWith('h1', 'test-session');
        expect(playerApiMock.updateSubtitleTranslationDemand).not.toHaveBeenCalled();
        expect(useTranslation.getState().translations.size).toBe(0);
        expect(useTranslation.getState().engine).toBe('tencent');
    });

    it('initializeRuntimeSettings 只改配置：不释放当前字幕会话（首屏竞态保护）', () => {
        seedActiveOpenAi();
        useTranslation.getState().initializeRuntimeSettings('local', 'simple_en');

        expect(playerApiMock.releaseSubtitleTranslationSession).not.toHaveBeenCalled();
        expect(useTranslation.getState().engine).toBe('local');
        expect(useTranslation.getState().openAiMode).toBe('simple_en');
    });

    it('setOpenAiMode 仅在 AI 引擎下释放会话并清空译文；普通引擎不动译文', () => {
        useTranslation.setState({ engine: 'tencent', activeFileHash: 'h1', translations: new Map([['k', 'v']]) });
        useTranslation.getState().setOpenAiMode('simple_en');
        expect(playerApiMock.releaseSubtitleTranslationSession).not.toHaveBeenCalled();
        expect(useTranslation.getState().translations.get('k')).toBe('v');

        seedActiveOpenAi();
        useTranslation.getState().setOpenAiMode('simple_en');
        expect(playerApiMock.releaseSubtitleTranslationSession).toHaveBeenCalledWith('h1', 'test-session');
        expect(useTranslation.getState().translations.size).toBe(0);
    });

    it('需求提交失败：错误提示带引擎与消息哈希 dedupeKey', async () => {
        seedActiveOpenAi();
        playerApiMock.updateSubtitleTranslationDemand.mockRejectedValueOnce(new Error('boom'));
        useTranslation.getState().requestTranslation('h1', 1);
        await flushDebounce();

        expect(showNotification).toHaveBeenCalledTimes(1);
        const notification = vi.mocked(showNotification).mock.calls[0]?.[0];
        expect(notification?.variant).toBe('error');
        expect(notification?.dedupeKey).toContain('subtitle-translation-request:openai:');
    });
});

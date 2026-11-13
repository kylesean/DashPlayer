import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: { isPackaged: true, getPath: () => '/tmp/dashplayer-study-note-test' },
}));

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
import { createMemoryDb, type MemoryDb } from '@/test/database';
import SentenceStudyNoteRepositoryImpl from '@/backend/infrastructure/db/repositories/SentenceStudyNoteRepositoryImpl';
import LearningPromptPresetRepositoryImpl from '@/backend/infrastructure/db/repositories/LearningPromptPresetRepositoryImpl';
import { LearningPromptPresetServiceImpl } from '@/backend/services/chat/LearningPromptPresetService';
import type { SettingsStore } from '@/backend/services/gateways/SettingsStore';
import { DEFAULT_LEARNING_PROMPT_PRESET_ID } from '@/backend/services/chat/LearningPromptPresets';

const createMockSettingsStore = (initial: Record<string, string> = {}): SettingsStore => {
    const map = new Map<string, string>(Object.entries(initial));
    return {
        get: (key: string) => map.get(key) ?? '',
        set: (key: string, val: string) => {
            map.set(key, val);
            return true;
        },
        delete: (key: string) => map.delete(key),
    } as unknown as SettingsStore;
};

describe('SentenceStudyNoteRepository & LearningPromptPreset', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        memoryDb?.close();
        memoryDb = null;
    });

    it('首卡缓存、笔记摘要与对话轮次支持幂等局部更新与按句秒读', async () => {
        memoryDb = createMemoryDb();
        const repo = new SentenceStudyNoteRepositoryImpl(memoryDb.db);

        const created = await repo.saveStudyCard({
            sentenceKey: 'hash-1:3',
            videoId: 'vid-1',
            fileHash: 'hash-1',
            sentenceIndex: 3,
            originalText: 'I am on the fence about this.',
            presetId: DEFAULT_LEARNING_PROMPT_PRESET_ID,
            studyCard: {
                sentence: {
                    completeText: 'I am on the fence about this.',
                    contextualTranslation: '这件事我还在犹豫。',
                    chunks: ['I am on the fence', 'about this.'],
                },
                focalPoints: [{
                    expression: 'on the fence',
                    kind: 'phrase',
                    coreImage: '骑在两块领地之间的木栅栏顶上，左脚没下、右脚也没踩实。',
                    meaningInContext: '从物理平衡僵局引申为：左右为难、还没做决定。',
                    tag: '物理意象',
                }],
                listeningLens: [],
                sentenceLens: {
                    structureInsight: '用空间位置状态替代干瘪的 I hesitate。',
                    subtext: '委婉表达还在权衡。',
                },
            },
        });

        expect(created.studyCard?.focalPoints[0]?.expression).toBe('on the fence');
        expect(created.noteSummary).toBe('');

        // 局部追加笔记摘要不能覆盖已落库的首卡 JSON
        const withNote = await repo.upsert({
            sentenceKey: 'hash-1:3',
            videoId: 'vid-1',
            fileHash: 'hash-1',
            sentenceIndex: 3,
            originalText: 'I am on the fence about this.',
            noteSummary: '骑墙头画面很直观。',
        });
        expect(withNote.studyCard?.sentence.completeText).toBe('I am on the fence about this.');
        expect(withNote.noteSummary).toBe('骑墙头画面很直观。');

        // 局部追加对话历史同样保留笔记和首卡
        const withMessages = await repo.saveMessages({
            sentenceKey: 'hash-1:3',
            videoId: 'vid-1',
            fileHash: 'hash-1',
            sentenceIndex: 3,
            originalText: 'I am on the fence about this.',
            messages: [
                {
                    id: 'm1',
                    role: 'user',
                    blocks: [{ kind: 'text', text: '再给个例子' }],
                    plainText: '再给个例子',
                },
                {
                    id: 'm2',
                    role: 'assistant',
                    blocks: [{ kind: 'text', text: '[[tts:I am still on the fence.]] 我还在观望。' }],
                    plainText: '[[tts:I am still on the fence.]] 我还在观望。',
                },
            ],
        });

        expect(withMessages.messages).toHaveLength(2);
        expect(withMessages.noteSummary).toBe('骑墙头画面很直观。');
        expect(withMessages.studyCard?.focalPoints).toHaveLength(1);

        const reloaded = await repo.findByLocation('hash-1', 3);
        expect(reloaded?.messages[1]?.plainText).toContain('on the fence');
    });

    it('教学预设支持内置列表、自定义覆写、恢复默认及激活持久化', async () => {
        memoryDb = createMemoryDb();
        const presetRepo = new LearningPromptPresetRepositoryImpl(memoryDb.db);
        const settingsStore = createMockSettingsStore({
            'learning.activePromptPresetId': DEFAULT_LEARNING_PROMPT_PRESET_ID,
        });
        const service = new LearningPromptPresetServiceImpl(presetRepo, settingsStore);

        const initial = await service.list();
        expect(initial.length).toBeGreaterThanOrEqual(4);
        expect(initial.find((p) => p.id === DEFAULT_LEARNING_PROMPT_PRESET_ID)?.isDefault).toBe(true);

        // 覆写内置预设并新建私人预设
        await service.save({
            id: DEFAULT_LEARNING_PROMPT_PRESET_ID,
            name: '物理意象导师（增强）',
            systemPrompt: '强调空间受力方向与日常身体体感',
            setAsActive: true,
        });
        const custom = await service.save({
            id: 'custom-slang',
            name: '美剧俚语猎手',
            systemPrompt: '专拆美剧黑话源头画面',
            setAsActive: true,
        });
        expect(custom.isBuiltin).toBe(false);
        expect(custom.isDefault).toBe(true);

        // 恢复默认内置预设
        const restored = await service.resetBuiltin({ id: DEFAULT_LEARNING_PROMPT_PRESET_ID });
        expect(restored.name).toBe('物理意象导师');
        expect(restored.systemPrompt).toContain('画面先行');
    });
});

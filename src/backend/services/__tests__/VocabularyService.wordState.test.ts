import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-vocabulary-state-test-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import { createMemoryDb, type MemoryDb } from '@/test/database';
import WordsRepositoryImpl from '@/backend/infrastructure/db/repositories/WordsRepositoryImpl';
import { VocabularyServiceImpl } from '@/backend/services/VocabularyService';
import type AiProviderService from '@/backend/services/AiProviderService';
import type FileSystemGateway from '@/backend/services/gateways/storage/FileSystemGateway';
import type StorageDirectoryProvider from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import type SubtitleService from '@/backend/services/SubtitleService';
import type { VideoLearningService } from '@/backend/services/VideoLearningService';
import type { WordMatchService } from '@/backend/services/WordMatchService';
import type VideoLearningClipWordRepository from '@/backend/services/repositories/VideoLearningClipWordRepository';

const buildService = (memoryDb: MemoryDb) => {
    const repository = new WordsRepositoryImpl(memoryDb.db);
    const service = new VocabularyServiceImpl(
        {
            syncFromOss: vi.fn(async () => undefined),
            invalidateClipAnalysisCache: vi.fn(),
        } as unknown as VideoLearningService,
        repository,
        { invalidateVocabularyCache: vi.fn() } as unknown as WordMatchService,
        {} as unknown as AiProviderService,
        {
            renameWord: vi.fn(async () => undefined),
            deleteByWord: vi.fn(async () => undefined),
        } as unknown as VideoLearningClipWordRepository,
        { invalidateVocabularyAnalysisCache: vi.fn() } as unknown as SubtitleService,
        {} as unknown as StorageDirectoryProvider,
        {} as unknown as FileSystemGateway,
    );
    return { service, repository };
};

describe('VocabularyService 单词状态', () => {
    let memoryDb: MemoryDb | null = null;

    afterEach(() => {
        memoryDb?.close();
        memoryDb = null;
    });

    it('命中变体时按 lemma 更新状态', async () => {
        memoryDb = createMemoryDb();
        const { service, repository } = buildService(memoryDb);
        await repository.insertOne({ word: 'cancel', translate: '取消', status: 'learning', source: 'manual' });

        const result = await service.updateWordState({ word: 'cancelled', status: 'known' });

        expect(result.success).toBe(true);
        expect(result.data).toEqual({ word: 'cancel', status: 'known' });
        const row = await repository.findByWord('cancel');
        expect(row?.status).toBe('known');
        expect(row?.mastery).toBe(1);
    });

    it('收藏已掌握的词会重新激活为 learning', async () => {
        memoryDb = createMemoryDb();
        const { service, repository } = buildService(memoryDb);
        await repository.insertOne({ word: 'cancel', translate: '取消', status: 'known', source: 'manual' });

        const result = await service.favoriteWord('cancel');

        expect(result.success).toBe(true);
        expect(result.data?.alreadyExists).toBe(true);
        const row = await repository.findByWord('cancel');
        expect(row?.status).toBe('learning');
        expect(row?.translate).toBe('取消');
    });

    it('默认词表被收藏后转为用户词并激活', async () => {
        memoryDb = createMemoryDb();
        const { service, repository } = buildService(memoryDb);
        await repository.insertOne({ word: 'cancel', translate: '取消', status: 'ignored', source: 'default' });

        const result = await service.favoriteWord('cancel');

        expect(result.success).toBe(true);
        const row = await repository.findByWord('cancel');
        expect(row?.status).toBe('learning');
        expect(row?.source).toBe('manual');
    });

    it('仓储默认排除 starter pack，显式请求时才返回', async () => {
        memoryDb = createMemoryDb();
        const { repository } = buildService(memoryDb);
        await repository.insertOne({ word: 'cancel', translate: '取消', status: 'ignored', source: 'default' });
        await repository.insertOne({ word: 'custom', translate: '自定义', status: 'learning', source: 'manual' });

        const visible = await repository.getAll();
        const all = await repository.getAll({ includeDefault: true });

        expect(visible.map((word) => word.word)).toEqual(['custom']);
        expect(all.map((word) => word.word).sort()).toEqual(['cancel', 'custom']);
    });
});

import { beforeEach, describe, expect, it } from 'vitest';

import { useVocabularyStore } from '@/frontend/features/player/vocabularyStore';

describe('vocabularyStore status projection', () => {
    beforeEach(() => {
        useVocabularyStore.getState().clearVocabularyWords();
    });

    it('只有活跃状态会被判定为生词', () => {
        useVocabularyStore.getState().setVocabularyStates({
            learn: 'learning',
            familiar: 'familiar',
            known: 'known',
            ignored: 'ignored',
        });

        expect(useVocabularyStore.getState().isVocabularyWord('learn')).toBe(true);
        expect(useVocabularyStore.getState().isVocabularyWord('familiar')).toBe(true);
        expect(useVocabularyStore.getState().isVocabularyWord('known')).toBe(false);
        expect(useVocabularyStore.getState().isVocabularyWord('ignored')).toBe(false);
    });

    it('状态切换会立即更新高亮集合', () => {
        useVocabularyStore.getState().setVocabularyWords(['learn']);
        expect(useVocabularyStore.getState().isVocabularyWord('learn')).toBe(true);

        useVocabularyStore.getState().setWordStatus('learn', 'known');

        expect(useVocabularyStore.getState().isVocabularyWord('learn')).toBe(false);
        expect(useVocabularyStore.getState().getWordStatus('learn')).toBe('known');
    });

    it('新增词默认进入 learning', () => {
        useVocabularyStore.getState().addVocabularyWords(['kindness']);

        expect(useVocabularyStore.getState().getWordStatus('kindness')).toBe('learning');
    });
});

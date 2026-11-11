import { describe, expect, it } from 'vitest';

import { resolveVocabularyAnnotation } from '@/fronted/features/player/vocabularyAnnotations';

describe('vocabulary annotation projection', () => {
    it('calm 只标记 learning', () => {
        expect(resolveVocabularyAnnotation('learning', 'calm')).toBe('learning');
        expect(resolveVocabularyAnnotation('familiar', 'calm')).toBeNull();
    });

    it('coach 同时标记 learning 与 familiar', () => {
        expect(resolveVocabularyAnnotation('learning', 'coach')).toBe('learning');
        expect(resolveVocabularyAnnotation('familiar', 'coach')).toBe('familiar');
    });

    it('关闭提示后不标记任何状态', () => {
        expect(resolveVocabularyAnnotation('learning', 'off')).toBeNull();
        expect(resolveVocabularyAnnotation('familiar', 'off')).toBeNull();
    });

    it('known / ignored 永远不标记', () => {
        expect(resolveVocabularyAnnotation('known', 'coach')).toBeNull();
        expect(resolveVocabularyAnnotation('ignored', 'coach')).toBeNull();
    });
});

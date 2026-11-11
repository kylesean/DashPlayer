import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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

    /**
     * 主字幕与右侧文稿必须走同一套投影。
     *
     * 两侧最终都渲染 `Word`，所以真正的约束是「不得在任一侧另写一份判定」。
     * 这里直接检查右文稿分词渲染器没有引入第二套注释逻辑。
     */
    it('右文稿分词渲染器复用 Word，不自行判定注释', () => {
        const rendererPath = path.resolve(
            __dirname,
            '..',
            'components',
            'srt-layout',
            'sentence-token-renderer.tsx',
        );
        const source = fs.readFileSync(rendererPath, 'utf8');

        expect(source).toContain("from '@/fronted/features/player/components/translatable-line/word'");
        expect(source).not.toContain('resolveVocabularyAnnotation');
        expect(source).not.toContain('getWordStatus');
    });
});

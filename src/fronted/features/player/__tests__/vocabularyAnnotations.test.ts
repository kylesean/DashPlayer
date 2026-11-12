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

    it('强化档与教练档的标注规则一致，差别只在主动提示密度', () => {
        expect(resolveVocabularyAnnotation('learning', 'intensive')).toBe('learning');
        expect(resolveVocabularyAnnotation('familiar', 'intensive')).toBe('familiar');
        expect(resolveVocabularyAnnotation('known', 'intensive')).toBeNull();
        expect(resolveVocabularyAnnotation('ignored', 'intensive')).toBeNull();
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
     * §6.1 要求 familiar 的交互是「悬停显示有印象」。这里锁定渲染层真的挂了提示，
     * 而不是只在下划线样式上有区别。
     */
    it('familiar 词渲染时带「有印象」悬停提示', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '..', 'components', 'translatable-line', 'word.tsx'),
            'utf8',
        );

        expect(source).toContain("annotationKind === 'familiar'");
        expect(source).toContain("t('wordStatusFamiliar')");
    });

    it('familiar 只在右侧文稿弱提示，主字幕不标记', () => {
        for (const guidance of ['coach', 'intensive'] as const) {
            expect(resolveVocabularyAnnotation('familiar', guidance, 'subtitle')).toBeNull();
            expect(resolveVocabularyAnnotation('familiar', guidance, 'transcript')).toBe('familiar');
            // learning 是必学词，两层都必须可见。
            expect(resolveVocabularyAnnotation('learning', guidance, 'subtitle')).toBe('learning');
        }
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

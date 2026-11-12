import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import OpenAIWordPop from '@/fronted/features/player/components/translatable-line/openai-word-pop';
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import type { WordMemoryVO } from '@/common/types/wordMemory';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => (
            options ? `${key}(${JSON.stringify(options)})` : key
        ),
        i18n: { language: 'zh-CN' },
    }),
}));

vi.mock('@/fronted/features/player/components/translatable-line/word-context-insight', () => ({
    default: () => <div data-testid="mock-insight" />,
}));

const data = {
    word: 'journey',
    phonetic: '/ˈdʒɜːni/',
    definitions: [{ partOfSpeech: 'noun', meaning: '旅程', examples: [] }],
    tags: [],
} as unknown as OpenAIDictionaryResult;

const memory = (overrides: Partial<WordMemoryVO> = {}): WordMemoryVO => ({
    word: 'journey',
    status: 'learning',
    source: 'manual',
    mastery: 0.3,
    confidence: 0.5,
    lastSeenAt: '2026-11-12T11:59:30.000Z',
    lastReviewedAt: null,
    dueAt: '2026-12-01T00:00:00.000Z',
    reviewCount: 2,
    lapseCount: 0,
    lastContext: null,
    ...overrides,
});

describe('OpenAIWordPop 历史行', () => {
    it('展示上次遇见与上次复习', () => {
        render(<OpenAIWordPop data={data} wordMemory={memory()} />);

        const block = screen.getByTestId('word-memory');
        expect(block.textContent).toContain('wordMemory.lastSeen');
        expect(block.textContent).toContain('wordMemory.lastReviewed');
        // 从未复习时明确说明，而不是留空。
        expect(block.textContent).toContain('wordMemory.neverReviewed');
    });

    it('没有历史数据时不渲染历史行', () => {
        render(<OpenAIWordPop data={data} />);

        expect(screen.queryByTestId('word-memory')).toBeNull();
    });

    it('未入词表时仍展示历史行，但状态标签为空', () => {
        render(<OpenAIWordPop data={data} wordMemory={memory({ status: null, source: null })} />);

        expect(screen.getByTestId('word-memory')).toBeDefined();
        expect(screen.queryByText('wordStatusLearning')).toBeNull();
    });
});

describe('OpenAIWordPop 提示理由', () => {
    it('有系统理由时展示「为什么此刻提示」', () => {
        render(
            <OpenAIWordPop
                data={data}
                promptReasons={['现在到期，复习正合适', '你之前查过它']}
            />,
        );

        const block = screen.getByTestId('word-prompt-reason');
        expect(block.textContent).toContain('wordPromptReasonLabel');
        expect(block.textContent).toContain('现在到期，复习正合适');
    });

    /**
     * 用户自己主动查的词通常没有系统理由；此时必须不渲染这一行，
     * 而不是编一个「高频」出来。
     */
    it('没有系统理由时不渲染该行', () => {
        render(<OpenAIWordPop data={data} />);
        expect(screen.queryByTestId('word-prompt-reason')).toBeNull();

        render(<OpenAIWordPop data={data} promptReasons={[]} />);
        expect(screen.queryByTestId('word-prompt-reason')).toBeNull();
    });
});

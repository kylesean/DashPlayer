import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import OpenAIWordPop from '@/frontend/features/player/components/translatable-line/openai-word-pop';
import type { OpenAIDictionaryResult } from '@/common/types/DictionaryResult';
import type { WordMemoryVO } from '@/common/types/wordMemory';
import useSetting from '@/frontend/features/settings/settingsStore';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => (
            options ? `${key}(${JSON.stringify(options)})` : key
        ),
        i18n: { language: 'zh-CN' },
    }),
}));

vi.mock('@/frontend/features/player/components/translatable-line/word-context-insight', () => ({
    default: () => <div data-testid="mock-insight" />,
}));

vi.mock('swr', () => ({
    default: () => ({ data: null, isLoading: false, mutate: vi.fn() }),
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
    it('默认收起，展开后展示上次遇见与上次复习', () => {
        render(<OpenAIWordPop data={data} wordMemory={memory()} />);

        // 两层式：学习状态默认不显示，避免悬停时信息过载。
        expect(screen.queryByTestId('word-memory')).toBeNull();
        fireEvent.click(screen.getByTestId('word-details-toggle'));

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

        fireEvent.click(screen.getByTestId('word-details-toggle'));
        expect(screen.getByTestId('word-memory')).toBeDefined();
        expect(screen.queryByText('wordStatusLearning')).toBeNull();
    });
});

describe('OpenAIWordPop 提示理由', () => {
    it('有系统理由时，展开后展示「为什么此刻提示」', () => {
        render(
            <OpenAIWordPop
                data={data}
                promptReasons={['现在到期，复习正合适', '你之前查过它']}
            />,
        );

        fireEvent.click(screen.getByTestId('word-details-toggle'));
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

describe('OpenAIWordPop 释义来源', () => {
    it('标注释义来自内置词典，让用户知道看的是哪一本', () => {
        render(<OpenAIWordPop data={{ ...data, source: 'builtin' }} />);

        expect(screen.getByTestId('word-source').textContent).toBe('dictionarySourceBuiltin');
    });

    it('AI 生成的释义要明确提示可能不准确', () => {
        render(<OpenAIWordPop data={{ ...data, source: 'ai' }} />);

        expect(screen.getByTestId('word-source').textContent).toBe('dictionarySourceAi');
    });

    it('来源未知时不渲染来源行，而不是猜一个', () => {
        render(<OpenAIWordPop data={data} />);

        expect(screen.queryByTestId('word-source')).toBeNull();
    });

    /**
     * 折叠入口曾经排在释义上方，看起来像「释义区标题」。
     * 它必须排在释义之后：用户读完释义，才可能想看学习记录。
     */
    it('「学习记录」排在释义之后', () => {
        render(<OpenAIWordPop data={data} wordMemory={memory()} />);

        const toggle = screen.getByTestId('word-details-toggle');
        const meaning = screen.getByText('旅程');
        expect(
            meaning.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it('AI 语境解析独立展示在释义之后，不藏在学习记录里', () => {
        render(<OpenAIWordPop data={{ ...data, source: 'builtin' }} contextSentence="Enjoy the journey." />);

        expect(screen.getByTestId('mock-insight')).toBeDefined();
        expect(screen.queryByTestId('word-details-toggle')).toBeNull();
        const meaning = screen.getByText('旅程');
        const source = screen.getByTestId('word-source');
        expect(
            meaning.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });
});

describe('OpenAIWordPop 操作区', () => {
    /**
     * 查词时用户处在「一眼扫过」的状态：动作要一步可达，
     * 不能先展开菜单再选。四个按钮平铺，靠 title/aria-label 说明后果。
     */
    it('四个动作平铺直达，不需要先展开菜单', () => {
        useSetting.setState({ values: new Map([['providers.dictionary', 'openai']]) });
        const onMarkKnown = vi.fn();
        render(
            <OpenAIWordPop
                data={data}
                onFavorite={vi.fn()}
                onMarkKnown={onMarkKnown}
                onMarkIgnored={vi.fn()}
                onRefresh={vi.fn()}
            />,
        );

        expect(screen.queryByTestId('word-actions-toggle')).toBeNull();
        expect(screen.getByRole('button', { name: 'favoriteWord' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'markWordIgnored' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'aiDictionary' })).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: 'markWordKnown' }));
        expect(onMarkKnown).toHaveBeenCalledTimes(1);
    });

    it('未启用 AI 词典时不显示 AI 词典切换按钮；已是 AI 释义时显示重新生成按钮', () => {
        useSetting.setState({ values: new Map([['providers.dictionary', 'none']]) });
        const { rerender } = render(
            <OpenAIWordPop data={{ ...data, source: 'builtin' }} onRefresh={vi.fn()} />,
        );
        expect(screen.queryByRole('button', { name: 'aiDictionary' })).toBeNull();

        useSetting.setState({ values: new Map([['providers.dictionary', 'openai']]) });
        rerender(<OpenAIWordPop data={{ ...data, source: 'ai' }} onRefresh={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'regenerateAiDictionary' })).toBeDefined();
    });
});

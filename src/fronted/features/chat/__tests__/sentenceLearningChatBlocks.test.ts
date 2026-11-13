import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';

import { toMessageBlocks } from '../useSentenceLearningChat';

type ToolPartShape = {
    type: 'tool-search_subtitles' | 'tool-get_subtitle_context';
    toolCallId: string;
    state: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
};

const messageWith = (parts: ToolPartShape[]): UIMessage => ({
    id: 'm1',
    role: 'assistant',
    parts: parts as unknown as UIMessage['parts'],
});

const searchPart = (state: string, output?: unknown): ToolPartShape => ({
    type: 'tool-search_subtitles',
    toolCallId: 't1',
    state,
    input: { queries: ['river bank'] },
    output,
});

describe('toMessageBlocks 的 tool 卡 running 钳制', () => {
    it('流活跃窗口内的 input-available 才视为 running', () => {
        const blocks = toMessageBlocks(messageWith([searchPart('input-available')]), true);
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({ kind: 'search', running: true });
    });

    it('流结束（中断/报错/完成）后，滞留的 input-available 不再转圈', () => {
        // AI SDK 在 error/abort 时不回写 tool part 终态，running 只能由流活跃窗口决定
        const blocks = toMessageBlocks(messageWith([searchPart('input-available')]), false);
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({ kind: 'search', running: false });
    });

    it('output-available 永远不是 running，与流状态无关', () => {
        const output = { matches: [{ index: 3, text: 'river bank' }], total: 1 };
        const active = toMessageBlocks(messageWith([searchPart('output-available', output)]), true);
        const inactive = toMessageBlocks(messageWith([searchPart('output-available', output)]), false);
        expect(active[0]).toMatchObject({ kind: 'search', running: false, hits: [{ index: 3, text: 'river bank' }] });
        expect(inactive[0]).toMatchObject({ kind: 'search', running: false });
    });

    it('output-error 映射为 error 块', () => {
        const part: ToolPartShape = { ...searchPart('output-error'), errorText: 'provider down' };
        const blocks = toMessageBlocks(messageWith([part]), true);
        expect(blocks).toEqual([{ kind: 'error', text: 'provider down' }]);
    });

    it('文本 part 输出 text 块，空白文本被剔除', () => {
        const message = {
            id: 'm1',
            role: 'assistant',
            parts: [
                { type: 'text', text: 'hello' },
                { type: 'text', text: '   ' },
            ],
        } as unknown as UIMessage;
        const blocks = toMessageBlocks(message, true);
        expect(blocks).toEqual([{ kind: 'text', text: 'hello' }]);
    });
});

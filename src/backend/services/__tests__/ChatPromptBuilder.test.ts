import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
    composeChatSystemPrompt,
    ensureChatRoleMessage,
    splitSystemMessages,
    toLocalChatMessagesWithWindow,
} from '@/backend/services/chat/ChatPromptBuilder';

describe('ChatPromptBuilder 双层提示词与上下文保护', () => {
    describe('splitSystemMessages（system 消息拆分）', () => {
        it('能把开头 system 消息拆出并保留剩余消息', () => {
            const { system, messages } = splitSystemMessages([
                { role: 'system', content: '你是学习伙伴' },
                { role: 'user', content: '用户问题' },
                { role: 'assistant', content: '助手回答' },
            ]);
            expect(system).toBe('你是学习伙伴');
            expect(messages).toEqual([
                { role: 'user', content: '用户问题' },
                { role: 'assistant', content: '助手回答' },
            ]);
        });

        it('多个 system 消息按原顺序用空行拼接', () => {
            const { system, messages } = splitSystemMessages([
                { role: 'system', content: '第一条' },
                { role: 'user', content: '问题' },
                { role: 'system', content: '第二条' },
            ]);
            expect(system).toBe('第一条\n\n第二条');
            expect(messages).toEqual([{ role: 'user', content: '问题' }]);
        });

        it('没有 system 消息时返回 undefined 且消息不变', () => {
            const { system, messages } = splitSystemMessages([
                { role: 'user', content: '问题' },
            ]);
            expect(system).toBeUndefined();
            expect(messages).toEqual([{ role: 'user', content: '问题' }]);
        });
    });
    it('双层拼装永远保留 [[tts:...]] 朗读协议，即使教学人设完全自定义', () => {
        const customPersona = '请用幽默夸张的相声捧哏语气讲解每个短语。';
        const withTools = composeChatSystemPrompt(customPersona, { enableSubtitleTools: true });
        expect(withTools).toContain(customPersona);
        expect(withTools).toContain('[[tts:');
        expect(withTools).toContain('search_subtitles');
        expect(withTools).toContain('禁止调用检索工具');

        const localCompact = composeChatSystemPrompt(customPersona, { enableSubtitleTools: false });
        expect(localCompact).toContain(customPersona);
        expect(localCompact).toContain('[[tts:');
        expect(localCompact).not.toContain('search_subtitles');
    });

    it('ensureChatRoleMessage 会在切换预设后覆盖旧系统提示词，不丢失聊天历史', () => {
        const messages: ModelMessage[] = [
            { role: 'system', content: 'old persona' },
            { role: 'user', content: 'What does break a leg mean?' },
        ];
        const updated = ensureChatRoleMessage(messages, {
            personaPrompt: 'new persona focus',
            enableSubtitleTools: false,
        });
        expect(updated[0].role).toBe('system');
        expect(updated[0].content).toContain('new persona focus');
        expect(updated[0].content).not.toContain('old persona');
        expect(updated).toHaveLength(2);
    });

    it('toLocalChatMessagesWithWindow 在超长多轮后裁剪中间旧轮次并保留字幕参考材料锚点', () => {
        const longText = 'word '.repeat(500);
        const messages: ModelMessage[] = [
            { role: 'system', content: '系统人设' },
            { role: 'user', content: '【字幕参考材料】\n\n当前学习句：Hang in there!\n\n首轮问题' },
            { role: 'assistant', content: longText },
            { role: 'user', content: longText },
            { role: 'assistant', content: longText },
            { role: 'user', content: '最新一轮追问' },
        ];
        const trimmed = toLocalChatMessagesWithWindow(messages, 3000);
        expect(trimmed[0].role).toBe('system');
        expect(trimmed.at(-1)?.content).toBe('最新一轮追问');
        expect(trimmed.some((m) => typeof m.content === 'string' && m.content.includes('Hang in there!'))).toBe(true);
    });
});

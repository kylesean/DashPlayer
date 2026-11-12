import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import {
    buildStudyCardPrompt,
    composeChatSystemPrompt,
    ensureChatRoleMessage,
    toLocalChatMessagesWithWindow,
} from '@/backend/services/chat/ChatPromptBuilder';

describe('ChatPromptBuilder 双层提示词与上下文保护', () => {
    it('双层拼装永远保留 [[tts:...]] 朗读协议，即使教学人设完全自定义', () => {
        const customPersona = '请用幽默夸张的相声捧哏语气讲解每个短语。';
        const withTools = composeChatSystemPrompt(customPersona, { enableSubtitleTools: true });
        expect(withTools).toContain(customPersona);
        expect(withTools).toContain('[[tts:');
        expect(withTools).toContain('search_subtitles');

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

    it('buildStudyCardPrompt 注入个人记忆提示与物理意象字段规范并包含 JSON 关键字', () => {
        const prompt = buildStudyCardPrompt({
            text: 'I am drowning in deadlines.',
            precedingLines: ['How is your week going?'],
            followingLines: ['Hang in there!'],
            memoryHints: {
                focusWords: ['drowning'],
                masteredWords: ['week'],
            },
        });
        expect(prompt).toContain('JSON');
        expect(prompt).toContain('coreImage');
        expect(prompt).toContain('drowning');
        expect(prompt).toContain('week');
        expect(prompt).toContain('Hang in there!');
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

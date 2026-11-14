import { beforeEach, describe, expect, it } from 'vitest';

import { useRecapPromptStore } from '@/frontend/features/player/components/learning-toolbar/recapPromptStore';

describe('recapPromptStore', () => {
    beforeEach(() => {
        useRecapPromptStore.setState({
            promptKey: null,
            promptedKeys: {},
            recapOpen: false,
        });
    });

    it('同一会话只提示一次', () => {
        useRecapPromptStore.getState().requestPrompt('v1::h1');
        expect(useRecapPromptStore.getState().promptKey).toBe('v1::h1');

        useRecapPromptStore.getState().dismiss();
        useRecapPromptStore.getState().requestPrompt('v1::h1');
        expect(useRecapPromptStore.getState().promptKey).toBeNull();
    });

    it('会话键为空时不提示', () => {
        useRecapPromptStore.getState().requestPrompt(null);
        expect(useRecapPromptStore.getState().promptKey).toBeNull();
    });

    it('切到新会话后可以再次提示', () => {
        useRecapPromptStore.getState().requestPrompt('v1::h1');
        useRecapPromptStore.getState().dismiss();
        useRecapPromptStore.getState().requestPrompt('v2::h2');
        expect(useRecapPromptStore.getState().promptKey).toBe('v2::h2');
    });

    it('复盘弹层开关由 store 共享，提示与工具栏读写同一份状态', () => {
        expect(useRecapPromptStore.getState().recapOpen).toBe(false);
        useRecapPromptStore.getState().setRecapOpen(true);
        expect(useRecapPromptStore.getState().recapOpen).toBe(true);
        useRecapPromptStore.getState().setRecapOpen(false);
        expect(useRecapPromptStore.getState().recapOpen).toBe(false);
    });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Theme } from '@astryxdesign/core/theme';
import { LinkProvider } from '@astryxdesign/core/Link';
import { themes } from '@/astryx-themes';
import zhCommon from '@/fronted/i18n/locales/zh-CN/common.json';
import StudyWorkbenchShell from '../components/StudyWorkbenchShell';
import SentenceStudyCanvas from '../components/SentenceStudyCanvas';
import StudyCopilotPane from '../components/StudyCopilotPane';
import { preprocessStudyMarkdown } from '../studyMarkdown';
import { extractCleanTakeaway, tokenizeSentenceWithHighlights } from '../sentenceStudyHelpers';

const resolveZhKey = (key: string, opts?: { defaultValue?: string; index?: number; name?: string; expr?: string }): string => {
    const clean = key.replace(/^common:/, '');
    const parts = clean.split('.');
    let cursor: unknown = zhCommon;
    for (const part of parts) {
        cursor = cursor && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[part] : undefined;
    }
    const template = typeof cursor === 'string' ? cursor : (opts?.defaultValue ?? key);
    return template
        .replace('{{index}}', String(opts?.index ?? ''))
        .replace('{{name}}', String(opts?.name ?? ''))
        .replace('{{expr}}', String(opts?.expr ?? ''));
};

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: { defaultValue?: string; index?: number; name?: string; expr?: string }) =>
            resolveZhKey(key, opts),
    }),
}));

vi.mock('@/fronted/components/shared/common/Playable', () => ({
    default: ({ children }: { children: string }) => <button type="button" data-testid="playable-pill">{children}</button>,
}));

vi.mock('@/fronted/components/shared/common/SwitchTopic', () => ({
    default: ({ label }: { label?: string }) => <span>{label}</span>,
}));

const noop = () => undefined;

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: noop,
            removeListener: noop,
            addEventListener: noop,
            removeEventListener: noop,
            dispatchEvent: () => false,
        }),
    });
}
if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}

const renderWithAstryx = (ui: React.ReactNode) => render(
    <Theme theme={themes['dp-neutral']} mode="light">
        <LinkProvider component={({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a>}>
            {ui}
        </LinkProvider>
    </Theme>,
);

describe('整句学习 AI-Native 工作台组件套件', () => {
    it('渲染极简确定性左栏工作台：原声与循环、句内词典微卡、前后对话语境、折叠收获条与收藏跳转', () => {
        const onPlayOriginal = vi.fn();
        const onToggleLoop = vi.fn();
        const onToggleSaveSentence = vi.fn();
        const onDeepDive = vi.fn();
        const onPreviewLine = vi.fn();
        const onStep = vi.fn();
        const onJumpPractice = vi.fn();

        renderWithAstryx(
            <StudyWorkbenchShell
                sentenceIndex={4}
                totalSentences={20}
                canStepPrev
                canStepNext
                onStepSentence={onStep}
                onBackToPlayer={noop}
                onJumpToPractice={onJumpPractice}
                isSentenceSaved={false}
                onToggleSaveSentence={onToggleSaveSentence}
                leftCanvas={(
                    <SentenceStudyCanvas
                        sentence={{
                            en: 'Do not sit on the fence.',
                            zh: '别两头摇摆。',
                            position: '00:12 · 第 5 / 20 句',
                        }}
                        neighbors={[
                            { index: 3, text: 'You have to choose a side now.', isCurrent: false },
                            { index: 4, text: 'Do not sit on the fence.', isCurrent: true },
                        ]}
                        resolveWordDetail={(word) => (word.toLowerCase() === 'fence' ? {
                            word: 'fence',
                            phonetic: 'fens',
                            meaning: 'n. 栅栏；围栏',
                            tags: ['cet4'],
                            surfaces: ['fence'],
                            memoryTag: 'due',
                        } : null)}
                        isFavorite={() => false}
                        onToggleFavorite={noop}
                        onSpeak={noop}
                        onPlayOriginal={onPlayOriginal}
                        isLooping={false}
                        onToggleLoop={onToggleLoop}
                        onDeepDiveExpression={onDeepDive}
                        onPreviewSubtitleLine={onPreviewLine}
                        miniVideoCollapsed={false}
                        onToggleMiniCollapsed={noop}
                        previewingEvidenceIndex={null}
                        onReturnToAnchorClip={noop}
                        noteSummary="栅栏画面"
                        noteSaving={false}
                        onNoteChange={noop}
                        onSaveNote={noop}
                    />
                )}
                rightCopilot={<div data-testid="right-placeholder" />}
            />,
        );

        expect(screen.getByTestId('learning-workbench')).toBeDefined();
        expect(screen.getByTestId('mini-pip-slot')).toBeDefined();
        expect(screen.getByText('前后对话语境')).toBeDefined();
        expect(screen.getByText('You have to choose a side now.')).toBeDefined();
        // 左栏已完全撤除「自动解析」「盲听」「0.75x」及冗余卡片
        expect(screen.queryByText('自动解析')).toBeNull();
        expect(screen.queryByText('0.75x')).toBeNull();
        expect(screen.queryByText('盲听')).toBeNull();
        // 严防任何未翻译的 i18n key 裸露到页面
        expect(document.body.textContent).not.toMatch(/learning\.[A-Za-z]+/);

        // 点击句中单词「fence」展开本地词典微卡
        fireEvent.click(screen.getByRole('button', { name: 'fence' }));
        expect(screen.getByTestId('inline-expression-popover')).toBeDefined();
        expect(screen.getByText('/fens/')).toBeDefined();
        expect(screen.getByText('n. 栅栏；围栏')).toBeDefined();
        expect(screen.getByText('待复习')).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: '问 AI 讲透' }));
        expect(onDeepDive).toHaveBeenCalledWith('fence');

        // 点击前一句台词触发试听
        fireEvent.click(screen.getByText('You have to choose a side now.'));
        expect(onPreviewLine).toHaveBeenCalledWith(3);

        fireEvent.click(screen.getByRole('button', { name: '原声本句' }));
        expect(onPlayOriginal).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: '单句循环' }));
        expect(onToggleLoop).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: '收入工坊' }));
        expect(onToggleSaveSentence).toHaveBeenCalledTimes(1);

        // 本句收获默认折叠，点击后展开输入框
        expect(screen.queryByPlaceholderText('记下这句最值钱的一句表达或心得…')).toBeNull();
        fireEvent.click(screen.getByTestId('takeaway-collapsed-bar'));
        expect(screen.getByPlaceholderText('记下这句最值钱的一句表达或心得…')).toBeDefined();

        fireEvent.click(screen.getByText('跟读/听写'));
        expect(onJumpPractice).toHaveBeenCalledTimes(1);
    });

    it('右侧 Astryx Chat 对话流渲染 [[tts:...]] 胶囊，且命中证据支持点击试听 3 秒原声', () => {
        const onPreviewLine = vi.fn();

        renderWithAstryx(
            <StudyCopilotPane
                sentenceText="Do not sit on the fence."
                messages={[
                    {
                        id: 'u1',
                        role: 'user',
                        blocks: [{ kind: 'text', text: '[聚焦表达: on the fence]\n这是什么画面？' }],
                    },
                    {
                        id: 'a1',
                        role: 'assistant',
                        blocks: [
                            {
                                kind: 'search',
                                queries: ['fence'],
                                hits: [{ index: 1, text: 'Stop hiding behind the fence!' }],
                                total: 1,
                                running: false,
                            },
                            {
                                kind: 'text',
                                text: '试试念这句 [[tts:sit on the fence]] 体会平衡感。',
                            },
                        ],
                    },
                ]}
                isBusy={false}
                sessionReady
                cloudAvailable
                chatErrorText={null}
                input=""
                onInputChange={noop}
                onSubmit={noop}
                onStop={noop}
                onClearConversation={noop}
                onPreviewSubtitleLine={onPreviewLine}
                onAppendToNote={noop}
                attachedFocusExpr="on the fence"
                onClearFocusExpr={noop}
                dictation={{
                    isSupported: false,
                    isListening: false,
                    isSpeaking: false,
                    volume: 0,
                    bands: [0, 0, 0, 0, 0],
                    rawBands: [0, 0, 0, 0, 0],
                    interimTranscript: '',
                    start: noop,
                    stop: noop,
                    abort: noop,
                    toggle: noop,
                }}
            />,
        );

        expect(screen.getByTestId('playable-pill').textContent).toBe('sit on the fence');
        fireEvent.click(screen.getByText(/Stop hiding behind the fence!/));
        expect(onPreviewLine).toHaveBeenCalledWith(1);
    });

    it('右侧对话空态呈现动作导向启动卡与次要 Prompt 设置入口且无未翻译 key 外泄', () => {
        const onOpenPresetDialog = vi.fn();

        renderWithAstryx(
            <StudyCopilotPane
                sentenceText="Do not sit on the fence."
                messages={[]}
                isBusy={false}
                sessionReady
                cloudAvailable
                chatErrorText={null}
                input=""
                onInputChange={noop}
                onSubmit={noop}
                onStop={noop}
                onClearConversation={noop}
                onPreviewSubtitleLine={noop}
                onAppendToNote={noop}
                attachedFocusExpr={null}
                onClearFocusExpr={noop}
                onOpenPresetDialog={onOpenPresetDialog}
                dictation={{
                    isSupported: false,
                    isListening: false,
                    isSpeaking: false,
                    volume: 0,
                    bands: [0, 0, 0, 0, 0],
                    rawBands: [0, 0, 0, 0, 0],
                    interimTranscript: '',
                    start: noop,
                    stop: noop,
                    abort: noop,
                    toggle: noop,
                }}
            />,
        );

        expect(screen.getByText('点破言外之意')).toBeDefined();
        expect(screen.getByText('讲透核心表达')).toBeDefined();
        expect(screen.getByText('情景造句实战')).toBeDefined();
        expect(screen.getByText('查前后剧情')).toBeDefined();
        expect(screen.queryByText('听感连读拆解')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: '编辑 Prompt' }));
        expect(onOpenPresetDialog).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).not.toMatch(/learning\.[A-Za-z]+/);
    });

    it('收为收获时清理 [[tts:...]] 与 Markdown 语法，句内切词优先完整匹配多词焦点短语', () => {
        const segments = tokenizeSentenceWithHighlights('Do not sit on the fence!', [
            { expression: 'on the fence', kind: 'phrase', coreImage: '跨骑在栅栏上' },
        ]);
        const phraseSeg = segments.find((s) => s.text === 'on the fence');
        expect(phraseSeg?.clickable).toBe(true);
        expect(phraseSeg?.focalPoint?.coreImage).toBe('跨骑在栅栏上');
        expect(segments.some((s) => s.text === 'sit' && s.clickable)).toBe(true);

        const cleaned = extractCleanTakeaway('### 小结\n**[[tts:sit on the fence]]** 意思是 `犹豫不决`。\n[[switch:12|跳转]]');
        expect(cleaned).toBe('小结 sit on the fence 意思是 犹豫不决。');

        const onAppendToNote = vi.fn();
        renderWithAstryx(
            <StudyCopilotPane
                sentenceText="Do not sit on the fence."
                messages={[
                    {
                        id: 'a-takeaway',
                        role: 'assistant',
                        blocks: [{ kind: 'text', text: '### 要点\n**[[tts:on the fence]]** 表示**保持中立**。' }],
                    },
                ]}
                isBusy={false}
                sessionReady
                cloudAvailable
                chatErrorText={null}
                input=""
                onInputChange={noop}
                onSubmit={noop}
                onStop={noop}
                onClearConversation={noop}
                onPreviewSubtitleLine={noop}
                onAppendToNote={onAppendToNote}
                attachedFocusExpr={null}
                onClearFocusExpr={noop}
                dictation={{
                    isSupported: false,
                    isListening: false,
                    isSpeaking: false,
                    volume: 0,
                    bands: [0, 0, 0, 0, 0],
                    rawBands: [0, 0, 0, 0, 0],
                    interimTranscript: '',
                    start: noop,
                    stop: noop,
                    abort: noop,
                    toggle: noop,
                }}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: '收为收获' }));
        expect(onAppendToNote).toHaveBeenCalledWith('要点 on the fence 表示保持中立。');
    });

    it('助手消息中的中文标点加粗、反引号包裹的 [[tts:...]] 与缺空格标题均能正确渲染而非输出原始星号', () => {
        const processed = preprocessStudyMarkdown('###物理画面\n在**「核心」**中，`[[tts:means]]` 表示**[[tts:take a risk]]**的动作。', false);
        expect(processed).toContain('### 物理画面');
        expect(processed).toContain('[means](tts:means)');
        expect(processed).not.toContain('`[means](tts:means)`');
        expect(preprocessStudyMarkdown('尝试 [[tts:hel', true)).toBe('尝试 ');

        const { container } = renderWithAstryx(
            <StudyCopilotPane
                sentenceText="Do not sit on the fence."
                messages={[
                    {
                        id: 'msg-1',
                        role: 'assistant',
                        blocks: [
                            {
                                kind: 'text',
                                text: '###物理画面\n\n在**「真实空间」**中，`[[tts:sit on the fence]]` 表达核心词**[[tts:means]]**的犹豫感。',
                            },
                        ],
                    },
                ]}
                isBusy={false}
                sessionReady
                cloudAvailable
                chatErrorText={null}
                input=""
                onInputChange={noop}
                onSubmit={noop}
                onStop={noop}
                onClearConversation={noop}
                onPreviewSubtitleLine={noop}
                onAppendToNote={noop}
                attachedFocusExpr={null}
                onClearFocusExpr={noop}
                dictation={{
                    isSupported: false,
                    isListening: false,
                    isSpeaking: false,
                    volume: 0,
                    bands: [0, 0, 0, 0, 0],
                    rawBands: [0, 0, 0, 0, 0],
                    interimTranscript: '',
                    start: noop,
                    stop: noop,
                    abort: noop,
                    toggle: noop,
                }}
            />,
        );

        const pills = screen.getAllByTestId('playable-pill').map((el) => el.textContent);
        expect(pills).toEqual(['sit on the fence', 'means']);
        expect(container.querySelectorAll('strong').length).toBeGreaterThanOrEqual(2);
        expect(container.textContent).not.toContain('**');
        expect(container.textContent).not.toContain('[[tts:');
        expect(container.textContent).not.toContain('###');
    });
});

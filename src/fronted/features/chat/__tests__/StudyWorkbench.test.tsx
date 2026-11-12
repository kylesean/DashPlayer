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
    it('渲染双栏工作台、Mini PiP 槽、4 模块物理意象首卡与可点击听感线索', () => {
        const onPlayOriginal = vi.fn();
        const onDeepDive = vi.fn();
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
                presets={[
                    {
                        id: 'image-schema-tutor',
                        name: '物理意象导师',
                        description: '画面映射',
                        roleMode: 'study',
                        systemPrompt: 'prompt',
                        isBuiltin: true,
                        isDefault: true,
                        updatedAt: '',
                    },
                ]}
                activePresetId="image-schema-tutor"
                onSelectPreset={noop}
                onOpenPresetDialog={noop}
                autoGenerateStudyCard
                onToggleAutoGenerateStudyCard={noop}
                cloudAvailable
                leftCanvas={(
                    <SentenceStudyCanvas
                        sentence={{
                            en: 'Do not sit on the fence.',
                            zh: '别两头摇摆。',
                            position: '00:12 · 第 5 / 20 句',
                        }}
                        neighbors={[{ index: 4, text: 'Do not sit on the fence.', isCurrent: true }]}
                        analysis={{
                            sentence: {
                                completeText: 'Do not sit on the fence.',
                                contextualTranslation: '别两头摇摆。',
                                chunks: ['Do not sit', 'on the fence.'],
                            },
                            focalPoints: [{
                                expression: 'on the fence',
                                kind: 'phrase',
                                tag: '物理意象',
                                coreImage: '坐在分隔两块草地的木栅栏正上方。',
                                meaningInContext: '尚未站队、保持中立犹豫。',
                            }],
                            listeningLens: [{
                                span: 'sit on the',
                                phenomenon: '辅元连读',
                                tip: 'sit 的 /t/ 闪音轻连到 on 上',
                            }],
                            sentenceLens: {
                                structureInsight: '直接借用动作意象代替抽象说教',
                                subtext: '带一点催促对方表态的意味',
                            },
                        }}
                        analysisStatus="done"
                        analysisError={null}
                        sessionReady
                        cloudAvailable
                        vocabWords={[{
                            word: 'fence',
                            phonetic: 'fens',
                            meaning: 'n. 栅栏；围栏',
                            tags: ['cet4'],
                            surfaces: ['fence'],
                            memoryTag: 'due',
                        }]}
                        resolveWordDetail={() => null}
                        isFavorite={() => false}
                        onToggleFavorite={noop}
                        onSpeak={noop}
                        onPlayOriginal={onPlayOriginal}
                        onRequestAnalysis={noop}
                        onDeepDiveExpression={onDeepDive}
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
        expect(screen.getByText('坐在分隔两块草地的木栅栏正上方。')).toBeDefined();
        expect(screen.getByText('[辅元连读] sit 的 /t/ 闪音轻连到 on 上')).toBeDefined();
        expect(screen.getByText('待复习')).toBeDefined();
        // 严防任何未翻译的 i18n key 裸露到页面
        expect(document.body.textContent).not.toMatch(/learning\.[A-Za-z]+/);

        fireEvent.click(screen.getByText('sit on the'));
        expect(onPlayOriginal).toHaveBeenCalledWith(0.75);

        fireEvent.click(screen.getAllByRole('button', { name: 'AI 拆解画面' })[0]);
        expect(onDeepDive).toHaveBeenCalledWith('on the fence');

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
                activePresetName="物理意象导师"
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

    it('右侧对话空态借鉴 ai-chat-landing 网格卡片且无任何未翻译 key 外泄', () => {
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
                activePresetName="物理意象导师"
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

        expect(screen.getByText('物理画面')).toBeDefined();
        expect(screen.getByText('情景造句')).toBeDefined();
        expect(screen.getByText('连读拆解')).toBeDefined();
        expect(screen.getByText('前文线索')).toBeDefined();
        expect(document.body.textContent).not.toMatch(/learning\.[A-Za-z]+/);
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
                activePresetName="物理意象导师"
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

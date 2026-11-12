import { useMemo, useRef } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import {
    ChatComposer,
    ChatComposerDrawer,
    ChatComposerInput,
    type ChatComposerInputHandle,
    type ChatComposerTrigger,
    ChatDictationButton,
    ChatLayout,
    ChatMessage,
    ChatMessageBubble,
    ChatMessageList,
    ChatToolCalls,
    type ChatToolCallItem,
    type UseSpeechRecognitionReturn,
} from '@astryxdesign/core/Chat';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Grid } from '@astryxdesign/core/Grid';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { Markdown, type MarkdownComponents } from '@astryxdesign/core/Markdown';
import { Heading, Text } from '@astryxdesign/core/Text';
import { createStaticSource, TypeaheadItem } from '@astryxdesign/core/Typeahead';
import {
    BookmarkPlus,
    Bot,
    Copy,
    Ear,
    Lightbulb,
    MessagesSquare,
    Play,
    Search,
    Trash2,
    X,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import Playable from '@/fronted/components/shared/common/Playable';
import SwitchTopic from '@/fronted/components/shared/common/SwitchTopic';
import {
    extractMarkdownNodeText,
    preprocessStudyMarkdown,
    safeDecodeMarkerUrl,
    SWITCH_PROTOCOL,
    TTS_PROTOCOL,
} from '@/fronted/features/chat/studyMarkdown';
import type { LearningMessageView } from '@/fronted/features/chat/types';

export interface StudyCopilotPaneProps {
    sentenceText: string;
    messages: LearningMessageView[];
    isBusy: boolean;
    sessionReady: boolean;
    cloudAvailable: boolean;
    chatErrorText: string | null;
    input: string;
    onInputChange: (value: string) => void;
    onSubmit: (value: string) => void;
    onStop: () => void;
    onClearConversation: () => void;
    onPreviewSubtitleLine: (index: number) => void;
    onAppendToNote: (text: string) => void;
    attachedFocusExpr: string | null;
    onClearFocusExpr: () => void;
    activePresetName: string;
    dictation: UseSpeechRecognitionReturn & {
        isTranscribing?: boolean;
        isRequesting?: boolean;
    };
}

interface SlashCommandItem {
    id: string;
    label: string;
    prompt: string;
}

const extractPlainTextFromBlocks = (msg: LearningMessageView): string => msg.blocks
    .filter((b): b is Extract<typeof b, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n\n')
    .trim();

const FOCUS_PREFIX_PATTERN = /^\[聚焦表达:\s*([^\]]+)\]\s*\n?/;

/**
 * 右侧 Astryx AI-Native 多轮精读 Co-pilot（借鉴官方 ai-chat & ai-chat-landing 模板设计语言）。
 */
export default function StudyCopilotPane({
    sentenceText,
    messages,
    isBusy,
    sessionReady,
    cloudAvailable,
    chatErrorText,
    input,
    onInputChange,
    onSubmit,
    onStop,
    onClearConversation,
    onPreviewSubtitleLine,
    onAppendToNote,
    attachedFocusExpr,
    onClearFocusExpr,
    activePresetName,
    dictation,
}: StudyCopilotPaneProps) {
    const { t } = useTranslation('common');
    const composerInputRef = useRef<ChatComposerInputHandle | null>(null);

    const starters = useMemo(() => [
        {
            id: 'image',
            icon: Lightbulb,
            title: t('learning.starterImageTitle'),
            hint: t('learning.starterImageHint'),
            prompt: '这句里最传神的表达在物理世界是什么画面？怎么引申出这里的意思？',
        },
        {
            id: 'roleplay',
            icon: MessagesSquare,
            title: t('learning.starterRoleplayTitle'),
            hint: t('learning.starterRoleplayHint'),
            prompt: '针对这句核心表达出 1 个生活小情景，邀我用英文造句并帮我润色。',
        },
        {
            id: 'listening',
            icon: Ear,
            title: t('learning.starterListeningTitle'),
            hint: t('learning.starterListeningHint'),
            prompt: '分析这句的吞音、连读、弱读与重音落点。',
        },
        {
            id: 'search',
            icon: Search,
            title: t('learning.starterSearchTitle'),
            hint: t('learning.starterSearchHint'),
            prompt: '搜索前后台词，看看说话人为什么会说这句话？',
        },
    ], [t]);

    const slashCommands = useMemo<SlashCommandItem[]>(() => [
        {
            id: 'image',
            label: t('learning.slashImage'),
            prompt: '请用“物理原型画面 → 抽象共识隐喻 → 这句语气”拆解这句里的核心表达。',
        },
        {
            id: 'challenge',
            label: t('learning.slashChallenge'),
            prompt: '围绕这句核心表达出 1 个贴近生活的微情景，让我用英文造句并帮我润色。',
        },
        {
            id: 'listen',
            label: t('learning.slashListen'),
            prompt: '拆解这句真实口语里的连读、弱读、吞音和重音锚词。',
        },
        {
            id: 'prev',
            label: t('learning.slashPrev'),
            prompt: '结合前文台词搜索一下，说话人为什么会在这里说出这句？',
        },
        {
            id: 'polish',
            label: t('learning.slashPolish'),
            prompt: '给出 2 种不同亲疏语气的母语级替换说法并说明差异。',
        },
    ], [t]);

    const markdownComponents = useMemo<MarkdownComponents>(() => ({
        link: ({ href, children: linkChildren }) => {
            if (href.startsWith(TTS_PROTOCOL)) {
                const content = extractMarkdownNodeText(linkChildren)
                    || safeDecodeMarkerUrl(href.slice(TTS_PROTOCOL.length));
                return content ? <Playable>{content}</Playable> : null;
            }
            if (href.startsWith(SWITCH_PROTOCOL)) {
                const target = safeDecodeMarkerUrl(href.slice(SWITCH_PROTOCOL.length));
                const label = extractMarkdownNodeText(linkChildren) || t('clickToSwitch');
                return target ? <SwitchTopic encoded={encodeURIComponent(target)} label={label} /> : null;
            }
            const isExternal = href.startsWith('https://') || href.startsWith('http://');
            return (
                <a
                    href={href}
                    {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="text-accent underline underline-offset-2 hover:opacity-80"
                >
                    {linkChildren}
                </a>
            );
        },
    }), [t]);

    const triggers = useMemo<ChatComposerTrigger[]>(() => {
        const items = slashCommands.map((cmd) => ({
            id: cmd.id,
            label: `/${cmd.label}`,
            auxiliaryData: cmd,
        }));
        return [
            {
                character: '/',
                menuLabel: t('learning.slashMenuLabel'),
                searchSource: createStaticSource(items, {
                    keywords: (item) => [item.id, (item.auxiliaryData as SlashCommandItem).prompt],
                }),
                renderItem: (item) => (
                    <TypeaheadItem
                        item={item}
                        description={(item.auxiliaryData as SlashCommandItem)?.prompt.slice(0, 28)}
                    />
                ),
                onSelect: (item) => {
                    const cmd = item.auxiliaryData as SlashCommandItem | undefined;
                    return cmd ? `${cmd.prompt} ` : `/${item.label} `;
                },
            },
        ];
    }, [slashCommands, t]);

    const composerDisabled = !sessionReady || !cloudAvailable;

    // 借鉴 Astryx ai-chat-landing 模板：ClickableCard 栅格 + 舒适间距，彻底摆脱一排挤压的椭圆胶囊
    const emptyState = (
        <div className="mx-auto flex w-full max-w-lg flex-col justify-center px-6 py-10">
            <VStack gap={5}>
                <VStack gap={1}>
                    <HStack gap={2} vAlign="center">
                        <Bot className="h-4 w-4 text-accent" />
                        <Text type="supporting" color="secondary">{activePresetName}</Text>
                    </HStack>
                    <Heading level={3}>{t('learning.copilotWelcomeShort')}</Heading>
                    <Text type="supporting" color="secondary" className="line-clamp-1">
                        {sentenceText}
                    </Text>
                </VStack>

                <Grid columns={2} gap={3}>
                    {starters.map((starter) => {
                        const Icon = starter.icon;
                        return (
                            <ClickableCard
                                key={starter.id}
                                label={starter.title}
                                variant="muted"
                                padding={3}
                                isDisabled={composerDisabled || isBusy}
                                onClick={() => onSubmit(starter.prompt)}
                            >
                                <VStack gap={1}>
                                    <HStack gap={1.5} vAlign="center">
                                        <Icon className="h-3.5 w-3.5 text-accent shrink-0" />
                                        <Text type="body" weight="semibold">{starter.title}</Text>
                                    </HStack>
                                    <Text type="supporting" color="secondary" className="line-clamp-1">
                                        {starter.hint}
                                    </Text>
                                </VStack>
                            </ClickableCard>
                        );
                    })}
                </Grid>
            </VStack>
        </div>
    );

    const hasDrawerContent = Boolean(attachedFocusExpr || dictation.isTranscribing);

    const composer = (
        <ChatComposer
            density="compact"
            elevation="none"
            value={input}
            onChange={onInputChange}
            onSubmit={onSubmit}
            onStop={onStop}
            isStopShown={isBusy}
            isDisabled={composerDisabled}
            status={chatErrorText ? { type: 'error', message: chatErrorText } : undefined}
            drawer={hasDrawerContent ? (
                <ChatComposerDrawer>
                    <div className="flex items-center justify-between gap-2 text-sm">
                        {attachedFocusExpr && (
                            <span className="inline-flex items-center gap-1">
                                <Badge variant="info" label={attachedFocusExpr} />
                                <IconButton
                                    label={t('learning.removeFocus')}
                                    icon={<X className="h-3 w-3" />}
                                    variant="ghost"
                                    size="sm"
                                    onClick={onClearFocusExpr}
                                />
                            </span>
                        )}
                        {dictation.isTranscribing && (
                            <span className="text-sm text-accent animate-pulse">
                                {t('learning.transcribingMic')}
                            </span>
                        )}
                    </div>
                </ChatComposerDrawer>
            ) : undefined}
            input={(
                <ChatComposerInput
                    handleRef={composerInputRef}
                    value={input}
                    onChange={onInputChange}
                    onSubmit={onSubmit}
                    triggers={triggers}
                    isDisabled={composerDisabled}
                    placeholder={
                        composerDisabled
                            ? (!sessionReady ? t('learning.preparingSession') : t('learning.aiOfflineCompact'))
                            : t('learning.copilotPlaceholderShort')
                    }
                />
            )}
            footerActions={messages.length > 0 && !isBusy ? (
                <IconButton
                    label={t('learning.clearChat')}
                    tooltip={t('learning.clearChat')}
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    variant="ghost"
                    size="sm"
                    onClick={onClearConversation}
                />
            ) : undefined}
            sendActions={(
                <span
                    className="inline-flex"
                    aria-busy={Boolean(dictation.isRequesting || dictation.isTranscribing) || undefined}
                >
                    <ChatDictationButton
                        dictation={dictation}
                        size="sm"
                        isHiddenWhenUnsupported
                    />
                </span>
            )}
        />
    );

    return (
        <div className="flex h-full w-full flex-col overflow-hidden px-3 pt-2">
            <ChatLayout
                density="compact"
                composer={composer}
                emptyState={messages.length === 0 ? emptyState : undefined}
            >
                {messages.length > 0 && (
                    <ChatMessageList density="compact">
                        {messages.map((message, msgIndex) => {
                            const isLastAssistantStreaming = isBusy
                                && msgIndex === messages.length - 1
                                && message.role === 'assistant';

                            if (message.role === 'user') {
                                const rawUserText = extractPlainTextFromBlocks(message);
                                const focusMatch = rawUserText.match(FOCUS_PREFIX_PATTERN);
                                const displayBody = focusMatch
                                    ? rawUserText.replace(FOCUS_PREFIX_PATTERN, '').trim()
                                    : rawUserText;
                                return (
                                    <ChatMessage key={message.id} sender="user">
                                        <ChatMessageBubble>
                                            {focusMatch && (
                                                <div className="mb-1">
                                                    <Badge variant="neutral" label={focusMatch[1]} />
                                                </div>
                                            )}
                                            <div className="whitespace-pre-wrap text-base leading-relaxed select-text">
                                                {displayBody}
                                            </div>
                                        </ChatMessageBubble>
                                    </ChatMessage>
                                );
                            }

                            const toolCalls: ChatToolCallItem[] = [];
                            const textParts: string[] = [];
                            const errorParts: string[] = [];

                            message.blocks.forEach((block, blockIdx) => {
                                if (block.kind === 'text') {
                                    textParts.push(block.text);
                                } else if (block.kind === 'error') {
                                    errorParts.push(block.text);
                                } else if (block.kind === 'search') {
                                    toolCalls.push({
                                        key: `search-${blockIdx}`,
                                        name: 'search_subtitles',
                                        status: block.running ? 'running' : 'complete',
                                        target: block.queries.join(' / '),
                                        stats: `${block.total}`,
                                    });
                                } else if (block.kind === 'context') {
                                    toolCalls.push({
                                        key: `context-${blockIdx}`,
                                        name: 'get_subtitle_context',
                                        status: block.running ? 'running' : 'complete',
                                        target: block.range
                                            ? `#${block.range.start + 1}–#${block.range.end + 1}`
                                            : '…',
                                    });
                                }
                            });

                            const combinedAssistantText = textParts.join('\n\n');

                            return (
                                <ChatMessage
                                    key={message.id}
                                    sender="assistant"
                                    name={activePresetName}
                                >
                                    {toolCalls.length > 0 && (
                                        <ChatMessageBubble variant="ghost" width="100%">
                                            <ChatToolCalls calls={toolCalls} />
                                            {message.blocks.map((block, bIdx) => (
                                                block.kind === 'search' && block.hits.length > 0 ? (
                                                    <div key={`hits-${bIdx}`} className="mt-1.5 space-y-1">
                                                        {block.hits.slice(0, 4).map((hit) => (
                                                            <button
                                                                key={hit.index}
                                                                type="button"
                                                                onClick={() => onPreviewSubtitleLine(hit.index)}
                                                                className="flex w-full items-start justify-between gap-2 rounded-lg border border-border/50 bg-body/80 px-2.5 py-1.5 text-left text-sm hover:border-accent-bg/50 transition-colors cursor-pointer"
                                                            >
                                                                <span className="min-w-0 flex-1 text-primary/90 leading-snug">
                                                                    <span className="mr-1.5 font-mono text-metadata text-accent">
                                                                        #{hit.index + 1}
                                                                    </span>
                                                                    {hit.text}
                                                                </span>
                                                                <span className="inline-flex shrink-0 items-center gap-1 text-metadata font-medium text-accent">
                                                                    <Play className="h-3 w-3" />
                                                                    <span>3s</span>
                                                                </span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : null
                                            ))}
                                        </ChatMessageBubble>
                                    )}

                                    {(combinedAssistantText || isLastAssistantStreaming) && (
                                        <ChatMessageBubble variant="ghost" width="100%">
                                            <Markdown
                                                density="compact"
                                                headingLevelStart={2}
                                                contentWidth="100%"
                                                isStreaming={isLastAssistantStreaming}
                                                components={markdownComponents}
                                            >
                                                {preprocessStudyMarkdown(
                                                    combinedAssistantText || (isLastAssistantStreaming ? '…' : ''),
                                                    isLastAssistantStreaming,
                                                )}
                                            </Markdown>
                                        </ChatMessageBubble>
                                    )}

                                    {errorParts.map((errText, errIdx) => (
                                        <ChatMessageBubble key={`err-${errIdx}`} variant="ghost" width="100%">
                                            <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error-text">
                                                {errText}
                                            </div>
                                        </ChatMessageBubble>
                                    ))}

                                    {!isLastAssistantStreaming && combinedAssistantText.trim().length > 0 && (
                                        <HStack gap={0.5} vAlign="center" className="mt-0.5 px-1">
                                            <IconButton
                                                label={t('learning.saveToNote')}
                                                tooltip={t('learning.saveToNote')}
                                                icon={<BookmarkPlus className="h-3.5 w-3.5" />}
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    onAppendToNote(combinedAssistantText.slice(0, 600));
                                                    toast.success(t('learning.savedToNote'));
                                                }}
                                            />
                                            <IconButton
                                                label={t('copy')}
                                                tooltip={t('copy')}
                                                icon={<Copy className="h-3.5 w-3.5" />}
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    void navigator.clipboard.writeText(combinedAssistantText);
                                                    toast.success(t('copied'));
                                                }}
                                            />
                                        </HStack>
                                    )}
                                </ChatMessage>
                            );
                        })}
                    </ChatMessageList>
                )}
            </ChatLayout>
        </div>
    );
}

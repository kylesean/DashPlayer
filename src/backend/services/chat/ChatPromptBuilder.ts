import type { ModelMessage } from 'ai';
import type { LocalChatMessage } from '@/backend/services/LocalAiService';
import { BUILTIN_LEARNING_PROMPT_PRESETS } from '@/backend/services/chat/LearningPromptPresets';
import type { SentenceMemoryHints } from '@/common/types/vo/SentenceVocabularyVO';

/**
 * 会话创建时冻结的字幕规模概览。
 */
export type SubtitleOverview = {
    /** 字幕行数。 */
    lineCount: number;
    /** 所有字幕文本的单词数（按空格分词统计）。 */
    wordCount: number;
    /** 字幕索引的最小值。 */
    minIndex: number;
    /** 字幕索引的最大值。 */
    maxIndex: number;
    /** 当前学习句的字幕索引。 */
    anchorIndex: number;
};

/**
 * 格式化通用 TTS 朗读与排版规范指令，供聊天系统提示词复用。
 */
const TTS_FORMAT_GUIDELINES = [
    '## 朗读与排版规范（重要）：',
    '- 遇到英文词汇、短语、句子或例句时，必须直接输出 [[tts:英文内容]] 以支持点击朗读。',
    '- 严禁用反引号（`）、引号或括号包裹 [[tts:...]]（错误示例：`[[tts:example]]`），也不要在标记外重复相同英文。',
    '- 标记内仅包含纯英文字符，不要夹带中文翻译，也不要使用 [] 或 | 等特殊符号。',
    '- 使用标准 Markdown 排版：标题 `#` 与文字之间保留一个空格（如 `### 物理画面`），列表与段落之间保持清晰换行。',
    '- 示例：[[tts:This is an example.]] 这是一个示例。',
].join('\n');

/**
 * 格式化字幕概览文本，统一输出结构。
 */
export const formatSubtitleOverview = (
    overview?: SubtitleOverview
): string | null => {
    if (!overview) {
        return null;
    }
    const currentPosition = overview.anchorIndex - overview.minIndex + 1;
    return [
        '字幕全局概览：',
        `- 全片字幕：共 ${overview.lineCount} 句（索引 ${overview.minIndex} ~ ${overview.maxIndex}，约 ${overview.wordCount} 词）`,
        `- 当前学习句：索引 ${overview.anchorIndex}（全片第 ${currentPosition} / ${overview.lineCount} 句）`,
    ].join('\n');
};

const SUBTITLE_TOOL_GUIDELINES = [
    '# 字幕上下文工具调用规范',
    '首轮消息已附带当前句及其前后紧邻台词上下文。绝大多数语言学习追问（词汇含义、物理意象/画面感、语法结构、固定搭配、语气感情、地道表达、通用英语知识）请直接基于当前句与已提供的临近上下文作答，禁止调用检索工具。',
    '仅当用户明确询问超出已提供临近台词范围的信息（如远距离剧情前因后果、人物关系回顾、某人此前/后续是否说过某话、某词在全片其他桥段的出现情况）时，才按需调用工具：',
    '1. 【定位线索】：使用 `search_subtitles` 搜索关键词（支持 `any`/`all` 匹配）；若只需看清命中处语境，直接把 `context` 设为若干行，无需再额外展开。',
    '2. 【展开上下文】：需要更长连续台词时，用命中索引 `index` 调用 `get_subtitle_context`（`before`/`after` 指定前后行数）；继续往后读时把返回的 `endIndex` 作为下一次的 `index`。',
    '3. 【综合回答】：结合检索到的台词上下文，给出准确、有依据的回答。',
].join('\n');

/**
 * 双层 System Prompt 拼装引擎：
 * - 第一层（教学人格层）：来自用户选中或自定义编辑的教学提示词；
 * - 第二层（应用协议层）：系统托管的 [[tts:...]] 点读格式与可选字幕工具调用规范，确保任何自定义提示词都不会破坏播放器交互能力。
 */
export const composeChatSystemPrompt = (
    personaPrompt?: string,
    options?: { enableSubtitleTools?: boolean },
): string => {
    const fallbackPersona = BUILTIN_LEARNING_PROMPT_PRESETS[0].systemPrompt;
    const persona = personaPrompt && personaPrompt.trim().length > 0
        ? personaPrompt.trim()
        : fallbackPersona;
    const sections = [
        persona,
        '',
        TTS_FORMAT_GUIDELINES,
    ];
    if (options?.enableSubtitleTools !== false) {
        sections.push('', SUBTITLE_TOOL_GUIDELINES);
    }
    return sections.join('\n');
};

/**
 * 构建整句学习统一首卡（SentenceStudyCardSchema）的上下文感知提示词。
 */
export const buildStudyCardPrompt = (params: {
    text: string;
    precedingLines?: string[];
    followingLines?: string[];
    paragraphLines?: string[];
    subtitleOverview?: SubtitleOverview;
    memoryHints?: SentenceMemoryHints;
    personaPrompt?: string;
}): string => {
    const formatLines = (lines?: string[]) => (lines && lines.length > 0
        ? lines.map((line, index) => `${index + 1}. ${line}`).join('\n')
        : '（无）');

    const overviewText = formatSubtitleOverview(params.subtitleOverview);
    const hasSplitContext = (params.precedingLines?.length ?? 0) > 0 || (params.followingLines?.length ?? 0) > 0;
    const focusWords = params.memoryHints?.focusWords ?? [];
    const masteredWords = params.memoryHints?.masteredWords ?? [];

    const parts: string[] = [
        '你在为一档沉浸式英语影视精读工作台生成“整句精读首卡”。',
        '所有中文讲解与译文必须使用自然流畅的简体中文，保留必要的英文词组与片段；只输出一个合法 JSON 对象，不要包含 markdown 代码块包裹或多余文字。',
        '',
        `当前字幕行：\n${params.text}`,
    ];

    if (hasSplitContext) {
        parts.push(
            '',
            `前文紧邻台词（时间升序）：\n${formatLines(params.precedingLines)}`,
            '',
            `后续紧邻台词（时间升序）：\n${formatLines(params.followingLines)}`,
        );
    } else if (params.paragraphLines && params.paragraphLines.length > 0) {
        parts.push('', `周边台词上下文：\n${formatLines(params.paragraphLines)}`);
    }

    if (overviewText) {
        parts.push('', overviewText);
    }

    if (focusWords.length > 0 || masteredWords.length > 0) {
        const memoryLines: string[] = ['', '# 学习者记忆信号（用于精准筛选 focalPoints）'];
        if (focusWords.length > 0) {
            memoryLines.push(`- 重点候选词（到期/在学/刚查过，若确属关键难点请优先拆解）：${focusWords.join(', ')}`);
        }
        if (masteredWords.length > 0) {
            memoryLines.push(`- 已熟练掌握词（除非在本句属于罕见“熟词僻义”，否则不要浪费 focalPoints 名额）：${masteredWords.join(', ')}`);
        }
        parts.push(...memoryLines);
    }

    if (params.personaPrompt && params.personaPrompt.trim().length > 0) {
        parts.push('', `# 当前导师风格参考\n${params.personaPrompt.trim().slice(0, 600)}`);
    }

    parts.push(
        '',
        '# 输出 JSON 契约（SentenceStudyCardSchema）',
        '1. `sentence`：',
        '   - `completeText`：结合前后台词把被字幕断行截断的当前句补全为完整英文句子；若当前行本就完整则保持原句，不擅自改写。',
        '   - `contextualTranslation`：贴合当下剧情情绪与口气的自然中文译文。',
        '   - `chunks`：2~5 个按自然停顿与意群切分的英文片段（按顺序覆盖完整句）。',
        '2. `focalPoints`（0~2 条；简单日常句可返回空数组 `[]`，宁缺毋滥）：',
        '   - 挑选句中最值得讲透的高价值词、动词短语、俚语或微妙语用表达。',
        '   - `expression`：句中出现的目标表达；`kind`：word / phrase / slang / nuance；`tag`：如“熟词僻义”“物理动词”“地道搭配”。',
        '   - `coreImage`（核心亮点）：用 1~2 句直观中文描绘它最底层的物理空间画面、身体动作或力学体感（不要背词典定义）。',
        '   - `meaningInContext`：点明母语者如何从上面的物理画面抽象投射到当前语境，并给出地道中文含义。',
        '3. `listeningLens`（0~2 条；语速清晰无连音陷阱可返回空数组 `[]`）：',
        '   - `span`：出现音变的连续英文词段；`phenomenon`：连读 / 弱读 / 失爆 / 语调重音；`tip`：1 句听音抓手。',
        '4. `sentenceLens`：',
        '   - `structureInsight`：1 句大白话点破这句话的语序重心或表达组织方式（禁用枯燥语法学术语）。',
        '   - `subtext`：1 句点出说话人此刻的潜台词、态度或情绪温度。',
    );

    return parts.join('\n');
};

/**
 * 构建整句学习的结构化分析提示词（兼容旧单参调用，内部转发至统一首卡提示词）。
 */
export const buildAnalysisPrompt = (text: string): string => buildStudyCardPrompt({ text });

/**
 * 把消息列表中的 system 角色消息拆分出来，供 AI SDK v7 的 streamText(system, messages) 使用。
 */
export const splitSystemMessages = (
    messages: ModelMessage[]
): { system?: string; messages: ModelMessage[] } => {
    const systemParts: string[] = [];
    const rest: ModelMessage[] = [];
    for (const message of messages) {
        if (message.role === 'system') {
            systemParts.push(message.content);
        } else {
            rest.push(message);
        }
    }
    return {
        system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
        messages: rest,
    };
};

/**
 * 确保消息流包含双层拼装后的角色人设与工具规范；若存在自定义人格覆盖，
 * 会重建首条 system 消息以确保动态切换人设立即生效。
 */
export const ensureChatRoleMessage = (
    messages: ModelMessage[],
    options?: { personaPrompt?: string; enableSubtitleTools?: boolean },
): ModelMessage[] => {
    const systemContent = composeChatSystemPrompt(options?.personaPrompt, options);
    const nonSystem = messages.filter((message) => message.role !== 'system');
    return [{ role: 'system', content: systemContent }, ...nonSystem];
};

/**
 * 为本地大模型（每 slot 上下文约 4096 token）裁剪多轮历史，
 * 保留 system 人设 + 首轮上下文摘要锚点 + 尽量多的最近对话轮次，防止触顶截断。
 */
export const toLocalChatMessagesWithWindow = (
    messages: ModelMessage[],
    maxHistoryChars = 6500,
): LocalChatMessage[] => {
    const { system, messages: turns } = splitSystemMessages(messages);
    const normalized: LocalChatMessage[] = turns
        .filter((msg): msg is ModelMessage & { role: 'user' | 'assistant' } => (
            msg.role === 'user' || msg.role === 'assistant'
        ))
        .map((msg) => ({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        }));

    if (normalized.length === 0) {
        return system ? [{ role: 'system', content: system }] : [];
    }

    // 保留最近完整尾部窗口
    const kept: LocalChatMessage[] = [];
    let usedChars = system ? system.length : 0;
    for (let i = normalized.length - 1; i >= 0; i -= 1) {
        const item = normalized[i];
        if (usedChars + item.content.length > maxHistoryChars && kept.length >= 2) {
            break;
        }
        kept.unshift(item);
        usedChars += item.content.length;
    }

    // 若窗口丢弃了最前面那条含【字幕参考材料】的用户消息，把锚点摘录补回第一条 user 顶部
    const firstTurn = normalized[0];
    if (kept[0] !== firstTurn && firstTurn.role === 'user' && firstTurn.content.startsWith(SUBTITLE_CONTEXT_PREFIX)) {
        const anchorSnippet = firstTurn.content.split('\n\n').slice(0, 2).join('\n\n').slice(0, 800);
        if (kept[0].role === 'user') {
            kept[0] = { role: 'user', content: `${anchorSnippet}\n\n${kept[0].content}` };
        } else {
            kept.unshift({ role: 'user', content: anchorSnippet });
        }
    }

    return system ? [{ role: 'system', content: system }, ...kept] : kept;
};

/** 字幕参考材料的固定前缀。 */
const SUBTITLE_CONTEXT_PREFIX = '【字幕参考材料】';

/**
 * 构建首轮对话的字幕参考材料。
 *
 * 说明：
 * - 只包含模型无法自行推导的客观上下文（当前学习句、全片规模、周边台词）；
 * - 不包含句子解析结果：解析内容已由句子卡片呈现，重复回灌既浪费上下文，也会与卡片产生两套说法。
 *
 * @param params 会话冻结的主题、周边字幕与字幕概览。
 * @returns 参考材料文本；没有可用内容时返回 null。
 */
export const buildSubtitleContext = (params: {
    /** 会话冻结的学习主题原文。 */
    originalTopic: string;
    /** 会话冻结的周边字幕。 */
    paragraphLines?: string[];
    /** 全片字幕规模概览。 */
    subtitleOverview?: SubtitleOverview;
}): string | null => {
    const parts: string[] = [];
    if (params.originalTopic.trim().length > 0) {
        parts.push(`当前学习句：${params.originalTopic}`);
    }

    const overviewText = formatSubtitleOverview(params.subtitleOverview);
    if (overviewText) {
        parts.push(overviewText);
    }

    const paragraphLines = params.paragraphLines ?? [];
    if (paragraphLines.length > 0) {
        parts.push([
            '原始段落上下文（当前句及前后台词）：',
            paragraphLines.map((line, index) => `${index + 1}. ${line}`).join('\n'),
        ].join('\n'));
    }

    if (parts.length === 0) {
        return null;
    }
    return [SUBTITLE_CONTEXT_PREFIX, '', parts.join('\n\n')].join('\n');
};

/**
 * 构建字幕完整句判定与补全的提示词。
 *
 * 说明：
 * - 字幕按换行/时间轴切分后，一行常只有半个句子；同时给前文与后续行，
 *   让模型返回当前行所在的完整句子（真实句首到真实句尾）；
 * - 译文随这一次调用一并产出：学习页要把中文摆在句子下方，单独再走一遍字幕
 *   翻译链路要重建上下文与缓存，代价远高于在同一次结构化输出里多要一个字段。
 *
 * @param params 当前字幕行及其前后紧邻字幕行。
 * @returns 交给 generateObject 的单条提示词。
 */
export const buildCompleteSentencePrompt = (params: {
    /** 当前字幕行原文。 */
    text: string;
    /** 当前行之前紧邻的字幕行（时间升序，最近一行在最后）。 */
    precedingLines: string[];
    /** 当前行之后紧邻的字幕行（时间升序）。 */
    followingLines: string[];
}): string => {
    const formatLines = (lines: string[]) => (lines.length > 0
        ? lines.map((line, index) => `${index + 1}. ${line}`).join('\n')
        : '（无）');
    return [
        '你在处理影视字幕。字幕经常被换行或时间轴切断，一行可能只有半个句子。',
        '请判断「当前字幕行」是否已是一个完整句子的全部；如果不是，结合前后紧邻字幕行，把当前行所在的句子补全。',
        '',
        '当前字幕行：',
        params.text,
        '',
        '前文行（按时间顺序，最近一行在最后）：',
        formatLines(params.precedingLines),
        '',
        '后续行（按时间顺序）：',
        formatLines(params.followingLines),
        '',
        '# 输出要求',
        // DeepSeek 等接口在使用 json_object 响应格式时强制要求提示词里出现 "json" 字样，缺失会直接报错。
        '- 只输出一个 JSON 对象，包含 complete、sentence 与 translation 三个字段，不要输出任何其他文字。',
        '- complete：当前字幕行本身是否已完整（句首与句尾都在当前行内）。',
        '- sentence：当前行所在的完整句子原文，从真实句首到真实句尾。',
        '- 当前行只是句子后半时，sentence 必须带上前文里的前半句；当前行开头已是句首时，sentence 从当前行开始。',
        '- 已完整时 sentence 与当前字幕行保持一致，不要改写或润色。',
        '- sentence 内不要包裹引号、代码块或任何说明文字，语言与原字幕保持一致。',
        '- translation：sentence 的中文译文，只输出译文本身，不要加引号或说明。',
        '- sentence 本身已是中文时，translation 与 sentence 保持一致。',
    ].join('\n');
};

import React from 'react';

export const TTS_PROTOCOL = 'tts:';
export const SWITCH_PROTOCOL = 'switch:';

const UNICODE_PUNCT_RE = /[\p{P}\p{S}]/u;

/**
 * 转义 Markdown 链接标签中的方括号与圆括号，防止英文片段内容破坏 `[label](href)` 语法。
 */
const escapeMarkdownLinkLabel = (value: string): string => value.replace(/[[\]()\\]/g, (ch) => `\\${ch}`);

/**
 * 安全解码自定义协议链接的目标文本。
 */
export const safeDecodeMarkerUrl = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

/**
 * 递归提取 React 节点中的纯文本内容，用于恢复自定义链接标签文案。
 */
export const extractMarkdownNodeText = (node: React.ReactNode): string => {
    if (typeof node === 'string' || typeof node === 'number') {
        return String(node);
    }
    if (Array.isArray(node)) {
        return node.map((item) => extractMarkdownNodeText(item)).join('');
    }
    if (React.isValidElement(node)) {
        const props = node.props as { children?: React.ReactNode } | undefined;
        return props?.children ? extractMarkdownNodeText(props.children) : '';
    }
    return '';
};

/**
 * 将 `[[tts:...]]` / `[[switch:...]]` 以及未编码 `[label](tts:...)` 转换为标准链接格式，
 * 避免 Astryx `<Markdown>` 在流式阶段把 `[` 当成未闭合链接裁剪掉，并支持嵌套在加粗/列表/标题中。
 */
const convertCustomMarkersToLinks = (segment: string, isStreaming: boolean): string => {
    // 1. 本地小模型常把示例中的反引号一起抄写出来（例如 `[[tts:word]]`），先剥掉外层反引号。
    let normalized = segment
        .replace(/`(\[\[(?:tts|switch):[^`\n]+?\]\])`/g, '$1')
        .replace(/`(\[[^\n`\][]+\]\((?:tts|switch):[^`\n)]+\))`/g, '$1');

    // 2. 流式输出尾部若出现尚未闭合的 `[[tts:` 或 `[[switch:`，暂隐藏尾部残片以免闪烁原始语法。
    if (isStreaming) {
        const openIdx = Math.max(
            normalized.lastIndexOf('[[tts:'),
            normalized.lastIndexOf('[[switch:'),
        );
        if (openIdx >= 0 && normalized.indexOf(']]', openIdx) < 0) {
            normalized = normalized.slice(0, openIdx);
        }
    }

    // 3. 解析完整 `[[tts:...]]` 与 `[[switch:...]]` 标记。
    const markerStart = /\[\[(tts|switch):/g;
    let output = '';
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = markerStart.exec(normalized)) !== null) {
        output += normalized.slice(cursor, match.index);
        const end = normalized.indexOf(']]', markerStart.lastIndex);
        if (end < 0) {
            output += normalized.slice(match.index);
            cursor = normalized.length;
            break;
        }

        const kind = match[1];
        const rawInner = normalized.slice(markerStart.lastIndex, end);
        const trimmed = rawInner.trim();
        if (!trimmed) {
            cursor = end + 2;
            markerStart.lastIndex = cursor;
            continue;
        }

        if (kind === 'tts') {
            output += `[${escapeMarkdownLinkLabel(trimmed)}](${TTS_PROTOCOL}${encodeURIComponent(trimmed)})`;
        } else {
            const sep = rawInner.indexOf('|');
            const target = (sep < 0 ? rawInner : rawInner.slice(0, sep)).trim();
            const label = (sep < 0 ? '' : rawInner.slice(sep + 1)).trim() || target;
            if (!target) {
                output += normalized.slice(match.index, end + 2);
            } else {
                output += `[${escapeMarkdownLinkLabel(label)}](${SWITCH_PROTOCOL}${encodeURIComponent(target)})`;
            }
        }

        cursor = end + 2;
        markerStart.lastIndex = cursor;
    }
    if (cursor < normalized.length) {
        output += normalized.slice(cursor);
    }

    // 4. 规范直出 `[text](tts:raw text)` 中的空格/标点，保证 CommonMark 链接解析成功。
    return output.replace(/\[([^\][]+)\]\(((?:tts|switch):[\s\S]*?)\)/g, (full, rawLabel: string, rawHref: string) => {
        const sep = rawHref.indexOf(':');
        if (sep < 0) {
            return full;
        }
        const protocol = rawHref.slice(0, sep + 1);
        const target = rawHref.slice(sep + 1).trim();
        if (!target) {
            return full;
        }
        return `[${rawLabel}](${protocol}${encodeURIComponent(safeDecodeMarkerUrl(target))})`;
    });
};

/**
 * 修复 CommonMark 0.31 严格侧翼规则在中文混排场景下的 `**...**` 失效问题：
 * 例如 `在**「核心」**中`、`**【物理画面】**：` 或 `** 重点词 **`。
 * 在紧邻首尾标点处注入零宽字符 `\u200B`（无视觉宽度且既非空白也非标点），使解析器正确识别加粗边界。
 */
const normalizeCjkBoldAndHeadings = (segment: string): string => {
    // 标题 `#` 与正文之间缺空格（本地小模型常见：`###物理画面`）
    let out = segment.replace(/^( {0,3}#{1,6})([^\s#\n])/gm, '$1 $2');

    // 先保护行内反引号代码，避免改动代码片段内部的 `**`
    const inlineCodes: string[] = [];
    out = out.replace(/`[^`\n]+`/g, (code) => {
        const token = `\uE000CODE${inlineCodes.length}\uE000`;
        inlineCodes.push(code);
        return token;
    });

    out = out.replace(/(?<!\*)\*\*(?!\*)([^\n]+?)(?<!\*)\*\*(?!\*)/g, (full, inner: string) => {
        const trimmed = inner.trim();
        if (!trimmed) {
            return full;
        }
        const firstChar = Array.from(trimmed)[0] ?? '';
        const chars = Array.from(trimmed);
        const lastChar = chars[chars.length - 1] ?? '';

        const needsOpenZeroWidth = firstChar !== '' && UNICODE_PUNCT_RE.test(firstChar);
        const needsCloseZeroWidth = lastChar !== '' && UNICODE_PUNCT_RE.test(lastChar);
        if (!needsOpenZeroWidth && !needsCloseZeroWidth && trimmed === inner) {
            return full;
        }
        return `**${needsOpenZeroWidth ? '\u200B' : ''}${trimmed}${needsCloseZeroWidth ? '\u200B' : ''}**`;
    });

    return out.replace(/\uE000CODE(\d+)\uE000/g, (_m, idx) => inlineCodes[Number(idx)] ?? '');
};

/**
 * 在交给 Astryx `<Markdown>` 渲染前规范化 AI 回答文本，同时修复流式边界、
 * `[[tts:...]]` 标记及中文标点相邻 `**加粗**` 失效问题。
 */
export const preprocessStudyMarkdown = (raw: string, isStreaming = false): string => {
    if (!raw) {
        return raw;
    }

    // 分离围栏代码块，仅处理普通 Markdown 文本段落。
    const parts = raw.split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/g);
    return parts.map((part, index) => {
        if (index % 2 === 1) {
            return part;
        }
        const withLinks = convertCustomMarkersToLinks(part, isStreaming);
        return normalizeCjkBoldAndHeadings(withLinks);
    }).join('');
};

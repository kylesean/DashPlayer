import type { DeepPartial } from '@/common/types/analysis';
import type { FocalPoint } from '@/common/types/aiRes/AiUnifiedAnalysisRes';

export interface SentenceSegment {
    text: string;
    clickable: boolean;
    lookupKey?: string;
    expression?: string;
    focalPoint?: DeepPartial<FocalPoint>;
}

const WORD_CHAR_RE = /[A-Za-z0-9']/;
const WORD_TOKEN_RE = /[A-Za-z]+(?:'[A-Za-z]+)*/g;
const TTS_PROTOCOL_RE = /\[\[tts:([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
const SWITCH_PROTOCOL_RE = /\[\[switch:[^\]]+\]\]/g;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildBoundaryPattern = (expression: string): RegExp => {
    const trimmed = expression.trim();
    const escaped = escapeRegex(trimmed).replace(/\s+/g, '\\s+');
    const startsWithWord = WORD_CHAR_RE.test(trimmed[0] ?? '');
    const endsWithWord = WORD_CHAR_RE.test(trimmed[trimmed.length - 1] ?? '');
    const prefix = startsWithWord ? "(?<![A-Za-z0-9'])" : '';
    const suffix = endsWithWord ? "(?![A-Za-z0-9'])" : '';
    return new RegExp(`${prefix}${escaped}${suffix}`, 'gi');
};

interface MatchedSpan {
    start: number;
    end: number;
    focalPoint: DeepPartial<FocalPoint>;
}

const findFocalSpans = (sentence: string, focalPoints: DeepPartial<FocalPoint>[]): MatchedSpan[] => {
    const candidates = focalPoints
        .filter((fp): fp is DeepPartial<FocalPoint> & { expression: string } => Boolean(fp?.expression?.trim()))
        .slice()
        .sort((a, b) => b.expression.trim().length - a.expression.trim().length);

    const occupied: MatchedSpan[] = [];

    for (const fp of candidates) {
        const pattern = buildBoundaryPattern(fp.expression);
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(sentence)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            const overlaps = occupied.some((span) => start < span.end && end > span.start);
            if (!overlaps && match[0].length > 0) {
                occupied.push({ start, end, focalPoint: fp });
                break;
            }
        }
    }

    return occupied.sort((a, b) => a.start - b.start);
};

const tokenizePlainSlice = (slice: string): SentenceSegment[] => {
    if (!slice) return [];
    const segments: SentenceSegment[] = [];
    let lastIndex = 0;
    WORD_TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = WORD_TOKEN_RE.exec(slice)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ text: slice.slice(lastIndex, match.index), clickable: false });
        }
        const word = match[0];
        segments.push({
            text: word,
            clickable: true,
            lookupKey: word.toLowerCase(),
            expression: word,
        });
        lastIndex = match.index + word.length;
    }

    if (lastIndex < slice.length) {
        segments.push({ text: slice.slice(lastIndex), clickable: false });
    }

    return segments;
};

/**
 * Splits a sentence into inline segments, prioritizing multi-word AI focal expressions
 * before falling back to individually clickable English words.
 */
export const tokenizeSentenceWithHighlights = (
    sentence: string,
    focalPoints: DeepPartial<FocalPoint>[] = []
): SentenceSegment[] => {
    if (!sentence) return [];
    const spans = findFocalSpans(sentence, focalPoints);
    if (spans.length === 0) {
        return tokenizePlainSlice(sentence);
    }

    const segments: SentenceSegment[] = [];
    let cursor = 0;

    for (const span of spans) {
        if (span.start > cursor) {
            segments.push(...tokenizePlainSlice(sentence.slice(cursor, span.start)));
        }
        const matchedText = sentence.slice(span.start, span.end);
        const expression = span.focalPoint.expression?.trim() || matchedText;
        segments.push({
            text: matchedText,
            clickable: true,
            lookupKey: expression.toLowerCase(),
            expression,
            focalPoint: span.focalPoint,
        });
        cursor = span.end;
    }

    if (cursor < sentence.length) {
        segments.push(...tokenizePlainSlice(sentence.slice(cursor)));
    }

    return segments;
};

/**
 * Strips interactive TTS/switch protocols and Markdown syntax from an AI reply
 * so saving a reply as a sentence takeaway stays concise and scannable.
 */
export const extractCleanTakeaway = (rawMarkdown: string, maxLength = 220): string => {
    const cleaned = rawMarkdown
        .replace(TTS_PROTOCOL_RE, (_m, phrase: string, display?: string) => (display ?? phrase).trim())
        .replace(SWITCH_PROTOCOL_RE, '')
        .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?|```/g, '').trim())
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
        .replace(/^[ \t]*>[ \t]?/gm, '')
        .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gm, '')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/\r?\n+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (!cleaned || cleaned.length <= maxLength) {
        return cleaned;
    }

    return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
};

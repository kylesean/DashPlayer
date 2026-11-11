import {
    CONTENT_COMPASS_ACTIONS,
    CONTENT_COMPASS_REASONS,
} from '@/common/types/contentCompass';
import type {
    LearningDataEncounterVO,
    LearningDataProductionPracticeVO,
    LearningDataRecommendationVO,
    LearningDataRestoreSnapshot,
    LearningDataReviewCardVO,
    LearningDataSentencePracticeVO,
    LearningDataWordVO,
} from '@/common/types/learningData';
import type { ProductionPracticeMode, RetellLevel } from '@/common/types/learningRecap';
import { REVIEW_CARD_STATES, REVIEW_RATINGS } from '@/common/types/review';
import {
    WORD_ENCOUNTER_ACTIONS,
    WORD_SOURCES,
    WORD_STATUSES,
} from '@/common/types/vocabulary';

/** 导入支持的最高 schema 版本。 */
export const LEARNING_DATA_SCHEMA_VERSION = 2;

/** 产出型练习模式。 */
const PRODUCTION_PRACTICE_MODES: readonly ProductionPracticeMode[] = ['retell', 'roleplay'];
/** 复述 / 角色扮演等级。 */
const RETELL_LEVELS: readonly RetellLevel[] = ['great', 'good', 'retry'];

/**
 * 备份文件结构校验失败。
 *
 * 单独的类型便于控制器把「文件选错了」与「磁盘读失败」区分开，
 * 前端也能给出可操作的提示，而不是一段 JSON 解析栈。
 */
export class LearningDataSnapshotError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LearningDataSnapshotError';
    }
}

const fail = (path: string, expected: string): never => {
    throw new LearningDataSnapshotError(`备份文件字段 ${path} 无效：期望 ${expected}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown, path: string): Record<string, unknown> => {
    if (!isRecord(value)) {
        return fail(path, '对象');
    }
    return value;
};

const array = (value: unknown, path: string): unknown[] => {
    if (!Array.isArray(value)) {
        return fail(path, '数组');
    }
    return value;
};

const str = (value: unknown, path: string): string => {
    if (typeof value !== 'string') {
        return fail(path, '字符串');
    }
    return value;
};

const nullableStr = (value: unknown, path: string): string | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return str(value, path);
};

const num = (value: unknown, path: string): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail(path, '有限数字');
    }
    return value;
};

const nullableNum = (value: unknown, path: string): number | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return num(value, path);
};

const int = (value: unknown, path: string): number => {
    const parsed = num(value, path);
    if (!Number.isInteger(parsed)) {
        return fail(path, '整数');
    }
    return parsed;
};

const nullableInt = (value: unknown, path: string): number | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return int(value, path);
};

const bool = (value: unknown, path: string, fallback: boolean): boolean => {
    if (value === undefined || value === null) {
        return fallback;
    }
    if (typeof value !== 'boolean') {
        return fail(path, '布尔值');
    }
    return value;
};

const oneOf = <T extends string>(
    value: unknown,
    allowed: readonly T[],
    path: string,
): T => {
    const parsed = str(value, path);
    if (!(allowed as readonly string[]).includes(parsed)) {
        return fail(path, allowed.join(' / '));
    }
    return parsed as T;
};

const nullableOneOf = <T extends string>(
    value: unknown,
    allowed: readonly T[],
    path: string,
): T | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return oneOf(value, allowed, path);
};

/** 校验可被 Date 解析的时间字符串；备份里的 "haha" 会让排序与调度计算全面失真。 */
const dateStr = (value: unknown, path: string): string => {
    const parsed = str(value, path);
    if (Number.isNaN(Date.parse(parsed))) {
        return fail(path, '可解析的 ISO 日期字符串');
    }
    return parsed;
};

const nullableDateStr = (value: unknown, path: string): string | null => {
    if (value === null || value === undefined) {
        return null;
    }
    return dateStr(value, path);
};

/** 把数值钳进 [min, max]；派生的调度字段截断比拒绝整份备份更友好。 */
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * 校验并归一化一条词条。
 *
 * 导出里的 `mastery` / `confidence` 可能来自旧版本，越界值按 0–1 截断而不是
 * 直接拒绝：这两个字段是派生量，截断不会伪造用户没做过的学习动作。
 */
const parseWord = (value: unknown, path: string): LearningDataWordVO => {
    const raw = record(value, path);
    const word = str(raw.word, `${path}.word`).trim();
    if (word.length === 0) {
        return fail(`${path}.word`, '非空字符串');
    }
    const source = oneOf(raw.source, WORD_SOURCES, `${path}.source`);
    return {
        word,
        translate: nullableStr(raw.translate, `${path}.translate`),
        status: oneOf(raw.status, WORD_STATUSES, `${path}.status`),
        // 恢复的是用户数据：'default' 是产品内置词标记，带着它入库的词会被
        // listUserWords / 导出 / 会话摘要全部排除，成为恢复成功却永远不可见、
        // 下次导出静默丢失的幽灵词。统一重映射为 manual。
        source: source === 'default' ? 'manual' : source,
        mastery: clamp01(num(raw.mastery ?? 0, `${path}.mastery`)),
        confidence: clamp01(num(raw.confidence ?? 0, `${path}.confidence`)),
        lastSeenAt: nullableDateStr(raw.lastSeenAt, `${path}.lastSeenAt`),
        masteredAt: nullableDateStr(raw.masteredAt, `${path}.masteredAt`),
        createdAt: dateStr(raw.createdAt, `${path}.createdAt`),
        updatedAt: dateStr(raw.updatedAt, `${path}.updatedAt`),
    };
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const parseEncounter = (value: unknown, path: string): LearningDataEncounterVO => {
    const raw = record(value, path);
    return {
        id: 0,
        word: str(raw.word, `${path}.word`),
        lemma: str(raw.lemma, `${path}.lemma`).toLowerCase(),
        action: oneOf(raw.action, WORD_ENCOUNTER_ACTIONS, `${path}.action`),
        videoId: nullableStr(raw.videoId, `${path}.videoId`),
        fileHash: nullableStr(raw.fileHash, `${path}.fileHash`),
        sentenceIndex: nullableInt(raw.sentenceIndex, `${path}.sentenceIndex`),
        sentenceHash: nullableStr(raw.sentenceHash, `${path}.sentenceHash`),
        context: nullableStr(raw.context, `${path}.context`),
        score: nullableNum(raw.score, `${path}.score`),
        rating: nullableOneOf(raw.rating, REVIEW_RATINGS, `${path}.rating`),
        createdAt: dateStr(raw.createdAt, `${path}.createdAt`),
    };
};

const parseReviewCard = (value: unknown, path: string): LearningDataReviewCardVO => {
    const raw = record(value, path);
    // 调度字段是派生量，畸形值（如 stability: 1e308）会在复习调度里
    // new Date(now + stability*DAY_MS) 处抛 RangeError，让这张卡永远无法评分。
    // 与 mastery/confidence 同口径截断，不拒绝整份备份。
    const reps = clamp(int(raw.reps ?? 0, `${path}.reps`), 0, 1_000_000);
    const lapses = clamp(int(raw.lapses ?? 0, `${path}.lapses`), 0, 1_000_000);
    const stability = clamp(num(raw.stability ?? 0, `${path}.stability`), 0, 36_500);
    const difficulty = clamp(num(raw.difficulty ?? 0, `${path}.difficulty`), 0, 10);
    return {
        word: str(raw.word, `${path}.word`).toLowerCase(),
        dueAt: dateStr(raw.dueAt, `${path}.dueAt`),
        state: oneOf(raw.state, REVIEW_CARD_STATES, `${path}.state`),
        reps,
        lapses,
        stability,
        difficulty,
        lastReviewAt: nullableDateStr(raw.lastReviewAt, `${path}.lastReviewAt`),
        lastRating: nullableOneOf(raw.lastRating, REVIEW_RATINGS, `${path}.lastRating`),
        createdAt: dateStr(raw.createdAt, `${path}.createdAt`),
        updatedAt: dateStr(raw.updatedAt, `${path}.updatedAt`),
    };
};

const parseRecommendation = (value: unknown, path: string): LearningDataRecommendationVO => {
    const raw = record(value, path);
    return {
        id: 0,
        videoId: str(raw.videoId, `${path}.videoId`),
        action: oneOf(raw.action, CONTENT_COMPASS_ACTIONS, `${path}.action`),
        surface: str(raw.surface ?? 'home', `${path}.surface`),
        score: num(raw.score ?? 0, `${path}.score`),
        reasonCode: nullableOneOf(raw.reasonCode, CONTENT_COMPASS_REASONS, `${path}.reasonCode`),
        createdAt: dateStr(raw.createdAt, `${path}.createdAt`),
    };
};

const parseSentencePractice = (value: unknown, path: string): LearningDataSentencePracticeVO => {
    const raw = record(value, path);
    return {
        fileHash: str(raw.fileHash, `${path}.fileHash`),
        sentenceIndex: int(raw.sentenceIndex, `${path}.sentenceIndex`),
        resegmented: bool(raw.resegmented, `${path}.resegmented`, true),
        mode: str(raw.mode, `${path}.mode`),
        score: num(raw.score, `${path}.score`),
        transcript: nullableStr(raw.transcript, `${path}.transcript`),
        audioFile: nullableStr(raw.audioFile, `${path}.audioFile`),
        detailJson: nullableStr(raw.detailJson, `${path}.detailJson`),
        createdAt: dateStr(raw.createdAt, `${path}.createdAt`),
    };
};

const parseProductionPractice = (value: unknown, path: string): LearningDataProductionPracticeVO => {
    const raw = record(value, path);
    return {
        mode: oneOf(raw.mode, PRODUCTION_PRACTICE_MODES, `${path}.mode`),
        videoId: nullableStr(raw.videoId, `${path}.videoId`),
        fileHash: nullableStr(raw.fileHash, `${path}.fileHash`),
        sentenceIndex: nullableInt(raw.sentenceIndex, `${path}.sentenceIndex`),
        sentenceText: str(raw.sentenceText, `${path}.sentenceText`),
        responseText: str(raw.responseText, `${path}.responseText`),
        level: oneOf(raw.level, RETELL_LEVELS, `${path}.level`),
        feedback: nullableStr(raw.feedback, `${path}.feedback`),
        improved: nullableStr(raw.improved, `${path}.improved`),
        detailJson: nullableStr(raw.detailJson, `${path}.detailJson`),
        createdAt: dateStr(raw.createdAt, `${path}.createdAt`),
    };
};

/**
 * 解析并校验一份学习数据备份。
 *
 * 兼容 schemaVersion 1：旧备份没有练习记录，按空数组处理。更高版本直接拒绝，
 * 避免用旧代码写入它并不理解的字段。
 *
 * @param value 已 JSON.parse 的未知值。
 * @returns 可直接写库的快照。
 */
export function parseLearningDataExport(value: unknown): LearningDataRestoreSnapshot {
    const root = record(value, '$');
    const version = int(root.schemaVersion, '$.schemaVersion');
    if (version > LEARNING_DATA_SCHEMA_VERSION) {
        throw new LearningDataSnapshotError(
            `备份版本 ${version} 高于当前支持的 ${LEARNING_DATA_SCHEMA_VERSION}`,
        );
    }
    if (version < 1) {
        return fail('$.schemaVersion', '>= 1');
    }

    const words = array(root.words, '$.words').map((item, index) => parseWord(item, `$.words[${index}]`));
    const seenWords = new Set<string>();
    for (const word of words) {
        const key = word.word.toLowerCase();
        if (seenWords.has(key)) {
            throw new LearningDataSnapshotError(`备份文件包含重复词条：${word.word}`);
        }
        seenWords.add(key);
    }

    const reviewCards = array(root.reviewCards ?? [], '$.reviewCards')
        .map((item, index) => parseReviewCard(item, `$.reviewCards[${index}]`));
    const seenCards = new Set<string>();
    for (const card of reviewCards) {
        if (seenCards.has(card.word)) {
            throw new LearningDataSnapshotError(`备份文件包含重复复习卡：${card.word}`);
        }
        seenCards.add(card.word);
    }

    return {
        words,
        encounters: array(root.encounters ?? [], '$.encounters')
            .map((item, index) => parseEncounter(item, `$.encounters[${index}]`)),
        reviewCards,
        recommendations: array(root.recommendations ?? [], '$.recommendations')
            .map((item, index) => parseRecommendation(item, `$.recommendations[${index}]`)),
        sentencePractices: version >= 2
            ? array(root.sentencePractices ?? [], '$.sentencePractices')
                .map((item, index) => parseSentencePractice(item, `$.sentencePractices[${index}]`))
            : [],
        productionPractices: version >= 2
            ? array(root.productionPractices ?? [], '$.productionPractices')
                .map((item, index) => parseProductionPractice(item, `$.productionPractices[${index}]`))
            : [],
    };
}

import { describe, expect, it } from 'vitest';

import {
    COACH_MOMENT_CADENCE,
    INTENSIVE_MOMENT_CADENCE,
    LEARNING_MOMENT_GLOBAL_COOLDOWN_MS,
    LEARNING_MOMENT_SESSION_LIMIT,
    evaluateLearningMoment,
    pickDueWordForMoment,
    resolveMomentCadence,
    type LearningMomentCandidate,
    type LearningMomentMemory,
} from '@/common/learning/learningMoment';

const NOW = Date.parse('2026-11-12T12:00:00.000Z');

const candidate = (
    override: Partial<LearningMomentCandidate> = {},
): LearningMomentCandidate => ({
    word: 'journey',
    surface: 'journey',
    phonetic: '/ˈdʒɜːni/',
    meaning: '旅程',
    status: 'learning',
    mastery: 0.3,
    dueAt: '2026-11-11T12:00:00.000Z',
    score: 0.72,
    ...override,
});

const memory = (
    override: Partial<LearningMomentMemory> = {},
): LearningMomentMemory => ({
    at: NOW - 60_000,
    sentenceHash: 'subtitle-1:2',
    sessionKey: 'session-1',
    count: 1,
    ...override,
});

const evaluate = (
    override: Partial<Parameters<typeof evaluateLearningMoment>[0]> = {},
) => evaluateLearningMoment({
    paused: true,
    dwellMs: 6_000,
    now: NOW,
    sentenceHash: 'subtitle-1:2',
    sessionKey: 'session-1',
    candidate: candidate(),
    memory: null,
    ...override,
});

describe('learning moment', () => {
    it('只在暂停停留足够久后出现', () => {
        expect(evaluate({ paused: false }).reason).toBe('not_paused');
        expect(evaluate({ dwellMs: 4_999 }).reason).toBe('dwell');
        expect(evaluate().shouldPrompt).toBe(true);
        expect(evaluate().reason).toBe('due_word');
    });

    it('没有到期词、尚未到期或已掌握时不打断', () => {
        expect(evaluate({ candidate: null }).reason).toBe('no_due_word');
        expect(evaluate({
            candidate: candidate({ dueAt: '2026-11-13T12:00:00.000Z' }),
        }).reason).toBe('not_due');
        expect(evaluate({
            candidate: candidate({ mastery: 0.6 }),
        }).reason).toBe('mastered');
    });

    it('全局冷却与同句冷却分别生效', () => {
        expect(evaluate({ memory: memory({ at: NOW - 60_000 }) }).reason)
            .toBe('sentence_cooldown');
        expect(evaluate({
            memory: memory({
                at: NOW - 60_000,
                sentenceHash: 'another-sentence',
            }),
        }).reason).toBe('global_cooldown');
        expect(evaluate({
            memory: memory({ at: NOW - LEARNING_MOMENT_GLOBAL_COOLDOWN_MS }),
        }).shouldPrompt).toBe(true);
    });

    it('单次播放会话最多出现三次，跨会话后只保留全局冷却', () => {
        expect(evaluate({
            memory: memory({
                at: NOW - 10 * 60_000,
                count: LEARNING_MOMENT_SESSION_LIMIT,
            }),
        }).reason).toBe('session_limit');
        expect(evaluate({
            memory: memory({
                at: NOW - 10 * 60_000,
                sessionKey: 'another-session',
                count: LEARNING_MOMENT_SESSION_LIMIT,
            }),
        }).shouldPrompt).toBe(true);
    });

    it('从候选中选最早到期且仍在学习中的词', () => {
        const picked = pickDueWordForMoment([
            {
                word: 'later',
                surface: 'later',
                phonetic: '',
                meaning: '稍后',
                status: 'learning',
                mastery: 0.2,
                dueAt: '2026-11-12T11:00:00.000Z',
                score: 0.9,
            },
            {
                word: 'journey',
                surface: 'journey',
                phonetic: '',
                meaning: '旅程',
                status: 'learning',
                mastery: 0.3,
                dueAt: '2026-11-11T11:00:00.000Z',
                score: 0.6,
            },
            {
                word: 'known',
                surface: 'known',
                phonetic: '',
                meaning: '已知',
                status: 'known',
                mastery: 0.9,
                dueAt: '2026-11-10T11:00:00.000Z',
                score: 1,
            },
        ], NOW);

        expect(picked?.word).toBe('journey');
    });

    it('off 与 calm 没有节奏，coach 与 intensive 各有一套', () => {
        expect(resolveMomentCadence('off')).toBeNull();
        expect(resolveMomentCadence('calm')).toBeNull();
        expect(resolveMomentCadence('coach')).toBe(COACH_MOMENT_CADENCE);
        expect(resolveMomentCadence('intensive')).toBe(INTENSIVE_MOMENT_CADENCE);
    });

    it('强化档更短停留就能出现，而教练档此时仍在等待', () => {
        expect(evaluate({ dwellMs: 2_500 }).reason).toBe('dwell');
        expect(evaluate({
            dwellMs: 2_500,
            cadence: INTENSIVE_MOMENT_CADENCE,
        }).shouldPrompt).toBe(true);
    });

    it('强化档允许更密集的冷却与会话上限，但掌握度门槛不变', () => {
        // 教练档 2 分钟仍被同句冷却拦住；强化档全局冷却只有 90 秒，已放行。
        expect(evaluate({ memory: memory({ at: NOW - 2 * 60_000 }) }).reason)
            .toBe('sentence_cooldown');
        expect(evaluate({
            memory: memory({ at: NOW - 2 * 60_000 }),
            cadence: INTENSIVE_MOMENT_CADENCE,
        }).shouldPrompt).toBe(true);
        // 强化档的 90 秒全局冷却仍然生效。
        expect(evaluate({
            memory: memory({ at: NOW - 60_000, sentenceHash: 'another-sentence' }),
            cadence: INTENSIVE_MOMENT_CADENCE,
        }).reason).toBe('global_cooldown');
        // 单次会话上限从 3 提到 8。
        expect(evaluate({
            memory: memory({ at: NOW - 20 * 60_000, sentenceHash: 'another-sentence', count: 5 }),
            cadence: INTENSIVE_MOMENT_CADENCE,
        }).shouldPrompt).toBe(true);
        expect(evaluate({
            memory: memory({ at: NOW - 20 * 60_000, sentenceHash: 'another-sentence', count: 8 }),
            cadence: INTENSIVE_MOMENT_CADENCE,
        }).reason).toBe('session_limit');
        // 掌握度足够高的词在任何档位都不再打断。
        expect(evaluate({
            candidate: candidate({ mastery: 0.6 }),
            cadence: INTENSIVE_MOMENT_CADENCE,
        }).reason).toBe('mastered');
    });

    it('强化档下按传入的掌握度上限筛选候选词', () => {
        const pool = [{
            word: 'journey',
            surface: 'journey',
            phonetic: '',
            meaning: '旅程',
            status: 'learning' as const,
            mastery: 0.5,
            dueAt: '2026-11-11T11:00:00.000Z',
            score: 0.6,
        }];
        expect(pickDueWordForMoment(pool, NOW)?.word).toBe('journey');
        expect(pickDueWordForMoment(pool, NOW, 0.4)).toBeNull();
    });
});

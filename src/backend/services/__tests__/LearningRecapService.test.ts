import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-learning-recap-test-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

vi.mock('ai', async (importOriginal) => {
    const actual = await importOriginal<typeof import('ai')>();
    return {
        ...actual,
        generateObject: vi.fn(),
    };
});

import { generateObject, type LanguageModel } from 'ai';
import type AiProviderService from '@/backend/services/AiProviderService';
import { CacheServiceImpl } from '@/backend/services/CacheService';
import type LearningDataService from '@/backend/services/LearningDataService';
import {
    buildLearningRecapPrompt,
    buildRetellPrompt,
    buildRolePlayFeedbackPrompt,
    LearningRecapServiceImpl,
} from '@/backend/services/LearningRecapService';
import type LocalAiService from '@/backend/services/LocalAiService';
import type LearningDataRepository from '@/backend/services/repositories/LearningDataRepository';
import type ProductionPracticeRecordRepository from '@/backend/services/repositories/ProductionPracticeRecordRepository';
import type RolePlayTurnRepository from '@/backend/services/repositories/RolePlayTurnRepository';
import type SentencePracticeService from '@/backend/services/SentencePracticeService';
import type WordEncounterService from '@/backend/services/WordEncounterService';
import type { WordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import type { LearningSessionSummaryVO } from '@/common/types/learningSession';

const LOCAL_MODEL_ID = 'qwen3.5-2b-q4_k_m';
const CLOUD_MODEL = { modelId: 'gpt-test' } as unknown as LanguageModel;
const SINCE = '2026-01-01T10:00:00.000Z';
/** 多轮场景对话的会话键。 */
const MULTI_TURN_SESSION = 'session-multi-turn';

const summary: LearningSessionSummaryVO = {
    since: SINCE,
    counts: { encountered: 3, mastered: 1, due: 1, practice: 1 },
    words: [
        {
            word: 'journey',
            translate: '旅程',
            status: 'learning',
            mastery: 0.4,
            confidence: 0.5,
            actions: ['open', 'save'],
            lastSeenAt: '2026-01-01T10:10:00.000Z',
            dueAt: '2026-01-01T09:00:00.000Z',
        },
        {
            word: 'orbit',
            translate: '轨道',
            status: 'known',
            mastery: 1,
            confidence: 1,
            actions: ['known'],
            lastSeenAt: '2026-01-01T10:09:00.000Z',
            dueAt: null,
        },
        {
            word: 'resilient',
            translate: '有韧性的',
            status: 'learning',
            mastery: 0.3,
            confidence: 0.4,
            actions: ['open'],
            lastSeenAt: '2026-01-01T10:08:00.000Z',
            dueAt: null,
        },
    ],
    mastered: [],
    due: [],
    nextDueAt: null,
};

const event = (lemma: string, context: string, createdAt: string): WordEncounter => ({
    lemma,
    context,
    created_at: createdAt,
} as unknown as WordEncounter);

const events: WordEncounter[] = [
    event('journey', 'It was a long journey home.', '2026-01-01T10:05:00.000Z'),
    event('orbit', 'The satellite stayed in orbit.', '2026-01-01T10:06:00.000Z'),
    event('resilient', 'She is remarkably resilient.', '2026-01-01T10:07:00.000Z'),
];

/**
 * 装配复盘服务；数据库、模型与缓存边界均可控，缓存默认使用真实实现。
 */
const buildService = (options: {
    summary?: LearningSessionSummaryVO;
    events?: WordEncounter[];
    cloudModel?: LanguageModel | null;
    localReady?: boolean;
    localGenerate?: () => unknown;
}) => {
    const learningDataService = {
        getSessionSummary: vi.fn().mockResolvedValue(options.summary ?? summary),
    } as unknown as LearningDataService;
    const learningDataRepository = {
        listSessionEvents: vi.fn().mockResolvedValue(options.events ?? events),
    } as unknown as LearningDataRepository;
    const aiProviderService = {
        getModel: vi.fn(() => options.cloudModel ?? null),
    } as unknown as AiProviderService;
    const localAiService = {
        getStatus: vi.fn(async () => ({
            runtimeReady: !!options.localReady,
            models: options.localReady ? [{ modelId: LOCAL_MODEL_ID, ready: true }] : [],
            activeModelId: options.localReady ? LOCAL_MODEL_ID : '',
        })),
        generate: vi.fn(async () => options.localGenerate?.() ?? {}),
    } as unknown as LocalAiService;
    const cache = new CacheServiceImpl();
    const productionPractice: { mode: string; [key: string]: unknown }[] = [];
    const productionPracticeRepository = {
        insertOne: vi.fn(async (value: Record<string, unknown>) => {
            productionPractice.push(value as { mode: string; [key: string]: unknown });
            return productionPractice.length;
        }),
        listRecentByLocation: vi.fn(async () => []),
    } as unknown as ProductionPracticeRecordRepository;
    const recordedEvidence: Array<Record<string, unknown>> = [];
    const wordEncounterService = {
        recordProductionEvidence: vi.fn(async (value: Record<string, unknown>) => {
            recordedEvidence.push(value);
        }),
    } as unknown as WordEncounterService;
    // 多轮轮次仓储：默认空会话，单个用例按需覆盖。
    const rolePlayTurns: Array<Record<string, unknown>> = [];
    const rolePlayTurnRepository = {
        upsertTurn: vi.fn(async (value: Record<string, unknown>) => {
            const existing = rolePlayTurns.findIndex((row) => (
                row.session_key === value.session_key && row.turn === value.turn
            ));
            if (existing >= 0) {
                rolePlayTurns[existing] = value;
                return existing + 1;
            }
            rolePlayTurns.push(value);
            return rolePlayTurns.length;
        }),
        listBySession: vi.fn(async (sessionKey: string) => (
            rolePlayTurns
                .filter((row) => row.session_key === sessionKey)
                .sort((a, b) => Number(a.turn) - Number(b.turn))
        )),
    } as unknown as RolePlayTurnRepository;
    // 语音转述：默认返回固定转写，单测按需覆盖。
    const sentencePracticeService = {
        transcribeOnce: vi.fn(async () => ({
            transcript: 'It was a long journey, and I was tired.',
            rhythm: null,
        })),
    } as unknown as SentencePracticeService;
    const service = new LearningRecapServiceImpl(
        learningDataService,
        learningDataRepository,
        aiProviderService,
        localAiService,
        cache,
        productionPracticeRepository,
        rolePlayTurnRepository,
        sentencePracticeService,
        wordEncounterService,
    );
    return {
        service,
        aiProviderService,
        localAiService,
        cache,
        productionPractice,
        rolePlayTurns,
        rolePlayTurnRepository,
        sentencePracticeService,
        recordedEvidence,
    };
};

const RECAP_PARAMS = {
    videoId: 'video-1',
    since: SINCE,
    locale: 'zh-CN' as const,
};

describe('LearningRecapService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('AI 复盘只保留会话词与真实字幕句，越界词自动用本地词补齐', async () => {
        vi.mocked(generateObject).mockResolvedValue({
            object: {
                headline: '这次你真正带走了三个词。',
                words: [
                    { word: 'journey', note: '记住那条回家的长路' },
                    { word: 'invented', note: '模型编出来的词' },
                ],
                sentence: {
                    text: 'It was a long journey home.',
                    note: 'journey 在这里是具体的旅程',
                },
                expression: { text: 'long journey', meaning: '漫长的旅程' },
                speakingTask: '用 30 秒讲讲你最近一次长途出行。',
            },
        } as never);
        const { service } = buildService({ cloudModel: CLOUD_MODEL });

        const recap = await service.buildRecap(RECAP_PARAMS);

        expect(recap.source).toBe('ai');
        expect(recap.words.map((word) => word.word)).toEqual(['journey', 'resilient', 'orbit']);
        expect(recap.words.find((word) => word.word === 'journey')?.note).toBe('记住那条回家的长路');
        expect(recap.sentence?.text).toBe('It was a long journey home.');
        expect(recap.expression).toEqual({ text: 'long journey', meaning: '漫长的旅程' });
        expect(recap.speakingTask).toContain('长途出行');
    });

    it('本地复盘用真实字幕句生成场景回应开场白', async () => {
        const { service } = buildService({});

        const recap = await service.buildRecap(RECAP_PARAMS);

        expect(recap.rolePlay).toEqual({
            scenario: '',
            openingLine: 'It was a long journey home.',
            prompt: '',
            targetExpressions: [],
        });
    });

    it('AI 场景回应只接受真实开场白与逐字出现的表达', async () => {
        vi.mocked(generateObject).mockResolvedValue({
            object: {
                headline: '一次安静的复盘。',
                words: [{ word: 'journey', note: '旅程' }],
                sentence: { text: 'It was a long journey home.', note: '本句回顾' },
                speakingTask: '复述这句话。',
                rolePlay: {
                    scenario: '和朋友聊回家的路。',
                    openingLine: 'It was a long journey home.',
                    prompt: '回应朋友，说说你的感受。',
                    targetExpressions: [
                        { text: 'long journey', meaning: '漫长的旅程' },
                        { text: 'home', meaning: '家' },
                        { text: 'invented phrase', meaning: '编造的表达' },
                        { text: 'long journey', meaning: '重复表达' },
                    ],
                },
            },
        } as never);
        const { service } = buildService({ cloudModel: CLOUD_MODEL });

        const recap = await service.buildRecap(RECAP_PARAMS);

        expect(recap.rolePlay).toMatchObject({
            scenario: '和朋友聊回家的路。',
            openingLine: 'It was a long journey home.',
            prompt: '回应朋友，说说你的感受。',
        });
        expect(recap.rolePlay?.targetExpressions.map((item) => item.text))
            .toEqual(['long journey', 'home']);
    });

    it('AI 场景开场白越界时回退本地场景，不阻断整份复盘', async () => {
        vi.mocked(generateObject).mockResolvedValue({
            object: {
                headline: '一次安静的复盘。',
                words: [{ word: 'journey', note: '旅程' }],
                sentence: { text: 'It was a long journey home.', note: '本句回顾' },
                speakingTask: '复述这句话。',
                rolePlay: {
                    scenario: '编造的场景。',
                    openingLine: 'This sentence never appeared.',
                    prompt: '编造的提示。',
                    targetExpressions: [{ text: 'never appeared', meaning: '不存在' }],
                },
            },
        } as never);
        const { service } = buildService({ cloudModel: CLOUD_MODEL });

        const recap = await service.buildRecap(RECAP_PARAMS);

        expect(recap.source).toBe('ai');
        expect(recap.rolePlay).toEqual({
            scenario: '',
            openingLine: 'It was a long journey home.',
            prompt: '',
            targetExpressions: [],
        });
    });

    it('复盘命中缓存时不重复调用模型', async () => {
        vi.mocked(generateObject).mockResolvedValue({
            object: {
                headline: '一次安静的复盘。',
                words: [{ word: 'journey', note: '旅程' }],
                sentence: { text: 'It was a long journey home.', note: '本句回顾' },
                speakingTask: '复述这句话。',
            },
        } as never);
        const { service } = buildService({ cloudModel: CLOUD_MODEL });

        const first = await service.buildRecap(RECAP_PARAMS);
        const second = await service.buildRecap(RECAP_PARAMS);

        expect(first.cached).toBe(false);
        expect(second.cached).toBe(true);
        expect(generateObject).toHaveBeenCalledTimes(1);
    });

    it('AI 不可用时返回本地确定性复盘', async () => {
        const { service } = buildService({});

        const recap = await service.buildRecap(RECAP_PARAMS);

        expect(recap).toMatchObject({
            source: 'local',
            cached: false,
            headline: '',
            speakingTask: '',
        });
        expect(recap.words.map((word) => word.word)).toEqual(['journey', 'resilient', 'orbit']);
        expect(recap.sentence?.text).toBe('It was a long journey home.');
    });

    it('云端失败时回退本地确定性复盘，不向界面抛错', async () => {
        vi.mocked(generateObject).mockRejectedValue(new Error('network down'));
        const { service } = buildService({ cloudModel: CLOUD_MODEL });

        const recap = await service.buildRecap(RECAP_PARAMS);

        expect(recap.source).toBe('local');
        expect(recap.words).toHaveLength(3);
    });

    it('同一会话的并发复盘请求只触发一次推理', async () => {
        const deferred: { resolve: (value: unknown) => void } = { resolve: () => undefined };
        vi.mocked(generateObject).mockReturnValue(new Promise((resolve) => {
            deferred.resolve = resolve;
        }) as never);
        const { service } = buildService({ cloudModel: CLOUD_MODEL });

        const first = service.buildRecap(RECAP_PARAMS);
        const second = service.buildRecap(RECAP_PARAMS);
        await vi.waitFor(() => expect(generateObject).toHaveBeenCalledTimes(1));
        deferred.resolve({
            object: {
                headline: '并发复盘。',
                words: [{ word: 'journey', note: '旅程' }],
                sentence: { text: 'It was a long journey home.', note: '本句回顾' },
                speakingTask: '复述这句话。',
            },
        });

        await expect(first).resolves.toMatchObject({ source: 'ai' });
        await expect(second).resolves.toMatchObject({ source: 'ai' });
        expect(generateObject).toHaveBeenCalledTimes(1);
    });

    it('复述检查在本地计算关键词覆盖并给出可解释缺失词', async () => {
        const { service } = buildService({});

        const good = await service.evaluateRetell({
            original: 'They decided to cancel the meeting.',
            response: 'They cancelled the meeting.',
        });
        expect(good.source).toBe('local');
        expect(good.level).toBe('great');
        expect(good.missingWords).toEqual(['decided']);
        expect(good.matchedKeywords).toBe(2);
        expect(good.totalKeywords).toBe(3);

        const retry = await service.evaluateRetell({
            original: 'They decided to cancel the meeting.',
            response: 'I do not know.',
        });
        expect(retry.level).toBe('retry');
        expect(retry.coverage).toBe(0);
    });

    it('AI 复述点评保留本地关键词信号，并在第二次命中缓存', async () => {
        vi.mocked(generateObject).mockResolvedValue({
            object: {
                level: 'good',
                feedback: '主要意思到了，补上 decided 会更完整。',
                improved: 'They chose to call off the meeting.',
            },
        } as never);
        const { service } = buildService({ cloudModel: CLOUD_MODEL });
        const params = {
            original: 'They decided to cancel the meeting.',
            response: 'They cancelled the meeting.',
            locale: 'zh-CN' as const,
        };

        const first = await service.evaluateRetell(params);
        const second = await service.evaluateRetell(params);

        expect(first).toMatchObject({
            source: 'ai',
            level: 'good',
            matchedKeywords: 2,
            totalKeywords: 3,
        });
        expect(first.improved).toBe('They chose to call off the meeting.');
        expect(second.cached).toBe(true);
        expect(generateObject).toHaveBeenCalledTimes(1);
    });

    it('复述与角色扮演结果会落库，并带上视频归因', async () => {
        const { service, productionPractice } = buildService({});

        await service.evaluateRetell({
            original: 'They decided to cancel the meeting.',
            response: 'They cancelled the meeting.',
            videoId: 'video-1',
            fileHash: 'subtitle-1',
            sentenceIndex: 3,
        });
        await service.evaluateRolePlay({
            openingLine: 'It was a long journey home.',
            response: 'It really was a long journey, but coming home felt wonderful.',
            targetExpressions: ['long journey', 'coming home'],
            videoId: 'video-1',
            fileHash: 'subtitle-1',
        });

        expect(productionPractice).toHaveLength(2);
        expect(productionPractice[0]).toMatchObject({
            mode: 'retell',
            video_id: 'video-1',
            file_hash: 'subtitle-1',
            sentence_index: 3,
            sentence_text: 'They decided to cancel the meeting.',
            level: 'great',
        });
        expect(productionPractice[1]).toMatchObject({
            mode: 'roleplay',
            video_id: 'video-1',
            level: 'great',
        });
        expect(JSON.parse(productionPractice[1].detail_json as string)).toMatchObject({
            usedExpressions: ['long journey', 'coming home'],
        });
    });

    it('复述与角色扮演会把用到的目标词写入长期掌握度证据', async () => {
        const { service, recordedEvidence } = buildService({});

        await service.evaluateRetell({
            original: 'They decided to cancel the meeting.',
            response: 'They cancelled the meeting.',
            videoId: 'video-1',
            fileHash: 'subtitle-1',
            sentenceIndex: 3,
        });
        await service.evaluateRolePlay({
            openingLine: 'It was a long journey home.',
            response: 'It really was a long journey, but coming home felt wonderful.',
            targetExpressions: ['long journey', 'coming home'],
            videoId: 'video-1',
        });

        expect(recordedEvidence).toHaveLength(2);
        // 复述：只把真正说到的内容词当证据，缺失的 decided 不计入。
        expect(recordedEvidence[0]).toMatchObject({
            action: 'retell',
            videoId: 'video-1',
            fileHash: 'subtitle-1',
            sentenceIndex: 3,
            score: 90,
        });
        expect(recordedEvidence[0].words).not.toContain('decided');
        expect(recordedEvidence[0].words).toContain('cancel');
        // 角色扮演：证据是用户真的用出来的目标表达。
        expect(recordedEvidence[1]).toMatchObject({
            words: ['long journey', 'coming home'],
            action: 'roleplay',
            score: 90,
        });
    });

    it('没有说到任何目标词时不写掌握度证据', async () => {
        const { service, recordedEvidence } = buildService({});

        await service.evaluateRolePlay({
            openingLine: 'It was a long journey home.',
            response: 'Yes.',
            targetExpressions: ['long journey'],
        });

        expect(recordedEvidence).toHaveLength(0);
    });

    it('场景回应在本地计算目标表达使用情况', async () => {
        const { service } = buildService({});

        const great = await service.evaluateRolePlay({
            openingLine: 'It was a long journey home.',
            response: 'It really was a long journey, but coming home felt wonderful.',
            targetExpressions: ['long journey', 'coming home'],
        });
        expect(great.source).toBe('local');
        expect(great.level).toBe('great');
        expect(great.usedExpressions).toEqual(['long journey', 'coming home']);

        const retry = await service.evaluateRolePlay({
            openingLine: 'It was a long journey home.',
            response: 'Okay.',
        });
        expect(retry.level).toBe('retry');
        expect(retry.usedExpressions).toEqual([]);
    });

    it('AI 场景点评保留本地表达信号，并在第二次命中缓存', async () => {
        vi.mocked(generateObject).mockResolvedValue({
            object: {
                level: 'good',
                feedback: '回应很自然，可以再补充一点感受。',
                improved: 'It was a long journey, but I was glad to be home.',
            },
        } as never);
        const { service } = buildService({ cloudModel: CLOUD_MODEL });
        const params = {
            openingLine: 'It was a long journey home.',
            response: 'It was a long journey, and I was tired.',
            targetExpressions: ['long journey'],
            locale: 'zh-CN' as const,
        };

        const first = await service.evaluateRolePlay(params);
        const second = await service.evaluateRolePlay(params);

        expect(first).toMatchObject({
            source: 'ai',
            level: 'good',
            usedExpressions: ['long journey'],
        });
        expect(first.improved).toBe('It was a long journey, but I was glad to be home.');
        expect(second.cached).toBe(true);
        expect(generateObject).toHaveBeenCalledTimes(1);
    });

    it('多轮场景对话按轮次落库，并可原样读回', async () => {
        const { service, rolePlayTurns } = buildService({});

        const first = await service.evaluateRolePlayTurn({
            sessionKey: MULTI_TURN_SESSION,
            scenario: '和朋友聊回家的路。',
            partnerLine: 'It was a long journey home.',
            partnerIndex: 12,
            response: 'It really was a long journey, but coming home felt wonderful.',
            targetExpressions: ['long journey'],
            videoId: 'video-1',
            fileHash: 'subtitle-1',
        });
        const second = await service.evaluateRolePlayTurn({
            sessionKey: MULTI_TURN_SESSION,
            partnerLine: 'I bet you were exhausted.',
            partnerIndex: 14,
            response: 'I was, but I slept for twelve hours.',
            videoId: 'video-1',
            fileHash: 'subtitle-1',
        });

        expect(first).toMatchObject({ turn: 1, partnerIndex: 12, level: 'great' });
        expect(second).toMatchObject({ turn: 2, partnerIndex: 14 });
        expect(rolePlayTurns).toHaveLength(2);

        const session = await service.listRolePlayTurns({ sessionKey: MULTI_TURN_SESSION });
        expect(session.sessionKey).toBe(MULTI_TURN_SESSION);
        expect(session.turns.map((turn) => turn.partnerLine)).toEqual([
            'It was a long journey home.',
            'I bet you were exhausted.',
        ]);
        expect(session.turns[0]).toMatchObject({
            turn: 1,
            partnerIndex: 12,
            response: 'It really was a long journey, but coming home felt wonderful.',
            usedExpressions: ['long journey'],
            level: 'great',
        });
    });

    it('同一句对方台词重复提交时覆盖该轮，不新增轮次', async () => {
        const { service, rolePlayTurns } = buildService({});
        const params = {
            sessionKey: 'session-b',
            partnerLine: 'It was a long journey home.',
            response: 'Yes.',
        };

        const first = await service.evaluateRolePlayTurn(params);
        const retried = await service.evaluateRolePlayTurn({
            ...params,
            response: 'It was a long journey, and I was glad to be home.',
        });

        expect(first.turn).toBe(1);
        expect(retried.turn).toBe(1);
        expect(rolePlayTurns).toHaveLength(1);
        expect(rolePlayTurns[0].response_text).toBe('It was a long journey, and I was glad to be home.');
    });

    it('多轮轮次落库失败时仍然返回点评', async () => {
        const { service, rolePlayTurnRepository } = buildService({});
        vi.mocked(rolePlayTurnRepository.upsertTurn).mockRejectedValueOnce(new Error('disk full'));

        const result = await service.evaluateRolePlayTurn({
            sessionKey: 'session-c',
            partnerLine: 'It was a long journey home.',
            response: 'It was a long journey, and I was tired.',
        });

        expect(result.level).toBe('great');
        expect(result.turn).toBe(1);
    });

    it('没有轮次时读取会话返回空列表，而不是报错', async () => {
        const { service } = buildService({});
        await expect(service.listRolePlayTurns({ sessionKey: 'missing' }))
            .resolves
            .toEqual({ sessionKey: 'missing', turns: [] });
    });

    it('语音复述用本地转写文本评分，并回传转写与节奏', async () => {
        const { service, sentencePracticeService } = buildService({});
        const rhythm = {
            speechDurationSec: 2.4,
            averageWordDurationSec: 0.4,
            paceRatio: 1.1,
            pace: 'steady' as const,
            words: [],
            notes: [],
        };
        vi.mocked(sentencePracticeService.transcribeOnce).mockResolvedValueOnce({
            transcript: 'It was a long journey, and I was tired.',
            rhythm,
        });

        const result = await service.evaluateSpokenRetell({
            original: 'It was a long journey home.',
            audio: new Uint8Array([1, 2, 3]),
            referenceDurationSec: 2.2,
            videoId: 'video-1',
            fileHash: 'subtitle-1',
            sentenceIndex: 4,
        });

        expect(sentencePracticeService.transcribeOnce).toHaveBeenCalledWith(expect.objectContaining({
            referenceText: 'It was a long journey home.',
            referenceDurationSec: 2.2,
            jobKey: 'video-1:4',
        }));
        // 转写文本就是实际参与评分的答案：关键词覆盖由本地计算。
        expect(result.transcript).toBe('It was a long journey, and I was tired.');
        expect(result.rhythm).toEqual(rhythm);
        expect(result.totalKeywords).toBeGreaterThan(0);
        expect(result.level).toBe('great');
    });

    it('录音为空或没有识别到语音时明确报错，不伪造 retry 结果', async () => {
        const { service, sentencePracticeService } = buildService({});

        await expect(service.evaluateSpokenRetell({
            original: 'It was a long journey home.',
            audio: new Uint8Array(),
        })).rejects.toThrow('录音内容为空');

        vi.mocked(sentencePracticeService.transcribeOnce).mockResolvedValueOnce({
            transcript: '',
            rhythm: null,
        });
        await expect(service.evaluateSpokenRetell({
            original: 'It was a long journey home.',
            audio: new Uint8Array([1]),
        })).rejects.toThrow('没有识别到语音内容');
    });

    it('提示词把会话词、真实句子与本地覆盖信号作为 grounding', () => {
        const recapPrompt = buildLearningRecapPrompt({
            summary,
            contexts: [{
                text: 'It was a long journey home.',
                lemmas: ['journey'],
                lastSeenAt: '2026-01-01T10:05:00.000Z',
            }],
            locale: 'zh-CN',
        });
        expect(recapPrompt).toContain('journey');
        expect(recapPrompt).toContain('It was a long journey home.');
        expect(recapPrompt).toContain('Simplified Chinese');

        const retellPrompt = buildRetellPrompt({
            original: 'They decided to cancel the meeting.',
            response: 'They cancelled the meeting.',
            coverage: 2 / 3,
            missingWords: ['decided'],
            locale: 'en-US',
        });
        expect(retellPrompt).toContain('decided');
        expect(retellPrompt).toContain('English');
        expect(retellPrompt).toContain('Do not require exact wording');

        const rolePlayPrompt = buildRolePlayFeedbackPrompt({
            scenario: '和朋友聊回家的路。',
            openingLine: 'It was a long journey home.',
            response: 'It was long, but I was happy.',
            targetExpressions: ['long journey'],
            usedExpressions: [],
            locale: 'en-US',
        });
        expect(rolePlayPrompt).toContain('It was a long journey home.');
        expect(rolePlayPrompt).toContain('long journey');
        expect(rolePlayPrompt).toContain('English');
        expect(rolePlayPrompt).toContain('Stay inside the role-play situation');
    });
});

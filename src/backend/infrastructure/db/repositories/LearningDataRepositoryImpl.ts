import { and, asc, eq, gte, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Db } from '@/backend/infrastructure/db/createDb';
import {
    recommendationEvent,
    type InsertRecommendationEvent,
    type RecommendationEvent,
} from '@/backend/infrastructure/db/tables/recommendationEvent';
import { productionPracticeRecord } from '@/backend/infrastructure/db/tables/productionPracticeRecord';
import { reviewCard, type ReviewCard } from '@/backend/infrastructure/db/tables/reviewCard';
import { rolePlayTurn, type RolePlayTurn } from '@/backend/infrastructure/db/tables/rolePlayTurn';
import { sentencePracticeRecord } from '@/backend/infrastructure/db/tables/sentencePracticeRecord';
import { wordEncounter, type WordEncounter } from '@/backend/infrastructure/db/tables/wordEncounter';
import { words, type Word } from '@/backend/infrastructure/db/tables/words';
import TYPES from '@/backend/ioc/types';
import type LearningDataRepository from '@/backend/services/repositories/LearningDataRepository';
import type {
    LearningDataResetCounts,
    SessionEventQuery,
} from '@/backend/services/repositories/LearningDataRepository';
import type { ReviewEventRow } from '@/common/types/review';
import type {
    LearningDataRestoreCounts,
    LearningDataRestoreSnapshot,
} from '@/common/types/learningData';
import type { ReviewOutcome } from '@/backend/services/repositories/WordEncounterRepository';
import { effectiveWordMastery } from '@/common/learning/mastery';

/**
 * restore 单条多值 INSERT 的每批行数上限。
 *
 * SQLite 的绑定参数上限是 32766，restore 各表最多 11-12 列：一次插入 2979 行
 * 就会撞上 `too many SQL variables`，让用户自己导出的备份无法恢复。
 * 每批 400 行（400×12=4800 参数）留出充分余量，与 ReviewCardRepositoryImpl
 * ensureForWords 的分批先例同一口径。
 */
const RESTORE_BATCH_ROWS = 400;

/** 按 size 切片逐批执行 fn；用于把大数组拆成多条多值 INSERT。 */
const inChunks = <T>(items: readonly T[], size: number, fn: (chunk: T[]) => void): void => {
    for (let index = 0; index < items.length; index += size) {
        fn(items.slice(index, index + size));
    }
};

/**
 * 学习数据 SQLite 仓储。
 */
@injectable()
export default class LearningDataRepositoryImpl implements LearningDataRepository {
    constructor(@inject(TYPES.Database) private readonly db: Db) {}

    public async listUserWords(): Promise<Word[]> {
        const rows = await this.db
            .select()
            .from(words)
            .where(ne(words.source, 'default'))
            .orderBy(asc(words.word));
        return rows.map((row) => ({ ...row, mastery: effectiveWordMastery(row) }));
    }

    /**
     * 读取用户词表的原始证据值（mastery 不经过读取边界衰减）。
     *
     * 仅供可移植导出使用：mastery.ts 的不变量是「数据库保存原始证据值，衰减只在
     * 读取边界生效、重复读取不产生复利」。导出若拿衰减后的值落进备份，恢复时会把
     * 它当作原始值写库，备份往返一次就额外衰减一次。
     */
    public async listUserWordsForExport(): Promise<Word[]> {
        return this.db
            .select()
            .from(words)
            .where(ne(words.source, 'default'))
            .orderBy(asc(words.word));
    }

    public async listEncounters(): Promise<WordEncounter[]> {
        return this.db
            .select()
            .from(wordEncounter)
            .orderBy(asc(wordEncounter.id));
    }

    public async listReviewCards(): Promise<ReviewCard[]> {
        return this.db
            .select()
            .from(reviewCard)
            .orderBy(asc(reviewCard.word));
    }

    public async listSessionEvents(query: SessionEventQuery): Promise<WordEncounter[]> {
        if (!query.videoId && !query.fileHash) {
            return [];
        }
        return this.db
            .select()
            .from(wordEncounter)
            .where(and(
                gte(wordEncounter.created_at, query.since),
                inArray(wordEncounter.action, [...query.actions]),
                or(
                    query.videoId ? eq(wordEncounter.video_id, query.videoId) : undefined,
                    query.fileHash ? eq(wordEncounter.file_hash, query.fileHash) : undefined,
                ),
            ))
            .orderBy(asc(wordEncounter.id))
            .limit(query.limit ?? 2000);
    }

    public async findWordsByLemmas(lemmas: string[]): Promise<Word[]> {
        if (lemmas.length === 0) {
            return [];
        }
        const rows = await this.db
            .select()
            .from(words)
            .where(inArray(sql`lower(${words.word})`, lemmas.map((lemma) => lemma.toLowerCase())));
        return rows.map((row) => ({ ...row, mastery: effectiveWordMastery(row) }));
    }

    public async findReviewCardsByWords(wordsToFind: string[]): Promise<ReviewCard[]> {
        if (wordsToFind.length === 0) {
            return [];
        }
        return this.db
            .select()
            .from(reviewCard)
            .where(inArray(reviewCard.word, wordsToFind.map((word) => word.toLowerCase())));
    }

    public async listReviewOutcomesSince(since: string): Promise<ReviewOutcome[]> {
        return this.db
            .select({
                rating: wordEncounter.rating,
                score: wordEncounter.score,
            })
            .from(wordEncounter)
            .where(and(
                eq(wordEncounter.action, 'review'),
                gte(wordEncounter.created_at, since),
            ));
    }

    public async listReviewEventsSince(since: string): Promise<ReviewEventRow[]> {
        return this.db
            .select({
                lemma: wordEncounter.lemma,
                rating: wordEncounter.rating,
            })
            .from(wordEncounter)
            .where(and(
                eq(wordEncounter.action, 'review'),
                gte(wordEncounter.created_at, since),
            ));
    }

    public async listEncountersSince(since: string): Promise<WordEncounter[]> {
        return this.db
            .select()
            .from(wordEncounter)
            .where(gte(wordEncounter.created_at, since))
            .orderBy(asc(wordEncounter.id));
    }

    public async insertRecommendationEvent(value: InsertRecommendationEvent): Promise<void> {
        await this.db.insert(recommendationEvent).values(value);
    }

    public async listRecommendationEventsSince(
        since: string,
        limit = 5000,
    ): Promise<RecommendationEvent[]> {
        return this.db
            .select()
            .from(recommendationEvent)
            .where(gte(recommendationEvent.created_at, since))
            .orderBy(asc(recommendationEvent.id))
            .limit(limit);
    }

    public async listRecommendationEvents(): Promise<RecommendationEvent[]> {
        return this.db
            .select()
            .from(recommendationEvent)
            .orderBy(asc(recommendationEvent.id));
    }

    public async listSentencePracticeRecords() {
        return this.db
            .select()
            .from(sentencePracticeRecord)
            .orderBy(asc(sentencePracticeRecord.id));
    }

    public async listProductionPracticeRecords() {
        return this.db
            .select()
            .from(productionPracticeRecord)
            .orderBy(asc(productionPracticeRecord.id));
    }

    public async listPracticeAudioFiles(): Promise<string[]> {
        const rows = await this.db
            .select({ audioFile: sentencePracticeRecord.audio_file })
            .from(sentencePracticeRecord)
            .where(isNotNull(sentencePracticeRecord.audio_file));
        return rows
            .map((row) => row.audioFile)
            .filter((audioFile): audioFile is string => typeof audioFile === 'string' && audioFile.length > 0);
    }

    public async listRolePlayTurns(): Promise<RolePlayTurn[]> {
        return this.db
            .select()
            .from(rolePlayTurn)
            .orderBy(
                asc(rolePlayTurn.created_at),
                asc(rolePlayTurn.session_key),
                asc(rolePlayTurn.turn),
            );
    }

    public async resetLearningData(): Promise<LearningDataResetCounts> {
        const now = new Date().toISOString();
        return this.db.transaction((tx) => {
            const encounters = tx.delete(wordEncounter).run();
            const cards = tx.delete(reviewCard).run();
            const recommendations = tx.delete(recommendationEvent).run();
            // 句子练习（跟读/听写）、产出型练习（复述/角色扮演）与角色扮演轮次
            // 都属于用户学习记录，清除学习数据时必须一并删除，否则会残留按视频
            // 定位的历史成绩，或让同一场对话在清除后继续续聊。
            tx.delete(sentencePracticeRecord).run();
            tx.delete(productionPracticeRecord).run();
            const rolePlayTurns = tx.delete(rolePlayTurn).run();
            // 只重置用户自己的词：内置词（source=default）带着产品词标记，
            // 把它们改成 manual 会让内置词混进用户词表，之后导出/清除都失真。
            const updatedWords = tx.update(words).set({
                status: 'learning',
                source: 'manual',
                mastery: 0,
                confidence: 0,
                last_seen_at: null,
                mastered_at: null,
                updated_at: now,
            }).where(ne(words.source, 'default')).run();
            return {
                encountersDeleted: Number(encounters.changes),
                reviewCardsDeleted: Number(cards.changes),
                recommendationsDeleted: Number(recommendations.changes),
                rolePlayTurnsDeleted: Number(rolePlayTurns.changes),
                wordsReset: Number(updatedWords.changes),
            };
        });
    }

    /**
     * 用导出的快照整体覆盖学习数据。
     *
     * 采用「先清空、再写入」而不是逐条合并：导出是完整快照，合并会让已经删除的
     * 事件复活，也会让同一词条的掌握度出现无法解释的混合值。整个替换在一个事务
     * 内完成，任何一步失败都不会留下半套数据。
     */
    public async restoreLearningData(
        snapshot: LearningDataRestoreSnapshot,
    ): Promise<LearningDataRestoreCounts> {
        return this.db.transaction((tx) => {
            tx.delete(wordEncounter).run();
            tx.delete(reviewCard).run();
            tx.delete(recommendationEvent).run();
            tx.delete(sentencePracticeRecord).run();
            tx.delete(productionPracticeRecord).run();
            tx.delete(rolePlayTurn).run();

            // 只替换用户词表：默认词表是产品资产，不随用户备份进出。
            // 但如果备份里的某个词正好与默认词表同形，必须先让位，否则会撞上 word 唯一约束；
            // 恢复后该词属于用户，而不是产品内置词。
            const restoreWords = snapshot.words.map((word) => word.word.toLowerCase());
            tx.delete(words).where(restoreWords.length > 0
                ? or(ne(words.source, 'default'), inArray(sql`lower(${words.word})`, restoreWords))
                : ne(words.source, 'default')).run();

            for (const word of snapshot.words) {
                tx.insert(words).values({
                    word: word.word,
                    translate: word.translate,
                    status: word.status,
                    source: word.source,
                    mastery: word.mastery,
                    confidence: word.confidence,
                    last_seen_at: word.lastSeenAt,
                    mastered_at: word.masteredAt,
                    created_at: word.createdAt,
                    updated_at: word.updatedAt,
                }).run();
            }
            if (snapshot.encounters.length > 0) {
                inChunks(snapshot.encounters, RESTORE_BATCH_ROWS, (chunk) => {
                    tx.insert(wordEncounter).values(chunk.map((encounter) => ({
                        word: encounter.word,
                        lemma: encounter.lemma,
                        action: encounter.action,
                        video_id: encounter.videoId,
                        file_hash: encounter.fileHash,
                        sentence_index: encounter.sentenceIndex,
                        sentence_hash: encounter.sentenceHash,
                        context: encounter.context,
                        score: encounter.score,
                        rating: encounter.rating,
                        created_at: encounter.createdAt,
                    }))).run();
                });
            }
            if (snapshot.reviewCards.length > 0) {
                inChunks(snapshot.reviewCards, RESTORE_BATCH_ROWS, (chunk) => {
                    tx.insert(reviewCard).values(chunk.map((card) => ({
                        word: card.word,
                        due_at: card.dueAt,
                        state: card.state,
                        reps: card.reps,
                        lapses: card.lapses,
                        stability: card.stability,
                        difficulty: card.difficulty,
                        last_review_at: card.lastReviewAt,
                        last_rating: card.lastRating,
                        created_at: card.createdAt,
                        updated_at: card.updatedAt,
                    }))).run();
                });
            }
            if (snapshot.recommendations.length > 0) {
                inChunks(snapshot.recommendations, RESTORE_BATCH_ROWS, (chunk) => {
                    tx.insert(recommendationEvent).values(chunk.map((event) => ({
                        video_id: event.videoId,
                        action: event.action,
                        surface: event.surface,
                        score: event.score,
                        reason_code: event.reasonCode,
                        created_at: event.createdAt,
                    }))).run();
                });
            }
            if (snapshot.sentencePractices.length > 0) {
                inChunks(snapshot.sentencePractices, RESTORE_BATCH_ROWS, (chunk) => {
                    tx.insert(sentencePracticeRecord).values(chunk.map((record) => ({
                        file_hash: record.fileHash,
                        sentence_index: record.sentenceIndex,
                        resegmented: record.resegmented,
                        mode: record.mode,
                        score: record.score,
                        transcript: record.transcript,
                        audio_file: record.audioFile,
                        detail_json: record.detailJson,
                        created_at: record.createdAt,
                    }))).run();
                });
            }
            if (snapshot.productionPractices.length > 0) {
                inChunks(snapshot.productionPractices, RESTORE_BATCH_ROWS, (chunk) => {
                    tx.insert(productionPracticeRecord).values(chunk.map((record) => ({
                        mode: record.mode,
                        video_id: record.videoId,
                        file_hash: record.fileHash,
                        sentence_index: record.sentenceIndex,
                        sentence_text: record.sentenceText,
                        response_text: record.responseText,
                        level: record.level,
                        feedback: record.feedback,
                        improved: record.improved,
                        detail_json: record.detailJson,
                        created_at: record.createdAt,
                    }))).run();
                });
            }
            if (snapshot.rolePlayTurns.length > 0) {
                inChunks(snapshot.rolePlayTurns, RESTORE_BATCH_ROWS, (chunk) => {
                    tx.insert(rolePlayTurn).values(chunk.map((turn) => ({
                        session_key: turn.sessionKey,
                        turn: turn.turn,
                        video_id: turn.videoId,
                        file_hash: turn.fileHash,
                        partner_line: turn.partnerLine,
                        partner_index: turn.partnerIndex,
                        response_text: turn.responseText,
                        level: turn.level,
                        feedback: turn.feedback,
                        improved: turn.improved,
                        used_expressions_json: turn.usedExpressions.length > 0
                            ? JSON.stringify(turn.usedExpressions)
                            : null,
                        source: turn.source,
                        created_at: turn.createdAt,
                    }))).run();
                });
            }

            return {
                wordsRestored: snapshot.words.length,
                encountersRestored: snapshot.encounters.length,
                reviewCardsRestored: snapshot.reviewCards.length,
                recommendationsRestored: snapshot.recommendations.length,
                sentencePracticesRestored: snapshot.sentencePractices.length,
                productionPracticesRestored: snapshot.productionPractices.length,
                rolePlayTurnsRestored: snapshot.rolePlayTurns.length,
            };
        });
    }
}

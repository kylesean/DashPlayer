import { inject, injectable } from 'inversify';

import TYPES from '@/backend/ioc/types';
import type LearningDataRepository from '@/backend/services/repositories/LearningDataRepository';
import type ReviewCardRepository from '@/backend/services/repositories/ReviewCardRepository';
import { buildLearningMetrics } from '@/common/learning/learningMetrics';
import { isActiveWordStatus } from '@/common/types/vocabulary';
import type {
    LearningMetricsParams,
    LearningMetricsVO,
    LearningMetricsWindow,
} from '@/common/types/learningMetrics';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS: LearningMetricsWindow = 7;

/**
 * 学习指标看板契约。
 */
export default interface LearningMetricsService {
    /**
     * 汇总成功回忆指标与辅助指标。
     *
     * 只读本地数据库；不调用模型、不访问网络。
     */
    getMetrics(params?: LearningMetricsParams): Promise<LearningMetricsVO>;
}

/**
 * 学习指标看板实现。
 *
 * 聚合逻辑放在 `common/learning/learningMetrics` 的纯函数里，这里只负责
 * 取数与时间窗口；这样边界条件可以用构造数据测试，不必每次都搭数据库。
 */
@injectable()
export class LearningMetricsServiceImpl implements LearningMetricsService {
    constructor(
        @inject(TYPES.LearningDataRepository) private readonly learningDataRepository: LearningDataRepository,
        @inject(TYPES.ReviewCardRepository) private readonly reviewCardRepository: ReviewCardRepository,
    ) {}

    public async getMetrics(params: LearningMetricsParams = {}): Promise<LearningMetricsVO> {
        const windowDays = params.windowDays === 30 ? 30 : DEFAULT_WINDOW_DAYS;
        const now = new Date();
        const windowStart = new Date(now.getTime() - windowDays * DAY_MS).toISOString();
        const day7 = new Date(now.getTime() - 7 * DAY_MS).toISOString();
        const day30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
        const [
            reviewEvents,
            encounters,
            userWords,
            dueBacklog,
            recommendationEvents,
            retention7Outcomes,
            retention30Outcomes,
        ] = await Promise.all([
            this.learningDataRepository.listReviewEventsSince(windowStart),
            this.learningDataRepository.listEncountersSince(windowStart),
            this.learningDataRepository.listUserWords(),
            this.reviewCardRepository.countDue(now.toISOString()),
            this.learningDataRepository.listRecommendationEventsSince(windowStart),
            this.learningDataRepository.listReviewOutcomesSince(day7),
            this.learningDataRepository.listReviewOutcomesSince(day30),
        ]);

        const activeWords = userWords
            .filter((word) => word.source !== 'default' && isActiveWordStatus(word.status))
            .map((word) => ({ word: word.word, status: word.status }));

        // 推荐指标沿用内容指南针的「视频 × 自然日」去重口径，否则同一天反复曝光
        // 会把打开率压到接近 0，与设置页已有的推荐看板自相矛盾。
        const shownKeys = new Set<string>();
        const openedKeys = new Set<string>();
        for (const event of recommendationEvents) {
            const key = `${event.video_id}|${event.created_at.slice(0, 10)}`;
            if (event.action === 'shown') {
                shownKeys.add(key);
            } else if (event.action === 'opened') {
                openedKeys.add(key);
            }
        }
        let openedWithinShown = 0;
        for (const key of openedKeys) {
            if (shownKeys.has(key)) {
                openedWithinShown += 1;
            }
        }

        const summarize = (outcomes: typeof retention7Outcomes) => {
            const successful = outcomes.filter((outcome) =>
                outcome.rating === 'good' || outcome.rating === 'easy',
            ).length;
            return {
                reviewed: outcomes.length,
                retention: outcomes.length === 0 ? null : successful / outcomes.length,
            };
        };
        const retention7 = summarize(retention7Outcomes);
        const retention30 = summarize(retention30Outcomes);

        const { northStar, metrics, unavailable } = buildLearningMetrics({
            windowDays,
            reviewEvents,
            encounters,
            activeWords,
            dueBacklog,
            recommendationShown: shownKeys.size,
            recommendationOpened: openedWithinShown,
            retention7: retention7.retention,
            retention30: retention30.retention,
            retention7Reviewed: retention7.reviewed,
            retention30Reviewed: retention30.reviewed,
        });

        return {
            generatedAt: now.toISOString(),
            windowDays,
            northStar,
            metrics,
            retention: { last7Days: retention7, last30Days: retention30 },
            unavailable,
        };
    }
}

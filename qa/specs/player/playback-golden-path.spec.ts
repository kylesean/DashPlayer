import path from 'node:path';
import { expect } from '@playwright/test';
import { test } from '../../support/fixtures';
import {
    SENTENCE_CARD_TESTID,
    SIDE_TRANSLATION_TOGGLE_TESTID,
} from '../../../src/common/constants/player-scroll-protocol';

/** 媒体夹具：真实视频 + 双语 SRT。 */
const FIXTURE_VIDEO = path.resolve(__dirname, '..', '..', 'fixtures', 'media', 'qa-bilingual.mp4');

/**
 * 核心播放链路：入库 → 首页最近观看 → 播放页 → 字幕与侧栏译文。
 *
 * 入库入口使用产品已有的 dev/qa `?file=`（与应用自己的 `watch-history/create` 同源），
 * 不伪造数据库；之后刻意回到真实首页，从「最近观看」卡片点进播放页，覆盖列表到播放器的
 * 跨页链路。滚动实验仍走 `?file=` 直达，不在这里重复。
 */
test.describe('播放核心链路', () => {
    test('[SET-PLY-01] 入库后从最近观看进入播放页，字幕与侧栏译文可用 @smoke', async ({ session }) => {
        const { page } = session;

        await page.evaluate((file) => {
            window.location.hash = `#/player/qa?file=${encodeURIComponent(file)}&seek=0&lang=zh`;
        }, FIXTURE_VIDEO);

        const firstSentence = page.getByTestId(SENTENCE_CARD_TESTID).filter({ hasText: 'The player keeps' }).first();
        await expect(firstSentence).toBeVisible({ timeout: 30_000 });

        // 侧栏译文开关是产品翻译面板的入口；打开后同一句应显示 SRT 里的中文译文
        const translationToggle = page.getByTestId(SIDE_TRANSLATION_TOGGLE_TESTID);
        await expect(translationToggle).toBeVisible();
        if (await translationToggle.getAttribute('aria-pressed') !== 'true') {
            await translationToggle.click();
        }
        await expect(translationToggle).toHaveAttribute('aria-pressed', 'true');
        await expect(firstSentence).toContainText('阅读位置');

        // 回到真实首页：列表由 watch-history/list 提供，卡片 testid 带真实视频 ID
        await page.evaluate(() => {
            window.location.hash = '#/';
        });
        const historyCard = page.getByTestId(/^watch-history-card-/).first();
        await expect(historyCard).toBeVisible({ timeout: 15_000 });
        const videoId = await historyCard.getAttribute('data-video-id');
        expect(videoId).toBeTruthy();

        await historyCard.click();
        await expect(page).toHaveURL(new RegExp(`#/player/${videoId}`));
        await expect(page.getByTestId(SENTENCE_CARD_TESTID).first()).toBeVisible({ timeout: 30_000 });
    });
});

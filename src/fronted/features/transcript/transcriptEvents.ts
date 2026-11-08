import type { RegisterRendererApi } from '@/fronted/infrastructure/electron/rendererApiRegistry';
import { getRendererLogger } from '@/fronted/log/simple-logger';
import { SWR_KEY, swrMutate } from '@/fronted/lib/swr-util';
import { TranscriptTaskState } from '@/common/contracts/transcript/transcript-task';
import { transcriptApi } from '@/fronted/features/transcript/transcriptApi';
import toast from 'react-hot-toast';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import { playerActions } from '@/fronted/features/player/components/PlayerActions';
import useTranslation from '@/fronted/features/player/translationStore';

const logger = getRendererLogger('TranscriptEvents');

/**
 * 注册转录相关的 main 进程回调通道。
 *
 * @param register 接口注册函数。
 */
export function registerTranscriptRendererApis(register: RegisterRendererApi): void {
    register('transcript/batch-result', async (params) => {
        logger.debug('Batch transcription result', {
            count: params.updates.length,
            statuses: params.updates.map((update) => update.status),
        });

        try {
            for (const update of params.updates) {
                if (update.status === TranscriptTaskState.DONE && update.result?.srtPath) {
                    await transcriptApi.attachSubtitle(update.filePath, 'same');
                    await swrMutate(SWR_KEY.PLAYER_P);
                    // 转录产出通常就是视频自己那份同名 SRT，解析出的路径与转录期间一模一样；
                    // 而字幕上下文的依赖里只有路径与重载令牌，路径没变就不会重建，增量字幕
                    // 与空 srtHash 会原地留着（收藏、生词、自动切片全按 srtHash 开关）。
                    // 因此结束事件必须自己把重建意图表达出来，不能指望路径恰好变了。
                    if (update.filePath === usePlaybackSession.getState().videoPath) {
                        usePlaybackSession.getState().reloadSubtitles();
                    }
                    toast('Transcript done', { icon: '🚀' });
                    continue;
                }
                // 取消/失败后增量会话已结束，当前视频需回退到已挂载的真实字幕（无则清空）。
                if (
                    (update.status === TranscriptTaskState.CANCELLED || update.status === TranscriptTaskState.FAILED)
                    && update.filePath === usePlaybackSession.getState().videoPath
                ) {
                    usePlaybackSession.getState().reloadSubtitles();
                }
            }
        } finally {
            await swrMutate(SWR_KEY.TRANSCRIPTION_TASKS);
        }
    });

    register('transcript/chunk-result', async (params) => {
        if (params.filePath !== usePlaybackSession.getState().videoPath) return;
        if (params.sentences.length === 0) return;
        useTranslation.getState().setActiveFileHash(params.sessionId);
        // 转录期间每完成一块推送一次全集；走合并入口，避免清掉逐句循环等播放期状态
        playerActions.mergeSubtitles(params.sentences);
    });
}

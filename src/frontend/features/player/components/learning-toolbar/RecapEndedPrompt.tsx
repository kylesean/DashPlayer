import { useTranslation } from 'react-i18next';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';

import { usePlaybackSession } from '@/frontend/features/player/playbackSessionStore';
import { buildLearningSessionKey } from '@/frontend/features/player/learningSessionStore';
import { useRecapPromptStore } from './recapPromptStore';

/**
 * 视频自然结束时的复盘提示。
 *
 * 用 Banner 而不是弹窗：结束时刻用户可能正想继续看下一集，任何模态框都会
 * 打断这个意图。提示只出现在字幕面板上方，可关闭，也只在同一会话里出现
 * 一次——切到别的视频后自动失效。
 *
 * @param onOpenRecap 打开复盘弹层的回调。
 */
export default function RecapEndedPrompt() {
    const { t } = useTranslation('player');
    const { t: tRecap } = useTranslation('recap');
    const videoId = usePlaybackSession((state) => state.videoId);
    const srtHash = usePlaybackSession((state) => state.srtHash);
    const promptKey = useRecapPromptStore((state) => state.promptKey);
    const dismiss = useRecapPromptStore((state) => state.dismiss);
    const setRecapOpen = useRecapPromptStore((state) => state.setRecapOpen);

    const sessionKey = buildLearningSessionKey(videoId ?? null, srtHash ?? null);
    if (promptKey === null || promptKey !== sessionKey) {
        return null;
    }

    return (
        <div className="px-3 pb-1.5" data-testid="recap-ended-prompt">
            <Banner
                status="info"
                title={t('learningSummary.endedTitle')}
                description={t('learningSummary.endedHint')}
                isDismissable
                dismissLabel={t('learningSummary.endedDismiss')}
                onDismiss={dismiss}
                endContent={(
                    <Button
                        variant="secondary"
                        size="sm"
                        label={tRecap('cta')}
                        onClick={() => {
                            dismiss();
                            setRecapOpen(true);
                        }}
                    />
                )}
            />
        </div>
    );
}

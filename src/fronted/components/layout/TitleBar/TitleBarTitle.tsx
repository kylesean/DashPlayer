import React, { useMemo } from 'react';
import { useInRouterContext, useLocation } from 'react-router-dom';
import { usePlaybackSession } from '@/fronted/features/player/playbackSessionStore';
import PathUtil from '@/common/utils/PathUtil';

const InnerTitle: React.FC = () => {
    const location = useLocation();
    const isPlayer = location.pathname.startsWith('/player');
    const videoPath = usePlaybackSession((s) => s.videoPath);
    const currentVideoTitle = useMemo(() => {
        if (!videoPath) return '';
        return PathUtil.parse(videoPath).base;
    }, [videoPath]);

    if (!isPlayer || !currentVideoTitle) {
        return null;
    }

    return (
        <span className="text-sm text-secondary/75 font-medium max-w-[420px] truncate select-none pointer-events-none">
            {currentVideoTitle}
        </span>
    );
};

/**
 * 桌面端标题栏居中文档/视频标题展示组件。
 *
 * 仅在 Router 环境且处于播放器状态时展示当前正在播放的媒体名称，
 * 在非 Router 启动门槛（Onboarding / 迁移失败）时安全降级为 null。
 */
export const TitleBarTitle: React.FC = () => {
    const inRouter = useInRouterContext();
    if (!inRouter) {
        return null;
    }
    return <InnerTitle />;
};

export default TitleBarTitle;

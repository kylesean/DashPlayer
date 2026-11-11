import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import useChatPanel from '@/fronted/features/chat/chatStore';
import { exitOverlayView } from '@/fronted/features/player/lib/player-view-controller';
import { usePlayerState } from '@/fronted/features/player/playerState';

/** 学习视图在播放地址后的固定后缀。 */
const LEARN_SUFFIX = '/learn';

/**
 * 判断当前路径是否指向学习视图。
 *
 * @param pathname 当前 location 的 pathname。
 * @returns 路径以 `/learn` 结尾时为 true。
 */
export function isLearningPath(pathname: string): boolean {
    return pathname.replace(/\/+$/, '').endsWith(LEARN_SUFFIX);
}

/**
 * 去掉学习后缀，得到播放地址。
 *
 * @param pathname 当前 location 的 pathname。
 * @returns 对应的播放地址；本身不是学习地址时原样返回。
 */
function playerBasePath(pathname: string): string {
    const trimmed = pathname.replace(/\/+$/, '');
    return isLearningPath(trimmed) ? trimmed.slice(0, -LEARN_SUFFIX.length) || '/' : trimmed;
}

/**
 * 把查询串拼回路径，保留 dev 入口等已有参数。
 *
 * @param path 目标路径。
 * @param search location.search。
 * @returns 带查询串的完整路径。
 */
function withSearch(path: string, search: string): string {
    return search ? `${path}${search}` : path;
}

/**
 * 让「整句学习」成为可寻址视图：地址是学习页的唯一入口与退出依据。
 *
 * 说明：
 * - `/player/:videoId/learn` 是学习视图地址，深链/前进即进入，浏览器后退即退出；
 * - 工具条、快捷键、右键菜单等既有入口继续写 store，本 hook 把可见状态变化同步回地址，
 *   因此入口不再依赖字幕文稿面板或工具条是否可见；
 * - 进入失败（如当前没有可学习的字幕句）退回播放地址，避免停在不可用深链。
 */
export function useLearningRouteSync(): void {
    const navigate = useNavigate();
    const location = useLocation();
    const locationRef = useRef(location);
    // 在 effect 中同步，避免渲染期读写 ref；其他 effect 声明在其后，读到的始终是本轮 location
    useEffect(() => {
        locationRef.current = location;
    }, [location]);

    const learningVisible = useChatPanel((s) => s.learningVisible);
    const currentSentenceReady = usePlayerState((s) => !!s.currentSentence);
    const onLearningPath = isLearningPath(location.pathname);
    /** 防止同一地址重复发起进入流程（字幕尚未就绪时会在就绪后重试）。 */
    const enterAttemptRef = useRef(false);

    // 地址 → 视图：深链或前进到 /learn 时进入学习页；离开 /learn 时退回播放画面。
    useEffect(() => {
        if (!onLearningPath) {
            if (useChatPanel.getState().learningVisible) {
                exitOverlayView();
            }
            return;
        }
        if (
            useChatPanel.getState().learningVisible
            || !currentSentenceReady
            || enterAttemptRef.current
        ) {
            return;
        }
        enterAttemptRef.current = true;
        void useChatPanel.getState().createFromCurrent()
            .catch((error) => {
                toast.error(error instanceof Error ? error.message : String(error));
            })
            .finally(() => {
                enterAttemptRef.current = false;
                if (!useChatPanel.getState().learningVisible) {
                    const { pathname, search } = locationRef.current;
                    navigate(withSearch(playerBasePath(pathname), search), { replace: true });
                }
            });
    }, [onLearningPath, currentSentenceReady, navigate]);

    // 视图 → 地址：任何内部入口打开/关闭学习页都写回地址，保证可返回、可分享。
    const previousVisibleRef = useRef(learningVisible);
    useEffect(() => {
        const wasVisible = previousVisibleRef.current;
        previousVisibleRef.current = learningVisible;
        if (learningVisible === wasVisible) {
            return;
        }
        const { pathname, search } = locationRef.current;
        const onLearnPath = isLearningPath(pathname);
        if (learningVisible && !onLearnPath) {
            navigate(withSearch(`${pathname.replace(/\/+$/, '')}${LEARN_SUFFIX}`, search));
        } else if (!learningVisible && onLearnPath) {
            navigate(withSearch(playerBasePath(pathname), search), { replace: true });
        }
    }, [learningVisible, navigate]);
}

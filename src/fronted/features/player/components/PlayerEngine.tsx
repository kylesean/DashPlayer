/**
 * 渲染实际的视频播放器，并负责把播放器事件同步回播放器 store。
 *
 * 职责：
 * - 承载 react-player v3 的 HtmlPlayer（等价于 v2 的 react-player/file：只负责本地文件渲染 <video>/<audio>）
 * - 同步 store 中的播放/seek/音量/倍速状态到原生媒体元素
 * - 通过 playRequestId 强制执行原生 play()，解决“期望播放已是 true 时点播放无效”的问题
 * - 通过 rAF 采样以约 50ms 粒度回传精确播放时间（v3 已移除 progressInterval，原生 timeupdate 粒度约 250ms）
 * - 通过看门狗检测播放卡死（currentTime 长时间不动）并自愈（强制 play → 重建 video 元素）
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import HtmlPlayer from 'react-player/HtmlPlayer';
import { usePlayerState } from '@/fronted/features/player/playerState';
import { usePlayer, type SeekRequest } from '@/fronted/features/player/playerStore';
import { useShallow } from 'zustand/react/shallow';
import { getRendererLogger } from '@/fronted/log/simple-logger';

const logger = getRendererLogger('PlayerEngine');

/** rAF 采样回传精确播放时间的最小间隔（毫秒），对齐 v2 progressInterval=50ms 的粒度。 */
const EXACT_TIME_SAMPLE_MS = 45;
/**
 * seek 落点结算兜底：从请求时刻起最多等这么久。
 * 正常由原生 seeked 结算；目标时间与当前位置相同时浏览器不会派发 seeked，需靠该兜底收尾。
 */
const SEEK_RESOLVE_TIMEOUT_MS = 1500;

/**
 * 播放器引擎组件入参。
 */
export interface PlayerEngineProps {
  /** 播放器容器宽度（作为内联样式应用到媒体元素）。 */
  width?: string | number;
  /** 播放器容器高度（作为内联样式应用到媒体元素）。 */
  height?: string | number;
  /** 底层播放器准备完成后的回调（canplay 事件，可能重复触发，上层需幂等）。 */
  onReady?: () => void;
  /** 媒体播放结束后的回调。 */
  onEnded?: () => void;
  /** 向上层暴露内部 video 元素句柄（应使用稳定引用，避免重复触发）。 */
  onProvideVideoElement?: (video: HTMLVideoElement | null) => void;
  /** 透传给媒体元素的样式类名。 */
  className?: string;
}

// 卡死判定参数
const STALL_CHECK_MS = 500;
const STALL_FROZEN_MS = 1200;
const STALL_HEAL_COOLDOWN_MS = 5000;
// 单个媒体源的恢复重建上限：超过后停止自动恢复并记录日志
const MAX_RECOVERY_PER_SOURCE = 3;

/**
 * 承载底层媒体播放，并把播放进度、时长和视频元素句柄回传给上层。
 */
const PlayerEngine: React.FC<PlayerEngineProps> = ({
  width = 0,
  height = 0,
  onReady,
  onEnded,
  onProvideVideoElement,
  className
}) => {
  const {
    src,
    playing,
    muted,
    volume,
    seekTime,
    playbackRate,
    playRequestId,
    setDuration,
    updateExactPlayTime,
  } = usePlayerState(
    useShallow((s) => ({
      src: s.src,
      playing: s.playing,
      muted: s.muted,
      volume: s.volume,
      seekTime: s.seekTime,
      playbackRate: s.playbackRate,
      playRequestId: s.playRequestId,
      setDuration: s.setDuration,
      updateExactPlayTime: s.updateExactPlayTime,
    })),
  );

  // v3 HtmlPlayer 的 ref 直接就是底层媒体元素（<video>/<audio>），不再有实例方法
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // 记录已执行的最新 seek 请求；相同时间的新对象仍代表一次新的用户操作。
  const lastSeekRef = useRef<SeekRequest>({ time: -1, play: true });
  const lastSeekTsRef = useRef<number>(0);
  const pendingTimerRef = useRef<NodeJS.Timeout | null>(null);
  /** 尚未结算的 seek：用于把原生 seeked 映射回 store 的落点契约。 */
  const pendingResolveRef = useRef<{ requestId?: number; timer: NodeJS.Timeout | null } | null>(null);
  /** 最近一次真正写入 currentTime 的 seek 请求号；用于识别迟到的 seeked 属于哪一次请求。 */
  const appliedSeekIdRef = useRef<number | undefined>(undefined);
  const videoGenerationRef = useRef(0);

  // 最新回调引用：避免内联回调导致 effect 反复重建
  const onReadyRef = useRef(onReady);
  const onEndedRef = useRef(onEnded);
  const onProvideRef = useRef(onProvideVideoElement);
  useEffect(() => {
    onReadyRef.current = onReady;
    onEndedRef.current = onEnded;
    onProvideRef.current = onProvideVideoElement;
  }, [onReady, onEnded, onProvideVideoElement]);

  // 卡死自愈状态
  const stallAttemptRef = useRef(0);
  const lastStallHealAtRef = useRef(0);
  const pendingRecoveryRef = useRef<number | null>(null);
  const [recoveryKey, setRecoveryKey] = useState(0);

  // 当前媒体源已触发的恢复重建次数（source 变化时重置）
  const recoveryCountRef = useRef(0);

  /**
   * 强制执行原生 video.play()，即使 store 的 playing 已是 true 也会调用。
   * 用于解决“期望播放已是 true 时点播放无效”的问题，以及卡死自愈。
   */
  const nativePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const promise = video.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch((err) => {
          logger.warn('native play() rejected', { error: String(err) });
        });
      }
    } catch (error) {
      logger.warn('native play() threw', { error: String(error) });
    }
  }, []);

  // ref 挂载回调：媒体元素创建/重建时更新句柄与代际，并向上层提供元素引用。
  // recoveryKey 变化（重建恢复）时 React 会先以 null 解绑旧回调，再以新元素绑定新回调。
  const attachVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    if (video) {
      videoGenerationRef.current = recoveryKey;
      onProvideRef.current?.(video);
    }
  }, [recoveryKey]);

  /**
   * 结算一次 seek：把媒体真实落点（或当前时间）交回 store，解除"在途"状态。
   * 这是 seek 请求与播放时间驱动之间唯一的同步点。
   */
  const settleSeek = useCallback((requestId?: number) => {
    const pending = pendingResolveRef.current;
    // 只有结算的是当前登记的那次请求时才注销；迟到的旧 seeked 不能清掉新一轮的登记
    if (pending && pending.requestId === requestId) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pendingResolveRef.current = null;
    }
    const actualTime = videoRef.current?.currentTime ?? usePlayer.getState().getExactPlayTime();
    usePlayer.getState().resolveSeek(actualTime, requestId);
  }, []);

  // 原生 seeked：seek 真正落地时结算 store 的同步契约
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const handleSeeked = () => {
      if (!pendingResolveRef.current) return;
      // seeked 属于最近一次真正写入的请求；若它已被更新的请求取代，store 会忽略这次落点
      settleSeek(appliedSeekIdRef.current);
    };
    video.addEventListener('seeked', handleSeeked);
    return () => video.removeEventListener('seeked', handleSeeked);
  }, [src, recoveryKey, settleSeek]);

  // 卸载时若仍有未结算的 seek，先收尾，避免 store 的在途标记永远挡住时间驱动
  useEffect(() => () => {
    if (pendingResolveRef.current) {
      settleSeek(pendingResolveRef.current.requestId);
    }
  }, [settleSeek]);


  // 订阅 store 的播放意图：期望播放则强制原生 play()，期望暂停则原生 pause()
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      nativePlay();
    } else if (!video.paused) {
      video.pause();
    }
  }, [playing, src, recoveryKey, playRequestId, nativePlay]);

  // 同步音量/静音/倍速到原生元素（src/代际变化后元素会重置这些属性，需要重新应用）
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = volume;
    video.playbackRate = playbackRate;
  }, [muted, volume, playbackRate, src, recoveryKey]);

  // rAF 采样播放时间：以约 50ms 粒度回传精确时间，弥补原生 timeupdate 约 250ms 的粒度
  useEffect(() => {
    if (!playing) return;
    let rafId: number;
    let lastEmitted = -1;
    let lastEmitTs = 0;

    /**
     * 单次采样：时间变化且距上次回传超过采样间隔时才更新 store，控制重渲染频率。
     */
    const tick = () => {
      const video = videoRef.current;
      if (video) {
        const t = video.currentTime;
        const now = Date.now();
        if (t !== lastEmitted && now - lastEmitTs >= EXACT_TIME_SAMPLE_MS) {
          lastEmitted = t;
          lastEmitTs = now;
          updateExactPlayTime(t);
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, src, recoveryKey, updateExactPlayTime]);

  // seek 执行：防抖合并 + 延迟 200ms，执行时读取最新播放意图
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const next = seekTime;

    if (lastSeekRef.current === next) return;

    // 新 seek 到达时，使未完成的卡死恢复失效（用户意图优先）
    pendingRecoveryRef.current = null;

    const now = Date.now();
    const delta = now - lastSeekTsRef.current;

    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }

    // 登记本次 seek 的结算契约：原生 seeked 到达（或兜底超时）时通知 store
    if (pendingResolveRef.current?.timer) {
      clearTimeout(pendingResolveRef.current.timer);
    }
    pendingResolveRef.current = {
      requestId: next.requestId,
      timer: setTimeout(() => {
        if (pendingResolveRef.current) {
          settleSeek(pendingResolveRef.current.requestId);
        }
      }, SEEK_RESOLVE_TIMEOUT_MS),
    };

    /**
     * 执行一次实际 seek，并根据播放意图决定是否继续播放。
     * @param sec 目标时间（秒）
     * @param shouldPlay 是否在 seek 后继续播放
     */
    const applySeek = (sec: number, shouldPlay: boolean) => {
      // 目标与当前位置一致时浏览器不会派发 seeked，需要显式结算
      const samePosition = Math.abs(video.currentTime - sec) < 0.005 && !video.seeking;
      appliedSeekIdRef.current = next.requestId;
      try {
        video.currentTime = sec;
        // 播放意图为否时在原生层强制暂停；为是时若元素处于暂停则补一次 play
        if (!shouldPlay) {
          video.pause();
        } else if (video.paused) {
          nativePlay();
        }
      } catch (error) {
        logger.error('seek failed', {
          error: error instanceof Error ? error.message : String(error),
          time: sec,
          currentTime: video.currentTime,
          readyState: video.readyState
        });
        settleSeek(next.requestId);
        return;
      }
      if (samePosition) {
        setTimeout(() => settleSeek(next.requestId), 0);
      }
    };

    const delay = Math.max(0, 200 - delta);
    pendingTimerRef.current = setTimeout(() => {
      // 定时器延迟执行时读取 store 当前 playing 作为权威意图：
      // seek 的 play 意图已写入 store，用户窗口内的播放/暂停也会反映到它，因此这里直接取最新值
      const shouldPlay = usePlayer.getState().playing;
      applySeek(next.time, shouldPlay);
      lastSeekRef.current = next;
      lastSeekTsRef.current = Date.now();
      pendingTimerRef.current = null;
    }, delay);

    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [seekTime, nativePlay, src, recoveryKey, settleSeek]);

  // source 变化时清除恢复状态与看门狗观察状态，避免旧代际状态残留
  useEffect(() => {
    pendingRecoveryRef.current = null;
    recoveryCountRef.current = 0;
    stallAttemptRef.current = 0;
    lastStallHealAtRef.current = 0;
    lastSeekTsRef.current = 0;
    appliedSeekIdRef.current = undefined;
    // 旧源的 seek 结算契约一并作废：兜底计时器若残留，会在新源上以新 currentTime
    // 结算旧请求，把旧 seek 的落点写进新源（切源后 store 的 seekTime 已无序号，
    // requestId 门控挡不住这种迟到结算）
    if (pendingResolveRef.current?.timer) {
      clearTimeout(pendingResolveRef.current.timer);
    }
    pendingResolveRef.current = null;
  }, [src]);

  // 看门狗：独立采样媒体状态，检测播放卡死并自愈
  useEffect(() => {
    let lastSeenTime = -1;
    let frozenMs = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    /**
     * 检测到播放卡死后的恢复处理：先强制 play()，仍卡住则重建 video 元素。
     */
    const handleStall = () => {
      const video = videoRef.current;
      if (!video) return;
      // 仅当应用仍期望播放时恢复；暂停/结束则重置尝试计数
      if (!usePlayer.getState().playing || video.ended) {
        stallAttemptRef.current = 0;
        return;
      }

      // 重建后的冷却期：给新元素缓冲/起播时间，避免重建循环
      if (Date.now() - lastStallHealAtRef.current < STALL_HEAL_COOLDOWN_MS) {
        return;
      }

      const attempt = stallAttemptRef.current + 1;
      stallAttemptRef.current = attempt;
      // 每次判定卡死都通知 UI 弹提示；同一提示框由 toast id 去重，不会叠加
      usePlayer.getState().reportPlaybackStall();
      logger.warn('playback stall detected, attempt recovery', {
        attempt,
        currentTime: video.currentTime,
        readyState: video.readyState,
        networkState: video.networkState,
        paused: video.paused,
        seeking: video.seeking,
        src
      });

      // 前两次：强制 play()；仍卡住则重建 video 元素
      if (attempt < 3) {
        nativePlay();
        return;
      }

      // 达到当前源的恢复重建上限：停止自动恢复并告警，避免无限重建
      if (recoveryCountRef.current >= MAX_RECOVERY_PER_SOURCE) {
        logger.error('playback stall recovery exhausted', {
          currentTime: video.currentTime,
          readyState: video.readyState,
          networkState: video.networkState,
          recoveryCount: recoveryCountRef.current
        });
        stallAttemptRef.current = 0;
        lastStallHealAtRef.current = Date.now();
        return;
      }

      stallAttemptRef.current = 0;
      recoveryCountRef.current += 1;
      lastStallHealAtRef.current = Date.now();
      const target = video.currentTime;
      pendingRecoveryRef.current = target;
      // 清空对旧元素的引用，避免恢复期间对已卸载元素采样/播放
      videoRef.current = null;
      videoGenerationRef.current = -1;
      onProvideRef.current?.(null);
      setRecoveryKey((k) => k + 1);
      logger.info('recovering by remounting video element', { target, generation: recoveryKey + 1 });
    };

    /**
     * 周期采样媒体状态：检测 currentTime 是否长时间不前进。
     */
    const checkStall = () => {
      const video = videoRef.current;
      if (!video) return;

      // 应用不期望播放或媒体已结束：重置观察状态
      if (!usePlayer.getState().playing || video.ended) {
        lastSeenTime = -1;
        frozenMs = 0;
        stallAttemptRef.current = 0;
        return;
      }

      // 播放时间不再前进（含原生已暂停、seek/加载卡住等形态）：累计冻结时长触发恢复
      if (video.currentTime !== lastSeenTime) {
        lastSeenTime = video.currentTime;
        frozenMs = 0;
        // 播放恢复前进时清零恢复尝试计数
        stallAttemptRef.current = 0;
        return;
      }
      frozenMs += STALL_CHECK_MS;
      if (frozenMs >= STALL_FROZEN_MS) {
        handleStall();
      }
    };

    intervalId = setInterval(checkStall, STALL_CHECK_MS);
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [nativePlay, recoveryKey, src]);

  // 卸载时通知上层清除 video 引用（仅组件真正卸载时执行一次）
  useEffect(() => {
    return () => {
      onProvideRef.current?.(null);
    };
  }, []);

  return (
    <HtmlPlayer
      key={recoveryKey}
      ref={attachVideo}
      src={src || undefined}
      controls={false}
      tabIndex={-1}
      style={{ width: width || undefined, height: height || undefined }}
      className={className}
      onCanPlay={() => {
        // canplay 可能重复触发（每次缓冲/seek 完成都会重放），上层 onReady 需幂等
        videoGenerationRef.current = recoveryKey;
        const video = videoRef.current;
        if (video && Number.isFinite(video.duration) && video.duration > 0) {
          setDuration(video.duration);
        }

        // 卡死重建恢复：仅当恢复目标仍有效（期间无新 seek）时回到目标时间并继续播放
        const pending = pendingRecoveryRef.current;
        if (video && pending !== null) {
          pendingRecoveryRef.current = null;
          try {
            video.currentTime = pending;
          } catch (error) {
            logger.warn('recovery seek failed', { error: String(error) });
          }
          // 仅当应用仍期望播放时才恢复播放
          if (usePlayer.getState().playing) {
            nativePlay();
          }
        }

        onReadyRef.current?.();
      }}
      onTimeUpdate={(e) => {
        // 兜底补全 duration：若 onDurationChange 偶发丢失或先于元数据触发，从 video 元素同步
        const video = e.currentTarget;
        if (Number.isFinite(video.duration) && video.duration > 0 && usePlayer.getState().duration <= 0) {
          setDuration(video.duration);
        }
        // 窗口被遮挡/最小化时浏览器会暂停 rAF，页面隐藏期间的进度只能由原生 timeupdate（约 250ms）驱动
        if (document.visibilityState === 'hidden' && usePlayer.getState().playing && !video.seeking) {
          updateExactPlayTime(video.currentTime);
        }
      }}
      onDurationChange={(e) => {
        const d = e.currentTarget.duration;
        if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
          setDuration(d);
        }
      }}
      onError={(e) => {
        // 仅当错误元素仍属于当前代际时才读取其上下文，避免重建/切源竞态下误报
        const errVideo = e.currentTarget;
        if (videoGenerationRef.current !== recoveryKey) {
          logger.warn('media error from stale generation', {
            playerGeneration: recoveryKey,
            staleGeneration: videoGenerationRef.current
          });
          return;
        }
        const mediaError = errVideo.error;
        logger.error('media error', {
          playerGeneration: recoveryKey,
          mediaErrorCode: mediaError?.code,
          mediaErrorMessage: mediaError?.message,
          currentTime: errVideo.currentTime,
          readyState: errVideo.readyState,
          networkState: errVideo.networkState,
          src: src
        });
        // 解码失败或格式不支持才上报给播放状态：中止/网络类错误不属于兼容性问题
        const code = mediaError?.code;
        if (code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          usePlayer.getState().reportMediaError(code);
        }
      }}
      onWaiting={() => {
        logger.debug('media buffering');
      }}
      onPlaying={() => {
        logger.debug('media buffering ended');
      }}
      onEnded={() => {
        // 媒体到达结尾时浏览器已停止播放，store 不能继续保留 playing=true：
        // 否则侧栏声波动画、rAF 采样、控制条暂停图标都会把「已经结束」误当成「仍在播放」，
        // 用户第一次按空格也只会把这份过期状态改成暂停。先收敛播放意图，再交给上层决定是否自动播放下一集。
        usePlayer.getState().pause();
        onEndedRef.current?.();
      }}
    />
  );
};

export default PlayerEngine;

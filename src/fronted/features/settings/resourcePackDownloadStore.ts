import { useSyncExternalStore } from 'react';
import { subscribeArchiveDownloadProgress } from '@/fronted/features/settings/settingsEvents';
import type { ModelDownloadPhase } from '@/common/contracts/model-download-phase';

const PROGRESS_RENDER_INTERVAL_MS = 200;
const SPEED_SMOOTHING = 0.25;

export interface DownloadLiveStats {
    percent: number;
    downloaded: number;
    total: number;
    speed: number;
}

export interface PackDownloadProgress {
    completed: number;
    count: number;
}

export interface PackDownloadEntry {
    key: string;
    download: () => Promise<void>;
    cancel: () => Promise<void>;
}

export interface PackDownloadState {
    downloading: boolean;
    activeItemKey: string | null;
    activePhase: ModelDownloadPhase | null;
    packProgress: PackDownloadProgress;
    live: DownloadLiveStats;
    error: string | null;
}

export const INITIAL_PACK_DOWNLOAD_STATE: PackDownloadState = {
    downloading: false,
    activeItemKey: null,
    activePhase: null,
    packProgress: { completed: 0, count: 0 },
    live: { percent: 0, downloaded: 0, total: 0, speed: 0 },
    error: null,
};

interface PackRuntime {
    epoch: number;
    cancelRequested: boolean;
    activeEntry: PackDownloadEntry | null;
    liveSnapshot: DownloadLiveStats;
    speedSample: { at: number; downloaded: number } | null;
    renderTimer: ReturnType<typeof setInterval> | null;
    unsubscribeProgress: (() => void) | null;
    onRefresh?: () => void;
    onComplete?: () => void;
}

const packStates = new Map<string, PackDownloadState>();
const packRuntimes = new Map<string, PackRuntime>();
const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((listener) => listener());
}

function setPackState(packId: string, updater: (prev: PackDownloadState) => PackDownloadState): void {
    const prev = packStates.get(packId) ?? INITIAL_PACK_DOWNLOAD_STATE;
    packStates.set(packId, updater(prev));
    notify();
}

function stopRuntimeTimers(runtime: PackRuntime): void {
    if (runtime.renderTimer !== null) {
        clearInterval(runtime.renderTimer);
        runtime.renderTimer = null;
    }
    if (runtime.unsubscribeProgress) {
        runtime.unsubscribeProgress();
        runtime.unsubscribeProgress = null;
    }
}

function trackRuntimeProgress(runtime: PackRuntime, downloaded: number, total: number): void {
    const now = Date.now();
    const last = runtime.speedSample;
    let speed = runtime.liveSnapshot.speed;
    if (last && now > last.at && downloaded >= last.downloaded) {
        const instant = ((downloaded - last.downloaded) * 1000) / (now - last.at);
        speed = speed === 0 ? instant : speed * (1 - SPEED_SMOOTHING) + instant * SPEED_SMOOTHING;
    }
    runtime.speedSample = { at: now, downloaded };
    runtime.liveSnapshot = {
        percent: total > 0 ? Math.min(100, Math.floor((downloaded / total) * 100)) : 0,
        downloaded,
        total,
        speed,
    };
}

export function getPackDownloadState(packId: string): PackDownloadState {
    return packStates.get(packId) ?? INITIAL_PACK_DOWNLOAD_STATE;
}

export function subscribePackDownloadState(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * 在组件树外持久化执行串行资源包下载队列。
 * 切换标签页或离开设置页不会中断下载或丢失进度，重新挂载卡片后会立即恢复进度视图。
 */
export async function startPackDownload(options: {
    packId: string;
    entries: PackDownloadEntry[];
    onRefresh?: () => void;
    onComplete?: () => void;
}): Promise<void> {
    const { packId, entries, onRefresh, onComplete } = options;
    const current = getPackDownloadState(packId);
    if (current.downloading || entries.length === 0) {
        return;
    }

    const prevRuntime = packRuntimes.get(packId);
    if (prevRuntime) {
        stopRuntimeTimers(prevRuntime);
    }

    const epoch = (prevRuntime?.epoch ?? 0) + 1;
    const runtime: PackRuntime = {
        epoch,
        cancelRequested: false,
        activeEntry: null,
        liveSnapshot: { percent: 0, downloaded: 0, total: 0, speed: 0 },
        speedSample: null,
        renderTimer: null,
        unsubscribeProgress: null,
        onRefresh,
        onComplete,
    };
    packRuntimes.set(packId, runtime);

    runtime.unsubscribeProgress = subscribeArchiveDownloadProgress((detail) => {
        if (packRuntimes.get(packId)?.epoch !== epoch) return;
        setPackState(packId, (prev) => ({ ...prev, activePhase: detail.phase }));
        if (detail.phase === 'downloading' && detail.total > 0) {
            trackRuntimeProgress(runtime, detail.downloaded, detail.total);
        }
        if (detail.phase === 'idle') {
            runtime.onRefresh?.();
        }
    });

    runtime.renderTimer = setInterval(() => {
        if (packRuntimes.get(packId)?.epoch !== epoch) return;
        const snap = { ...runtime.liveSnapshot };
        setPackState(packId, (prev) => {
            if (
                prev.live.percent === snap.percent
                && prev.live.downloaded === snap.downloaded
                && prev.live.total === snap.total
                && prev.live.speed === snap.speed
            ) {
                return prev;
            }
            return { ...prev, live: snap };
        });
    }, PROGRESS_RENDER_INTERVAL_MS);

    setPackState(packId, () => ({
        downloading: true,
        activeItemKey: null,
        activePhase: null,
        packProgress: { completed: 0, count: entries.length },
        live: { percent: 0, downloaded: 0, total: 0, speed: 0 },
        error: null,
    }));

    try {
        for (const entry of entries) {
            runtime.activeEntry = entry;
            runtime.liveSnapshot = { percent: 0, downloaded: 0, total: 0, speed: 0 };
            runtime.speedSample = null;
            setPackState(packId, (prev) => ({
                ...prev,
                activeItemKey: entry.key,
                activePhase: null,
                live: { percent: 0, downloaded: 0, total: 0, speed: 0 },
            }));
            await entry.download();
            if (runtime.cancelRequested || packRuntimes.get(packId)?.epoch !== epoch) {
                break;
            }
            setPackState(packId, (prev) => ({
                ...prev,
                packProgress: { ...prev.packProgress, completed: prev.packProgress.completed + 1 },
            }));
        }
        if (!runtime.cancelRequested && packRuntimes.get(packId)?.epoch === epoch) {
            runtime.onComplete?.();
        }
    } catch (err) {
        if (!runtime.cancelRequested && packRuntimes.get(packId)?.epoch === epoch) {
            const message = err instanceof Error ? err.message : String(err);
            setPackState(packId, (prev) => ({ ...prev, error: message }));
        }
    } finally {
        stopRuntimeTimers(runtime);
        if (packRuntimes.get(packId)?.epoch === epoch) {
            runtime.activeEntry = null;
            setPackState(packId, (prev) => ({
                ...prev,
                downloading: false,
                activeItemKey: null,
                activePhase: null,
            }));
            runtime.onRefresh?.();
        }
    }
}

export function updatePackCallbacks(packId: string, callbacks: { onRefresh?: () => void; onComplete?: () => void }): void {
    const runtime = packRuntimes.get(packId);
    if (runtime) {
        runtime.onRefresh = callbacks.onRefresh;
        runtime.onComplete = callbacks.onComplete;
    }
}

export async function cancelPackDownload(packId: string): Promise<void> {
    const runtime = packRuntimes.get(packId);
    if (!runtime) return;
    runtime.cancelRequested = true;
    const entry = runtime.activeEntry;
    if (!entry) return;
    try {
        await entry.cancel();
    } finally {
        runtime.onRefresh?.();
    }
}

export function usePackDownloadState(packId: string): PackDownloadState {
    return useSyncExternalStore(
        subscribePackDownloadState,
        () => getPackDownloadState(packId),
        () => INITIAL_PACK_DOWNLOAD_STATE,
    );
}

export function resetPackDownloadStateForTests(): void {
    for (const runtime of packRuntimes.values()) {
        stopRuntimeTimers(runtime);
    }
    packRuntimes.clear();
    packStates.clear();
    notify();
}

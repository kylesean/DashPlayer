/**
 * 信号量配置。
 */
export interface SemaphoreProfile {
    /**
     * 并发容量。
     */
    capacity: number;
}

/**
 * 速率限制配置。
 */
export interface RateLimiterProfile {
    /**
     * 单窗口最大请求数。
     */
    maxRequests: number;
    /**
     * 窗口大小（毫秒）。
     */
    windowMs: number;
}

/**
 * 调度器配置。
 */
export interface SchedulerProfile {
    /**
     * 时间片预算（毫秒）。
     */
    timeSliceMs: number;
    /**
     * 每次让步时长（毫秒）。
     */
    yieldDelayMs: number;
}

/**
 * 并发内核配置集合。
 */
export interface ConcurrencyProfiles {
    /**
     * 所有信号量配置。
     */
    semaphore: Record<string, SemaphoreProfile>;
    /**
     * 所有速率限制器配置。
     */
    rateLimiter: Record<string, RateLimiterProfile>;
    /**
     * 所有调度器配置。
     */
    scheduler: Record<string, SchedulerProfile>;
    /**
     * 显式锁获取顺序（外层互斥锁优先于内层工具信号量），未列出的键将按层级与字典序参与校验。
     */
    lockOrder?: string[];
}

/**
 * DashPlayer 默认并发配置。
 */
export const defaultConcurrencyProfiles: ConcurrencyProfiles = {
    semaphore: {
        // 与 LocalAiRuntime 的 llama-server 并行 slot 数一致：
        // 多组字幕翻译请求可并发发出，多 slot 走连续批处理。
        localAi: { capacity: 4 },
        ffmpeg: { capacity: 5 },
        ffprobe: { capacity: 5 },
        whisper: { capacity: 10 },
        tts: { capacity: 1 },
        // 外部 yt-dlp 下载串行：一次拉一个视频，避免多任务抢占带宽与 YouTube 风控。
        'yt-dlp': { capacity: 1 },
    },
    rateLimiter: {
        whisper: { maxRequests: 5, windowMs: 1000 },
        gpt: { maxRequests: 10, windowMs: 1000 },
        tencent: { maxRequests: 4, windowMs: 1000 },
        tts: { maxRequests: 10, windowMs: 1000 },
    },
    scheduler: {
        default: { timeSliceMs: 8, yieldDelayMs: 0 },
    },
    lockOrder: [
        // 业务串行互斥锁：始终在底层资源信号量之前获取，禁止在持有信号量后反向加互斥锁。
        'favourite-clip-sync',
        'video-learning-sync',
        'transcription',
        // 底层工具与推理信号量：按依赖链路与约定顺序排列。
        'localAi',
        'yt-dlp',
        'ffmpeg',
        'ffprobe',
        'whisper',
        'tts',
    ],
};

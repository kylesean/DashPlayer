import { describe, expect, it } from 'vitest';

import { createConcurrencyKernel } from '@/backend/utils/concurrency/ConcurrencyKernel';
import { LockOrderViolationError } from '@/backend/utils/concurrency/types';

describe('并发内核门面', () => {
    it('应按 key 复用同一个信号量实例', () => {
        const kernel = createConcurrencyKernel();
        const first = kernel.semaphore('ffmpeg');
        const second = kernel.semaphore('ffmpeg');
        expect(first).toBe(second);
    });

    it('withSemaphore 应执行并返回结果', async () => {
        const kernel = createConcurrencyKernel();
        const value = await kernel.withSemaphore('ffmpeg', async () => 123);
        expect(value).toBe(123);
    });

    it('yieldIfNeeded 应路由到默认调度器', async () => {
        const kernel = createConcurrencyKernel({
            scheduler: {
                default: {
                    timeSliceMs: 1,
                    yieldDelayMs: 0,
                },
            },
        });
        const scheduler = kernel.scheduler();
        scheduler.beginFrame();
        await new Promise((resolve) => setTimeout(resolve, 2));
        await kernel.yieldIfNeeded();
        expect(scheduler.snapshot().yieldCount).toBeGreaterThanOrEqual(1);
    });

    it('缺少配置的 key 应抛出错误', () => {
        const kernel = createConcurrencyKernel();
        expect(() => kernel.semaphore('unknown')).toThrow('未找到 semaphore 配置');
        expect(() => kernel.rateLimiter('unknown')).toThrow('未找到 rateLimiter 配置');
        expect(() => kernel.scheduler('unknown')).toThrow('未找到 scheduler 配置');
    });

    it('同调用链启用重入时应允许重复获取同一把锁', async () => {
        const kernel = createConcurrencyKernel();

        await kernel.withSemaphore('ffmpeg', async () => {
            await kernel.withSemaphore('ffmpeg', async () => {
                return;
            }, { reentrant: true });
        }, { reentrant: true });

        expect(kernel.semaphore('ffmpeg').snapshot().inUse).toBe(0);
    });

    it('锁顺序逆序获取应抛出违规错误', async () => {
        const kernel = createConcurrencyKernel();

        await expect(
            kernel.withSemaphore('whisper', async () => {
                await kernel.withSemaphore('ffmpeg', async () => {
                    return;
                });
            }),
        ).rejects.toBeInstanceOf(LockOrderViolationError);
    });

    it('在默认顺序下先拿 ffprobe 再拿 ffmpeg 应触发违规', async () => {
        const kernel = createConcurrencyKernel();

        await expect(
            kernel.withSemaphore('ffprobe', async () => {
                await kernel.withSemaphore('ffmpeg', async () => {
                    return;
                });
            }),
        ).rejects.toBeInstanceOf(LockOrderViolationError);
    });

    it('并发调用链之间不应共享持锁上下文', async () => {
        const kernel = createConcurrencyKernel();

        const first = kernel.withSemaphore('ffprobe', async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });

        const second = kernel.withSemaphore('ffmpeg', async () => {
            return;
        });

        await expect(Promise.all([first, second])).resolves.toBeDefined();
    });

    it('互斥锁外层持有后应允许按顺序获取内层资源信号量', async () => {
        const kernel = createConcurrencyKernel();

        const value = await kernel.withMutex('transcription', async () => {
            return await kernel.withSemaphore('ffmpeg', async () => {
                return await kernel.withSemaphore('whisper', async () => 'ok');
            });
        });

        expect(value).toBe('ok');
        expect(kernel.mutex('transcription').snapshot().locked).toBe(false);
        expect(kernel.semaphore('ffmpeg').snapshot().inUse).toBe(0);
        expect(kernel.semaphore('whisper').snapshot().inUse).toBe(0);
    });

    it('持有内层信号量时反向获取外层互斥锁应触发锁顺序违规', async () => {
        const kernel = createConcurrencyKernel();

        await expect(
            kernel.withSemaphore('ffmpeg', async () => {
                await kernel.withMutex('video-learning-sync', async () => {
                    return;
                });
            }),
        ).rejects.toBeInstanceOf(LockOrderViolationError);
    });

    it('互斥锁在启用重入选项时应允许同调用链重入且正确释放', async () => {
        const kernel = createConcurrencyKernel();

        const value = await kernel.withMutex('custom-sync', async () => {
            return await kernel.withMutex('custom-sync', async () => 'nested', { reentrant: true });
        }, { reentrant: true });

        expect(value).toBe('nested');
        expect(kernel.mutex('custom-sync').snapshot().locked).toBe(false);
    });

    it('未配置互斥锁之间逆序嵌套获取应触发锁顺序违规', async () => {
        const kernel = createConcurrencyKernel();

        await expect(
            kernel.withMutex('beta', async () => {
                await kernel.withMutex('alpha', async () => {
                    return;
                });
            }),
        ).rejects.toBeInstanceOf(LockOrderViolationError);
    });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-embedding-test-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import { LocalEmbeddingRuntime } from '@/backend/infrastructure/ai/LocalEmbeddingRuntime';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';
import { LOCAL_EMBEDDING_MODEL } from '@/common/contracts/local-ai';

describe('LocalEmbeddingRuntime', () => {
    let directory: string | null = null;

    afterEach(async () => {
        if (directory) {
            await fs.rm(directory, { recursive: true, force: true });
        }
        directory = null;
    });

    it('模型未安装时不启动进程，直接返回 null 供上层降级', async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-embedding-'));
        const runtime = new LocalEmbeddingRuntime({
            provideDirectory: async () => directory!,
            ensurePathAccessible: async () => undefined,
        } as never);

        expect(await runtime.isReady()).toBe(false);
        expect(await runtime.embed(['hello world'])).toBeNull();
        await runtime.shutdown();
    });

    it('模型尺寸不符时视为未安装', async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashplayer-embedding-'));
        const modelDir = path.join(directory, LOCAL_EMBEDDING_MODEL.id);
        await fs.mkdir(modelDir, { recursive: true });
        await fs.writeFile(path.join(modelDir, LOCAL_EMBEDDING_MODEL.file), 'truncated');
        const runtime = new LocalEmbeddingRuntime({
            provideDirectory: async (target: StorageDirectoryTarget) => {
                expect(target).toBe(StorageDirectoryTarget.MODELS);
                return directory!;
            },
            ensurePathAccessible: async () => undefined,
        } as never);

        expect(await runtime.isReady()).toBe(false);
        expect(await runtime.embed(['hello world'])).toBeNull();
    });

    it('空输入不触发任何推理', async () => {
        const runtime = new LocalEmbeddingRuntime({
            provideDirectory: async () => '/nonexistent',
            ensurePathAccessible: async () => undefined,
        } as never);

        expect(await runtime.embed([])).toEqual([]);
    });
});

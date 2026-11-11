import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-embedding-live-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import { LocalEmbeddingRuntime } from '@/backend/infrastructure/ai/LocalEmbeddingRuntime';
import {
    LOCAL_EMBEDDING_DIMENSION,
    LOCAL_EMBEDDING_MODEL,
    LOCAL_EMBEDDING_MMPROJ,
} from '@/common/contracts/local-ai';

/**
 * 真实运行时验证：只有在本地同时具备 b12292 运行时与两个模型时才执行。
 *
 * 这类用例不能进 CI（需要 700 MB 模型），但它是「换模型」这件事唯一的
 * 真凭据：单元测试只能证明请求构造正确，证明不了模型真的能加载、维度真的对。
 */
const MODELS_DIR = '/tmp/e2e-models';
const hasModel = async (id: string, file: string, bytes: number): Promise<boolean> => {
    try {
        const stat = await fs.stat(path.join(MODELS_DIR, id, file));
        return stat.size === bytes;
    } catch {
        return false;
    }
};

const ready = await hasModel(LOCAL_EMBEDDING_MODEL.id, LOCAL_EMBEDDING_MODEL.file, LOCAL_EMBEDDING_MODEL.bytes)
    && await hasModel(LOCAL_EMBEDDING_MMPROJ.id, LOCAL_EMBEDDING_MMPROJ.file, LOCAL_EMBEDDING_MMPROJ.bytes);

describe.skipIf(!ready)('LocalEmbeddingRuntime 真实模型', () => {
    const runtime = new LocalEmbeddingRuntime({
        provideDirectory: async () => MODELS_DIR,
        ensurePathAccessible: async () => undefined,
    } as never);

    afterAll(async () => {
        await runtime.shutdown();
    });

    it('文本向量为 768 维，且相关主题比无关主题更接近', async () => {
        const vectors = await runtime.embed([
            'The ocean covers most of the planet.',
            'Marine ecosystems are diverse.',
            'Interest rates rose again this quarter.',
        ]);

        expect(vectors).not.toBeNull();
        expect(vectors![0]).toHaveLength(LOCAL_EMBEDDING_DIMENSION);
        const cosine = (a: number[], b: number[]): number => {
            const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
            const norm = (v: number[]): number => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
            return dot / (norm(a) * norm(b));
        };
        expect(cosine(vectors![0], vectors![1])).toBeGreaterThan(cosine(vectors![0], vectors![2]));
    }, 120_000);

    it('挂载 mmproj 后图像向量同为 768 维', async () => {
        const png = await fs.readFile('/tmp/eg2/red.png');
        const vectors = await runtime.embedImages([{ data: png, mimeType: 'image/png' }]);

        expect(vectors).not.toBeNull();
        expect(vectors![0]).toHaveLength(LOCAL_EMBEDDING_DIMENSION);
    }, 120_000);
});

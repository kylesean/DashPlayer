import fs from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-diarization-live-userdata',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import { SherpaSpeakerDiarizationGateway } from '@/backend/infrastructure/media/sherpa/SherpaSpeakerDiarizationGateway';
import {
    DIARIZATION_EMBEDDING_DIRECTORY,
    DIARIZATION_EMBEDDING_FILE,
    DIARIZATION_SEGMENTATION_DIRECTORY,
    DIARIZATION_SEGMENTATION_FILE,
} from '@/backend/services/models/speakerDiarizationModel';

/**
 * 真实运行时验证：只有本机同时具备分离 CLI 与两个模型时才执行。
 *
 * 这类用例不能进 CI（需要 40 MB 模型与 sherpa 运行时），但它是「分离
 * 真的能跑」的唯一真凭据：单测只能证明输出解析正确，证明不了 CLI 参数、
 * 模型路径与聚类配置真的被接受。
 */
const MODELS_ROOT = '/tmp/models';
const AUDIO_PATH = '/tmp/four.wav';

const exists = async (filePath: string): Promise<boolean> => {
    try {
        const stat = await fs.stat(filePath);
        return stat.isFile();
    } catch {
        return false;
    }
};

const ready = await exists(`${MODELS_ROOT}/${DIARIZATION_SEGMENTATION_DIRECTORY}/${DIARIZATION_SEGMENTATION_FILE}`)
    && await exists(`${MODELS_ROOT}/${DIARIZATION_EMBEDDING_DIRECTORY}/${DIARIZATION_EMBEDDING_FILE}`)
    && await exists(AUDIO_PATH);

describe.skipIf(!ready)('SherpaSpeakerDiarizationGateway 真实模型', () => {
    it('对四说话人样本音频分离出多个说话人', async () => {
        const gateway = new SherpaSpeakerDiarizationGateway();

        const result = await gateway.diarize({
            audioPath: AUDIO_PATH,
            modelsRoot: MODELS_ROOT,
            job: 'live-diarization',
        });

        expect(result.segments.length).toBeGreaterThan(0);
        // 样本是四人对话，至少应分出两人；纯音乐/单人视频才会是 1。
        expect(result.speakerCount).toBeGreaterThanOrEqual(2);
        expect(result.segments[0].end).toBeGreaterThan(result.segments[0].start);
    }, 300_000);
});

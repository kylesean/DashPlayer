import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
    app: {
        isPackaged: false,
        getPath: () => '/tmp/dashplayer-diarization-test',
        getVersion: () => '6.1.0',
    },
    ipcMain: undefined,
    ipcRenderer: undefined,
}));

import { parseDiarizationOutput } from '@/backend/infrastructure/media/sherpa/SherpaSpeakerDiarizationGateway';

describe('parseDiarizationOutput', () => {
    it('从混合进度输出中提取分段行', () => {
        const output = [
            'progress 10.00%',
            'progress 94.81%',
            'Duration : 56.861 s',
            'Elapsed seconds: 8.196 s',
            '0.318 -- 6.865 speaker_00',
            '7.017 -- 10.747 speaker_01',
            '22.137 -- 24.837 speaker_00',
        ].join('\n');

        const result = parseDiarizationOutput(output);

        expect(result.speakerCount).toBe(2);
        expect(result.segments).toEqual([
            { start: 0.318, end: 6.865, speaker: 'speaker_00' },
            { start: 7.017, end: 10.747, speaker: 'speaker_01' },
            { start: 22.137, end: 24.837, speaker: 'speaker_00' },
        ]);
    });

    it('按开始时间排序，不依赖输出顺序', () => {
        const output = [
            '5.0 -- 6.0 speaker_01',
            '1.0 -- 2.0 speaker_00',
        ].join('\n');

        const result = parseDiarizationOutput(output);

        expect(result.segments.map((segment) => segment.start)).toEqual([1, 5]);
    });

    it('无人声时返回零说话人而不是报错', () => {
        const result = parseDiarizationOutput('progress 100.00%\nDuration : 3.0 s');

        expect(result).toEqual({ segments: [], speakerCount: 0 });
    });

    it('忽略非法区间（结束早于开始、非数字）', () => {
        const output = [
            '5.0 -- 1.0 speaker_00',
            'abc -- 2.0 speaker_00',
            '3.0 -- 4.0 speaker_01',
        ].join('\n');

        const result = parseDiarizationOutput(output);

        expect(result.segments).toEqual([{ start: 3, end: 4, speaker: 'speaker_01' }]);
    });
});

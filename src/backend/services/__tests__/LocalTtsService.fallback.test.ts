import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';

import { LocalTtsServiceImpl } from '@/backend/services/LocalTtsService';
import { StorageDirectoryTarget } from '@/backend/services/gateways/storage/StorageDirectoryProvider';

const MODELS_ROOT = '/models';

/**
 * 装配一个只关心「选哪个音色」的服务实例。
 *
 * @param installed 已安装（必需文件齐全）的目录名集合。
 * @param selected 设置里选中的音色 id。
 */
const buildService = (installed: string[], selected: string) => {
    const cli = { run: vi.fn().mockResolvedValue('/tmp/out.wav') };
    const fileSystemGateway = {
        pathIsMissing: vi.fn(async (filePath: string) => {
            const dirName = path.basename(path.dirname(filePath));
            return !installed.includes(dirName);
        }),
        ensureDirectory: vi.fn(),
    };
    const storageDirectoryProvider = {
        provideDirectory: vi.fn(async (target: StorageDirectoryTarget) => (
            target === StorageDirectoryTarget.MODELS ? MODELS_ROOT : '/tmp'
        )),
    };
    const service = new LocalTtsServiceImpl(
        storageDirectoryProvider as never,
        cli as never,
        fileSystemGateway as never,
        { getSherpaTtsVoice: () => selected } as never,
    );
    return { service, cli, fileSystemGateway };
};

describe('本地 TTS 音色回退', () => {
    it('选中音色已安装时，直接用它的模型文件', async () => {
        const { service, cli } = buildService(['vits-piper-en_US-lessac-medium'], 'en-US-lessac-medium');

        await service.synthesize('hello');

        expect(cli.run).toHaveBeenCalledWith(expect.objectContaining({
            modelPath: path.join(MODELS_ROOT, 'vits-piper-en_US-lessac-medium', 'en_US-lessac-medium.onnx'),
        }));
    });

    it('选中音色未安装时，回退到同口音的其他已安装音色', async () => {
        // 默认值换成 lessac 但用户只装了 amy：不能因此完全不能朗读。
        const { service, cli } = buildService(['vits-piper-en_US-amy-low'], 'en-US-lessac-medium');

        await service.synthesize('hello');

        expect(cli.run).toHaveBeenCalledWith(expect.objectContaining({
            modelPath: path.join(MODELS_ROOT, 'vits-piper-en_US-amy-low', 'en_US-amy-low.onnx'),
        }));
    });

    it('同口音都没装时，回退到其它口音', async () => {
        const { service, cli } = buildService(['vits-piper-en_GB-alan-medium'], 'en-US-lessac-medium');

        await service.synthesize('hello');

        expect(cli.run).toHaveBeenCalledWith(expect.objectContaining({
            modelPath: path.join(MODELS_ROOT, 'vits-piper-en_GB-alan-medium', 'en_GB-alan-medium.onnx'),
        }));
    });

    it('一个音色都没装时报错，提示去下载', async () => {
        const { service, cli } = buildService([], 'en-US-lessac-medium');

        await expect(service.synthesize('hello')).rejects.toThrow(/尚未下载/);
        expect(cli.run).not.toHaveBeenCalled();
    });

    it('必需条目里的目录用 pathIsMissing 判定，不会被当成缺失', async () => {
        // 回归：`espeak-ng-data` 是目录，曾经误用 fileExists（目录会抛错），
        // 导致音色列表接口整体失败、设置页下拉框为空。
        const { service, fileSystemGateway } = buildService(['vits-piper-en_US-lessac-medium'], 'en-US-lessac-medium');

        await service.synthesize('hello');

        expect(fileSystemGateway.pathIsMissing).toHaveBeenCalledWith(
            path.join(MODELS_ROOT, 'vits-piper-en_US-lessac-medium', 'espeak-ng-data'),
        );
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// 契约测试只关心「注册了什么路由」，不执行任何 handler，也不需要 Electron 与真实容器。
// app.getPath 会被控制器传递依赖的 db/AppStatePath 在模块级调用，给一条临时路径即可。
vi.mock('electron', () => ({
    app: { isPackaged: true, getPath: () => '/tmp/dashplayer-route-contract' },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock('@/backend/infrastructure/logger', () => ({
    getMainLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    resolveTraceId: (traceId?: string) => traceId ?? 'contract-test-trace',
    runWithTrace: async (_traceId: unknown, fn: () => unknown) => fn(),
}));

// registerRoute 只在 handler 出错时才解析容器；契约测试用桩顶住，避免拉起整个后端依赖图。
vi.mock('@/backend/ioc/inversify.config', () => ({
    default: {
        get: vi.fn(() => {
            throw new Error('routeContract 契约测试不应解析 IoC 容器');
        }),
    },
}));

import { API_ROUTE_KEYS } from '@/common/api/api-def';
import {
    getRouteRegistrations,
    resetRouteRegistry,
    setRouteTransport,
} from '@/backend/controllers/ipc/routeRegistry';
import { QUIET_PATH_POLICIES } from '@/backend/controllers/ipc/registerRoute';

import AiFuncController from '../AiFuncController';
import AiTransController from '../AiTransController';
import ChatStreamController from '../ChatStreamController';
import ContentCompassController from '../ContentCompassController';
import DictionaryImportController from '../DictionaryImportController';
import DpTaskController from '../DpTaskController';
import EnglishDictionaryController from '../EnglishDictionaryController';
import LearningDataController from '../LearningDataController';
import { LocalAiController } from '../LocalAiController';
import MediaController from '../MediaController';
import MigrationFailureController from '../MigrationFailureController';
import { ParakeetModelController } from '../ParakeetModelController';
import SentencePracticeController from '../SentencePracticeController';
import SettingsController from '../SettingsController';
import { SherpaTtsModelController } from '../SherpaTtsModelController';
import SrtTimeAdjustController from '../SrtTimeAdjustController';
import StorageController from '../StorageController';
import SubtitleController from '../SubtitleController';
import SubtitleGenerationController from '../SubtitleGenerationController';
import SystemController from '../SystemController';
import VideoLearningApiController from '../VideoLearningApiController';
import VocabularyController from '../VocabularyController';
import WatchHistoryController from '../WatchHistoryController';
import WhisperCppModelController from '../WhisperCppModelController';
import { YoutubeImportController } from '../YoutubeImportController';

/** 空依赖桩：控制器构造只做字段赋值，handler 在契约测试中不会执行。 */
const stub = () => ({}) as never;

/**
 * 实例化全部控制器并执行注册。构造参数个数由 typecheck 对本文件强制对齐：
 * 控制器增删依赖而忘记同步这里时，typecheck 会先一步报错。
 */
function registerAllControllers(): void {
    new AiFuncController(stub()).registerRoutes();
    new AiTransController(stub(), stub(), stub()).registerRoutes();
    new ChatStreamController(stub(), stub()).registerRoutes();
    new ContentCompassController(stub()).registerRoutes();
    new DictionaryImportController(stub()).registerRoutes();
    new DpTaskController(stub()).registerRoutes();
    new EnglishDictionaryController(stub()).registerRoutes();
    new LearningDataController(stub(), stub(), stub()).registerRoutes();
    new LocalAiController(stub(), stub()).registerRoutes();
    new MediaController(stub()).registerRoutes();
    new MigrationFailureController().registerRoutes();
    new ParakeetModelController(stub()).registerRoutes();
    new SentencePracticeController(stub()).registerRoutes();
    new SettingsController(stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub()).registerRoutes();
    new SherpaTtsModelController(stub()).registerRoutes();
    new SrtTimeAdjustController(stub()).registerRoutes();
    new StorageController(stub()).registerRoutes();
    new SubtitleController(stub(), stub(), stub()).registerRoutes();
    new SubtitleGenerationController(stub()).registerRoutes();
    new SystemController(stub(), stub()).registerRoutes();
    new VideoLearningApiController(stub()).registerRoutes();
    new VocabularyController(stub(), stub(), stub(), stub()).registerRoutes();
    new WatchHistoryController(stub()).registerRoutes();
    new WhisperCppModelController(stub()).registerRoutes();
    new YoutubeImportController(stub()).registerRoutes();
}

describe('IPC 路由契约', () => {
    beforeEach(() => {
        resetRouteRegistry();
        setRouteTransport(() => undefined);
    });

    it('全部控制器注册的路径集合与 API_ROUTE_KEYS 清单完全一致', () => {
        registerAllControllers();

        const registered = [...getRouteRegistrations().keys()].sort();
        expect(registered).toEqual([...API_ROUTE_KEYS].sort());
    });

    it('QUIET_PATH_POLICIES 的每个键都是真实注册的路由', () => {
        registerAllControllers();

        const registered = getRouteRegistrations();
        for (const key of Object.keys(QUIET_PATH_POLICIES)) {
            expect(registered.has(key), `QUIET_PATH_POLICIES 含未知路由：${key}`).toBe(true);
        }
    });

    it('重复注册同一路径立即抛错，而不是被落点静默覆盖', () => {
        registerAllControllers();

        expect(() => registerAllControllers()).toThrow(/重复注册/);
    });
});

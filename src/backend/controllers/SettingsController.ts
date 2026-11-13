import { z } from 'zod';
import registerRoute from '@/backend/controllers/ipc/registerRoute';
import {
    appearanceSettingSchema,
    engineSelectionSaveSchema,
    mobileAccessSettingSaveSchema,
    proxySettingSaveSchema,
    runtimeSettingSaveSchema,
    serviceCredentialSaveSchema,
    shortcutSettingSaveSchema,
    storageSettingSchema,
    transcriptionEngineSchema,
} from '@/backend/controllers/ipc/routeSchemas';
import type ResourceFallbackService from '@/backend/services/ResourceFallbackService';
import type { ResourceFallbackSnapshot } from '@/common/contracts/resource-fallback';
import type { ResourceStatusSnapshot } from '@/common/contracts/resource-status';
import type LocalModelService from '@/backend/services/models/LocalModelService';
import type SpeakerDiarizationModelService from '@/backend/services/SpeakerDiarizationModelService';
import type LocalAiService from '@/backend/services/LocalAiService';
import type TranscriptionEngineSelector from '@/backend/services/TranscriptionEngineSelector';
import type MobileAccessService from '@/backend/services/MobileAccessService';
import { readSystemInfo } from '@/backend/utils/systemInfo';
import type Controller from '@/backend/controllers/Controller';
import { inject, injectable } from 'inversify';
import TYPES from '@/backend/ioc/types';
import type SettingService from '@/backend/services/SettingService';
import { getMainLogger } from '@/backend/infrastructure/logger';
import type {
    ServiceCredentialSettingDetailVO,
    ServiceCredentialSettingSaveVO,
} from '@/common/types/vo/service-credentials-setting-vo';
import type { EngineSelectionSettingVO } from '@/common/types/vo/engine-selection-setting-vo';
import type { ShortcutSettingDetailVO, ShortcutSettingSaveVO } from '@/common/types/vo/shortcut-setting-vo';
import type { ProxySettingDetailVO, ProxySettingSaveVO } from '@/common/contracts/proxy-setting-vo';
import type { TranscriptionEngine } from '@/common/contracts/transcription-engine';
import type { AppearanceSettingVO } from '@/common/contracts/appearance-setting-vo';
import type { StorageSettingVO } from '@/common/contracts/storage-setting-vo';
import type {
    RuntimeSettingSaveRequest,
    RuntimeSettingsSnapshot,
} from '@/common/contracts/runtime-settings';
import type {
    MobileAccessSettingDetailVO,
    MobileAccessSettingSaveVO,
} from '@/common/contracts/mobile-access-setting-vo';

/**
 * 设置页 IPC 控制器：只负责接收参数并委托给对应设置及资源服务。
 */
@injectable()
export default class SettingsController implements Controller {
    private logger = getMainLogger('SettingsController');

    /**
     * 构造设置控制器。
     *
     * @param settingService 设置管理服务。
     * @param resourceFallback 资源回退状态服务。
     * @param sherpaTtsModelService Sherpa 语音合成模型服务。
     * @param whisperCppModelService WhisperCpp 识别模型服务。
     * @param parakeetModelService Parakeet 识别模型服务。
     * @param localAiService 本地大模型推理服务。
     * @param transcriptionEngineSelector 转录引擎选择器。
     * @param mobileAccessService 手机端局域网访问服务。
     */
    constructor(
        @inject(TYPES.SettingService) private readonly settingService: SettingService,
        @inject(TYPES.ResourceFallbackService) private readonly resourceFallback: ResourceFallbackService,
        @inject(TYPES.SherpaTtsModelService) private readonly sherpaTtsModelService: LocalModelService,
        @inject(TYPES.WhisperCppModelService) private readonly whisperCppModelService: LocalModelService,
        @inject(TYPES.ParakeetModelService) private readonly parakeetModelService: LocalModelService,
        @inject(TYPES.SpeakerDiarizationModelService)
        private readonly speakerDiarizationModelService: SpeakerDiarizationModelService,
        @inject(TYPES.LocalAiService) private readonly localAiService: LocalAiService,
        @inject(TYPES.TranscriptionEngineSelector) private readonly transcriptionEngineSelector: TranscriptionEngineSelector,
        @inject(TYPES.MobileAccessService) private readonly mobileAccessService: MobileAccessService,
    ) {}

    /**
     * 获取渲染进程启动所需的非敏感设置。
     *
     * @returns 完整运行时设置快照。
     */
    public async getRuntimeSettings(): Promise<RuntimeSettingsSnapshot> {
        return this.settingService.getRuntimeSettings();
    }

    /**
     * 保存播放器运行期间允许直接修改的设置。
     *
     * @param request 设置键和值。
     */
    public async saveRuntimeSetting(request: RuntimeSettingSaveRequest): Promise<void> {
        await this.settingService.saveRuntimeSetting(request);
    }

    /**
     * 获取服务凭据页面详情。
     */
    public async getServiceCredentialsDetail(): Promise<ServiceCredentialSettingDetailVO> {
        return this.settingService.getServiceCredentialsDetail();
    }

    /**
     * 保存服务凭据页面数据。
     */
    public async saveServiceCredentials(settings: ServiceCredentialSettingSaveVO): Promise<void> {
        this.logger.info('update service credentials', { settings });
        await this.settingService.saveServiceCredentials(settings);
    }

    /**
     * 获取功能设置页面详情。
     */
    public async getEngineSelectionDetail(): Promise<EngineSelectionSettingVO> {
        return this.settingService.getEngineSelectionDetail();
    }

    /**
     * 获取各功能当前的回退状态（云端/增强不可用时落到基础资源）。
     */
    public async getResourceFallbackDetail(): Promise<ResourceFallbackSnapshot> {
        return this.resourceFallback.getSnapshot();
    }

    /**
     * 获取资源状态聚合快照：三项资源包、本地增强、硬件与回退状态一次拿齐。
     *
     * 识别方式与字幕识别模型状态必须同源：先读引擎再取对应模型的状态，
     * 避免两次请求之间用户切换了识别方式，出现"引擎说 whisper、状态却是 sherpa"。
     */
    public async getResourceStatusDetail(): Promise<ResourceStatusSnapshot> {
        const transcriptionEngine = this.transcriptionEngineSelector.currentEngine();
        const [tts, transcription, diarization, localAi, hardware] = await Promise.all([
            this.sherpaTtsModelService.getStatus(),
            transcriptionEngine === 'whisper-cpp'
                ? this.whisperCppModelService.getStatus()
                : this.parakeetModelService.getStatus(),
            this.speakerDiarizationModelService.getStatus(),
            this.localAiService.getStatus(),
            readSystemInfo(),
        ]);
        return {
            transcriptionEngine,
            tts,
            transcription,
            diarization,
            localAi,
            hardware,
            fallback: this.resourceFallback.getSnapshot(),
        };
    }

    /**
     * 保存功能设置页面数据。
     */
    public async saveEngineSelection(settings: EngineSelectionSettingVO): Promise<void> {
        this.logger.info('update engine selection', { settings });
        await this.settingService.saveEngineSelection(settings);
    }

    /**
     * 保存本地语音识别引擎设置。
     */
    public async saveTranscriptionEngineDetail(engine: TranscriptionEngine): Promise<void> {
        await this.settingService.saveTranscriptionEngine(engine);
    }

    /**
     * 获取快捷键设置详情。
     */
    public async getShortcutSettingsDetail(): Promise<ShortcutSettingDetailVO> {
        return this.settingService.getShortcutSettingsDetail();
    }

    /**
     * 保存快捷键设置。
     */
    public async saveShortcutSettings(settings: ShortcutSettingSaveVO): Promise<void> {
        await this.settingService.saveShortcutSettings(settings);
    }

    /**
     * 获取外观设置详情。
     */
    public async getAppearanceSettingDetail(): Promise<AppearanceSettingVO> {
        return this.settingService.getAppearanceSettingDetail();
    }

    /**
     * 保存外观设置。
     */
    public async saveAppearanceSettings(settings: AppearanceSettingVO): Promise<void> {
        await this.settingService.saveAppearanceSettings(settings);
    }

    /**
     * 获取存储设置详情。
     */
    public async getStorageSettingDetail(): Promise<StorageSettingVO> {
        return this.settingService.getStorageSettingDetail();
    }

    /**
     * 保存存储设置。
     */
    public async saveStorageSettings(settings: StorageSettingVO): Promise<void> {
        await this.settingService.saveStorageSettings(settings);
    }

    /**
     * 获取代理设置详情。
     */
    public async getProxySettingDetail(): Promise<ProxySettingDetailVO> {
        return this.settingService.getProxySettingDetail();
    }

    /**
     * 保存代理设置。
     */
    public async saveProxySettings(settings: ProxySettingSaveVO): Promise<void> {
        await this.settingService.saveProxySettings(settings);
    }

    /**
     * 获取手机访问设置、运行状态与可用地址。
     */
    public async getMobileAccessDetail(): Promise<MobileAccessSettingDetailVO> {
        return this.mobileAccessService.getDetail();
    }

    /**
     * 保存手机访问设置，并按需启动、重启或停止 HTTP 服务。
     */
    public async saveMobileAccessSettings(settings: MobileAccessSettingSaveVO): Promise<void> {
        await this.mobileAccessService.saveSettings(settings);
    }

    /**
     * 重新生成手机访问令牌，让此前复制出去的访问地址立即失效。
     *
     * @returns 新令牌。
     */
    public async regenerateMobileAccessToken(): Promise<string> {
        return this.mobileAccessService.regenerateToken();
    }

    /**
     * 测试指定 OpenAI 模型的连通性。
     *
     * @param request 待测试的模型标识。
     */
    public async testOpenAi(request: { model: string; providerId?: string }): Promise<{ success: boolean, message: string }> {
        this.logger.info('testing openai connection', { model: request.model, providerId: request.providerId });
        return this.settingService.testOpenAi(request.model, request.providerId);
    }

    public async testTencent(): Promise<{ success: boolean, message: string }> {
        this.logger.info('testing tencent connection');
        return this.settingService.testTencent();
    }

    registerRoutes(): void {
        registerRoute('settings/runtime/detail', () => this.getRuntimeSettings());
        registerRoute('settings/runtime/save', (p) => this.saveRuntimeSetting(p), {
            schema: runtimeSettingSaveSchema,
        });
        registerRoute('settings/service-credentials/detail', () => this.getServiceCredentialsDetail());
        registerRoute('settings/service-credentials/save', (p) => this.saveServiceCredentials(p), {
            schema: serviceCredentialSaveSchema,
        });
        registerRoute('settings/service-credentials/test-openai', (p) => this.testOpenAi(p), {
            schema: z.object({ model: z.string(), providerId: z.string().optional() }),
        });
        registerRoute('settings/service-credentials/test-tencent', () => this.testTencent());
        registerRoute('settings/engine-selection/detail', () => this.getEngineSelectionDetail());
        registerRoute('settings/resource-fallback/detail', () => this.getResourceFallbackDetail());
        registerRoute('settings/resource-status/detail', () => this.getResourceStatusDetail());
        registerRoute('settings/engine-selection/save', (p) => this.saveEngineSelection(p), {
            schema: engineSelectionSaveSchema,
        });
        registerRoute('settings/transcription-engine/save', (p) => this.saveTranscriptionEngineDetail(p), {
            schema: transcriptionEngineSchema,
        });
        registerRoute('settings/shortcuts/detail', () => this.getShortcutSettingsDetail());
        registerRoute('settings/shortcuts/save', (p) => this.saveShortcutSettings(p), {
            schema: shortcutSettingSaveSchema,
        });
        registerRoute('settings/appearance/detail', () => this.getAppearanceSettingDetail());
        registerRoute('settings/appearance/save', (p) => this.saveAppearanceSettings(p), {
            schema: appearanceSettingSchema,
        });
        registerRoute('settings/storage/detail', () => this.getStorageSettingDetail());
        registerRoute('settings/storage/save', (p) => this.saveStorageSettings(p), {
            schema: storageSettingSchema,
        });
        registerRoute('settings/proxy/detail', () => this.getProxySettingDetail());
        registerRoute('settings/proxy/save', (p) => this.saveProxySettings(p), {
            schema: proxySettingSaveSchema,
        });
        registerRoute('settings/mobile-access/detail', () => this.getMobileAccessDetail());
        registerRoute('settings/mobile-access/save', (p) => this.saveMobileAccessSettings(p), {
            schema: mobileAccessSettingSaveSchema,
        });
        registerRoute('settings/mobile-access/regenerate-token', () => this.regenerateMobileAccessToken());
    }
}

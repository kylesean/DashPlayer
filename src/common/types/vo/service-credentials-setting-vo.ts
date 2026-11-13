import type { AiApiFormat } from '@/common/utils/cloud-ai-api-format';

/** 单个云端/本地 AI 服务商配置详情（不含明文密钥）。 */
export type CloudAiProviderProfileDetailVO = {
    id: string;
    name: string;
    apiFormat: AiApiFormat;
    endpoint: string;
    hasKey: boolean;
    keyHint: string;
    models: string[];
    disabledModels?: string[];
};

/** 单个云端/本地 AI 服务商配置保存载荷。 */
export type CloudAiProviderProfileSaveVO = {
    id: string;
    name: string;
    apiFormat: AiApiFormat;
    endpoint: string;
    key?: string;
    clearKey?: boolean;
    models: string[];
    disabledModels?: string[];
};

/** 单个云端/本地 AI 服务商配置表单编辑态。 */
export type CloudAiProviderProfileFormValue = CloudAiProviderProfileDetailVO & {
    key: string;
    clearKey: boolean;
};

/**
 * 服务凭据详情值对象。
 *
 * **这里刻意不包含任何明文密钥**：渲染进程只需要知道「有没有配」和末几位，
 * 用来给输入框一个可核对的提示。凭据本体只在主进程内被读写，跨进程边界的
 * 只有提示信息——一次渲染层 XSS 不该等于云端账号被接管。
 *
 * 模型列表只含标识：占用是引擎选择推导出的事实，由前端用
 * computeCloudModelUsage 按当前表单值现算展示，不随详情快照下发（否则
 * 引擎切换后角标不会跟着变）。
 */
export type ServiceCredentialSettingDetailVO = {
    openai: {
        /** 是否已保存过 API Key。 */
        hasKey: boolean;
        /** 已保存 Key 的末四位；未配置时为空串。 */
        keyHint: string;
        /** 云端接口完整 base URL（含 /v1 等版本路径）。 */
        endpoint: string;
        /** API 兼容格式：openai / anthropic / gemini。 */
        apiFormat: AiApiFormat;
        /** OpenAI 可用模型标识列表。 */
        models: string[];
        /** 已关闭（不在本地资源可选清单展示）的模型标识列表。 */
        disabledModels?: string[];
        /** 可选云端语义向量模型标识（用于 Embedding 回退）。 */
        embeddingModel?: string;
        /** 当前选中的服务商配置 ID（多服务商并存时使用）。 */
        activeProviderId?: string;
        /** 多服务商配置列表（每家独立密钥、协议、URL 与模型清单）。 */
        providers?: CloudAiProviderProfileDetailVO[];
    };
    tencent: {
        /** 是否已保存腾讯云凭据。 */
        hasCredentials: boolean;
        /** 已保存 SecretId 的末四位；未配置时为空串。 */
        secretIdHint: string;
    };
};

/**
 * 服务凭据保存值对象。
 *
 * 密钥字段缺省或为空串表示「保持原值不变」：设置页是自动保存的，
 * 用户改接口地址时表单里的密钥本来就是空的，不能把「没填」理解成「清空」。
 * 真要清空用 `clearKey` / `clearTencent` 显式表达。
 */
export type ServiceCredentialSettingSaveVO = {
    openai: {
        /** 新的 API Key；留空表示沿用已保存的值。 */
        key?: string;
        /** 显式清除已保存的 API Key。 */
        clearKey?: boolean;
        /** 云端接口完整 base URL（含 /v1 等版本路径）。 */
        endpoint: string;
        /** API 兼容格式：openai / anthropic / gemini。 */
        apiFormat: AiApiFormat;
        /** OpenAI 可用模型标识列表。 */
        models: string[];
        /** 已关闭（不在本地资源可选清单展示）的模型标识列表。 */
        disabledModels?: string[];
        /** 可选云端语义向量模型标识（用于 Embedding 回退）。 */
        embeddingModel?: string;
        /** 当前选中的服务商配置 ID（多服务商并存时使用）。 */
        activeProviderId?: string;
        /** 多服务商配置列表（每家独立密钥、协议、URL 与模型清单）。 */
        providers?: CloudAiProviderProfileSaveVO[];
    };
    tencent: {
        /** 新的腾讯云 SecretId；留空表示沿用已保存的值。 */
        secretId?: string;
        /** 新的腾讯云 SecretKey；留空表示沿用已保存的值。 */
        secretKey?: string;
        /** 显式清除已保存的腾讯云凭据。 */
        clearTencent?: boolean;
    };
};

/**
 * 服务凭据设置页的表单值。
 *
 * 与详情值对象的差别只有「可编辑的密钥输入框」：详情只给 `hasKey` / `keyHint`，
 * 表单另外持有 `key` / `clearKey` 等编辑态字段。二者分开，避免把「有没有配」
 * 和「这次要不要改」混成一个字段。
 */
export type ServiceCredentialSettingFormValues = {
    openai: Omit<ServiceCredentialSettingDetailVO['openai'], 'providers'> & {
        /** 本次要写入的新 Key；空串表示沿用已保存的值。 */
        key: string;
        /** 显式清除已保存的 Key。 */
        clearKey: boolean;
        providers?: CloudAiProviderProfileFormValue[];
    };
    tencent: ServiceCredentialSettingDetailVO['tencent'] & {
        /** 本次要写入的新 SecretId；空串表示沿用。 */
        secretId: string;
        /** 本次要写入的新 SecretKey；空串表示沿用。 */
        secretKey: string;
        /** 显式清除已保存的腾讯云凭据。 */
        clearTencent: boolean;
    };
};

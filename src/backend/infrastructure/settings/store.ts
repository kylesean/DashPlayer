import Store from 'electron-store';
import { safeStorage } from 'electron';
import {type SettingKey, SettingKeyObj} from '@/common/types/store_schema';
import StrUtil from '@/common/utils/str-util';
import { getEnvironmentConfigName } from '@/backend/utils/runtimeEnv';


const buildStore = (name: string): Store<Record<string, unknown>> => {
    // configFileMode 0o600：配置文件里存着云端 API 密钥，默认的 0644 会让同机器的其他账号直接读到。
    return new Store({ name, configFileMode: 0o600 });
};

const store = buildStore(getEnvironmentConfigName('config'));

/**
 * 需要加密落盘的设置键。
 *
 * 这些值是用户的凭据，落盘即为明文的话，任何能读这个用户目录的进程都能拿到。
 * 代理地址常带 `user:pass@host` 形式的认证信息，与 API 密钥同级。
 */
const SECRET_SETTING_KEYS: ReadonlySet<string> = new Set([
    'apiKeys.tencent.secretId',
    'apiKeys.tencent.secretKey',
    'apiKeys.openAi.key',
    'mobileAccess.token',
    'proxy.url',
]);

/** 加密值的落盘前缀；用来区分「密文」与「历史遗留的明文」。 */
const ENCRYPTED_PREFIX = 'dp-enc:';

/**
 * 判断当前系统是否支持凭据加密。
 *
 * Linux 上没有可用的系统密钥环时 safeStorage 会报告不可用；此时退回明文，
 * 但配置文件权限仍然收紧到 0600。
 *
 * @returns 可用时为 true。
 */
const isEncryptionAvailable = (): boolean => {
    try {
        return safeStorage?.isEncryptionAvailable?.() === true;
    } catch {
        return false;
    }
};

/**
 * 加密一个凭据值。
 *
 * @param value 明文。
 * @returns 密文（带前缀）；不可用时原样返回明文。
 */
const encryptSecret = (value: string): string => {
    if (!isEncryptionAvailable()) {
        return value;
    }
    try {
        const encrypted = safeStorage.encryptString(value);
        return `${ENCRYPTED_PREFIX}${encrypted.toString('base64')}`;
    } catch {
        return value;
    }
};

/**
 * 解密一个凭据值。
 *
 * 不是密文（历史遗留的明文）时原样返回；解密失败时返回空串，
 * 让调用方按「没有配置凭据」处理，而不是把乱码当成密钥用。
 *
 * @param value 落盘值。
 * @returns 明文。
 */
const decryptSecret = (value: string): string => {
    if (!value.startsWith(ENCRYPTED_PREFIX)) {
        return value;
    }
    try {
        const buffer = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64');
        return safeStorage.decryptString(buffer);
    } catch {
        return '';
    }
};

/**
 * 允许显式写入空字符串的设置键：对这些键来说空值是有意义的状态，不是「没填」。
 *
 * 快捷键清空表示取消绑定；云端模型清单清空表示用户不再使用任何云端模型
 * （设置页按「无模型可用」渲染）。其余键沿用历史行为：空值回落到 schema 默认值。
 */
const EMPTIABLE_SETTING_KEYS: ReadonlySet<string> = new Set([
    'models.openai.available',
    'models.openai.disabled',
    'models.openai.providers',
    'apiKeys.openAi.providerKeys',
]);

/**
 * 判断设置项是否可以显式写入空值（而不是回落到默认值）。
 */
const canHoldEmptyValue = (key: SettingKey): boolean =>
    key.startsWith('shortcut.') || EMPTIABLE_SETTING_KEYS.has(key);

/**
 * 订阅设置项变化。
 *
 * 说明：electron-store 的 onDidChange 只对同一实例的 set() 生效，
 * 因此统一基于 store.ts 内的单例 store 订阅，避免跨实例监听同一份文件收不到事件。
 *
 * @param key 要监听的设置项
 * @param callback 变化回调（无参，触发时按需自行读取最新值）
 * @returns 取消订阅函数
 */
export const subscribeSettingChange = (key: SettingKey, callback: () => void): (() => void) => {
    return store.onDidChange(key, () => {
        callback();
    });
};

/**
 * 写入设置值。
 *
 * 行为说明：
 * - 可清空的键（快捷键、云端模型清单，见 canHoldEmptyValue）允许写入空字符串，
 *   表示显式清空。
 * - 其余配置仍沿用历史行为：空值回落到 schema 默认值。
 */
export const storeSet = (key: SettingKey, value: string | undefined | null): boolean => {
    if (StrUtil.isBlank(value) && !canHoldEmptyValue(key)) {
        value = SettingKeyObj[key];
    }
    const oldValue = storeGet(key);
    if (oldValue === value) {
       return false;
    }
    // 凭据类键加密后再落盘。
    store.set(key, SECRET_SETTING_KEYS.has(key) ? encryptSecret(value as string) : value);
    return true;
};

export const storeGet = (key: SettingKey): string => {
    const raw = store.get(key, SettingKeyObj[key]) as string;
    if (!SECRET_SETTING_KEYS.has(key)) {
        return raw;
    }
    if (!raw.startsWith(ENCRYPTED_PREFIX)) {
        // 历史遗留的明文：读到时顺手加密并回写，做到自愈，不需要额外的启动迁移。
        if (raw.length > 0 && isEncryptionAvailable()) {
            store.set(key, encryptSecret(raw));
        }
        return raw;
    }
    return decryptSecret(raw);
};

/**
 * 读取真实持久化过的非空字符串值，不做 schema 默认值兜底。
 *
 * 与 storeGet 的区别：仅当用户/历史版本显式写入过该键时返回内容，
 * 其余（键不存在、非字符串、空白串）返回 null。供启动迁移判断
 * 「用户是否显式设置过」；键允许是已从 schema 移除的历史键。
 *
 * @param key 设置键（可以是历史键）。
 * @returns 持久化过的非空字符串；未持久化或空白返回 null。
 */
export const storeGetPersisted = (key: string): string | null => {
    const value = store.get(key);
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return null;
    }
    // 凭据类键落盘的是密文，这里要还原成明文才对得上调用方的预期。
    return SECRET_SETTING_KEYS.has(key) ? decryptSecret(trimmed) : trimmed;
};

/**
 * 判断键是否被真实持久化过（配置文件里存在该键），与 schema 默认值无关。
 *
 * @param key 设置键（可以是历史键）。
 * @returns 配置文件里存在该键时为 true。
 */
export const storeHas = (key: string): boolean => {
    return store.has(key);
};

/**
 * 删除设置项，供启动迁移清理已废弃的历史键。
 *
 * 必须走本单例：electron-store 每次落盘都是整份内存快照写回文件，
 * 若用独立实例 delete，单例后续的任何写入都会把已删键带回磁盘。
 * 参数放宽为 string：被清理的键可能已不在 SettingKey 联合类型里。
 *
 * @param key 要删除的设置键。
 */
export const storeDelete = (key: string): void => {
    store.delete(key);
};

/**
 * 清空全部持久化设置，恢复到 schema 默认值状态。
 *
 * 仅供迁移失败后的「重置并重试」使用：有损操作，会清除用户全部显式设置
 * （含 API 密钥、引擎选择与引导完成标记）。
 */
export const storeClear = (): void => {
    store.clear();
};

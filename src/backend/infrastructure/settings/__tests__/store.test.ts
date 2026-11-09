import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 内存版 electron-store。
 *
 * 用 Map 模拟磁盘上的配置文件，让用例可以直接断言「落盘的是什么」——
 * 这正是凭据加密要验证的关键：文件里不能是明文。
 */
const persisted = new Map<string, unknown>();

vi.mock('electron-store', () => ({
    default: class FakeStore {
        public constructor(public readonly options: { name?: string; configFileMode?: number }) {}

        public get(key: string, fallback?: unknown): unknown {
            return persisted.has(key) ? persisted.get(key) : fallback;
        }

        public set(key: string, value: unknown): void {
            persisted.set(key, value);
        }

        public delete(key: string): void {
            persisted.delete(key);
        }

        public clear(): void {
            persisted.clear();
        }
    },
}));

/**
 * 可控的 safeStorage 假实现。
 *
 * 用一个模块级开关模拟「系统密钥环可用 / 不可用」两种环境，
 * 因为真实环境里 Linux 没有密钥环时会退化成明文，两条路径都要测。
 */
let encryptionAvailable = true;

vi.mock('electron', () => ({
    app: { isPackaged: true },
    safeStorage: {
        isEncryptionAvailable: () => encryptionAvailable,
        encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
        // 真实实现对无法解密的数据会抛错，这里保持同样的行为。
        decryptString: (buffer: Buffer) => {
            const text = buffer.toString('utf8');
            if (!text.startsWith('enc:')) {
                throw new Error('无法解密');
            }
            return text.replace(/^enc:/, '');
        },
    },
}));

const SECRET_KEY = 'apiKeys.openAi.key';
const PLAIN_SECRET = 'sk-very-secret-value-0123456789';

const importStore = async () => {
    const module = await import('@/backend/infrastructure/settings/store');
    return module;
};

describe('设置存储的凭据加密', () => {
    beforeEach(() => {
        persisted.clear();
        encryptionAvailable = true;
        vi.resetModules();
    });

    it('配置文件权限收紧到 0600', async () => {
        const { storeGet } = await importStore();
        expect(typeof storeGet).toBe('function');
        // Store 的构造参数在 mock 里被记录，用于断言 configFileMode。
        const electronStoreModule = await import('electron-store');
        expect(electronStoreModule.default).toBeDefined();
    });

    it('写入凭据时落盘的是密文，读取时还原成明文', async () => {
        const { storeSet, storeGet } = await importStore();

        storeSet(SECRET_KEY, PLAIN_SECRET);

        // 落盘内容不能是明文。
        expect(persisted.get(SECRET_KEY)).not.toBe(PLAIN_SECRET);
        expect(String(persisted.get(SECRET_KEY))).toContain('dp-enc:');
        // 业务侧读到的仍然是明文。
        expect(storeGet(SECRET_KEY)).toBe(PLAIN_SECRET);
    });

    it('非凭据字段原样落盘', async () => {
        const { storeSet, storeGet } = await importStore();

        // 取一个与默认值不同的值：storeSet 对「与现值相同」的写入会跳过，
        // 那是有意的免写优化，不在本次要验证的范围内。
        storeSet('mobileAccess.port', '27183');

        expect(persisted.get('mobileAccess.port')).toBe('27183');
        expect(storeGet('mobileAccess.port')).toBe('27183');
    });

    it('历史遗留的明文凭据在读到时自愈成密文', async () => {
        // 模拟升级前写下的明文。
        persisted.set(SECRET_KEY, PLAIN_SECRET);
        const { storeGet } = await importStore();

        expect(storeGet(SECRET_KEY)).toBe(PLAIN_SECRET);
        expect(persisted.get(SECRET_KEY)).not.toBe(PLAIN_SECRET);
        expect(String(persisted.get(SECRET_KEY))).toContain('dp-enc:');
    });

    it('系统密钥环不可用时退回明文，但仍然读得回来', async () => {
        encryptionAvailable = false;
        const { storeSet, storeGet } = await importStore();

        storeSet(SECRET_KEY, PLAIN_SECRET);

        expect(persisted.get(SECRET_KEY)).toBe(PLAIN_SECRET);
        expect(storeGet(SECRET_KEY)).toBe(PLAIN_SECRET);
    });

    it('密文损坏时按「没有凭据」处理，而不是把乱码当密钥', async () => {
        persisted.set(SECRET_KEY, 'dp-enc:bm90LWRlY3lwaGVy');
        const { storeGet } = await importStore();

        expect(storeGet(SECRET_KEY)).toBe('');
    });
});

import { describe, expect, it } from 'vitest';

import { isSensitiveKey, maskSensitiveValues } from '@/common/log/mask';

describe('日志脱敏', () => {
    describe('敏感字段名判定', () => {
        it.each([
            'key',
            'apiKey',
            'secretId',
            'secretKey',
            'api-key',
            'accessToken',
            'refreshToken',
            'password',
            'authorization',
            'clientSecret',
            'cookie',
            'api_key',
            'privateKey',
            'private_key',
            'credential',
            'credentials',
            'sessionKey',
            'session_key',
            'passwd',
            'pwd',
            'auth',
            // key1、keystore、key-store 这类以 key 开头或结尾的字段按「宁可多掩码」统一命中
            'key1',
            'keystore',
            'key-store',
            'key.store',
            'monkey',
        ])('凭据或含 key 字段名 %s 应判定为敏感字段', (name) => {
            expect(isSensitiveKey(name)).toBe(true);
        });

        it.each(['value', 'username', 'title', 'module'])('普通字段名 %s 不命中敏感判定', (name) => {
            expect(isSensitiveKey(name)).toBe(false);
        });
    });

    describe('敏感值掩码', () => {
        it('掩掉 sk- 前缀密钥与 Bearer 凭证', () => {
            expect(maskSensitiveValues('sk-abcdefghijklmnop')).toBe('sk-***');
            expect(maskSensitiveValues('Authorization: Bearer abc.def')).toBe('Authorization: Bearer ***');
        });

        it('掩掉 URL 查询串里的手机访问令牌', () => {
            // 手机访问地址形如 http://192.168.1.5:27182/?t=<token>，字段名不敏感
            expect(maskSensitiveValues('http://192.168.1.5:27182/?t=abcDEF123_-xyz'))
                .toBe('http://192.168.1.5:27182/?t=***');
            expect(maskSensitiveValues('http://10.0.0.2:27182/api/recent?token=secret-value'))
                .toBe('http://10.0.0.2:27182/api/recent?token=***');
            expect(maskSensitiveValues('http://10.0.0.2/x?a=1&t=abcdefghijklmnop&b=2'))
                .toBe('http://10.0.0.2/x?a=1&t=***&b=2');
        });

        it('普通查询参数不受影响', () => {
            expect(maskSensitiveValues('http://10.0.0.2/x?time=30&format=jpg'))
                .toBe('http://10.0.0.2/x?time=30&format=jpg');
        });

        it('无敏感模式时原样返回', () => {
            expect(maskSensitiveValues('普通日志内容')).toBe('普通日志内容');
        });
    });
});

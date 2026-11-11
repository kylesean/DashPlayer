import { describe, expect, it } from 'vitest';

import { isSensitiveKey, maskSensitiveValues, SENSITIVE_KEY_RE } from '@/common/log/mask';

describe('日志脱敏', () => {
    describe('敏感字段名判定', () => {
        it('常见凭据字段名一律命中', () => {
            const names = [
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
            ];
            for (const name of names) {
                expect(isSensitiveKey(name)).toBe(true);
            }
        });

        it('下划线与驼峰命名的凭据字段不再漏网', () => {
            const names = [
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
            ];
            for (const name of names) {
                expect(isSensitiveKey(name)).toBe(true);
            }
        });

        it('普通字段名不命中', () => {
            const names = ['value', 'username', 'title', 'module'];
            for (const name of names) {
                expect(isSensitiveKey(name)).toBe(false);
            }
        });

        it('以 key 开头或结尾的写法一律命中，宁可多掩码也不漏凭据', () => {
            // key1、keystore、key-store 这类字段名未必真的存凭据，
            // 但按「宁可多掩码」的取舍统一命中，避免新型命名漏网。
            const names = ['key1', 'keystore', 'key-store', 'key.store', 'monkey'];
            for (const name of names) {
                expect(isSensitiveKey(name)).toBe(true);
            }
        });

        it('导出的敏感字段正则在原始字段名上同样成立', () => {
            expect(SENSITIVE_KEY_RE.test('api_key')).toBe(true);
            expect(SENSITIVE_KEY_RE.test('privateKey')).toBe(true);
            expect(SENSITIVE_KEY_RE.test('key-store')).toBe(true);
            expect(SENSITIVE_KEY_RE.test('key1')).toBe(true);
            expect(SENSITIVE_KEY_RE.test('value')).toBe(false);
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

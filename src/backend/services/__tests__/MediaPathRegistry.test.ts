import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import MediaPathRegistry from '@/backend/services/MediaPathRegistry';

describe('媒体路径登记表', () => {
    let tempRoot: string;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-registry-'));
    });

    it('登记过的文件路径可以命中', () => {
        const registry = new MediaPathRegistry();
        const target = path.join(tempRoot, 'a.mp4');

        expect(registry.isAllowed(target)).toBe(false);
        registry.allowFile(target);
        expect(registry.isAllowed(target)).toBe(true);
    });

    it('路径归一化：a/../b 与 b 视为同一个', () => {
        const registry = new MediaPathRegistry();
        const target = path.join(tempRoot, 'b.mp4');

        registry.allowFile(path.join(tempRoot, 'x', '..', 'b.mp4'));

        expect(registry.isAllowed(target)).toBe(true);
    });

    it('登记目录后目录内的文件都算命中', () => {
        const registry = new MediaPathRegistry();
        const dir = path.join(tempRoot, 'clips');
        fs.mkdirSync(dir, { recursive: true });

        registry.allowDirectory(dir);

        expect(registry.isAllowed(path.join(dir, 'clip.mp4'))).toBe(true);
        expect(registry.isAllowed(path.join(tempRoot, 'other.mp4'))).toBe(false);
    });

    it('只共享字符串前缀的兄弟目录不算命中', () => {
        const registry = new MediaPathRegistry();
        const dir = path.join(tempRoot, 'lib');
        const sibling = path.join(tempRoot, 'lib2');
        fs.mkdirSync(dir, { recursive: true });
        fs.mkdirSync(sibling, { recursive: true });

        registry.allowDirectory(dir);

        expect(registry.isAllowed(path.join(sibling, 'x.mp4'))).toBe(false);
    });

    it('软链接文件登记后按真实路径也能命中', () => {
        const registry = new MediaPathRegistry();
        const realFile = path.join(tempRoot, 'real.mp4');
        fs.writeFileSync(realFile, 'x');
        const link = path.join(tempRoot, 'link.mp4');
        fs.symlinkSync(realFile, link);

        registry.allowFile(link);

        expect(registry.isAllowed(link)).toBe(true);
        expect(registry.isAllowed(realFile)).toBe(true);
    });

    it('登记过的文件被换成指向别处的软链接后，真实路径不再命中', () => {
        const registry = new MediaPathRegistry();
        const target = path.join(tempRoot, 'video.mp4');
        fs.writeFileSync(target, 'x');
        registry.allowFile(target);

        // 文件事后被换成指向别处的软链接：真实路径变了，不该再放行。
        const secret = path.join(tempRoot, 'secret.txt');
        fs.writeFileSync(secret, 'top secret');
        fs.rmSync(target);
        fs.symlinkSync(secret, target);

        expect(registry.isAllowed(secret)).toBe(false);
    });

    it('size 反映登记的条目数', () => {
        const registry = new MediaPathRegistry();
        expect(registry.size()).toBe(0);

        registry.allowFile(path.join(tempRoot, 'a.mp4'));
        registry.allowDirectory(path.join(tempRoot, 'd'));

        expect(registry.size()).toBeGreaterThanOrEqual(2);
    });

    it('空路径不会被登记', () => {
        const registry = new MediaPathRegistry();
        registry.allowFile('');
        registry.allowDirectory('');

        expect(registry.size()).toBe(0);
        expect(registry.isAllowed('')).toBe(false);
    });
});

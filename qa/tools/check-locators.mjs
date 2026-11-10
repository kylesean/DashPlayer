#!/usr/bin/env node
/**
 * QA 定位器静态检查。
 *
 * e2e 只允许语义定位：`getByRole` / `getByTestId` / `getByLabel` 等。
 * 禁止 `page.locator(...)` / `page.$(...)`，因为它默认把 CSS 类名、标签名和
 * DOM 层级写成契约——产品改一次排版，用例就会静默指到相邻元素或直接失效。
 *
 * 例外：页面内部 `evaluate` 里的 `querySelector` 属于浏览器内观测代码，不在本检查范围。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QA_ROOT = path.join(REPO_ROOT, 'qa');

/** 需要扫描的目录。 */
const TARGET_DIRS = ['specs', 'support'];

/**
 * 递归列出 `.ts` 文件。
 *
 * @param dir 目录绝对路径。
 * @returns 文件绝对路径数组。
 */
function listTsFiles(dir) {
    const found = [];
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.name.endsWith('.ts')) {
                found.push(full);
            }
        }
    }
    return found.sort();
}

const problems = [];
for (const target of TARGET_DIRS) {
    for (const file of listTsFiles(path.join(QA_ROOT, target))) {
        const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/');
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
            if (/\.locator\s*\(/.test(line)) {
                problems.push(`${relative}:${index + 1} 使用了 page.locator()，请改用 getByRole/getByTestId`);
            }
            if (/\.\$\$?\s*\(/.test(line)) {
                problems.push(`${relative}:${index + 1} 使用了 page.$/$$，请改用语义定位器`);
            }
        });
    }
}

if (problems.length > 0) {
    console.error('QA 定位器检查失败：');
    for (const problem of problems) {
        console.error(`  - ${problem}`);
    }
    process.exit(1);
}

console.log('QA 定位器检查通过：未发现 CSS/tag 定位器。');

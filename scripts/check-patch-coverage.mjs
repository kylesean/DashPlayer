#!/usr/bin/env node
/**
 * 补丁覆盖率门禁：本次变更触碰的控制器文件，其行覆盖率必须达标。
 *
 * 与 vitest.config.ts 的 per-glob 阈值互补：全局阈值防「整层覆盖率倒退」，
 * 本脚本防「本次提交引入未测试的新代码」——新增控制器若没有接入
 * routeContract 契约测试，diff 会命中它且覆盖率为 0，这里直接报红。
 *
 * 数据来源：vitest v8 provider 产出的 istanbul 格式 coverage/coverage-final.json
 * （CI 在 Unit tests 步骤用 test:coverage 生成；本地请先跑 pnpm run test:coverage）。
 *
 * 用法：node scripts/check-patch-coverage.mjs [--base <git-ref>] [--coverage <path>]
 *   --base     diff 基线（默认 origin/main）；基线不可解析时跳过并放行（CI 首推等场景）。
 *   --coverage 覆盖率 JSON 路径（默认 coverage/coverage-final.json）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

/** 分层补丁阈值：前缀命中的变更文件按该行覆盖率底线把关。
 *  与 vitest.config.ts 'src/backend/controllers/**' 的 lines 阈值保持同源口径。 */
const PATCH_RULES = [
    { prefix: 'src/backend/controllers/', lines: 55 },
];

/** 解析命令行参数。 */
function parseArgs(argv) {
    const args = { base: 'origin/main', coverage: 'coverage/coverage-final.json' };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--base') args.base = argv[++i];
        else if (argv[i] === '--coverage') args.coverage = argv[++i];
        else {
            console.error(`未知参数：${argv[i]}`);
            process.exit(2);
        }
    }
    return args;
}

/** 执行 git 命令并返回 stdout；失败时返回 null。 */
function git(args) {
    try {
        return execFileSync('git', args, { encoding: 'utf8' }).trim();
    } catch {
        return null;
    }
}

/** 从 istanbul JSON 条目计算行覆盖率（语句命中行 / 语句覆盖行总数）。 */
function lineCoverage(entry) {
    const total = new Set();
    const hit = new Set();
    for (const [id, loc] of Object.entries(entry.statementMap)) {
        const count = entry.s[id] ?? 0;
        for (let line = loc.start.line; line <= loc.end.line; line += 1) {
            total.add(line);
            if (count > 0) hit.add(line);
        }
    }
    if (total.size === 0) return 100;
    return (hit.size / total.size) * 100;
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = git(['rev-parse', '--show-toplevel']);
if (!repoRoot) {
    console.error('补丁覆盖率：无法定位 git 仓库根目录');
    process.exit(2);
}

// 基线不可解析（CI 首次推送的 0000 占位、浅克隆缺历史等）→ 跳过，不拦正常流水线。
const baseCommit = git(['rev-parse', '--verify', `${args.base}^{commit}`]);
if (!baseCommit) {
    console.log(`补丁覆盖率：基线 ${args.base} 不可解析，跳过检查`);
    process.exit(0);
}

const changedFiles = git(['diff', '--name-only', `${baseCommit}...HEAD`, '--', 'src/'])
    ?.split('\n')
    // 测试/规格文件自身不计入覆盖率统计（vitest coverage exclude 同口径），
    // 不排除的话「缺失 = 0%」规则会误伤它们。
    .filter((file) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file))
    .filter(Boolean) ?? [];
if (changedFiles.length === 0) {
    console.log('补丁覆盖率：src/ 无变更，跳过检查');
    process.exit(0);
}

const coveragePath = path.resolve(repoRoot, args.coverage);
if (!fs.existsSync(coveragePath)) {
    console.error(`补丁覆盖率：未找到 ${args.coverage}，请先运行 pnpm run test:coverage`);
    process.exit(2);
}
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));

const violations = [];
const checked = [];
for (const rule of PATCH_RULES) {
    const touched = changedFiles
        .filter((file) => file.startsWith(rule.prefix))
        .map((file) => {
            const absolute = path.resolve(repoRoot, file);
            const entry = coverage[absolute];
            return { file, pct: entry ? lineCoverage(entry) : 0 };
        });
    for (const { file, pct } of touched) {
        checked.push(`${file} ${pct.toFixed(1)}%`);
        if (pct < rule.lines) {
            violations.push(`${file} 行覆盖率 ${pct.toFixed(1)}% 低于 ${rule.lines}%`);
        }
    }
}

if (checked.length === 0) {
    console.log('补丁覆盖率：本次变更未触碰受门禁的目录，通过');
    process.exit(0);
}

console.log(`补丁覆盖率（基线 ${args.base}）：`);
for (const line of checked) console.log(`  ${line}`);

if (violations.length > 0) {
    console.error('\n补丁覆盖率不达标：');
    for (const line of violations) console.error(`  ${line}`);
    process.exit(1);
}
console.log('补丁覆盖率门禁通过');

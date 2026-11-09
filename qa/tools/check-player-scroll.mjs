#!/usr/bin/env node
/**
 * 播放器滚动锚定检查的机读出口：跑 a/b 两套策略，汇总每轮 JSON，按退出码给结论。
 *
 * 为什么要包一层：`playwright test` 只会给 0/1，而这里要区分四种结局——
 * 过了、红了、**空通过**（一条断言都没识别到，不算过）、环境不符（比如没有埋点、node 不是 22）。
 * 分层排查时，「空通过」和「环境不符」是最容易被误读成绿灯的两类，所以必须各占一个退出码。
 *
 * 退出码：
 * - 0 通过：两套策略都跑出观测数据，且全部断言成立；
 * - 1 红：有观测不成立（守卫不成立 / 残差超限 / 出现不该有的滚动请求），或 playwright 自身失败；
 * - 3 空通过：识别到 0 条观测（用例没跑起来/没打印结果），不算过；
 * - 4 环境不符：node 与 `.nvmrc` 不在同一条工具链上，或所有观测都报告埋点缺失
 *   （`__dpDebug` 不存在）。
 *
 * 用法：`node qa/tools/check-player-scroll.mjs`（先跑过一次用例，或让 globalSetup 备好料）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** 仓库根目录。 */
const projectDir = fileURLToPath(new URL('../..', import.meta.url));

/** 用例文件（相对仓库根）。 */
const SPEC_FILE = 'qa/specs/player/player-scroll-anchor.spec.ts';

/**
 * 从协议模块读取常量，不在本文件里另存副本。
 *
 * 为什么可以直接 `import()` 一个 `.ts`：Node 22 起自带类型擦除（22.18+ 默认开启），
 * 而这两个协议文件都刻意保持「零 import 的纯常量」——一旦它们引入别的模块，
 * 这里的解析就会因为没有扩展名而失败，所以那条约束写进了各自的文件头。
 *
 * 分工：
 * - `src/common/constants/player-scroll-protocol.ts`：产品与用例共用的运行期契约（testid、日志前缀）；
 * - `qa/support/scroll-anchor-protocol.ts`：纯 QA 侧规格数值（起点、轮数、阈值）。
 *
 * 这是本工具唯一的常量来源：以前这里手工镜像了 4 个值，改协议文件时没有任何机制
 * 提醒同步，而工具又恰恰是「不信任 playwright 退出码」的那一层，它一漂就失去了复核意义。
 */
const commonProtocol = await import(
    new URL('../../src/common/constants/player-scroll-protocol.ts', import.meta.url).href
);
const qaProtocol = await import(
    new URL('../support/scroll-anchor-protocol.ts', import.meta.url).href
);

/** 观测日志前缀：用例打印的每轮 JSON 都以它开头。 */
const OBSERVATION_PREFIX = commonProtocol.PLAYER_SCROLL_OBSERVATION_PREFIX;

/** 需要跑的策略。 */
const POLICIES = ['a', 'b'];

/**
 * 读取 `.nvmrc` 声明的 node 版本。
 *
 * 为什么不照抄 `package.json` 的 engines：engines 同时允许 22 与 24 两条线，
 * 而 CI 与本地统一按 `.nvmrc` 固定（见 `ci.yml` 的 `node-version-file`）。
 * 在这个工具里再维护一张允许表，等于又造一个版本来源——正是要消除的漂移。
 *
 * @returns `.nvmrc` 去空白后的内容；读不到时为 null。
 */
function readNvmrcNode() {
    try {
        return fs.readFileSync(path.join(projectDir, '.nvmrc'), 'utf8').trim();
    } catch {
        return null;
    }
}

/**
 * 判断当前 node 是否与 `.nvmrc` 在同一条工具链上。
 *
 * 只比主次版本：补丁号差异视为同一条线（补丁通常只含安全修复），
 * 主次版本不同则说明跑的不是项目声明的运行时，观测结果与 CI 不可比。
 *
 * @param current process.versions.node（形如 24.22.2）。
 * @param expected `.nvmrc` 的内容（形如 22.23.4）。
 * @returns 同一工具链时为 true；`.nvmrc` 格式不认识时也返回 true（不拿工具自身当障碍）。
 */
function isSameNodeLine(current, expected) {
    const [currentMajor, currentMinor] = current.split('.').map(Number);
    const [expectedMajor, expectedMinor] = expected.split('.').map(Number);
    if (!Number.isFinite(expectedMajor) || !Number.isFinite(expectedMinor)) {
        return true;
    }
    return currentMajor === expectedMajor && currentMinor === expectedMinor;
}

/**
 * 判定阈值同样来自协议模块，而不是在本文件里重抄一遍。
 *
 * 这些值与 spec 用的是同一份：spec 用它断言，工具用它独立复核；
 * 两边各抄一份时，spec 收紧了阈值而工具没跟，工具就会「更松」，
 * 「独立复核」退化成 spec 的子集。
 */
const { CONVERGE_EPSILON_PX, MAX_SCROLL_WRITES, MIN_CONTENT_HEIGHT_DELTA } = qaProtocol;

/**
 * 跑一套策略，返回观测数组与 playwright 退出码。
 *
 * @param policy 策略（a / b）。
 * @returns 观测数组、退出码与原始输出尾部。
 */
function runPolicy(policy) {
    const result = spawnSync(
        process.execPath,
        [path.join(projectDir, 'node_modules', 'playwright', 'cli.js'), 'test', '-c', 'qa/playwright.config.ts', SPEC_FILE],
        {
            cwd: projectDir,
            env: { ...process.env, DP_POLICY: policy },
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024,
        },
    );
    const stdout = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const observations = [];
    for (const line of stdout.split('\n')) {
        const at = line.indexOf(OBSERVATION_PREFIX);
        if (at < 0) {
            continue;
        }
        const raw = line.slice(at + OBSERVATION_PREFIX.length).trim();
        try {
            observations.push(JSON.parse(raw));
        } catch {
            // 解析不了的行直接丢弃：宁可少一条观测（可能触发空通过），也不要吞掉格式错误
        }
    }
    return { policy, observations, exitCode: result.status, tail: stdout.split('\n').slice(-8).join('\n') };
}

/**
 * 判定一条观测是否成立。
 *
 * 守卫（起点落在中段、行高确实变化、锚点行仍在渲染）与策略断言都在这里重新核一遍：
 * 机读出口不信任 playwright 的退出码，只信任观测数据本身。
 *
 * 这里的判定必须与 spec 里的断言**等价**，否则它只是 spec 的一个子集，
 * 「独立复核」就成了空话：spec 加了断言而这里没加，等于机读出口悄悄变松。
 * 对应关系：grow 见 spec 的 `POLICY === 'a'` / else 两个分支，shrink 见「锚点行被回收」用例。
 *
 * @param observation 一条观测。
 * @returns 失败原因列表；空数组表示成立。
 */
function judge(observation) {
    const failures = [];
    // 埋点缺失时滚动写入数不可观测（null），此时写入类断言无从判定；
    // 但那种情况 spec 会直接判红、退出码非 0，本函数的结果不会被采用。
    const writable = observation.instrumentation !== 'absent';
    if (observation.case === 'grow') {
        if (observation.guardHolds !== true) {
            failures.push('守卫不成立');
        }
        if (!writable) {
            return failures;
        }
        if (observation.policy === 'a') {
            if (!(typeof observation.residual === 'number' && Math.abs(observation.residual) < CONVERGE_EPSILON_PX)) {
                failures.push(`末轮残差 ≥ ${CONVERGE_EPSILON_PX} 布局像素`);
            }
            if (!(observation.requestCount <= MAX_SCROLL_WRITES)) {
                failures.push(`请求类滚动写入超过 ${MAX_SCROLL_WRITES} 次`);
            }
            // 请求数与直接写是两个子系统：requestCount 记 Virtuoso 的 scrollToIndex/scrollBy，
            // writeCount 记 hold 自己改 scrollTop。只钉前者会漏掉后者失控。
            if (!(observation.writeCount <= MAX_SCROLL_WRITES)) {
                failures.push(`hold 直接写 scrollTop 超过 ${MAX_SCROLL_WRITES} 次`);
            }
            return failures;
        }
        if (observation.requestCount !== 0) {
            failures.push('对照策略出现了请求类滚动写入');
        }
        if (observation.writeCount !== 0) {
            failures.push('对照策略出现了直接写 scrollTop');
        }
        if (!(typeof observation.residual === 'number' && Math.abs(observation.residual) > MIN_CONTENT_HEIGHT_DELTA)) {
            failures.push('对照策略下残差没有明显偏移，这一轮不构成对照');
        }
        return failures;
    }
    // 锚点行被回收：守卫本就不成立（这条用例的目的是证明 fail closed），
    // 所以这里要求 guardHolds 为 false——「守卫成立」反而是失败。
    if (observation.guardHolds !== false) {
        failures.push('锚点行被回收时守卫竟然成立');
    }
    if (writable) {
        if (observation.requestCount !== 0) {
            failures.push('锚点缺失时仍请求了滚动');
        }
        if (observation.writeCount !== 0) {
            failures.push('锚点缺失时仍直接写了 scrollTop');
        }
    }
    return failures;
}

/**
 * 汇总并打印结论。
 *
 * @returns 退出码。
 */
function main() {
    // 版本门禁放在最前面：它不成立时，跑用例得到的任何结论都不可信，
    // 而两套策略跑完要十几分钟——先跑再报「环境不符」是纯浪费，也容易被误读成用例挂了。
    const nvmrcNode = readNvmrcNode();
    if (nvmrcNode === null) {
        console.error('[check] 提示：读不到 .nvmrc，跳过 node 版本校验（观测结果可能与 CI 不可比）');
    } else if (!isSameNodeLine(process.versions.node, nvmrcNode)) {
        console.error(
            `[check] 环境不符：node ${process.versions.node}，.nvmrc 要求 ${nvmrcNode}。`
            + 'CI 也按 .nvmrc 跑，不同线上的观测不可比；先切到项目声明的版本再重试。',
        );
        return 4;
    }
    const runs = POLICIES.map((policy) => runPolicy(policy));
    const observations = runs.flatMap((run) => run.observations);

    const checks = observations.map((observation) => ({
        policy: observation.policy,
        case: observation.case,
        round: observation.round,
        instrumentation: observation.instrumentation,
        residual: observation.residual,
        requestCount: observation.requestCount,
        writeCount: observation.writeCount,
        guardHolds: observation.guardHolds,
        failures: judge(observation),
    }));

    const summary = {
        check: 'player-scroll-anchor',
        nodeVersion: process.versions.node,
        nvmrcNode,
        assertionCount: checks.length,
        playwrightExitCodes: runs.map((run) => ({ policy: run.policy, exitCode: run.exitCode })),
        // 空数组的 every() 恒为 true，会把「没识别到任何观测」误判成「埋点缺失」，
        // 于是下面的 return 3（空通过）永远走不到。先显式要求非空。
        instrumentation: observations.length > 0
            && observations.every((observation) => observation.instrumentation === 'absent')
            ? 'absent'
            : 'present',
        failures: checks.filter((check) => check.failures.length > 0),
        checks,
    };
    console.log(JSON.stringify(summary, null, 2));

    // 判定顺序是有讲究的，三条从「最不可能是被测代码的问题」到「最可能是」：
    // 1. 用例进程本身失败（崩溃、超时、启动不起来）——此时没有观测是**症状**，
    //    不能报成「空通过」，否则一次崩溃会被读成「跑过了只是没识别到观测」。
    if (runs.some((run) => run.exitCode !== 0)) {
        console.error('[check] 红：用例进程非零退出，观测不可用');
        for (const run of runs) {
            console.error(run.tail);
        }
        return 1;
    }
    // 2. 进程正常结束却一条观测都没有——这才是「空通过」，它既不是绿也不是环境问题，
    //    必须报出它自己的退出码。这个工具存在的理由就是让这种假绿无法冒充成功。
    if (checks.length === 0) {
        console.error('[check] 空通过：没有识别到任何观测，不算过');
        for (const run of runs) {
            console.error(run.tail);
        }
        return 3;
    }
    // 3. 观测齐了但全都说埋点缺失——环境问题，不是断言不成立。
    if (summary.instrumentation === 'absent') {
        console.error('[check] 环境不符：所有观测都报告埋点缺失（window.__dpDebug 不存在）');
        for (const run of runs) {
            console.error(run.tail);
        }
        return 4;
    }
    // 4. 观测齐了、埋点也在，就是断言不成立。
    if (summary.failures.length > 0) {
        console.error(`[check] 红：${summary.failures.length} 条观测不成立`);
        for (const run of runs) {
            console.error(run.tail);
        }
        return 1;
    }
    console.error(`[check] 通过：${checks.length} 条观测全部成立`);
    return 0;
}

process.exitCode = main();

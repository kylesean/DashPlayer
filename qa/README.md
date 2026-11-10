# QA：端到端用例

> 用 Playwright 驱动真实 Electron 应用，覆盖跨进程链路。**这里是用例资产的唯一入口**：规范、代码、夹具、文档都在 `qa/` 下。
> 维护边界：QA 拥有场景清单、契约常量与评审权；开发可以维护测试实现，但改断言/场景要先过 QA review。
> **测什么（场景清单与缺口）见 [test-cases/](./test-cases/)**；通用测试原则见本文第 6 节「红线」。

## 1. 定位

- **测什么**：单元测试覆盖不到的跨进程链路——真实界面操作 → preload IPC → 主进程 → 数据库/配置文件，例如启动门槛、引导流程、设置项落盘与重启持久化。
- **不测什么**：能用 vitest 覆盖的（纯函数、服务层、业务组件）不写在这里；第三方代码不测。
- **要求**：少而稳，只保关键链路；用例独立、可重跑、失败信息能直接定位到坏在哪一环。

## 2. 运行

统一走 `package.json` 脚本（CI 与本地同一条命令）：

```bash
pnpm run test:e2e                     # 全部源构建用例
pnpm run test:e2e:smoke               # PR 门禁的 @smoke 子集
pnpm run test:e2e:packaged            # 先打包，再跑真实打包产物冒烟（nightly / 手工）
pnpm exec playwright test -c qa/playwright.config.ts --list   # 只列用例（不启动应用）
pnpm run qa:check-locators            # 禁止 CSS/tag 定位器的静态检查
node qa/tools/check-test-cases.mjs    # 用例文档 ↔ 用例 ID 双向校验
node qa/tools/check-player-scroll.mjs # 播放器滚动锚定检查（JSON + 语义化退出码）
```

- **备料全自动**：`qa/support/globalSetup.ts` 在用例前跑——`.vite` 缺失、构建输入变化、产物摘要不一致或不是生产模式时重新构建（约 8~25 秒），媒体夹具缺失就生成。因此「刚 clone」和「改了 src 之后」都只需要上面那一条命令。
- **构建不是「有 main.cjs 就算数」**：`qa/support/build.mjs` 先构建到临时目录，全部成功后原子替换 `.vite`，并写入 `.vite/.qa-build-manifest.json`（mode、输入摘要、全部产物摘要）。globalSetup 逐项校验，fixture 再断言首窗口 URL 是 `file:`；本机开着 Vite dev server 也不能冒充生产入口。
- 用例串行执行（`workers: 1`）；单条用例真实启动一次应用，启动约 2~4 秒、整条约 10 秒。
- 首次运行会按需下载 Electron 二进制到 `node_modules/electron`，需要网络。
- 生成媒体夹具需要本机有 `ffmpeg` / `ffprobe`（`qa/fixtures/make-fixtures.mjs`）。
- 首次拉取本分支后要先装依赖：`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 pnpm install`。`@playwright/test` 是这套基建引入的依赖；跳过浏览器下载是因为用例只用 Electron，用不到 Playwright 自带的 Chromium。
- **CI 分层**：PR 跑 `@smoke`（xvfb，约 1~2 分钟）；main 推送跑全量；nightly 跑全量 + 真实打包产物冒烟。失败自动上传截图、JUnit、HTML 报告与运行期证据。

## 3. 工作原理

- **源构建用例走开发态**：正式打包产物被 FusesPlugin 关闭 `--inspect`，Playwright 无法接管；因此日常用例以 `electron .` 启动，读取带清单的 `.vite/` 生产 bundle。真实打包产物由 `qa/playwright.packaged.config.ts` + QA 专用打包配置单独覆盖（只打开 inspect fuse，其余 fuse/asar/extraResource 与发布包一致）。
- **构建脚本**：`qa/support/build.mjs` 复用 forge 的 Vite 配置（`ViteConfigGenerator`）生成 `.vite/build` + `.vite/renderer/main_window`；不需要 `pnpm run download` 拉取的原生资源（whisper / ffmpeg 等不参与）。
- **数据隔离**：每个用例独占临时 userData 目录（`--user-data-dir`），数据库、日志、配置全部落在里面，用例结束自动删除；启动后立刻校验隔离生效，一旦 `--user-data-dir` 失效会尽早失败，避免写坏本机真实数据。
- **越过首次引导**：引导完成标记存在数据库里、启动前无法预置；fixture 通过真实 IPC（与应用内「跳过」同一个后端入口 `system/config/set`）写入标记后 `page.reload()`，让启动门槛重新判定，全程不使用 mock。这是唯一登记的 QA bootstrap 例外，只用于让设置页用例独立；引导 UI 本身由 `SET-ONB-01` 从真实引导页覆盖。

开发态与生产路径的区别（写断言时会用到）：

| | 生产 | 开发态（e2e 跑的） |
|---|---|---|
| 数据库 | `data/dp_db.sqlite3` | `data-dev/dp_db.sqlite3` |
| 日志 | `logs/` | `logs-dev/` |
| 配置 | `config.json` | `config.dev.json` |

## 4. 基建 API（`qa/support/fixtures.ts`）

| 导出 | 用途 |
|---|---|
| `test` | 扩展后的 test，提供下面两个 fixture |
| `session` | 已启动并处于主界面的应用会话，`session.page` 可直接操作 |
| `userDataDir` | 用例独占的临时 userData 目录，用例结束自动清理 |
| `launchAppSession(userDataDir)` | 手动启动一次会话，重启场景用 |
| `readConfigValue(userDataDir, 'a.b')` | 读配置文件里的嵌套值（如 `appearance.theme`） |

```typescript
// 普通用例：直接拿 session
test('...', async ({ session, userDataDir }) => { /* ... */ });

// 重启场景：不用 session fixture，自己控制两次启动
const first = await launchAppSession(userDataDir);
// ...操作...
await first.close();
const restarted = await launchAppSession(userDataDir);
```

### 设置页公共工具（`qa/support/settings-page.ts`）

设置页的导航与定位在各页面用例里是重复的，这部分抽到了独立模块：

| 导出 | 用途 |
|---|---|
| `openSettingsSection(page, 'proxy', ready)` | 从首页进「设置中心」再切到指定栏目（键来自 `SETTINGS_NAV_TESTIDS`），并等该页标志性元素出现 |
| `switchSettingsSection(page, 'appearance', ready)` | 已经在设置中心时切到另一个栏目（用例中途离开当前页、验证挂起的改动是否提交） |
| `reloadSettingsPage(page, ready)` | 重新加载当前设置页（HashRouter 保留路由），验证值来自后端回读 |
| `selectInRow(page, rowKey)` | 定位某一设置行里的下拉框。行键来自 `SETTING_ROW_TESTIDS`（`subtitleTranslation` / `transcription` 等），不做文案模糊匹配 |
| `chooseInRow(page, rowKey, '选项文案')` | 在指定行点开下拉框并选中一项 |

`openSettingsSection` 与 `switchSettingsSection` 分开，是为了让「从一个设置页切到另一个」的用例只经历一次导航——切走的瞬间正是要验证的时机，不能有多余的中间跳转。

## 5. 新页面用例怎么写

设置中心各页面已全覆盖。**每条用例测什么、哪些场景还是缺口、当前各页各有多少条，看 [test-cases/](./test-cases/)（一个设置页一份文档），或直接跑 `node qa/tools/check-test-cases.mjs` 看它打印的概览**——计数由工具算，本文档不手写，避免数字悄悄过期。本文档只讲怎么写，按页面形态挑最近的抄：

| 页面形态 | 参考文件（都在 `qa/specs/settings/`） |
|---|---|
| 按钮 / 档位切换 | `qa/specs/settings/appearance-settings.spec.ts` |
| 文本输入（含「填了要真保存、重进要回显」范式） | `qa/specs/settings/proxy-settings.spec.ts`、`qa/specs/settings/storage-settings.spec.ts` |
| 下拉框与自定义提示词 | `qa/specs/settings/service-resource-settings.spec.ts` |
| 弹窗内录制 / 保存 | `qa/specs/settings/shortcut-settings.spec.ts` |
| 只读页（无可填字段的守卫） | `qa/specs/settings/about-settings.spec.ts` |
| 服务类开关 + 跨端 HTTP 断言（令牌鉴权） | `qa/specs/settings/mobile-access-settings.spec.ts` |
| 保存时机（改完立刻切走） | 各页 spec 里都有一条：`qa/specs/settings/appearance-settings.spec.ts` 的 SET-APP-09 最简洁 |
| 应用外壳的机制性约束（只在构建产物里存在的行为） | `qa/specs/app/renderer-security.spec.ts` |

1. **定位分两类**：导航、设置行、列表卡片等结构性容器用 `data-testid`（产品与 QA 共用 `src/common/constants/qa-testids.ts`）；按钮、tab、dialog、heading 等有可访问名称的控件用 `getByRole` + 当前语言的 accessible name。禁止 `page.locator()` / CSS 类名 / 标签名定位，`qa/tools/check-locators.mjs` 会在 CI 拦截。设置页导航走 `openSettingsSection`，不要手写点击链接——侧边栏与其它导航区可能出现同名入口。
2. **「用户填了但没保存」是这套用例的首要防范对象**：设置页没有保存按钮，改动由页面防抖自动保存，所以每条用例都按三段式写——① 操作控件；② `expect.poll(() => readConfigValue(...))` 断言值真进了配置文件；③ `reloadSettingsPage` 后断言界面回显。只做第 ① 步，或只断言界面 state，都可能在「保存链路断了」时假通过。涉及保存时机的用例还要多走一步「切到别的栏目再切回来」，因为整页 reload 会清掉前端缓存，验不到缓存过期一类的问题（见下面的已知坑）。
3. **断言"操作 → 可观测结果"**：界面状态（类名 / DOM）+ 持久化结果（配置文件 / 数据库）。
4. **用自动重试的断言**：`expect(locator).toHaveClass()`、`expect.poll()` 等；不要用 `waitForTimeout` 硬等。
5. **用例互相独立**：每条用例都是全新进程 + 全新数据目录，不要依赖其他用例或执行顺序。
6. **文案用中文白话**：describe / it 描述真实业务行为，与 vitest 用例风格一致。
7. **可填字段的页面要补一条失败路径**：三段式只能证明"保存成功"，证明不了"保存失败时用户看得见"。后端拒绝写入时（路径不可用、被功能占用等），页面必须把原因显式露出来，所以补一条用例：① 造一个后端必然拒绝的输入；② 断言 `page.getByRole('alert')` 可见且文案包含拒绝原因；③ 断言配置文件里的旧值没被覆盖。只断言界面报错、不断言值未落盘会漏掉"报错同时把坏值也写进去了"。

   以无写权限目录为例（`qa/specs/settings/storage-settings.spec.ts`）：

   ```typescript
   // 把父目录设成只读，后端校验会真实失败（chmod 后无需还原，目录属于本用例）
   const readOnlyParent = path.join(userDataDir, 'read-only-parent');
   fs.mkdirSync(readOnlyParent);
   fs.chmodSync(readOnlyParent, 0o500);

   await libraryInput.fill(path.join(readOnlyParent, 'library'));

   const saveError = page.getByRole('alert');
   await expect(saveError).toBeVisible();
   await expect(saveError).toContainText('当前存储目录暂时无法访问');
   // 报错时旧值不能被覆盖
   expect(readConfigValue(userDataDir, 'storage.path')).toBe(initialPath);
   ```

   失败横幅统一加 `role="alert"`（`ProxySetting` / `ShortcutSetting` / `StorageSetting` 已加），既方便定位也补上无障碍语义。

标题开头的 `[SET-XXX-01]` 是用例 ID。先在对应页面的用例文档里写一段场景并挂上这个 ID（一个设置页一份，ID 规则见 [test-cases/README.md](./test-cases/README.md)），再把 ID 写进 `test()` 标题，`node qa/tools/check-test-cases.mjs` 会把两边对起来。

新文件骨架（放进 `qa/specs/settings/`，用 `../../support/*` 引基建）：

```typescript
import { expect, type Page } from '@playwright/test';
import { readConfigValue, test } from '../../support/fixtures';
import { openSettingsSection, reloadSettingsPage } from '../../support/settings-page';

/** 进入 xxx 设置页。 */
async function openXxxSetting(page: Page): Promise<void> {
    await openSettingsSection(page, 'xxx', page.getByRole('heading', { name: 'xxx' }));
}

test.describe('xxx 设置', () => {
    test('[SET-XXX-01] 填完 xxx 后落盘，重进页面仍回显', async ({ session, userDataDir }) => {
        const page = session.page;
        await openXxxSetting(page);

        await page.getByPlaceholder('占位符文案').fill('要保存的值');

        // 落盘：断言配置文件里的真实键
        await expect.poll(() => readConfigValue(userDataDir, 'xxx.yyy')).toBe('要保存的值');

        // 回显：重进页面后界面显示的是刚保存的值
        await reloadSettingsPage(page, page.getByRole('heading', { name: 'xxx' }));
        await expect(page.getByPlaceholder('占位符文案')).toHaveValue('要保存的值');
    });
});
```

### 播放器页：确定性入口与滚动埋点（`qa/specs/player/`）

播放页的正规入口是「入库 → 在列表里点进去 → 拖进度条」，每条滚动类用例都要先复现这一长串前置，既慢又脆。播放器页因此有一套 dev/qa 专用入口与埋点（都只在开发/未打包运行时生效，判据是 main 进程下发的 `system/info.devMode`）：

| 能力 | 用途 |
|---|---|
| `#/player/<任意>?file=<视频绝对路径>` | 用应用自己的 `watch-history/create` 把路径换成观看记录，跳过入库与点选 |
| `&seek=<秒>` | 视频就绪后跳到指定播放位置 |
| `&lang=<en\|zh>` | 本次会话切到指定界面语言（不落盘） |
| `window.__dpDebug.scrollWrites` | 滚动写入环形缓冲（上限 200），`kind: 'request'` 是 Virtuoso 这类「应用发起、库内部写 scrollTop」的调用，`kind: 'write'` 是直接写 |
| `window.__dpDebug.snapshot()` | 一次采样：`scrollTop` / `currentIndex` / `visibleRange` / `contentHeight` |
| `window.__dpDebug.lastHold()` | 最近一次「侧栏译文」保持阅读位置的记录（锚点下标、残差、轮数、结束原因） |
| `window.__dpPolicy` | 只由用例注入的策略开关：`a`（默认，补偿）/ `b`（对照，不补偿） |

配套基建：

```bash
node qa/fixtures/make-fixtures.mjs     # 生成 36 句双语 SRT + 480x270 小视频到 qa/fixtures/media/（不入库，globalSetup 缺则自动生成）
node qa/tools/check-player-scroll.mjs  # 播放器滚动锚定检查：输出 JSON 摘要 + 语义化退出码
```

`qa/tools/check-player-scroll.mjs` 的退出码是 **0 通过 / 1 红 / 3 空通过（识别到 0 条观测）/ 4 环境不符（node 与 `.nvmrc` 不在同一条工具链上，或埋点缺失）**——「空通过」与「环境不符」单独占一个码，避免它们被误读成绿灯。版本门禁在跑用例之前判定：版本不对时不会白跑两套策略再报错；判据直接读 `.nvmrc`（与 CI 的 `node-version-file` 同一个来源），不在工具里另存一份允许表。

参考用例：`qa/specs/player/player-scroll-anchor.spec.ts`（每轮都先 `console.log` 一段 JSON 再断言，断言失败也能拿到现场）。写滚动类用例时注意三点：

1. **起点只能用真实滚轮输入构造，不能直接写 `scrollTop`**：`Subtitle.tsx` 的 `wheel` 监听是把自动跟随切到 `USER_BROWSING` 的唯一入口。绕过它，首屏自动跟随仍生效，几百毫秒内就把位置拉回顶部（实测 `900 → 409 → 396 → 63 → 4`），「切换前快照」与「用例采样」量的不是同一个起点。用例里用 `wheelToScrollTop`（`page.mouse.wheel`）构造起点，位置才稳定。
2. **点开关时不要让指针停在标题栏上**：`locator.click()` 会先把真实指针移到元素中心；侧栏译文开关在列表**上方**的标题栏里，指针停在那儿之后 `mouse.wheel()` 滚的是标题栏，表现为「滚轮完全没反应」。用例里用 `element.click()` 派发 DOM 事件，不碰指针。
3. **虚拟列表会回收 DOM 节点**：锚点身份只能靠 `data-index`，不能用节点引用；「哪些行还在渲染范围内」用 `[data-testid="sentence-card"][data-index="N"]` 是否存在判断。构造「锚点被回收」时甩到**底部**而不是写死深度——行高随译文开关在 350–700px 之间变化，写死的深度可能仍落在 overscan 缓冲里，场景根本构造不出来。

滚动锚定的规格常量（起点 900、守卫 >850、甩到底部、收敛阈值）集中在 `qa/support/scroll-anchor-protocol.ts`；元素 testid 与日志前缀在 `src/common/constants/player-scroll-protocol.ts`（产品与用例共用一份，改名会在 `tsc` 阶段失败）。

## 6. 红线

- **禁止 mock 应用内部实现**（IPC、仓储、服务）：e2e 的价值就是验证这些真实边界。
- **禁止复用会话或数据目录来"提速"**：会引入用例顺序依赖；每条用例必须独立启动。
- **禁止为变绿放宽断言**；删除功能时同步删除对应用例。
- **用例与文档同步改**：标题里的 ID 必须在对应页面的用例文档里登记为「自动化」，文档里标「自动化」的场景也必须有对应用例；只改一边会被 `node qa/tools/check-test-cases.mjs` 拦下。
- 断言失败要能一眼看出坏点（UI 没生效 vs 没落盘），写断言时按这个标准取舍。

## 7. 已知坑

- **启动偶发停顿几十秒到几分钟（环境级，与 Playwright 无关）**：`launch()` 偶尔迟迟不返回，stderr 在 `Debugger listening` 后长期不出 `DevTools listening`；停顿期间应用就绪前的 JS（建库、迁移）已完成，但 Chromium 不 fork GPU 进程、不建 profile，恢复时一次性补齐。纯手动 `electron .` 同样复现（实测停顿 17 秒至 2 分钟以上），与本项目代码、`app.evaluate()`（实测 5~64ms 正常）无关；本机触发源为显示器切换器：把本机切走期间启动一律卡住（实测 12 分钟窗口内多次尝试无一例外），切回瞬间恢复，切回后重跑即可。全局测试超时 180 秒、launch 上限 120 秒，留出 teardown 余量；遇到启动超时先查切换器状态与 `journalctl -k` 的外设事件，不要怀疑用例本身。
- **GPU 默认关闭，不污染本机环境**：fixture 默认追加 `--disable-gpu`，规避 Linux/Wayland 下 NVIDIA egl-gbm 的上游崩溃（NVIDIA/egl-gbm#9）和启动等待，避免本机出现系统级 GPU 崩溃提示。个别用例要显式验证 GPU 硬件路径时设置 `QA_DISABLE_GPU=0`。同时主进程监听 `render-process-gone` / `child-process-gone`：渲染进程非正常退出判红；GPU 进程崩溃只作为环境证据记录（失败时随 runtime-evidence 上传），不直接判产品回归。
- **`NODE_ENV` 不能解锁 dev 能力**：`runtimeEnv.isDevelopmentMode()` 只认 `!app.isPackaged`。打包应用即使从带 `NODE_ENV=development` 的终端启动，也必须使用 `data/`、`logs/`、`config.json`，并忽略 `?file=`。`SET-PKG-01` 专门守这条边界。
- **Windows 权限失败路径**：`chmod 0o500` 只在 POSIX 上能构造只读父目录；`SET-STO-02` 在 Windows 显式 skip，并保留原因。其它平台仍必须真实失败并断言错误横幅与旧值未被覆盖。
- **Chromium 开关必须用 `--flag=value` 等号形式**：`--user-data-dir <path>` 写成两个 token 会被解析成"无值开关 + 位置参数"，userData 静默回退到真实目录、污染开发数据。fixture 里是 `--user-data-dir=${dir}`（另有 `assertUserDataIsolated` 兜底）；手写启动脚本时容易踩。
- **`npm/yarn install` 后 Electron 二进制可能缺失**：仓库里 `electron` 包的 postinstall 不落盘二进制，首次跑用例时会自动补下，日志出现 `Downloading Electron binary...` 属正常。
- **配置是嵌套 JSON**：electron-store 按点号访问，`appearance.theme` 在文件里存成 `{"appearance":{"theme":"dark"}}`；断言用 `readConfigValue`，不要按平铺 key 读。
- **与默认值相同的写入根本不会落盘**：`storeSet` 发现新值等于当前值（含 schema 默认值）时直接返回、不写文件，所以默认档位的键在 `config.dev.json` 里是**不存在**的。想让某键出现在文件里，要先把它改成非默认值；断言"改回默认"时只能用重进页面回显，不能用 `readConfigValue` 断言等于默认值。快捷键页还有一条相关语义：非 `shortcut.*` 键写空字符串会被替换成默认值，而快捷键支持空绑定（表示解绑）。
- **保存成功后必须刷新详情缓存（已修，接新页面时别漏传 `detailKey`）**：`useAutoSaveSettingsForm` 的 `detailKey` 参数在保存成功后会 `mutate` 该详情缓存。原因：SWR 在一次请求完成后的 `dedupingInterval`（默认 2 秒）内保留「请求进行中」标记，重新进入该页时会被判定为无需重拉，于是页面一直显示旧值——用户改完设置、切走再切回来核对，看到旧值就会以为没保存成功（整页 reload 才正常，所以老用例发现不了）。该刷新同时让「新增云端模型后立刻能在功能下拉里选中」成立：功能下拉的模型清单读的就是这份详情缓存，不再是「必须重进页面」。
- **引擎下拉框的模型列表来自页面加载时的快照**：新增云端模型后不再需要重进页面（见上一条）；但如果将来绕过 `detailKey`，这个坑会回来。
- **存储路径会被追加环境后缀**：`resolveStorageRootPath` 在可用性校验前给目录名加环境后缀（开发态 `-dev`），所以指向一个真实文件时会变成同级的 `文件-dev` 路径，在可写父目录下反而算"可用"、保存成功。要构造真正的失败必须让父目录无写权限（`chmod 0o500`），而不是靠指向不存在的路径或文件。

## 8. 维护边界（review 依据）

QA 拥有场景清单、契约常量与评审权；开发可以维护测试实现，但改断言/场景必须先过 QA review。为了让「不乱写」有强制手段，规矩分两层：

**机器强制（CI 会拦）**

- `qa/**` 只允许 import `@/common/**` 的类型与常量（或等价的 `../../src/common/**` 相对路径）。
  `@/fronted/**`、`@/backend/**` 等内部实现一律禁止——运行期契约只能走 `window.__dpDebug` 与 URL 参数，
  否则用例会跟着实现细节一起腐烂，产品一重构就全红。由 `eslint.config.mjs` 的 `no-restricted-imports` 强制。
- `src/**` 不允许 import `qa/**`：产品代码不能依赖用例。同样由 `eslint.config.mjs` 强制。
- 用例 ID 与文档的绑定由 `node qa/tools/check-test-cases.mjs` 强制（只改一边就报错）。
  这个脚本已接进 CI（`Test case docs` 步骤），不是「记得手动跑」的君子协定。
- `qa/tools/check-locators.mjs` 禁止 `page.locator()` / `page.$()`，CI 直接拦截 CSS 类名与标签定位。
- PR 的 `@smoke`、main 的全量、nightly 的打包冒烟都在 CI 跑；失败证据（截图/JUnit/HTML/运行期进程退出记录）自动上传。

**人审强制（下面三条写死在 review 清单里）**

1. **定位只用 `data-testid` / `aria-*` / 语义 role**：结构性容器禁 CSS 类名/tag 定位；按钮/tab/dialog 用 role + accessible name。界面文案只用于断言用户可见内容，不能拿来猜 DOM 结构。
   状态判断只认语义属性（如 `aria-pressed`），不认 class。
2. **每条用例必须有场景守卫**：守卫不成立要**判红**（说明夹具/环境变了），不能静默 skip；
   操作前后都要断言，等待用显式超时（`expect.poll` / `toHaveX` / `waitForFunction`），不用裸 `sleep` 赌时间。
3. **禁止 test-only 业务分支**：不许为用例在产品代码里加开关或假数据；场景靠 `qa/fixtures/` 的夹具
   + URL 入口参数构造。产品侧只允许 dev/qa 运行时生效的调试面（`__dpDebug`、`?file=` 这类），
   且必须由 `system/info.devMode` 兜住，生产构建零暴露。

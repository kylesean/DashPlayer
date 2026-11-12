# Refrain 视觉与交互规范

本文档是 UI 实现的**约束清单**，不是灵感集。新增或修改界面时必须先对照本文；
违反约束的代码应在评审阶段被打回，而不是靠事后截图发现问题。

技术底座是 Astryx（`@astryxdesign/core`）+ Tailwind v4。Astryx 提供组件与 token，
Tailwind 提供布局工具类，两者都不提供「本项目怎么用」的答案——那部分就是本文。

## 1. 核心原则

1. **主题只改变风格，不改变尺度。**
   主题可以换配色、字体族、圆角、阴影；**不可以**改变字号、行高、间距、控件高度。
   否则同一个弹层在不同主题下尺寸不一致，布局必然崩。
2. **语义 token 优先于具体数值。**
   用 `text-sm` / `bg-surface` / `rounded-lg`，不用 `text-[13px]` / `bg-[#fff]` / `rounded-[10px]`。
3. **一处定义，多处复用。**
   弹层、工具条、分段控件的共享外观集中在 `ControlPopover.tsx`、`toolbarStyles.ts`；
   组件内部不要各自写一套，否则同一条工具条上会长出两种观感。
4. **可读性优先于紧凑。**
   宁可把弹层加宽 40px，也不要让标签换行、让分段文字被截断。

## 2. 排版尺度（强制）

### 2.1 字号档位

应用 UI 只允许使用下表的档位。`--font-size-*` 已在 `src/index.css` 的
`@layer utilities` 里锚定为固定值，**不随主题变化**：

| 类名 | 值 | 用途 |
| --- | --- | --- |
| `text-xs` | 10px | 仅限微型计数徽章、极短辅助后缀 |
| `text-metadata` | 11px | 时间码、词性、参数提示、元信息角标 |
| `text-sm` | 13px | **默认正文**：紧凑浮层/菜单/工具条/按钮/卡片/列表标题 |
| `text-base` | 14px | 大页面正文、独立设置页的表单标签 |
| `text-lg` | 17px | 区块标题 |
| `text-xl` | 20px | 页面标题 |

规则：

- 紧凑弹层内**一律** `text-sm`，包括 Astryx 组件内部的标签。
  Astryx 的 `--text-label-size` 默认是 `--font-size-base`（14px），比 `text-sm` 大一档，
  必须在弹层作用域内压到 supporting：`[--text-label-size:var(--text-supporting-size)]`
  （`CONTROL_POPOVER_PANEL` 已内置）。
- Astryx 的 `NumberInput` / `TextInput` 用 `--text-body-size`（= `--font-size-base`），
  与同排 `text-sm` 按钮不同高。放进紧凑弹层时要同时压 `--text-body-size`。
- **禁止**写裸像素字号（`text-[11px]`）。现有 5 处是历史遗留，改动到时应顺手归并到上表。
- 同一行内的文字必须有明确的主次：主文案 `text-sm`，辅助信息 `text-metadata`，
  不允许出现两个不同档位却同等强调的文字。

### 2.2 行高与字重

- 行高交给 Astryx 的 `--text-*-leading`，不要手写 `leading-*` 覆盖（除非是字幕这类特殊排版）。
- 字重只用三档：`font-normal`（正文）、`font-medium`（可点击/强调）、`font-semibold`（标题）。
  不要用 `font-bold` 做 UI 文本——在 13px 下会糊成一团。

## 3. 颜色与主题

### 3.1 只用语义色

| 类别 | 允许 | 禁止 |
| --- | --- | --- |
| 背景 | `bg-body` / `bg-surface` / `bg-muted` / `bg-card` | `bg-white` / `bg-[#f5f5f5]` |
| 文字 | `text-primary` / `text-secondary` / `text-secondary` | `text-black` / `text-gray-500` |
| 边框 | `border-border` / `border-border/60` | `border-gray-200` |
| 状态 | `text-success-text` / `text-warning-text` / `text-error-text` | 直接写红/绿十六进制 |

例外：`--color-media-*` 是**视频画面层**专用（遮罩、角标、控制条），
在浅色主题下也必须保持深底白字，因此不接 `light-dark()`。只有叠在视频画面上的元素可以用它。

### 3.2 状态色要区分填充与文字

Astryx 的 `--color-<status>` 是**填充色**，文字色在 `--color-text-<status>`。
项目在 `src/index.css` 里提供了别名 `--color-success-text` 等，**文字必须用别名**，
否则深色主题下会出现"深绿字配深绿底"。

### 3.3 主题差异的边界

允许各主题不同：配色、字体族、圆角、阴影。
**不允许**不同：字号、行高、间距、控件高度、弹层宽度。

如果发现某个主题下布局变了，先怀疑是不是用了会被主题覆盖的 token
（`--font-size-*`、`--radius-*`），而不是去给那个主题写特例。

## 4. 尺寸与间距

- 间距走 4px 网格：`gap-1`(4px) / `gap-1.5`(6px) / `gap-2`(8px) / `gap-3`(12px)。
- 控件高度用 Astryx 的 `--size-element-sm` 等 token，不要写死 `h-7` / `h-8`。
  （工具条按钮的 32px 网格在 `toolbarStyles.ts` 里统一，属于有意的例外。）
- 弹层宽度：播放设置与训练面板统一 **320px**。改宽度必须同步两处，
  否则同一控制条上的两个弹层会错位。
- 圆角用 `rounded-md`(element) / `rounded-lg`(container) / `rounded-2xl`(page)。
  不要写 `rounded-[10px]`。

## 5. 组件选型

| 场景 | 用什么 | 不要用 |
| --- | --- | --- |
| 布尔开关 | Astryx `Switch`（`PopoverSwitchRow` 包装） | 手写 checkbox、`<input type="checkbox">` |
| 2~4 项互斥 | Astryx `SegmentedControl` | 手写按钮组、下拉 |
| 5 项以上互斥 | Astryx `Select` | 横向塞满的分段控件 |
| 数值输入 | Astryx `NumberInput` | `<input type="number">` |
| 弹层 | Astryx `usePopover` | 自己写 absolute 定位 |
| 图标 | `lucide-react` | 内联 SVG、emoji |

图标尺寸只用两档：`h-3.5 w-3.5`（行内）、`h-4 w-4`（独立按钮）。

### 5.1 分段控件必须 `shrink-0`

Astryx 的 `SegmentedControl` 容器是 `width: fit-content` + `max-width: 100%`，
而每个段标签是 `min-width: 0` + `overflow: hidden; text-overflow: ellipsis`。
放进 flex 行后，只要同行还有别的元素，控件就会被压缩，标签渲染成
「关…」「安…」这种省略号。

因此**所有** `SegmentedControl` 都要包一层 `shrink-0`：

```tsx
<div className="flex items-center justify-between gap-2">
  <span className="min-w-0 shrink whitespace-nowrap text-sm">标签</span>
  <div className="shrink-0">
    <SegmentedControl …>
  </div>
</div>
```

标签侧用 `min-w-0 shrink whitespace-nowrap`：允许被压缩到省略号，
但**不允许折行**——折成「词汇提/示」两行比省略号更破坏对齐。

如果标签在 320px 里放不下，说明选项太多：改用 `Select`，而不是继续加宽弹层。

### 5.2 紧凑设置面板的排版原语

设置面板「显得乱」几乎总是同一组原因：行内边距不一致、控件与标签的对齐基线
不同、有的条目有底色有的没有、说明文字常驻导致行高参差。

Astryx 官方 `settings-dialog` 模板给出了三条规则，本项目实现为
`PopoverSettingRow.tsx` 里的原语，**新面板必须复用，不要重写**：

| 原语 | 用途 |
| --- | --- |
| `PopoverSwitchRow` | 布尔设置（开关在右） |
| `PopoverControlRow` | 自定义控件（分段/选择器在右） |
| `PopoverSettingGroup` | 一个主题一张 `Card variant="muted"`，行间 `Divider` |

规则：

1. **一个面板只有一种行内边距**（`px-3 py-2.5`）。混用 `space-y-*` 与
   `VStack gap` 会让行距看起来随机。
2. **行高必须一致**。说明文字一律收进 `InfoTip`（ⓘ 悬停），不要常驻一行；
   常驻说明会让带说明的行比不带说明的高一倍。
3. **卡片分组按"主题"而不是"位置"**。一个卡片只讲一个主题；需要「和」来
   命名的分组（"播放和字幕"）说明该拆成两张。
4. **`Card padding={0}`**，内边距由行承担。否则卡片内边距 + 行内边距双重缩进，
   分隔线也无法拉通到卡片边缘。
5. **控件永不收缩**（`shrink-0`），文本列 `min-w-0` 允许换行。
6. **分组标题用 `Text type="supporting"`**，与卡片左边缘齐平（不要缩进到行标题）。

面板骨架：

```tsx
<div className="flex flex-col gap-3">
  <PopoverSettingGroup title={t('...groupPlayback')}>
    <PopoverSwitchRow label="…" checked={…} onChange={…} />
  </PopoverSettingGroup>
  <PopoverSettingGroup title={t('...groupSubtitle')}>
    <PopoverSwitchRow … />
    <PopoverControlRow label="…" control={<SegmentedControl … />} />
  </PopoverSettingGroup>
</div>
```

## 6. 文案与本地化

- 所有用户可见文案走 `t()`，禁止硬编码中文/英文。
- 中文标签在同一行内**不允许换行**（`whitespace-nowrap`）；如果放不下，
  说明布局需要调整，而不是让文字折行。
- 按钮文案不超过 4 个汉字 / 2 个英文词。
- 提示信息放 `labelTooltip`（ⓘ 悬停），不要常驻一行说明文字。

### 6.1 命名空间必须显式指定

项目有 16 个 i18n 命名空间，`defaultNS` 是 `settings`。**永远不要用裸
`useTranslation()`**——键落在哪个 ns 就传哪个 ns：

```tsx
const { t } = useTranslation('player');   // contextSuggestion.reasons.*
const { t } = useTranslation('common');   // wordMemory.*
```

反面案例：`word.tsx` 用 `useTranslation('common')` 去查
`contextSuggestion.reasons.*`（实际在 `player`），t() 回退成原始 key，
界面上直接显示 `contextSuggestion.reasons.useful_new_word`。

新增文案时，先确认目标 ns 里是否已有同类键，再决定放哪——**同一个概念的
文案只允许存在于一个 ns**。

## 7. 可访问性

- 所有可交互元素必须有 `focus-visible` 环（工具条样式已内置）。
- 仅图标的按钮必须有 `aria-label`。
- 颜色不能是唯一的信息载体：状态除了颜色还要有图标或文字。
- 尊重 `prefers-reduced-motion`：动画必须能被关闭（见 `src/index.css` 的既有处理）。

## 8. 评审清单

提交 UI 改动前自查：

- [ ] 没有裸像素字号/颜色/圆角
- [ ] 弹层内所有文字都是 `text-sm` 或 `text-metadata`
- [ ] 切换全部 7 个主题后布局没有变化（只有配色/字体族不同）
- [ ] 浅色与深色模式下对比度都够（尤其状态文字）
- [ ] 中文标签没有折行
- [ ] 窄视口（弹层宽度）下没有截断
- [ ] 新组件复用了共享样式，没有另起一套
- [ ] 每个 `SegmentedControl` 都包了 `shrink-0`
- [ ] 新增的显示开关**真的会改变渲染结果**（不是只写了一个 state）
- [ ] 弹层内没有挂 portal 的浮层（悬停弹层会先关闭）
- [ ] 高频操作用平铺图标直达，没有为了「整齐」把常用动作折进二级菜单
- [ ] 折叠入口排在它折叠的内容之后，且文案说明了内容
- [ ] 工具栏只放视图控制；临时动作贴内容，不为了整齐而制造二级菜单
- [ ] 「只在某状态下出现」的按钮，它的处理函数没有在该状态下提前 return

## 8.1 别做"无效开关"

加显示类选项前，先确认它在数据层真的能产生差异。

反面案例：曾加过「整句块 / 仅当前行」的字幕显示密度选项，但后端
`resegmentIntoMeaningGroups` 已经把字幕重切成完整句，前端
`groupSentencesIntoBlocks` 再合并时几乎恒为 1 句/块——两个选项渲染结果完全一样，
用户点了没任何变化。

正确做法是**先写测试证明差异存在**，再写 UI：

```ts
// 先证明两种模式输出不同，否则这个开关没有存在意义
expect(selectVisibleSentences(list, current, 'sentence')).toHaveLength(1);
expect(selectVisibleSentences(list, current, 'context')).toHaveLength(3);
```

最终这个选项改成了「仅当前句 / 带上下文」——后者真的会多渲染前后各一句，
对学习上下文衔接有实际价值。

## 8.2 富内容浮层用两层式

悬停浮层（查词、划词翻译）是**瞬时**交互：用户视线还在正文上，手指可能
随时移开。因此第一层只放"用户此刻必须要的答案"，其余信息折叠。

查词浮层的分层：

| 层 | 内容 | 触发 |
| --- | --- | --- |
| 第一层 | 词头、音标、口音标识、释义、例句 | 悬停即出 |
| 第二层 | 学习状态（上次遇见/复习）、语境解读、推荐理由 | 点击「学习记录」展开 |

判断标准：如果一条信息在用户"只想确认这词什么意思"时不需要，它就属于
第二层。学习系统的数据（掌握度、复习时间、推荐理由）全部属于第二层——
它们是主动学习的产物，不该打断被动查词。

同理，**AI 语境解读默认折叠**：它慢（1-3s）、要钱、可能出错，不能阻塞
第一层的词典释义渲染。

### 8.2.1 查词的数据来源优先级

第一层的释义**必须**来自本地词典，优先级固定为：

```
用户导入词典 → 内置 ECDICT → （都没有时）在线/AI 引擎
```

带语境时也**不跳过**词典。曾经的做法是「有语境就直接问 LLM」，理由是
静态义项可能不符合语境——但这个权衡方向错了：

- 用户要的是「这词什么意思」，90% 的情况词典够了；
- LLM 慢、要钱、可能出错，不该阻塞首屏；
- 语境价值属于**第二层**，按需请求即可，不需要牺牲首屏速度。

`forceRefresh` 是唯一例外：它的语义就是「绕过词典与缓存重新在线查询」。

### 8.2.2 单词卡的信息层次

第一层只回答「这词什么意思」。由此推出三条硬约束：

**折叠入口排在内容之后。** 「学习记录与语境解读」曾经放在释义上方，视觉上
等于给释义区加了个标题，用户会以为下面折叠着更多释义。折叠块必须排在
释义（和英英释义）之后，顺序才是「读完释义 → 想深入看记录」。

**折叠入口的文案要说清内容。** 「更多信息」什么也没说——更多什么？改成
「学习记录」后，用户不点开也知道里面是什么，能自己决定要不要看。
折叠区内部的小标题同理：「为什么是它」指代不明，要写成「为什么现在提示这个词」。

**并列理由要分行，不要拼成一句。** 三条理由用「·」连起来会读成一句没说完的话，
用户看不出这是三个独立原因。一条一行，每行一个短句。

**释义来源必须显示。** 同一个词，内置 ECDICT、用户导入词典、AI 生成的
详略和可靠度完全不同。卡片要标出来源（`OpenAIDictionaryResult.source`），
AI 结果还要写明「可能不准确」，否则用户无从判断该不该信。

### 8.2.3 弹层内的浮层不能挂 portal

悬停弹层用 `safePolygon` 判定鼠标是否还在词上。如果把菜单交给
`DropdownMenu` 之类的组件，它会挂到独立的 portal 里——鼠标移进菜单的那一刻，
safePolygon 认为已经离开单词，整张卡先关掉了，用户根本点不到菜单项。

弹层内部的菜单/二级面板必须渲染在弹层自己的 DOM 子树里（`relative` + `absolute`），
即使这意味着要手写行样式。这是**有意的例外**：portal 带来的层级正确性，
在这里换不来可用性。

### 8.2.4 查词卡的操作用平铺图标，不折叠

卡片右上角并排四个图标：收藏 / 已掌握 / 忽略 / 重新查询。

**试过、并已否决的做法**：把三个低频动作收进「更多操作」菜单，每行带一句
后果说明。理由听起来很充分（图标同形、后果不同），但实际用起来更差：

- 查词是「一眼扫过」的瞬时动作，多一次点击就多一次打断；
- 四个图标是**固定位置**的，用两三次就形成肌肉记忆，比读菜单快得多；
- 折叠把「收藏」也拖进了文字按钮，反而让头部变重。

因此规则是：**高频、位置固定的操作平铺，一步可达**。图标必须配
`title` + `aria-label`，把「点了会发生什么」放在悬停提示里，而不是藏在二级菜单。

这条与「别做无效开关」是同一条原则的两面：**优化不能以增加操作为代价**。

## 8.3 工具栏只放「视图控制」，跟随类操作贴内容

文稿面板右上角曾堆到 7 个图标：筛选、搜索、视图切换、译文开关、回到当前位置、
停靠切换、收起。问题不是数量本身，而是**它们不属于同一类动作**：

| 类别 | 特征 | 该放哪 |
| --- | --- | --- |
| 视图控制 | 改「怎么看」，长期有效 | 工具栏 |
| 跟随/临时动作 | 只在特定状态下才有意义 | 贴近内容，就近出现 |

**一次性设置也不要收进「更多」菜单。** 曾把「停靠方位」收进一个「⋯」菜单，
理由是它不常改。结果是：为了一个图标腾出位置，反而让用户多一次点击，
而且「⋯」本身也要占一个图标——净收益为零。**图标能直接表达的动作就直给**，
不要为了「整齐」制造二级菜单。

「回到当前播放位置」属于第三类：它**只在用户滚开时出现**，本质是「你离开了，
要不要回来」的临时提示。放进常驻工具栏有两个代价——稀释了那组视图控制的语义，
并且位置离用户的视线很远（用户正在看文稿中段，却要抬头点右上角）。

现在它是文稿区底部的浮动按钮：出现位置贴近阅读视线，出现时机恰好是用户已经离开
当前句。底部 `Footer` 留了 112px，不会遮住最后一句。

**浮动按钮用纯图标，不加文字。** 图标（回到顶部/回到当前位置）已经能自解释，
悬停有 tooltip；在阅读区中央横一条文字按钮，反而挡住了正文。

### 8.3.1 「被动跟随」与「显式归位」必须分开

这两个动作都表现为「滚动到当前句」，但**对浏览态的态度完全相反**：

- 被动跟随（`syncIntoView`）：用户滚开时必须让位，否则永远滚不开；
- 显式归位（`returnToCurrent`）：用户主动点按钮要求回去，恰恰要在浏览态下工作。

把两者合用一个入口的后果是：按钮只在浏览态出现，而入口在浏览态直接 return，
于是**点了永远没反应**。这不是样式问题，是状态机语义被合并了。

判断标准：一个函数里出现 `if (state === 'USER_BROWSING') return;`，而调用它的
UI 又只在 `USER_BROWSING` 下渲染，就说明这个入口被两种意图共用了。

## 8.4 TTS 音色是设置项，不是常量

离线朗读音色（`SHERPA_TTS_VOICES`）必须满足：

- **口音可区分**：至少美音 + 英音各一个，单词卡显示 `US`/`UK` 标识。
- **默认值优先音质**：默认取 `en-US-lessac-medium`，`amy-low` 音质偏机械，
  长时间听会疲劳。已有设置值的老用户保持原值，不被强制切换。
- **选择与下载分离**：切换音色只落盘，不自动下载；未安装时明确提示去哪里下载。
- **状态按音色独立判断**：装了美音不代表英音就绪，设置页要分别显示。

新增音色只需在 `sherpaTtsModel.ts` 的 `SHERPA_TTS_VOICES` 加一条——
下载、安装、选择、朗读、UI 全部数据驱动。

## 9. 为什么写在这里而不是 AGENTS.md

`AGENTS.md` 是给 coding agent 的**工作方式**说明（怎么找代码、怎么跑测试），
篇幅应保持短小，改动频率低。

`DESIGN.md` 是**领域规范**，内容多、迭代快、需要被设计师和工程师共同阅读。
业内通行做法是分开：

- `AGENTS.md` / `CLAUDE.md`：agent 协作约定，只放"指向"（例如"改 UI 前先读 docs/DESIGN.md"）。
- `DESIGN.md`：设计系统、token、组件选型、评审清单。
- 代码里的常量文件（`toolbarStyles.ts`、`index.css`）：可执行的唯一事实源。

三者关系：`DESIGN.md` 解释**为什么**，常量文件是**怎么实现**，`AGENTS.md` 负责**让 agent 知道去哪读**。

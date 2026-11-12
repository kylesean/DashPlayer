# 本地主题（Astryx extends）

这里放 Refrain 自己的主题：每套都通过 `defineTheme({ extends })` 继承一个 Astryx 官方主题，
只覆盖必要的地方，其余 tokens / 组件覆盖 / 图标继续跟随官方包。

## 为什么需要本地主题

1. **中文回退**：官方主题的拉丁字体（Figtree / Montserrat / Fustat / DM Sans /
   Playwrite / Poppins / Outfit / Fraunces / Albert Sans 等）没有中文字形，
   中文会按主题自带的 generic family 回落（Matcha 的标题甚至会落到系统衬线）。
   这里保留主题的拉丁字体，只把中文回退显式写成无衬线字族，避免中英混排跳字形。
2. **浅色卡片层级**：官方主题在 light 模式下把 `background-card/surface/popover` 全部定为纯白。
   工作台的大部分面积都是 Card，切主题时几乎看不出变化；这里给浅色面加一层很淡的主题色，
   深色值沿用官方主题，不破坏暗色层级。

## 字体

主题字体全部自托管在 `src/fronted/styles/fonts/`，由 `scripts/download-fonts.mjs` 生成
`src/fronted/styles/fonts.css`（只保留 latin / latin-ext 子集，中文走系统字体）。
这样运行时不再请求 Google Fonts，大陆网络与离线场景都不会回落到系统字体。

新增或调整主题字体后：

```bash
node scripts/download-fonts.mjs
```

## 主题 spacing 与固定尺寸 chrome

Astryx 官方主题并不共享同一套 spacing 基数：Matcha / Y2K 的 `--spacing-1` 是 6px，
其余主题是 4px。Astryx 的 Tailwind bridge 会把 Tailwind 的 `--spacing` 指到当前主题的
`--spacing-1`，因此 `h-8`、`w-11`、`gap-1` 这些工具类会随主题放大 1.5 倍。

窗口标题栏、窗口控制按钮等系统 chrome 必须保持像素稳定，统一使用固定 px
（高度常量见 `src/fronted/components/layout/TitleBar/titleBarMetrics.ts`），
不要用 spacing 工具类表达尺寸。普通页面内容仍可继续使用主题 spacing，让排版跟随主题。

## 目录约定

- `src/themes/<slug>/<name>Theme.ts`：主题源文件，导出 `<name>Theme`。
- `src/themes/<slug>/<name>Theme.doc.mjs`：`astryx theme add` 读取的描述文件。
- `<slug>.css` / `<slug>.js` / `<slug>.d.ts` / `<slug>.variants.d.ts`：`theme build` 产物，**提交进仓库**，
  不要手改；`src/astryx-themes.ts` 由 `astryx theme add/remove/use` 重新生成，也不要手改。

## 修改流程

```bash
# 改完主题源文件后重新构建产物
pnpm exec astryx theme build src/themes/*/*Theme.ts

# 校验仓库里的产物是否与源文件一致（CI/提交前）
pnpm exec astryx theme build src/themes/*/*Theme.ts --check

# 新增/删除主题后同步 src/astryx-themes.ts
pnpm exec astryx theme add <slug>
pnpm exec astryx theme remove <slug>
```

主题 slug 与后端存储值（`appearance.themeFamily`）的映射在 `src/fronted/app/App.tsx` 的
`THEME_SLUG_BY_FAMILY`，新增家族时两处要一起改。

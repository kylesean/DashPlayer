# Refrain — 品牌标识

一个字母，一个句号。整个标识只有这些。

## 概念

**R 后面紧跟着一个句号。**

- **R** = 名字本身。不画播放键、不画耳机、不画书，因为这些都是"播放器"的语法，不是这个产品的。
- **句号** = 一句话的结束。你也在这里停下、回听、再放一遍。
- 句号在乐谱里还是**休止**——声音停住的那一拍。Refrain 正好是"停下来又回来"的那一句。
- 两者之间的距离是**一个字干**（17.14），所以那个点不是标点符号，是这个字的一部分。

这也是为什么标识和全名**从不并排出现**：标记就是全名的缩写——首字母加句号。放在一起等于把同一个字母写了两遍。

## 几何

| 元素 | 数值（大写高度 = 100） |
|---|---|
| 字标 | DM Sans SemiBold，opsz 40，tracking −2%，300+ 锚点全部转轮廓 |
| 字干 | 17.14（DM Sans 在 opsz 40 下的真实笔重，不是估的） |
| R 与点的间距 | 17.14 = 一个字干 |
| 点 | 字体自带句号，直径 21.29 × 20.29，含 0.71 的视觉外扩（round overshoot） |
| 标记外框 | 110.28 × 100（≈1.1:1，接近正方形，适合图标槽位） |

点比字干大 1.24 倍，这是对的：圆形要比直线略大才看起来等重，字体本身已经这样画了，不要"修正"它。

R 的顶点、碗口、斜腿三点全部来自字体，没有重绘。标记的可信度来自"它就是一个字"，而不是"它像一个字"。

## 颜色

| 名称 | 值 | 用在哪 |
|---|---|---|
| Ink | `#16171A` | 主色。比纯黑柔，带一点冷灰 |
| Paper | `#FBFAF7` | 浅底、反白时的图形色 |
| Highlighter | `#F6C445` | **只用在那个句号上**——图标里的一点、界面里"正在播放的那一句"的标记。永不做文字色，永不做按钮底色 |
| Mute | `#8A8B90` | 辅助信息 |

黄色只占地一个点的面积。它越小，越像"被标出来的那一处"。

## 用法

**主次**：全名 `Refrain.` 是主标识。`R.` 是次标识，用于没有名字的位置：应用图标、头像、favicon、加载态、折叠后的侧边栏。

**永不并排**：`R.` 与 `Refrain.` 不放在同一行、同一屏。需要方形版式时用图标块（`png/app-icon-*`）而不是"标记 + 名字"。

**应用里的落点**：侧边栏折叠态用 `mark.svg` / `mark-reverse.svg`；展开态与关于页用
`wordmark.svg` / `wordmark-reverse.svg`（不再另写一遍产品名）；应用图标、favicon、
安装动画都从 `app-icon.svg` 派生。深浅主题只切换墨色 / 米白两套，不改几何。

**最小尺寸**：`R.` 不小于 16 px（`favicon.svg` 专门调过：留边 6/64，点放大 1.45 倍）。`Refrain.` 不小于 96 px 宽。

**留白**：四周至少留一个字干（17.14，即大写高度的 17%）。

**不要**：
- 不要把句号做成方形、菱形、或者放大成装饰圆点。
- 不要把句号挪到字母上方（那就变成省略号或度数符号了）。
- 不要给 R 加圆角、描边、投影、渐变、下划线。
- 不要为了"看起来居中"把标记往右推——右侧多出来的宽度就是那个点，它必须待在基线右侧。
- 不要用黄色写 `Refrain`，也不要给整个图标铺黄色底。

## 字体

字标是 **DM Sans SemiBold**，optical size 40，字距 −2%，已转成轮廓（`wordmark.svg` 里没有 `<text>`，运行时不需要装字体）。

DM Sans 是 SIL OFL 授权，项目本来就自托管了它（`src/fronted/styles/fonts/dm-sans/`），字标和界面同源，不需要额外授权。

## 文件

```
mark.svg                 标记（R.，墨色，110.28 × 100）
mark-reverse.svg         标记（米白，深底用）
mark-square.svg          标记（128 × 128 正方形画布，头像/方形槽位）
favicon.svg              16 px 起可用（留边更宽、点放大）
favicon-dark.svg         同上，深色底
favicon.ico              16 / 32 / 48 三档
wordmark.svg             全名 Refrain.（纯轮廓，无文字节点）
wordmark-reverse.svg     全名（米白，深底用）
app-icon.svg             应用图标 1024（墨底 + 米白 R + 黄点）。带 id="plate" / id="glyph"
app-icon-mono.svg        单色版（点和字母都是米白）
app-icon-light.svg       浅色版（米白底 + 墨色 R + 黄点）
png/app-icon-*.png       1024 / 512 / 256 / 128 / 64 / 32 / 16（设计交付用）
board.svg / board.png    提案板
tools/export_app_icons.py  把标识导出到应用各资产槽位（见下）
```

重新生成（在 `tools/` 里）：

```sh
# 1. SVG 源文件：build.py 要实例化可变字体，仓库不自带 venv，先建一个
python3 -m venv .venv && .venv/bin/pip install fonttools uharfbuzz brotli
.venv/bin/python build.py && .venv/bin/python build_board.py
# 2. 应用资产：assets/icons/*、iOS AppIcon、install.gif（系统 python3 + Pillow + rsvg-convert）
python3 export_app_icons.py
# 3. 手机页图标（从新 icon.svg 派生满幅方图）
cd ../../../.. && node scripts/build-mobile-icons.mjs && pnpm run build:mobile
```

R 和句号从项目自托管的 `src/fronted/styles/fonts/dm-sans/latin-01.woff2` 解压并实例化，缓存写在 `tools/cache/`（可删，会重新生成）。`export_app_icons.py` 直接手写 ICO（DIB 条目，兼容 rcedit）与 ICNS（PNG 条目），不需要 macOS 的 `iconutil`。

## 还没做的

- **商标检索**没做。第 9 类（软件）与第 41 类（教育）在投入商用前需要专业检索，这里不保证可注册性。
- 打包用的 `.icns` / `.ico` 已由 `tools/export_app_icons.py` 生成，但没有在真实 macOS / Windows 上验证过显示效果。
- **16 px 下的句号**只剩 3 px 左右，会糊成一个点。它仍然在，但基本只作为"右下角有一点"被感知。这是字母标识的固有代价，不是可以靠调参解决的问题。

# Refrain

> 基于 [solidSpoon/DashPlayer](https://github.com/solidSpoon/DashPlayer) 早期版本派生，现已独立演进与维护的现代视频播放与沉浸式语言学习桌面应用。

<p>
  <a href="LICENSE" target="_blank">
    <img alt="AGPL-3.0 license" src="https://img.shields.io/github/license/kylesean/Refrain.svg" />
  </a>
  <a href="https://github.com/kylesean/Refrain/releases/latest" target="_blank">
    <img alt="Releases" src="https://img.shields.io/github/v/release/kylesean/Refrain?label=Release" />
  </a>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-087EA4?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" />
</p>

> 详细使用文档与新版截图将在当前阶段功能迭代稳定后补充。

---

## 核心特性

- **沉浸式视频与字幕播放**：支持常见音视频与 `srt` / `vtt` / `ass` 字幕；提供按句跳转、单句循环、播完自动暂停、字幕时间轴微调与自定义快捷键。
- **离线词典与双语字幕**：内置 ECDICT 常用词离线词典（音标、释义、频次与考试标签），支持本地与云端 AI 字幕翻译。
- **本地字幕生成与跟读练习**：支持本地语音识别生成字幕，以及句子跟读/听写工作台。
- **AI 整句学习与语境复习**：围绕当前字幕上下文提供 AI 整句拆解对话、学习笔记沉淀与语境工坊复习。
- **多主题外观**：内置多套浅色/深色主题家族，支持跟随系统与快捷键切换。

---

## 安装说明

前往 [Latest Release](https://github.com/kylesean/Refrain/releases/latest) 下载对应平台安装包（桌面安装包暂未签名，如遇系统安全拦截可按以下方式放行）：

- **macOS（`.dmg`，`arm64` / `x64`）**：拖入 `Applications`。若系统提示应用已损坏或无法验证开发者，可在 `系统设置 → 隐私与安全性` 中选择「仍要打开」，或执行：
  ```bash
  xattr -c /Applications/Refrain.app
  ```
- **Windows（`.exe` / `.msi`）**：双击安装；若 SmartScreen 提示未识别应用，点击「更多信息 → 仍要运行」。
- **Linux（`.AppImage` / `.deb` / `.rpm`）**：
  ```bash
  # AppImage
  chmod +x Refrain-*.AppImage && ./Refrain-*.AppImage
  # 若缺少 FUSE，可附加 --appimage-extract-and-run 或安装 libfuse2
  ```

---

## 本地开发

环境要求：`Node.js`（`22.x >= 22.22.2` 或 `24.x >= 24.15.0`）、`pnpm`。

```bash
pnpm install
pnpm start          # 启动桌面开发环境
pnpm run lint       # ESLint 检查
pnpm run typecheck  # TypeScript 类型检查
pnpm run test:run   # 运行单元测试
```

---

## 致谢与开源协议

- **[solidSpoon/DashPlayer](https://github.com/solidSpoon/DashPlayer)**：本项目最初由 DashPlayer 派生而来，感谢原作者的早期探索与开源贡献。
- **[ECDICT](https://github.com/skywind3000/ECDICT)**（MIT License）：内置离线词典数据构建基础。

本项目沿用 [AGPL-3.0](LICENSE) 开源协议。

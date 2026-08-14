<p align="center">
  <img src="assets/icon.png" width="120" height="120" alt="IsleMind 应用图标">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  本地优先、服务商可控的 Android AI 工作区。
</p>

<p align="center">
  简体中文 · <a href="docs/readme/README.en.md">English</a> · <a href="docs/readme/README.ja.md">日本語</a>
</p>

<p align="center">
  <strong>当前版本：1.0.15（Android versionCode 115）</strong><br>
  <a href="https://github.com/domidoremi/IsleMind/releases">版本与更新日志</a>
</p>

> [!IMPORTANT]
> 当前 GitHub Release 不提供 APK、校验文件或其他构建产物。Release 仅用于标记源码版本并记录对应更新；如需运行应用，请在本地从源码构建。

## IsleMind 是什么

IsleMind 面向希望自行掌控模型服务商、对话数据和工作上下文的用户。它不提供托管式 AI 账号，而是将服务商配置、聊天、知识检索、任务运行和结果交付组织在同一个移动工作区中。

当前以 **Android** 作为主要开发和验证平台。仓库保留 Expo iOS 配置，但不宣称已经完成 iOS 发布或真机回归验证。

## 核心能力

- **服务商与模型**：配置 API Key、Base URL、协议、模型与能力开关；支持 OpenAI、Anthropic、Gemini、xAI、DeepSeek、Qwen、GLM 及 OpenAI/Anthropic 兼容端点。
- **对话工作区**：管理多会话、流式回复、推理状态、引用、附件和可复制内容，并保留明确的运行中、成功与失败反馈。
- **知识与上下文**：在设备侧管理知识文档、个人记忆、对话上下文和检索索引；本地模型不可用时保留可诊断的降级路径。
- **任务与工作流**：把长任务拆分为可跟踪步骤，保留取消、恢复、工具授权和执行证据边界。
- **结构化工作产物**：将模型回复整理为可交付内容，包含质量门槛、可执行行动、复制交接和继续提示。
- **系统级反馈**：通过应用内 Toast/Banner、状态层和 Android 通知呈现关键操作状态，避免静默成功或静默失败。

## 隐私与网络边界

对话、设置、知识索引、个人上下文和服务商配置默认保存在本机。以下行为会产生由用户动作触发的外部请求：

- 向用户选定的 AI 服务商发送推理、模型发现、embedding、转录或语音请求。
- 下载用户明确选择的本地模型资源。
- 检查 GitHub 远端版本。
- 执行用户明确启用的网络工具或集成。

服务商密钥存放在安全存储中，不写入便携 JSON 导出。提交 Issue、日志或截图前，请主动移除 API Key、令牌、私有 Base URL 和个人内容。

## 从源码运行 Android

### 环境要求

- [Bun 1.3.14](https://bun.sh/)（仓库以 `bun.lock` 为唯一依赖锁文件）
- Node.js（项目脚本和 Expo CLI 入口需要）
- JDK 17
- Android SDK、Platform Tools 与 ADB
- Android 模拟器或已开启 USB 调试的真机

### 安装与启动

```powershell
git clone https://github.com/domidoremi/IsleMind.git
cd IsleMind
bun install
bun run doctor
```

连接 Android 真机后：

```powershell
adb devices
adb reverse tcp:8081 tcp:8081
bun run android --device <设备名称> --no-bundler
```

在另一个终端启动 Metro：

```powershell
bun run start --localhost
```

如果不使用 USB 反向端口，请根据 Expo/Metro 所在网络配置设备可访问的开发服务器地址。

## 验证

修改代码后，至少运行与变更范围相匹配的检查：

```powershell
bun run type-check
bun run test:provider-intelligence
bun run test:architecture-boundary
bun run test:vnext-architecture-contract
```

Android UI、原生插件、通知、文件系统或打包行为的变更，还需要在模拟器或真机上进行聚焦验证。源码检查不能替代设备证据。

## 架构

IsleMind 正在按 vNext 边界渐进迁移：

```text
app/               Expo Router 路由与页面入口
src/modules/       按业务所有者划分的领域与应用模块
src/core/          跨模块共享的纯契约
src/platform/      可复用平台基础设施
src/bootstrap/     组合根与具体适配器绑定
src/presentation/  展示层控制器与视图模型
src/components/    React Native 组件
plugins/           Expo/Android 原生配置插件
assets/            运行时资源、品牌源文件与模型清单
scripts/           验证、审计、构建和证据脚本
```

架构变更前请先阅读：

- [vNext 架构重构计划](docs/architecture/islemind-vnext-architecture-refactor-plan.md)
- [vNext 模块公共 API](docs/architecture/vnext-module-public-api.md)
- [vNext 当前迁移状态](docs/architecture/vnext-migration-status.md)

新业务行为应进入对应的 `src/modules/<owner>/`；跨模块依赖只能通过所有者模块的公共入口。具体适配器由 `src/bootstrap/` 绑定，`src/services/` 仅作为有明确删除条件的旧兼容边界。

## 版本与发布

- 项目使用单一 [Semantic Versioning](https://semver.org/) 版本号。
- `package.json`、`app.json` 与 Git Tag 必须保持一致；Tag 格式为 `vX.Y.Z`。
- `0.x.x` 用于早期渐进式预发布标记，`1.x.x` 起用于正式版本。
- 每个 GitHub Release 必须包含与该版本实际变更对应的更新日志。
- 当前 GitHub Release 只发布源码版本标记，不上传 APK、校验文件或其他构建产物。
- 版本更新不会主动清除已经安装应用中的本地对话、知识库、记忆或服务商配置；涉及持久化迁移时必须单独说明。

## 仓库卫生

- 产品代码、文档和运行时资源分别放入 `src/`、`docs/` 与 `assets/`，不要把临时截图或导出文件放在仓库根目录。
- 本地日志、测试报告、Playwright 输出、截图、APK、AAB 和临时证据应留在已忽略目录中。
- 不提交 API Key、签名密钥、令牌、私有配置、设备日志中的敏感内容或下载缓存。
- 删除资源前必须先确认运行时、构建脚本和文档均无引用；需要保留的设计源文件应进入明确命名的 `assets/brand/source/`。
- 使用 Bun 安装依赖，不生成或提交其他包管理器锁文件。

## 资源与署名

- Isle UI 是 [animal-island-ui](https://github.com/guokaigdg/animal-island-ui) 的 React Native 适配实现。上游项目由 `guokaigdg` 发布并采用 CC BY-NC 4.0；IsleMind 不直接打包其 React DOM、CSS、字体或图片资产。
- 可选本地模型记录在 [assets/models/catalog.json](assets/models/catalog.json)，来源与署名见 [assets/models/NOTICE.md](assets/models/NOTICE.md)。
- 当前品牌源文件位于 `assets/brand/source/`，运行时生成资源位于 `assets/brand/generated/` 和 Expo 图标路径。

## 参与项目

提交问题前，请先搜索现有 [Issues](https://github.com/domidoremi/IsleMind/issues)，并提供可复现步骤、平台/设备、应用版本和经过脱敏的日志。涉及架构或持久化的修改应同时说明兼容性、迁移与回退边界。

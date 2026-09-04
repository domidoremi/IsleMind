<p align="center">
  <img src="assets/icon.png" width="120" height="120" alt="IsleMind 应用图标">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  本地优先、服务商可控的 Android AI 工作区
</p>

<p align="center">
  简体中文 · <a href="docs/readme/README.en.md">English</a> · <a href="docs/readme/README.ja.md">日本語</a>
</p>

## IsleMind 是什么

IsleMind 将模型服务商、对话、知识与记忆、Agent 任务以及工具集成集中在一个移动工作区中。应用以 Android 为主要平台，强调本地数据所有权、明确的网络边界和可恢复的 AI 执行过程。

## 主要能力

- **模型服务商管理**：配置 API Key、Base URL、协议、模型与能力开关；支持模型发现、批量导入、可用性检查、用量查询和运行诊断。
- **广泛的协议兼容**：支持 OpenAI、Anthropic、Gemini、xAI、DeepSeek、Qwen、GLM，以及 OpenAI-compatible 和 Anthropic-compatible 中转端点。
- **对话工作区**：管理多会话、流式回复、推理状态、来源引用、附件、草稿、消息操作和生成状态。
- **知识与个人上下文**：导入知识文档，维护个人记忆和对话上下文，并通过本地索引与 embedding 模型完成检索增强。
- **Agent 与任务执行**：提供步骤状态、取消与恢复、工具授权、执行证据，以及结构化工作产物的质量门槛、复制交接和继续提示。
- **工具与集成**：支持 MCP、Skills、内置工作区工具、联网检索、语音和 Android 设备能力；网络能力由用户配置或显式启用。
- **主题与语言**：提供极简、莫奈、Material 3、液态玻璃主题，支持浅色、深色、跟随系统和自定义强调色；界面支持简体中文、English 和日本語。
- **Android 体验**：包含安全区与键盘适配、后台状态通知、应用内更新检查、运行时诊断和故障恢复入口。

## 数据与网络边界

对话、设置、知识索引、个人上下文和服务商配置默认保存在本机。服务商凭据写入系统安全存储，便携 JSON 导出不包含 API Key。

以下操作会访问网络：

- AI 推理、模型发现、embedding、转录和语音服务；
- 本地模型资源下载；
- GitHub 版本检查；
- 用户启用的联网工具、MCP 服务和第三方集成。

## 当前版本

- 当前版本：`v1.0.22`
- Android：`versionCode 122`
- [查看 v1.0.22 Release 说明](https://github.com/domidoremi/IsleMind/releases/tag/v1.0.22)
- [下载 v1.0.21 APK 与校验文件](https://github.com/domidoremi/IsleMind/releases/tag/v1.0.21)
- [查看全部 Releases 与中英文版本记录](https://github.com/domidoremi/IsleMind/releases)

`v1.0.22` Release 暂不附带 APK 构建资产，可安装的最新构建仍为 `v1.0.21`。

### v1.0.22 更新

- 重构聊天工作区与移动端导航，改善消息列表滚动、键盘交互、浮动输入框和连续会话画布体验。
- 完善主题表达与玻璃表面组件，统一聊天、设置和反馈状态在不同主题下的视觉与可读性。
- 错误提示跟随当前选择的应用语言显示。
- 增强服务商运行时：改进模型能力识别、请求参数映射、请求优化、健康检查、故障转移和本地路由。
- 完善便携数据备份与恢复流程，并扩展用量统计、价格目录和用量归因诊断能力。
- 更新 Expo / React Native 依赖与 Android 构建工具链，继续覆盖 16 KB 页面兼容性和 ARM64 构建验证。

### APK 选择

- `no-model`：安装包更小，不内置本地 embedding 模型。
- `with-model-small`：内置小型本地 RAG embedding 模型。
- 不确定设备架构时，优先选择对应变体的 `universal-64` 包；`.sha256` 文件可用于校验下载完整性。

## 开发环境

- [Bun 1.3.14](https://bun.sh/)（依赖安装与脚本运行）
- Node.js（部分项目脚本的运行时）
- JDK 17
- Android SDK
- Android Platform Tools / ADB
- Android 模拟器或启用 USB 调试的真机

`bun.lock` 是权威依赖锁文件，请勿混用其他包管理器更新依赖。

## 获取源码

```powershell
git clone https://github.com/domidoremi/IsleMind.git
cd IsleMind
bun install
bun run doctor
```

## 运行 Android

启动 Metro：

```powershell
bun run start --localhost
```

连接 Android 设备并启动应用：

```powershell
adb devices
adb reverse tcp:8081 tcp:8081
bun run android --device <设备名称> --no-bundler
```

## 项目结构

```text
app/              Expo Router 页面与路由入口
src/core/         共享纯类型、协议与基础契约
src/modules/      业务模块及其公开 API
src/platform/     存储、网络和原生平台适配
src/bootstrap/    依赖装配与运行时组合根
src/presentation/ 展示层控制器与用例桥接
src/components/   React Native 界面组件
scripts/          测试、审计、诊断与本地发布脚本
plugins/          项目内 Expo / Android 原生插件
docs/             架构说明、迁移状态与多语言文档
```

架构约束以 [IsleMind 架构](docs/architecture/architecture.md) 和 [模块公共 API](docs/architecture/module-public-api.md) 为准。

## 常用验证

```powershell
bun run type-check
bun run test:architecture-boundary
bun run test:architecture-contract
bun run test:walking-skeleton
bun run test:task-runtime
bun run test:provider-intelligence
bun run test:product-mobile-layout
```

## 资源与署名

- Isle UI 是 [animal-island-ui](https://github.com/guokaigdg/animal-island-ui) 的 React Native 适配实现；上游许可证为 CC BY-NC 4.0。
- 本地模型目录：[assets/models/catalog.json](assets/models/catalog.json)
- 模型来源与署名：[assets/models/NOTICE.md](assets/models/NOTICE.md)
- 品牌源文件：`assets/brand/source/`
- 运行时品牌资源：`assets/brand/generated/`

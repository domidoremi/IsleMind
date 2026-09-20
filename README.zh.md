<p align="center">
  <img src="assets/icon.png" width="120" height="120" alt="IsleMind 应用图标">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  本地优先、服务商可控的 Android AI 工作区
</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文 · <a href="README.ja.md">日本語</a>
</p>

## IsleMind 是什么

IsleMind 将模型服务商、对话、知识与记忆、Agent 任务以及工具集成集中在一个移动工作区中。应用以 Android 为主要平台，强调本地数据所有权、明确的网络边界和可恢复的 AI 执行过程。

## 主要能力

- **模型服务商管理**——配置 API Key、Base URL、协议、模型与能力开关；支持模型发现、批量导入、可用性检查、用量查询和运行诊断。
- **广泛的协议兼容**——支持 OpenAI、Anthropic、Gemini、xAI、DeepSeek、Qwen、GLM，以及 OpenAI-compatible 和 Anthropic-compatible 中转端点。
- **对话工作区**——管理多会话、流式回复、推理状态、来源引用、附件、草稿、消息操作和生成状态。
- **知识与个人上下文**——导入知识文档，维护个人记忆和对话上下文，并通过本地索引与 embedding 模型完成检索增强。
- **Agent 与任务执行**——提供步骤状态、取消与恢复、工具授权、执行证据，以及结构化工作产物的质量门槛、复制交接和继续提示。
- **工具与集成**——支持 MCP、Skills、内置工作区工具、联网检索、语音和 Android 设备能力；网络能力由用户配置或显式启用。
- **主题与语言**——提供极简、莫奈、Material 3、液态玻璃主题，支持浅色、深色、跟随系统和自定义强调色；界面支持简体中文、English 和日本語。
- **Android 体验**——包含安全区与键盘适配、后台状态通知、应用内更新检查、运行时诊断和故障恢复入口。

## 数据与网络边界

对话、设置、知识索引、个人上下文和服务商配置默认保存在本机。服务商凭据写入系统安全存储，便携 JSON 导出不包含 API Key。

以下操作会访问网络：

- AI 推理、模型发现、embedding、转录和语音服务；
- 本地模型资源下载；
- GitHub 版本检查；
- 用户启用的联网工具、MCP 服务和第三方集成。

## 当前资格验证版本

| 项目 | 值 |
|---|---|
| 源码版本 | `1.1.2` |
| Android `versionCode` | `127` |
| 状态 | 预发布资格验证进行中 |
| `1.1.2` 生产 APK 附件 | 尚未发布 |

`1.1.2` 正在进行资格验证。GitHub 标签与 Release 说明不代表生产构建已通过验证；当前 Release 没有 APK 或校验文件附件。开发与资格验证需从源码构建，生产 APK 仅以通过验证的 Release 实际附件为准。

- [查看 v1.1.2 Release 说明](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.2)
- [查看全部 Releases 与实际附件](https://github.com/domidoremi/IsleMind/releases)

### 1.1.2 验证范围

本版本为仅源码预发布，不提供可安装的 1.1.2 APK。下述 1.1.1 设备与构建结果为历史证据，不代表 1.1.2 精确制品已通过验证。

2026-09-21 已在本地构建 `com.islemind.app` 的 ARM64 Release APK（`1.1.1` / `126`，no-model），校验值、源码输入绑定及 16 KiB 对齐检查均通过；因缺少生产签名，仍为**未签名、不可安装**候选包。隔离 Android 12 M2007J3SC 上的 C4 与完整应用生命周期恢复已通过，已安装**调试包**的私有文件哈希保持不变。持久浏览器配置的 Web 验证也已通过，但不代表生产签名包、其他设备或隐私窗口已获认证。合法签名、适用的策略与许可决定以及发布批准仍未完成，**生产发布就绪状态仍为 NOT READY**。详见[本地验证与打包说明](README.md#web-persistence-qualification)。

- 模型执行配置与推理准入遵循所选服务商支持的能力。
- 故障披露区分服务商、模型与请求错误；用量展示保留 token 数据不可用状态。
- 联网检索适配器与本地存储恢复包含针对性回归测试。
- Android 资格验证使用隔离测试应用，生产签名与 Release 不可调试策略保持不变。

### APK 变体

- `no-model`——默认构建，不内置本地 embedding 模型，本地全文检索仍可用。
- `with-model-small`——内置标准小型 RAG embedding 模型，需在目标设备完成原生资格验证。
- 多语言 embedding 标记为 **EXPERIMENTAL / OPT-IN（实验性／主动启用）**，不阻塞默认候选资格验证。
- 架构分包与 `universal-64` 仅在 Release 实际附带对应 APK 和 `.sha256` 时可下载。

## 开发环境

- [Bun 1.4.2](https://bun.sh/)（依赖安装与脚本运行）
- Node.js（部分项目脚本的运行时）
- JDK 25
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
docs/             架构、公共 API 与技术决策
```

[文档索引](docs/README.md) 汇集架构约束、模块公共 API、验证要求与技术决策。

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

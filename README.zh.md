<p align="center">
  <img src="assets/icon.png" width="120" height="120" alt="IsleMind 应用图标">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  本地优先、执行可控的 Android 端侧 Agent 平台
</p>

<p align="center">
  <a href="README.md">English</a> · 简体中文 · <a href="README.ja.md">日本語</a>
</p>

## IsleMind 是什么

IsleMind 将模型服务商、对话、知识与记忆、Agent 任务以及工具集成集中在一个端侧 Agent 平台中。应用以 Android 为主要平台，强调本地数据所有权、明确的网络边界和可恢复的执行过程。

### Agent 闭环

**LLM 决策 → Harness 调度与约束 → 端侧执行 → 执行回执 → LLM 再决策。**

- **LLM**：根据任务和真实执行结果选择下一步工具或给出答复，不直接拥有设备权限。
- **Harness**：冻结工具与上下文范围，校验参数、权限和预算，调度执行并持久化等待确认、取消、失败和恢复状态。
- **端侧运行时**：通过 Tasks 和平台适配器执行工作区、知识检索及已授权的 Android 能力，返回可追踪的结果；不提供无限制 Shell、权限绕过或不确定副作用的自动重放。

端侧指执行控制与数据落在设备上，不代表所有 LLM 推理离线。服务商推理和已启用的网络工具仍会访问网络。详见[架构与执行边界](docs/architecture/architecture.md#16-agent-harness)。

## 主要能力

- **模型服务商管理**——配置 API Key、Base URL、协议、模型与能力开关；支持模型发现、批量导入、可用性检查、用量查询和运行诊断。
- **广泛的协议兼容**——支持 OpenAI、Anthropic、Gemini、xAI、DeepSeek、Qwen、GLM，以及 OpenAI-compatible 和 Anthropic-compatible 中转端点。
- **对话工作区**——管理多会话、流式回复、推理状态、来源引用、附件、草稿、消息操作和生成状态。
- **知识与个人上下文**——导入知识文档，维护个人记忆和对话上下文，并通过本地索引与 embedding 模型完成检索增强。
- **Agent 与任务执行**——提供步骤状态、取消与恢复、工具授权、执行证据，以及结构化工作产物的质量门槛、复制交接和继续提示。
- **工具与集成**——支持 MCP、Skills、内置工作区工具、联网检索、语音和 Android 设备能力；网络能力由用户配置或显式启用。
- **主题与语言**——提供极简、莫奈、Material 3、液态玻璃和 Animal Island UI 主题，支持浅色、深色、跟随系统和自定义强调色；界面支持简体中文、English 和日本語。
- **Android 体验**——包含安全区与键盘适配、后台状态通知、应用内更新检查、运行时诊断和故障恢复入口。

## 数据与网络边界

对话、设置、知识索引、个人上下文和服务商配置默认保存在本机。服务商凭据写入系统安全存储，便携 JSON 导出不包含 API Key。

以下操作会访问网络：

- AI 推理、模型发现、embedding、转录和语音服务；
- 本地模型资源下载；
- GitHub 版本检查；
- 用户启用的联网工具、MCP 服务和第三方集成。

## 版本下载

| 项目 | 值 |
|---|---|
| 版本 | `1.1.2` |
| Android 构建号 | `127` |
| 渠道 | 预览版 |

[查看更新内容与可用下载](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.2)。APK 与对应的 `.sha256` 校验文件以 Release 页面附件为准。预览版适合尝鲜与测试，安装前请备份数据。

### 更新亮点

- 更清晰的回复活动步骤与完成状态。
- 更流畅的模型可用性页面加载体验。
- 优化 Android 启动配色与液态玻璃输入框外观。

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
$env:ANIMAL_ISLAND_UI_REF='<配套 UI 的完整提交 SHA>'
node scripts/prepare-animal-island-ui.js
bun install --frozen-lockfile
bun run doctor
```

RN 主题 fork 必须与 IsleMind 位于同级目录。`bun install` 直接链接并构建其声明；通用主题组件问题在 fork 修复，不在 IsleMind 重复移植。职责边界与 CI/EAS 配置见 [UI 接入说明](src/components/ui/isle/README.md)。

将占位符替换为与应用源码配套的 UI 完整提交 SHA，不使用浮动分支，也不使用缺少必需本地修改的旧 HEAD。准备脚本拒绝缺失/不匹配的固定引用并保留已有工作。GitHub 工作流读取仓库变量 `ANIMAL_ISLAND_UI_REF`；EAS 环境需单独设置同一值。当前未提交源码的限制见[发布前提](docs/release/google-play.md#配套构建输入与并发边界)。

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

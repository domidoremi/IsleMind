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

<p align="center">
  <strong>1.0.16 · Android 116</strong><br>
  <a href="https://github.com/domidoremi/IsleMind/releases">版本记录</a>
</p>

## 产品定位

IsleMind 用于管理模型服务商、对话、知识库、个人上下文、任务工作流。

主要平台：Android。

## 功能

- **服务商管理**：API Key、Base URL、协议、模型、能力开关、模型发现。
- **模型兼容**：OpenAI、Anthropic、Gemini、xAI、DeepSeek、Qwen、GLM、OpenAI/Anthropic 兼容端点。
- **对话工作区**：多会话、流式回复、推理状态、引用、附件、内容复制。
- **知识与上下文**：知识文档、个人记忆、对话上下文、检索索引、本地模型。
- **任务与工作流**：步骤状态、取消、恢复、工具授权、执行证据。
- **结构化工作产物**：质量门槛、可执行行动、复制交接、继续提示。
- **操作反馈**：Toast、Banner、状态层、Android 通知、进行中/成功/失败状态。
- **外观设置**：浅色、深色、自定义颜色、简体中文、English、日本語。

## 数据与网络

对话、设置、知识索引、个人上下文、服务商配置默认保存在本机。

以下功能会访问网络：

- AI 推理、模型发现、embedding、转录、语音。
- 本地模型资源获取。
- GitHub 版本检查。
- 用户启用的网络工具与集成。

服务商凭据存放在安全存储中。便携 JSON 导出不包含 API Key。

## 开发环境

- [Bun 1.3.14](https://bun.sh/)
- Node.js
- JDK 17
- Android SDK
- Android Platform Tools / ADB
- Android 模拟器或 USB 调试真机

`bun.lock` 是项目依赖锁文件。

## 安装

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

连接真机：

```powershell
adb devices
adb reverse tcp:8081 tcp:8081
bun run android --device <设备名称> --no-bundler
```

## 常用检查

```powershell
bun run type-check
bun run test:provider-intelligence
bun run test:product-mobile-layout
bun run test:theme-system
```

## 资源与署名

- Isle UI 是 [animal-island-ui](https://github.com/guokaigdg/animal-island-ui) 的 React Native 适配实现。上游许可证：CC BY-NC 4.0。
- 本地模型目录：[assets/models/catalog.json](assets/models/catalog.json)
- 模型来源与署名：[assets/models/NOTICE.md](assets/models/NOTICE.md)
- 品牌源文件：`assets/brand/source/`
- 运行时品牌资源：`assets/brand/generated/`

<p align="center">
  <img src="../../assets/icon.png" width="120" height="120" alt="IsleMind app icon">
</p>

<h1 align="center">IsleMind</h1>

<p align="center">
  本地优先的移动 AI 工作区，用于私有服务商配置、知识辅助对话、个人上下文和结构化工作产物。
</p>

<p align="center">
  <a href="../../README.md">简体中文</a> | <a href="README.en.md">English</a> | <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/domidoremi/IsleMind/releases/latest">最新 APK</a>
</p>

## 能力边界

IsleMind 默认在设备上保存对话、设置、上下文索引、Agentic RAG 索引和服务商配置。数据离开本机必须由以下动作触发：

- 用户选择已配置的 AI 服务商并发起推理、embedding、转录、语音或模型发现请求。
- 用户导出或导入 JSON 数据。
- 用户下载、校验或启用本地 RAG 模型。
- 用户通过 Android 系统安装器安装 GitHub Release APK。

SecureStore 中的服务商 Key 不会写入 JSON 导出文件。默认 APK 不内置模型权重；本地模型必须来自内置 catalog 或用户明确选择的下载流程。

## 用户路径

| 场景 | 默认行为 | 输出 |
| --- | --- | --- |
| 配置服务商 | 用户输入 API Key、Base URL、模型和能力开关 | 可用于对话、模型发现和运行时诊断的服务商配置 |
| 发起对话 | 应用读取当前会话、个人上下文、知识检索结果和模型设置 | AI 回复、引用信息、token 使用记录和可复制内容 |
| 导入知识 | Agentic RAG 执行分块、索引、混合检索和本地 rerank | 可引用的知识索引和检索证据 |
| 生成工作产物 | 应用将模型回复整理为结构化交付内容 | 质量门槛、可执行行动、复制交接和继续提示 |
| 更新 Android 版本 | 应用检查 GitHub Release APK 并打开系统安装器 | 用户确认后的冷更新安装 |

## 下载与 APK 变体

从 [GitHub Releases](https://github.com/domidoremi/IsleMind/releases/latest) 下载 Android APK。

本地模型变体：

- `no-model`：默认构建，不内置本地模型文件。
- `with-model-small`：内置 `all-MiniLM-L6-v2`，用于本地 embedding。

Android 架构变体：

- `arm64-v8a`：64 位 ARM 设备。
- `x86_64`：64 位 x86 设备。
- `universal-64`：同时包含 64 位 ARM 和 64 位 x86 原生库。
- `armeabi-v7a-legacy`：面向旧 32 位 ARM 设备。

如果已安装 `no-model` APK，应用内本地模型页面仍可下载、校验并启用 RAG 模型。

## 风险控制

- 服务商请求必须由用户配置触发；没有可用服务商时，应用必须保持在本地配置状态。
- 本地模型缺失或不可用时，检索能力会回退到 hash embedding 路径。
- Android 更新必须通过系统安装器确认；应用不会静默替换 APK。
- `universal-64` 包含 `arm64-v8a` 和 `x86_64`。`armeabi-v7a-legacy` 面向旧 32 位设备，不参与 Android 16 的 64 位 page-size 验证。

## 失败行为

- AI 服务商不可达、Key 无效或模型能力不匹配时，对话运行时必须返回可诊断状态，而不是丢弃用户输入。
- RAG 模型文件缺失时，本地模型页面必须保留下载和校验入口；检索流程必须保留降级路径。
- APK 下载失败时，已安装版本必须保持不变；安装生效必须经过系统安装器确认。

## 资源与署名

- Isle UI 是 `animal-island-ui` 的 React Native 适配实现。上游项目由 `guokaigdg` 发布，许可证为 MIT：<https://github.com/guokaigdg/animal-island-ui>。
- 默认 APK 不包含模型权重。可选模型记录在 `assets/models/catalog.json`，来源与署名说明记录在 `assets/models/NOTICE.md`。
- 应用图标源图保存为 `assets/brand/source/isle-pet-preview-base.png`。生成资产会去除黄色背景，并输出到 `assets/` 与 Android launcher 资源目录。

## 技术栈

- 应用运行时：[Expo SDK](https://docs.expo.dev/)、[React Native](https://reactnative.dev/)、[React](https://react.dev/)、[Expo Router](https://docs.expo.dev/router/introduction/)、[TypeScript](https://www.typescriptlang.org/)。
- 移动目标：[Android APK](https://developer.android.com/build/building-cmdline)、[EAS](https://docs.expo.dev/eas/) 配置、[Expo iOS metadata](https://docs.expo.dev/versions/latest/config/app/)。
- UI 与动效：[NativeWind](https://www.nativewind.dev/)、[Tailwind CSS](https://tailwindcss.com/)、[Isle UI](../../src/components/ui/isle/README.md)、[lucide-react-native](https://lucide.dev/)、[moti](https://moti.fyi/)、[React Native Reanimated](https://docs.swmansion.com/react-native-reanimated/)、[Gesture Handler](https://docs.swmansion.com/react-native-gesture-handler/)、[Safe Area Context](https://github.com/AppAndFlow/react-native-safe-area-context)、[Screens](https://github.com/software-mansion/react-native-screens)、[SVG](https://github.com/software-mansion/react-native-svg)、[Expo Blur](https://docs.expo.dev/versions/latest/sdk/blur-view/)。
- 本地存储与设备 API：[AsyncStorage](https://react-native-async-storage.github.io/async-storage/)、[Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)、[Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)、[Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/)、[Expo Document Picker](https://docs.expo.dev/versions/latest/sdk/document-picker/)、[Expo Image Picker](https://docs.expo.dev/versions/latest/sdk/imagepicker/)、[Expo Clipboard](https://docs.expo.dev/versions/latest/sdk/clipboard/)、[Expo Sharing](https://docs.expo.dev/versions/latest/sdk/sharing/)、[Expo Application](https://docs.expo.dev/versions/latest/sdk/application/)、[Expo Constants](https://docs.expo.dev/versions/latest/sdk/constants/)、[Expo Haptics](https://docs.expo.dev/versions/latest/sdk/haptics/)、[Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/)、[Expo Speech](https://docs.expo.dev/versions/latest/sdk/speech/)。
- AI 服务商运行时：[OpenAI](https://platform.openai.com/docs/)、[Anthropic](https://docs.anthropic.com/)、[Google Gemini](https://ai.google.dev/gemini-api/docs)、[Xiaomi MiMo](https://mimo.mi.com/)、[OpenAI-compatible providers](https://platform.openai.com/docs/api-reference)、[自定义兼容端点](https://platform.openai.com/docs/api-reference)，以及 [DeepSeek](https://api-docs.deepseek.com/)、[DashScope/Qwen](https://www.alibabacloud.com/help/en/model-studio/use-qwen-by-calling-api)、[Zhipu/GLM](https://docs.bigmodel.cn/)、[xAI](https://docs.x.ai/)、[OpenRouter](https://openrouter.ai/docs/api/reference)、[NewAPI](https://docs.newapi.pro/)、[OneAPI](https://github.com/songquanpeng/one-api)、[Sub2API](https://sub2api.info/) 预设。
- 检索与本地模型：Agentic RAG、[ONNX Runtime React Native](https://onnxruntime.ai/docs/get-started/with-javascript/react-native.html)、[local embedding model catalog](../../assets/models/catalog.json)、模型下载校验、[Xenova](https://huggingface.co/Xenova) 与 [BAAI](https://huggingface.co/BAAI) 模型来源、hash embedding fallback。
- 多语言：[i18next](https://www.i18next.com/)、[React i18next](https://react.i18next.com/)、[Expo Localization](https://docs.expo.dev/versions/latest/sdk/localization/)、`zh-CN`、`en`、`ja` 资源文件。

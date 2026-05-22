# IsleMind

[English](README.md) | 简体中文 | [日本語](README.ja.md)

IsleMind 是一个本地优先的移动 AI 工作区，用于专注对话、私有服务商配置、可复用个人上下文和知识辅助聊天。

## 亮点

- 使用自定义 AI 服务商和模型进行对话。
- 将对话、设置和本地上下文保存在设备上。
- 使用 Agentic RAG 导入知识：混合检索、语义分块、本地重排序、引用和降级路径。
- 在应用内下载可选本地 Embedding 模型；没有模型文件时使用 hash embedding 降级。
- 查看模型输出的来源、检索与过程信息。
- 通过 GitHub Release APK 更新 Android 版本。

## 下载

从 [GitHub Releases](https://github.com/domidoremi/IsleMind/releases/latest) 下载最新 Android APK，然后在设备上安装。Release notes 会提供每个 APK 版本的直接下载链接。

当前应用版本：`1.0.3`。

Release APK 按本地模型包拆分：

- `no-model`：默认构建，不内置本地模型文件。
- `with-model-small`：内置 `all-MiniLM-L6-v2`，用于本地 embedding。

Release APK 也按 Android 架构拆分：

- `arm64-v8a`：64 位 ARM 设备使用。
- `x86_64`：64 位 x86 设备使用。
- `armeabi-v7a`：32 位 ARM 设备使用。
- `universal`：兼容范围最广，体积较大。

应用内“本地模型”页面也支持下载、校验和启用 RAG 模型。

## Android 16 KB Page Size

Release 构建会运行 `npm run apk:validate-16kb`，用 `zipalign -P 16` 检查 APK ZIP page alignment，并用 `llvm-readelf` 检查 native library 的 ELF `LOAD` segment alignment。ZIP 对齐由 Android 构建控制；ELF 对齐取决于 Expo、React Native、ONNX Runtime 等依赖提供的原生库。如果校验报告第三方 `.so` 仍是 4 KB `LOAD` alignment，需要升级或重建对应依赖后，才能标记为完全兼容 Android 16 KB page-size 设备。

## 本地 RAG 模型

IsleMind 默认 APK 不包含模型权重。可选本地模型记录在 `assets/models/catalog.json`，模型来源与署名说明在 `assets/models/NOTICE.md`。

当前 catalog 中的模型是 Xenova 在 Hugging Face 发布的 ONNX 分发版本，上游模型家族来自 `sentence-transformers` 和 BAAI。模型文件并非 IsleMind 贡献者创作；重新分发或商用前请查看上游模型卡和许可证。

## 隐私

IsleMind 采用本地优先设计。对话、设置、上下文索引数据、Agentic RAG 索引和服务商配置会保存在设备上；只有在你导出/导入 JSON、下载本地模型，或向已配置的 AI 服务商发送内容时，数据才会离开本机。SecureStore 中的服务商 Key 不会包含在 JSON 导出中。

## 更新

IsleMind 当前仅使用 APK 冷更新。应用内更新会检查最新 GitHub Release APK，在 Android 上下载并打开系统安装器，由你确认安装。

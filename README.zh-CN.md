# IsleMind

[English](README.md) | 简体中文 | [日本語](README.ja.md)

IsleMind 是一个本地优先的移动 AI 工作区，用于专注对话、私有服务商配置、可复用个人上下文和知识辅助聊天。

## 亮点

- 使用自定义 AI 服务商和模型进行对话。
- 将对话、设置和本地上下文保存在设备上。
- 导入知识、检索已保存上下文，并以 JSON 导出数据。
- 查看模型输出的来源与过程信息。
- 通过 GitHub Release APK 更新 Android 版本。

## 下载

从 [GitHub Releases](https://github.com/domidoremi/IsleMind/releases/latest) 下载最新 Android APK，然后在设备上安装。除非明确需要更小的 ABI 专用包，建议使用 universal APK。

当前应用版本：`1.0.0`。

## 隐私

IsleMind 采用本地优先设计。对话、设置、上下文索引数据和服务商配置会保存在设备上；只有在你导出/导入 JSON，或向已配置的 AI 服务商发送内容时，数据才会离开本机。SecureStore 中的服务商 Key 不会包含在 JSON 导出中。

## 更新

IsleMind 当前仅使用 APK 冷更新。应用内更新会检查最新 GitHub Release APK，在 Android 上下载并打开系统安装器，由你确认安装。

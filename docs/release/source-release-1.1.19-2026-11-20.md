# IsleMind 1.1.19 实际发布记录

日期：2026-11-20，时区Asia/Taipei。[IsleMind 1.1.19](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.19)于2026-11-20 15:09:25（台北）实际发布。

标签v1.1.19固定到源码版本提交`6ee8bd9af5aca1646a260072c0cc6d2696eabd8d`，源码1.1.19/144。GitHub API核对公开稳定状态与最新版本，简体中文、英文、日文正文与标签内[v1.1.19.md](./v1.1.19.md)逐字一致，正文SHA-256为`630861edb8b2fe04aa9a71096f44ae7673871f5aa231992f2724a6406938a9d6`。

本版覆盖五项已验证修复：场景副本说明、提示词同步、输入焦点、返回状态与密钥策略。检查点`a1efb879d1cf1ac4933c18568f2225a0a176f471`之后开始下一周期，当前0/5。[更新记录](./source-version-1.1.19-2026-11-20.md)保留各项实际验证范围、失败及后续工作。

45个历史Release的标签、正文、发布日期、稳定/预发布状态与附件元数据保持，原有远端标签一致。提交、推送、标签和发布前均核对六个远端工作流，仅存在pull_request或workflow_dispatch事件；41条任务记录保持，没有新增或活动任务。

五组版本资料检查及22项版本契约测试通过。487个原有未完成路径除package版本字段外保持，最小候选提交保留package其他改动。固定安装仍为1.1.8/133，updates/android.json保持1.1.2/127实际APK候选及空资产。没有构建、导出、安装、上传APK或派发工作流。

场景提示词、输入焦点和返回状态已有范围明确的原生证据，Web会话表单90组主题、语言和尺寸组合仅覆盖字段保持与DOM边界；两次截图超时，未授予Web视觉通过。密钥策略本批仅完成独立主线九组146项、工作区九组158项、各自类型、架构和凭据检查，计数不相加；媒体请求使用合成传输验证，没有新增真实模型请求。当前原生第42份源码及1672恢复基线保持，本次未操作设备；版本字段更新后不能据此宣称当前运行源码与工作区全量一致。场景路由组策略预览及其主线依赖、31路由、55原型、完整主题语言尺寸、TalkBack、真实存储故障和内存性能仍待完成。fullAcceptance、nativeVerified、visualAcceptance 及广义 loadedRuntimeVerified 保持 false。

证据：[版本检查](../../test-evidence/release/source-version-1.1.19-20261120-01/version-checks-03.json)、[版本提交](../../test-evidence/release/source-version-1.1.19-20261120-01/commit-version-04.json)、[实际发布与远端复核](../../test-evidence/release/source-version-1.1.19-20261120-01/publication-receipt-05.json)。

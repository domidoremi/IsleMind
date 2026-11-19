# IsleMind 1.1.18 实际发布记录

日期：2026-11-20，时区Asia/Taipei。[IsleMind 1.1.18](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.18)于2026-11-20 03:55:59（台北）实际发布。

标签v1.1.18固定到源码版本提交`a09eef29e9580491e00c24c821a547e1285c68eb`，源码1.1.18/143。GitHub API核对公开稳定状态与最新版本，简体中文、英文、日文正文与标签内[v1.1.18.md](./v1.1.18.md)逐字一致，正文SHA-256为`461f1df2c24dc52c07fab05ede9b8035cf933bda1fa4ab777647f6d0911a18e3`。

本版覆盖五项已验证修复：密钥状态、模型数量、输入焦点、候选变更收尾与费用提示。检查点`e92f01483ecdf8ecec0f4a513f40a80a7a9118df`之后开始下一周期，当前0/5。[更新记录](./source-version-1.1.18-2026-11-20.md)保留各项实际验证范围、失败及后续工作。

44个历史Release的标签、正文、发布日期、稳定/预发布状态与附件元数据保持，原有远端标签一致。提交、推送、标签和发布前均核对六个远端工作流，仅存在pull_request或workflow_dispatch事件；41条任务记录保持，没有新增或活动任务。

五组版本资料检查及22项版本契约测试通过。492个原有未完成路径除package版本字段外保持，最小候选提交保留package其他改动。固定安装仍为1.1.8/133，updates/android.json保持1.1.2/127实际APK候选及空资产。没有构建、导出、安装、上传APK或派发工作流。

密钥状态、模型数量、输入焦点及候选变更收尾均有范围明确的行为证据。日文和英文浅色原生行内重试、回复版本与未发送草稿保持已独立核对；53张表、四项原始存储、六组草稿和恢复槽、原有资料及70条请求恢复一致。费用提示修复仅完成源码与自动回归验证，设备仍加载第37份源码，尚未包含该修复及本次版本字段。其余主题语言和尺寸、无障碍、供应商及同模型路由组、31路由与55原型完整矩阵继续验收。fullAcceptance、nativeVerified、visualAcceptance 及广义 loadedRuntimeVerified 保持 false。

证据：[版本检查](../../test-evidence/release/source-version-1.1.18-20261120-01/version-checks-03.json)、[版本提交](../../test-evidence/release/source-version-1.1.18-20261120-01/commit-version-04.json)、[实际发布与远端复核](../../test-evidence/release/source-version-1.1.18-20261120-01/publication-receipt-05.json)。

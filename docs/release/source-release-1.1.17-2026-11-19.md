# IsleMind 1.1.17 实际发布记录

日期：2026-11-19，时区Asia/Taipei。[IsleMind 1.1.17](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.17)于2026-11-19 19:54:26（台北）实际发布。

标签v1.1.17固定到源码版本提交`277245f95ea57fe127cd7d48da81161f921999b3`，源码1.1.17/142。GitHub API核对公开稳定状态与最新版本，简体中文、英文、日文正文与标签内[v1.1.17.md](./v1.1.17.md)逐字一致，正文SHA-256为`fcf61769c22dbcdb46901a98d42346b179341eed63ec2df237033dd8e78c6dba`。

本版覆盖五项已验证修复：接口协议、连接导入、配置输入、密钥编辑与 JSON 语法保护。检查点`643fb43c90c8e231037d336abb0084b751fce514`之后开始下一周期，当前0/5。[更新记录](./source-version-1.1.17-2026-11-19.md)保留各项实际验证范围、失败及后续工作。

43个历史Release的标签、正文、发布日期、稳定/预发布状态与附件元数据保持，原有远端标签一致。提交、推送、标签和发布前均核对六个远端工作流，仅存在pull_request或workflow_dispatch事件；41条任务记录保持，没有新增或活动任务。

五组版本资料检查及22项版本契约测试通过。493个原有未完成路径除package版本字段外保持，最小候选提交保留package其他改动。固定安装仍为1.1.8/133，updates/android.json保持1.1.2/127实际APK候选及空资产。没有构建、导出、安装、上传APK或派发工作流。

Web 凭据 JSON 与保存重载，以及 Android 中文岛屿深色竖屏的连接导入、密钥保存、冷启动回读、重开和精准恢复均有独立记录。真实网页按键、其他主题语言和尺寸、无障碍、供应商及同模型路由组和其余路由继续验收。fullAcceptance、nativeVerified、visualAcceptance 及广义 loadedRuntimeVerified 保持 false。

证据：[版本检查](../../test-evidence/release/source-version-1.1.17-20261119-01/version-checks-03.json)、[版本提交](../../test-evidence/release/source-version-1.1.17-20261119-01/commit-version-04.json)、[实际发布与远端复核](../../test-evidence/release/source-version-1.1.17-20261119-01/publication-receipt-05.json)。

# IsleMind 1.1.16 实际发布记录

日期：2026-11-19，时区Asia/Taipei。[IsleMind 1.1.16](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.16)于2026-11-19 05:37:42（台北）实际发布。

标签v1.1.16固定到源码版本提交`4bc49d4273e128c359426c8188fa7de778f56de5`，源码1.1.16/141。GitHub API核对公开稳定状态与最新版本，简体中文、英文、日文正文与标签内[v1.1.16.md](./v1.1.16.md)逐字一致，正文SHA-256为`4ab24987be4c5f558a0e377e795b9a97a6b89f172b5962a91a0ba1d16acae1d9`。

本版覆盖五项已验证修复：网页启动存储占用恢复、手册正文搜索、切换会话时避免重复保存草稿、网页输入法光标，以及原生确认操作前释放输入焦点。检查点`27f29317cb7bcf2e6e5d8465e50f54d72c0d5239`之后开始下一周期，当前0/5。[更新记录](./source-version-1.1.16-2026-11-19.md)保留各项实际验证范围、失败及后续工作。

42个历史Release的标签、正文、发布日期、稳定/预发布状态与附件元数据保持，原有远端标签一致。提交、推送、标签和发布前均核对六个远端工作流，仅存在pull_request或workflow_dispatch事件；41条任务记录保持，没有新增或活动任务。

五组版本资料检查及22项版本契约测试通过。494个原有未完成路径除package版本字段外保持，最小候选提交保留package其他改动。固定安装仍为1.1.8/133，updates/android.json保持1.1.2/127实际APK候选及空资产。没有构建、导出、安装、上传APK或派发工作流。

网页启动重试、三语手册搜索、草稿保存与输入法选区，以及 Android 中文岛屿深色竖屏的聊天和文档输入及返回均有独立记录。真实网页按键、其他主题语言和尺寸、无障碍、供应商及同模型路由组和其余路由继续验收。fullAcceptance、nativeVerified、visualAcceptance 及广义 loadedRuntimeVerified 保持 false。

证据：[版本检查](../../test-evidence/release/source-version-1.1.16-20261119-01/version-checks-03.json)、[版本提交](../../test-evidence/release/source-version-1.1.16-20261119-01/commit-version-04.json)、[实际发布与远端复核](../../test-evidence/release/source-version-1.1.16-20261119-01/publication-receipt-05.json)。

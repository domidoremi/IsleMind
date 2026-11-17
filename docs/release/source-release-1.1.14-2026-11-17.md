# IsleMind 1.1.14 实际发布记录

日期：2026-11-17，时区Asia/Taipei。[IsleMind 1.1.14](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.14)于2026-11-17 13:52:50（台北）实际发布。

标签v1.1.14固定到源码版本提交`db8e0cba16468d65769e17ec93128635c67f11cc`，源码1.1.14/139。GitHub API核对公开稳定状态与最新版本，简体中文、英文、日文正文与标签内[v1.1.14.md](./v1.1.14.md)逐字一致，正文SHA-256为`bdb29ee8de594eed7a7b965e5ba58c8297784ae9fc827c0df330dfb5b007f2cc`。

本版覆盖五项已验证改动：模型参数基线快照、有效密钥组与别名分组、英文单复数、岛屿主题筛选数量及根导航默认首页。检查点`56c38c5d57dca06eac849f1a25f42fb0145e9cd3`之后开始下一周期，当前0/5。[更新记录](./source-version-1.1.14-2026-11-17.md)保留各项实际验证范围、失败及后续工作。

40个历史Release的标签、正文、发布日期、稳定/预发布状态与附件元数据保持，原有远端标签一致。提交、推送、标签和发布前均核对六个远端工作流，仅存在pull_request或workflow_dispatch事件；41条任务记录保持，没有新增或活动任务。

五组版本资料检查及22项版本契约测试通过。494个原有未完成路径除package版本字段外保持，最小候选提交保留package其他改动。固定安装仍为1.1.8/133，updates/android.json保持1.1.2/127实际APK候选及空资产。没有构建、导出、安装、上传APK或派发工作流。

完整目标继续。跨成员参数的Web和原生真实发送、分组与数量实际界面、根导航默认配置及完整原始状态复核已记录；岛屿筛选数量Web补验、历史导航状态丢失、原生延迟与内存问题，以及31路由深层操作和完整环境矩阵仍待完成。fullAcceptance、nativeVerified、visualAcceptance及广义loadedRuntimeVerified保持false。

证据：[版本检查](../../test-evidence/release/source-version-1.1.14-20261117-01/version-checks-03.json)、[版本提交](../../test-evidence/release/source-version-1.1.14-20261117-01/commit-version-04.json)、[实际发布与远端复核](../../test-evidence/release/source-version-1.1.14-20261117-01/publication-receipt-05.json)。

# IsleMind 1.1.12 实际发布记录

日期：2026-11-17，时区Asia/Taipei。[IsleMind 1.1.12](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.12)于07:01:26（台北）实际发布。

标签v1.1.12固定到源码版本提交`c18a8909e7e580d40c338429662d592fcd466ed1`，源码1.1.12/137。GitHub API核对公开稳定状态与最新版本，简体中文、英文、日文正文与标签内[v1.1.12.md](./v1.1.12.md)逐字一致，正文SHA-256为`e49026d68c811f3792d6892af37249eda76987e85fa8c7a2a6006799337389ad`。

本版覆盖五项已验证改动：聊天阅读栏列表更新、请求详情文案、会话路由状态、参数键盘避让，以及关闭配置时的草稿保存与焦点清理。检查点`d601750f0ab9b3c16ee5cf2ae0f76fdcafcaa879`之后开始下一周期，当前0/5。[更新记录](./source-version-1.1.12-2026-11-17.md)保留各项实际验证范围、失败与后续工作。

38个历史Release的标签、正文、发布日期、稳定/预发布状态与附件元数据保持，原有远端标签一致。提交、推送、标签和发布前均核对六个远端工作流，仅存在pull_request或workflow_dispatch事件；41条任务记录保持，没有新增或活动任务。

源码版本同步的五组检查及22项版本契约测试通过。495个原有未完成路径除package版本字段外保持，最小候选提交保留package的其他未完成改动。固定安装仍为1.1.8/133，updates/android.json保持1.1.2/127实际APK候选及空资产。没有构建、导出、安装、上传APK或派发工作流。

完整目标继续。原生四种退出路径共8项通过，独立原始状态复核和14张截图复核已记录；布局、请求载荷、Web及完整主题/语言/尺寸/输入/无障碍/恢复/性能矩阵仍待推进。fullAcceptance、nativeVerified、visualAcceptance及广义loadedRuntimeVerified保持false。

证据：[版本检查](../../test-evidence/release/source-version-1.1.12-20261117-01/version-checks-03.json)、[版本提交](../../test-evidence/release/source-version-1.1.12-20261117-01/commit-version-04.json)、[实际发布与远端复核](../../test-evidence/release/source-version-1.1.12-20261117-01/publication-receipt-05.json)。

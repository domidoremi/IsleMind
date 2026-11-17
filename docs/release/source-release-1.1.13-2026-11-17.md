# IsleMind 1.1.13 实际发布记录

日期：2026-11-17，时区Asia/Taipei。[IsleMind 1.1.13](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.13)于2026-11-17 11:05:25（台北）实际发布。

标签v1.1.13固定到源码版本提交`eb62cd71184b60dc92f957e594684464a1e0fc02`，源码1.1.13/138。GitHub API核对公开稳定状态与最新版本，简体中文、英文、日文正文与标签内[v1.1.13.md](./v1.1.13.md)逐字一致，正文SHA-256为`4331ae2f11ade15cbe9ee0770a57a223251d5d7acde65677eb3ed07b0e0bbde9`。

本版覆盖五项已验证改动：参数标题与输入行对齐、会话消息增量保存、不可变快照复用、限定重验凭据读取及调用方实时撤销检查。检查点`37734cbd16ca0ca6e6eb13e7d16fc8d1d22565c7`之后开始下一周期，当前0/5。[更新记录](./source-version-1.1.13-2026-11-17.md)保留各项实际验证范围、失败及后续工作。

39个历史Release的标签、正文、发布日期、稳定/预发布状态与附件元数据保持，原有远端标签一致。提交、推送、标签和发布前均核对六个远端工作流，仅存在pull_request或workflow_dispatch事件；41条任务记录保持，没有新增或活动任务。

五组版本资料检查及22项版本契约测试通过。494个原有未完成路径除package版本字段外保持，最小候选提交保留package其他改动。固定安装仍为1.1.8/133，updates/android.json保持1.1.2/127实际APK候选及空资产。没有构建、导出、安装、上传APK或派发工作流。

完整目标继续。调用方撤销的Web和原生运行各22项受控拒绝检查通过，原始状态复核及运行源码匹配已记录；跨成员默认参数、路由组完整流程、31路由深层操作及主题、语言、尺寸、输入、无障碍、恢复与性能矩阵仍待完成。fullAcceptance、nativeVerified、visualAcceptance及广义loadedRuntimeVerified保持false。

证据：[版本检查](../../test-evidence/release/source-version-1.1.13-20261117-01/version-checks-03.json)、[版本提交](../../test-evidence/release/source-version-1.1.13-20261117-01/commit-version-04.json)、[实际发布与远端复核](../../test-evidence/release/source-version-1.1.13-20261117-01/publication-receipt-05.json)。

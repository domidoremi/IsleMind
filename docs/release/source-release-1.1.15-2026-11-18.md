# IsleMind 1.1.15 实际发布记录

日期：2026-11-18，时区Asia/Taipei。[IsleMind 1.1.15](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.15)于2026-11-18 21:07:21（台北）实际发布。

标签v1.1.15固定到源码版本提交`3c6c785dc9cde086a98bbf71454abf38ac0dbb88`，源码1.1.15/140。GitHub API核对公开稳定状态与最新版本，简体中文、英文、日文正文与标签内[v1.1.15.md](./v1.1.15.md)逐字一致，正文SHA-256为`e24f8aa411f4981a74da9435fc5a00cb44ef0e57002047b28e1e5c0bf59ed1bb`。

本版覆盖五项已验证改动：模型菜单避开安全区、点击模型按钮时保留输入焦点、扩大关闭按钮、输入区折行时保留按钮焦点，以及窗口和页面缩放后的定位。检查点`31a5737252300ab4684c990820da7a942b95170a`之后开始下一周期，当前0/5。[更新记录](./source-version-1.1.15-2026-11-18.md)保留各项实际验证范围、失败及后续工作。

41个历史Release的标签、正文、发布日期、稳定/预发布状态与附件元数据保持，原有远端标签一致。提交、推送、标签和发布前均核对六个远端工作流，仅存在pull_request或workflow_dispatch事件；41条任务记录保持，没有新增或活动任务。

五组版本资料检查及22项版本契约测试通过。494个原有未完成路径除package版本字段外保持，最小候选提交保留package其他改动。固定安装仍为1.1.8/133，updates/android.json保持1.1.2/127实际APK候选及空资产。没有构建、导出、安装、上传APK或派发工作流。

Web 三语焦点、窗口和双倍缩放已验证。真实网页按键、手机输入法、SQLite 启动锁及其余路由的完整验收继续。fullAcceptance、nativeVerified、visualAcceptance 及广义 loadedRuntimeVerified 保持 false。

证据：[版本检查](../../test-evidence/release/source-version-1.1.15-20261118-01/version-checks-03.json)、[版本提交](../../test-evidence/release/source-version-1.1.15-20261118-01/commit-version-04.json)、[实际发布与远端复核](../../test-evidence/release/source-version-1.1.15-20261118-01/publication-receipt-05.json)。

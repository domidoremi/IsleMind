# IsleMind 1.1.11 实际发布记录

日期：2026-11-15，时区Asia/Taipei。已实际发布[IsleMind 1.1.11](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.11)，发布时间为2026-11-15 20:28:24（台北）。

标签`v1.1.11`固定到源码版本提交`02190b3bde18da27c98727009f9aac48c60bacf6`，源码版本为1.1.11 / 136。GitHub API核对公开稳定状态，最新版本为v1.1.11；简体中文、英文、日文正文与标签内[v1.1.11.md](./v1.1.11.md)逐字一致，正文SHA-256为`cb87799875a224d6173687aea157c77569d523881e16f77d8b2cfa0e515a996f`。

本版覆盖五项已验证产品改动：消息手势、知识片段与保存段落英文数量、连接表单、已存密钥键盘避让及多密钥缓存目录保留。[源码更新记录](./source-version-1.1.11-2026-11-15.md)保留各项范围、失败和仍待验证的内容。产品计数检查点为`e9b382ae82fca7fdd50cff0a01d45f6cbabf021e`，下一轮从0/5继续。

37个原有Release的正文、标签、发布日期、稳定/预发布状态和附件元数据保持；原有远端标签全部一致。发布前后41个工作流任务保持，没有新增任务。全程未构建、导出、安装APK、上传APK或派发工作流；updates/android.json继续保留1.1.2 / 127实际候选及空资产。

版本准备的旧回执字段识别失败，以及误用Node测试运行器的启动失败保留。校正后六项版本文档检查和22项Jest版本契约测试通过，未重复发布。

原有492个未完成路径的字节和状态保留，package的原有其他字段保持。原生和Web测试资料精确恢复；14张缓存验证最终图完整查看。恢复价值仍在的原SQLite与私有数据检查点继续保留。

[完整原目标](../architecture/full-application-improvement-goal.md)继续进行中，预算无限制，目标登记正文仍是旧批次摘要，未成功改写。供应商完整功能、同模型路由组、31生产路由、55原型页及全主题/语言/尺寸/输入/无障碍/恢复/性能矩阵继续；`fullAcceptance`、`nativeVerified`、`visualAcceptance`和广义`loadedRuntimeVerified`保持false。

证据：[发布及远端核对](../../test-evidence/release/source-version-1.1.11-20261115-01/publication-receipt-06.json)、[版本提交](../../test-evidence/release/source-version-1.1.11-20261115-01/commit-version-receipt-05.json)、[产品修复](../../test-evidence/implementation/native-provider-catalog-retention-20261115-01/commit-catalog-receipt-16.json)。

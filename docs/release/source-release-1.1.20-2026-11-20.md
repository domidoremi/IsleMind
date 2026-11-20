# IsleMind 1.1.20 实际发布记录

2026-11-20，Asia/Taipei。[IsleMind 1.1.20](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.20)于2026-11-20 18:03:10（台北）实际发布。

标签v1.1.20固定到源码版本提交`d966ba93661b938e58dfeec3fd133b43f1708799`，源码1.1.20/145。GitHub API核对公开稳定状态与最新版本，简体中文、英文、日文正文与标签内[v1.1.20.md](./v1.1.20.md)逐字一致，SHA-256为`f2b7b008870786bb499c50eb80323ea66fe219ccc452faa3d454539e057f537d`。

本周期覆盖完整目录与归属、模型启用选择、同模型路由组执行、场景策略预览、目录同步配置保护五项改动。检查点`92f132070e23533f995390151e8fd096a70c3fcd`之后开始下一周期，当前0/5。[更新记录](./source-version-1.1.20-2026-11-20.md)保存各项实际验证、失败与后续范围。

46个历史Release的标签、正文、发布日期、稳定／预发布状态和附件元数据保持；原远端标签一致。每次Git写入、标签和发布前重新读取六工作流、完整Actions和main来源PR，仅有pull_request或workflow_dispatch触发事件。发布后41条Actions、零新增／活动、main来源PR零。

五组版本元数据、计数、三语内容、文档链接及原改动保护检查和22项版本契约测试通过。435个原未完成路径除package版本字段外保持。APK候选清单保持1.1.2/127；没有构建、导出、安装、上传APK或触发Actions。

五项产品提交的验证使用合成依赖；路由组SQLite覆盖内存库与repository重建。发布前另外完成英文知识文件和记忆0／1／2数量、两次实际清空确认及14张截图复核；测试引入的四张FTS索引表已条件恢复，53表／3,256行、四raw、六组草稿、路由、编辑器及70请求一致。设备第42份完整缓存、Metro输出、源码映射和九组件挂载绑定通过，实际消息按钮触发的渲染帧、导出与完整factory对应；这些记录仅证明冻结源码，当前工作区另有四处差异。详见[数量与恢复记录](../../test-evidence/implementation/native-routing-groups-20261115-01/native-quantity-visual-restoration-20261120-1749.json)和[消息运行帧](../../test-evidence/implementation/native-routing-groups-20261115-01/native-message-frame-20261120-1740.json)。原1736／1739／1742／1743失败与FTS恢复预演失败保留。两次初始发布因Git标签读取TLS失败而停在写入前；05c通过认证GitHub refs API核对全部直接标签对象并创建版本标签，随后实际发布与复核。31路由／55原型、完整供应商和路由组UI、主题语言尺寸、TalkBack、实际存储故障及系统内存终止继续处理。fullAcceptance、nativeVerified、visualAcceptance及loadedRuntimeVerified保持false。

证据：[版本检查](../../test-evidence/release/source-version-1.1.20-20261120-01/version-checks-03.json)、[版本提交](../../test-evidence/release/source-version-1.1.20-20261120-01/commit-version-04.json)、[发布复核](../../test-evidence/release/source-version-1.1.20-20261120-01/publication-receipt-05c.json)。

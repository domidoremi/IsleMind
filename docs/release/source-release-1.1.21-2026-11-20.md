# IsleMind 1.1.21 实际发布记录

2026-11-20，Asia/Taipei。[IsleMind 1.1.21](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.21)于2026-11-20 20:59:27（台北）实际发布。

标签v1.1.21固定到源码版本提交`406f915799896a6ab83924c568405e527b6b682a`，源码1.1.21/146。GitHub API核对公开稳定状态与最新版本，简体中文、英文、日文正文与标签内[v1.1.21.md](./v1.1.21.md)逐字一致，SHA-256为`1fd65678ac6a9205af3b3093dd875028116c270c91d700b49ddfa6c79c83f029`。

本周期覆盖保存密钥健康、MiMo导入模式与区域、明确模型选择、停用密钥状态、实际请求轮换五项修复。检查点`ade2d7cfcdca3320260251edea7cab5d43f2567e`之后开始下一周期，当前0/5。[更新记录](./source-version-1.1.21-2026-11-20.md)保存各项实际验证、失败与后续范围。

47个历史Release的标签、正文、发布日期、稳定／预发布状态和附件元数据保持；原远端标签一致。每次Git写入、标签和发布前重新读取六工作流、完整Actions和main来源PR，仅有pull_request或workflow_dispatch触发事件。发布后41条Actions、零新增／活动、main来源PR零。

五组版本元数据、计数、三语内容、文档链接及原改动保护检查和22项版本契约测试通过。436个原未完成路径除package版本字段外保持。APK候选清单保持1.1.2/127；没有构建、导出、安装、上传APK或触发Actions。

最终实际轮换修复在主线与工作区各通过11组218项测试，类型与架构边界通过，主线架构自检通过。工作区自检的原有草稿会话fixture缺项已用修改前脚本逐字重建确认，失败保留。Web完成四次实际本地HTTP请求B／A／B／A，第三次后刷新并继续轮换；八个实际运行函数绑定完整加载脚本、同源响应、工厂和源码映射。此前路由组、首选、停用、导入模式与模型选择证据分别记录。没有外部模型请求，截图超时不计视觉通过。Web独立域名尚待清理与原浏览器资料核对。

本周期真机仅恢复连接并独立核对原值，仍运行第42份旧源码；53表、四raw、六组草稿、编辑器正文／附件／选区／焦点、原路由及70请求保持。native-baseline-111作为下轮保护参考，本周期修复待同步后验收。31路由／55原型、五主题三语尺寸、TalkBack、输入恢复、实际存储故障、性能及系统内存终止继续处理。fullAcceptance、nativeVerified、visualAcceptance及loadedRuntimeVerified保持false。

证据：[版本检查](../../test-evidence/release/source-version-1.1.21-20261120-01/version-checks-03.json)、[版本提交](../../test-evidence/release/source-version-1.1.21-20261120-01/commit-version-04.json)、[发布复核](../../test-evidence/release/source-version-1.1.21-20261120-01/publication-receipt-05.json)。

# IsleMind 1.1.21 实际发布记录

2026-11-20，Asia/Taipei。[IsleMind 1.1.21](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.21)于2026-11-20 20:59:27（台北）实际发布。

标签v1.1.21固定到源码版本提交`406f915799896a6ab83924c568405e527b6b682a`，源码1.1.21/146。GitHub API核对公开稳定状态与最新版本，简体中文、英文、日文正文与标签内[v1.1.21.md](./v1.1.21.md)逐字一致，SHA-256为`1fd65678ac6a9205af3b3093dd875028116c270c91d700b49ddfa6c79c83f029`。

本周期覆盖保存密钥健康、MiMo导入模式与区域、明确模型选择、停用密钥状态、实际请求轮换五项修复。检查点`ade2d7cfcdca3320260251edea7cab5d43f2567e`之后开始下一周期，当前0/5。[更新记录](./source-version-1.1.21-2026-11-20.md)保存各项实际验证、失败与后续范围。

47个历史Release的标签、正文、发布日期、稳定／预发布状态和附件元数据保持；原远端标签一致。每次Git写入、标签和发布前重新读取六工作流、完整Actions和main来源PR，仅有pull_request或workflow_dispatch触发事件。发布后41条Actions、零新增／活动、main来源PR零。

五组版本元数据、计数、三语内容、文档链接及原改动保护检查和22项版本契约测试通过。436个原未完成路径除package版本字段外保持。APK候选清单保持1.1.2/127；没有构建、导出、安装、上传APK或触发Actions。

最终实际轮换修复在主线与工作区各通过11组218项测试，类型与架构边界通过，主线架构自检通过。工作区自检的原有草稿会话fixture缺项已用修改前脚本逐字重建确认，失败保留。Web完成四次实际本地HTTP请求B／A／B／A，第三次后刷新并继续轮换；八个实际运行函数绑定完整加载脚本、同源响应、工厂和源码映射。此前路由组、首选、停用、导入模式与模型选择证据分别记录。没有外部模型请求，截图超时不计视觉通过。Web独立域名尚待清理与原浏览器资料核对。

本周期真机仅恢复连接并独立核对原值，仍运行第42份旧源码；53表、四raw、六组草稿、编辑器正文／附件／选区／焦点、原路由及70请求保持。native-baseline-111作为下轮保护参考，本周期修复待同步后验收。31路由／55原型、五主题三语尺寸、TalkBack、输入恢复、实际存储故障、性能及系统内存终止继续处理。fullAcceptance、nativeVerified、visualAcceptance及loadedRuntimeVerified保持false。

证据：[版本检查](../../test-evidence/release/source-version-1.1.21-20261120-01/version-checks-03.json)、[版本提交](../../test-evidence/release/source-version-1.1.21-20261120-01/commit-version-04.json)、[发布复核](../../test-evidence/release/source-version-1.1.21-20261120-01/publication-receipt-05.json)。


## 发布后真机验证与资料恢复

本周期修复已同步至第43份原生源码并完成受保护重载。完整设备缓存、服务脚本、源码映射、三字体、三语及本周期模块绑定核对通过。四次真实键盘请求均返回HTTP200，实际密钥按1／2／1／2轮换；使用时间和持久化健康记录更新，四条用量及最后请求详情归属正确。三张截图仅覆盖中文岛屿深色原竖屏的模型菜单、末次回复和详情可见区域。

测试清理曾因健康记录变化及JSON／undefined比较停止，失败记录保留。定向恢复后另开Inspector回读：53表3256行、四项原始存储、六组草稿与恢复槽、原会话设置及编辑器文字／附件／选区／焦点全部一致，八个测试密钥已移除；原USB设置任务和70条请求保持。当前进程15464、编辑器8968，Inspector关闭且无遗留操作。

Web独立域名已清空，原浏览器13项存储与六文件保持，空间已关闭，8108和8214测试服务已停止，24条请求记录保留。12份可再生临时基线的删除被自动审批拒绝，文件保持。版本仍1.1.21/146，周期0/5；全应用验收和系统内存问题继续，四项整体资格保持false。

[真机检查点](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-cycle-checkpoint-20261120-188.json)、[独立原值回读](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-current-20261120-185.json)、[限定目视记录](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-rotation-visual-review-20261120-188.json)。

# IsleMind 1.1.20 源码版本更新记录

2026-11-20，五项产品改动达到发布节奏。源码版本由1.1.19升至1.1.20，Android源码版本码由144升至145。[三语更新说明](./v1.1.20.md)

从检查点`a1efb879d1cf1ac4933c18568f2225a0a176f471`后计入以下五项已验证、已推送改动。

- `a2c851f829a632952faea7b8641b9fecffd85764` fix(providers): 完整保留模型目录与密钥归属
- `0cec280d353587f2adc01d33bc5715c25d0c13cd` fix(providers): 统一模型启用选择与备用访问约束
- `e7ccd4b200cc79dfd9bd7f8ec12721dfe6379c82` feat(providers): 接入同模型路由组执行与独立快照
- `00e41b7af57e90749b78eb3c553204e5246c966b` fix(scenes): 完整显示路由组成员与策略变化
- `92f132070e23533f995390151e8fd096a70c3fcd` fix(providers): 保护目录同步配置与模型检查归属

下一周期从`92f132070e23533f995390151e8fd096a70c3fcd`之后开始。版本与维护文档提交不计入。

完整目录去除256／512项截断，保留尾部及停用密钥目录、元数据和精确归属。模型选择统一显式空列表、目录刷新、别名、备用访问和备份恢复。路由组执行支持三策略、并发轮转、授权／取消／凭据变更检查、实际用量凭据及独立会话快照。场景预览显示完整成员及策略差异。目录同步在配置冲突时拒绝旧结果，检查请求限定到真实模型所有者，单连接与批量入口都传递配置条件和取消信号。

源码检查按独立主线候选和工作区分别记录，重叠计数不相加：完整目录7组89／96项；模型选择12组149／156项；路由组15组154／158项，两边各14项Bun内存SQLite测试；场景预览4组51／52项；目录同步9组97／97项。适用的类型、架构、性能约束及备用契约通过。SQLite覆盖repository重建，未覆盖操作系统进程重启或真实磁盘故障；服务商通信使用合成依赖，没有真实模型请求。

保留各批次实际失败记录：目录回归和fixture修正、模型单类备份及过期调用断言、分支成员浅复制、场景三语策略缺失、目录同步配置冲突、性能约束名称同步。两次候选文件尾空行检查及TLS/EOF连接失败均在依赖操作前停止，按实际Git状态续接；远端检查恢复后才继续写入。原有未完成工作按哈希保持，限定改动单独记录。

本周期未操作设备或浏览器。当前原生第42份旧源码、1672恢复记录及53表／3256行、四raw、六组草稿与恢复槽、原编辑器及前台和70请求保持为后续独立核对起点，不能据此授予当前源码运行资格。31路由／55原型、模型和路由组完整UI、五主题三语尺寸、TalkBack、真实存储故障及系统内存终止仍未全部闭环。

每次Git写入、标签和发布前重读远端六工作流、完整Actions及main来源PR；禁止触发任何Actions。原APK候选和历史公开说明保持，没有构建、导出、安装或上传APK。此前自动审批拒绝清理的十份临时文件及历史目录保留，未换机制删除。

fullAcceptance、nativeVerified、visualAcceptance及loadedRuntimeVerified保持false。[完整目标](../architecture/full-application-improvement-goal.md)

证据：[目录](../../test-evidence/implementation/native-routing-groups-20261115-01/catalog-preservation-progress-20261120-1703.json)、[模型选择](../../test-evidence/implementation/native-routing-groups-20261115-01/model-selection-progress-20261120-1709.json)、[路由组](../../test-evidence/implementation/native-routing-groups-20261115-01/routing-group-progress-20261120-1721.json)、[场景预览](../../test-evidence/implementation/native-routing-groups-20261115-01/scene-routing-preview-progress-20261120-1726.json)、[目录同步](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-activation-progress-20261120-1732.json)。

## 实际发布

版本提交`d966ba93661b938e58dfeec3fd133b43f1708799`已推送，v1.1.20于2026-11-20 18:03:10（台北）实际发布。标签固定到版本提交，三语正文逐字一致；GitHub API核对公开稳定状态与最新版本。46个历史Release、原有标签和41条Actions保持。五组版本资料检查及22项版本契约测试通过，435个原未完成路径除package版本字段外保持。详见[发布记录](./source-release-1.1.20-2026-11-20.md)。

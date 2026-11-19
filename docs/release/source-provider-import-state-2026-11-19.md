# 结构化连接导入保留密钥与模型状态

JSON 连接导入现在保留密钥组的启停、各组模型目录、已选模型、手工模型、首选组和调度策略。显式 `modelCatalogKnown: false` 保持未知状态；缓存目录和历史同步成功记录沿用该声明。存在结构化密钥组时，导入仅使用这些组。

新建表单保存导入元数据。第二次导入空目录会清空前一次模型列表，关闭后重开清除导入状态。`Model` 与 `model` 保持两个模型身份，保存顺序遵循现有排序规则。[完整改进目标](../architecture/full-application-improvement-goal.md)

新增十一项回归，覆盖注册表、真实元数据保存加载和表单提交。旧 main 九项失败、两项通过；独立 main 候选六组 90 项、类型和架构检查通过。工作区六组 118 项、类型和架构检查通过，两处计数分别记录。

Android 岛屿深色中文竖屏中，实际输入结构化 JSON、保存连接、回读三项安全凭据、关闭并重开配置均通过。停用组、已知空目录、未知缓存目录、首选和调度策略保持。密钥按现有设计存入安全存储，配置元数据保留空密钥字段。残留旧主密钥未写入安全存储。测试连接保持停用，原 70 条请求完整。

真机操作使用当前工作区第 30 份源码快照。设备缓存 26,766,254 字节与 Metro 主包完全相同，SHA-256 为 `3e2205f8ef9cac60e1f42c0fc5bd8f0e86aa3312eb1eedb5516c6a6be2cd4e4f`。2,139 项输入、1,182 个映射文本、三份字体、三语资源和九个挂载导出已核对。既有安装仍为 1.1.8/133，源码为 1.1.16/141。

Web 使用 DOM 按钮事件和 Chromium 输入协议，保存与重载、第二次空目录替换、放弃以及关闭重开均通过。实际挂载的供应商页面、配置页和新建表单，以及注册表工厂，已对应当前加载脚本、函数范围和源码映射。可信鼠标与系统键盘路径继续验收。

测试连接及其安全凭据已精准移除。独立复核确认原 53 张表、四项原始存储、六组草稿与恢复槽、全部用户资料、编辑器、路由、设备和请求日志完整。Web 测试来源恢复为初始空状态，原来源 13 项存储及六个文件保持一致。

一次高速 Android 文本输入留下 `Maximum update depth exceeded` 错误。分段输入、保存、重开和恢复未增加该条计数，原警告继续保留和调查。1125 的下一步点按打开了旧警告详情，1130 完成恢复；1132 的明文密钥与 JSON 属性预期过严，1135 通过安全存储回读和完整恢复复核。Web 的源码尾部调试地址、React alternate 和非法策略夹具检查均保留原失败记录。完整主题、语言、尺寸、无障碍、输入、恢复和性能矩阵继续。

1105 的离线读取副本清理遭自动审批拒绝，五份副本保持原位。未改用其他机制删除。

本地证据：[独立 main 验证](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-import-main-validation-20261119-1098.json)、[工作区回归](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-import-workspace-validation-20261119-1108.json)、[设备缓存与源码](../../test-evidence/implementation/native-routing-groups-20261115-01/native-loaded-provider-import-20261119-1113.json)、[真机保存与安全存储](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-import-saved-resume-20261119-1135.json)、[独立原资料复核](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-import-saved-originals-20261119-1138.json)、[Web 加载源码](../../test-evidence/implementation/native-routing-groups-20261115-01/web-provider-import-state-20261119-1137.json)、[Web 空目录与重开](../../test-evidence/implementation/native-routing-groups-20261115-01/web-provider-import-resume-state-20261119-1139.json)、[Web 来源恢复](../../test-evidence/implementation/native-routing-groups-20261115-01/web-provider-import-restoration-20261119-1140.json)。

`fullAcceptance`、`nativeVerified`、`visualAcceptance` 和广义 `loadedRuntimeVerified` 均保持 false。全程未构建、导出、安装或上传 APK，未派发工作流。

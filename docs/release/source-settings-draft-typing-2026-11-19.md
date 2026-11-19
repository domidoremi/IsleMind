# 输入设置草稿时保持离页保护稳定

设置草稿每次内容变化都会注销并重新注册编辑器，重复更新离页保护。连续输入 64 个字符时，旧版保护配置调用从 2 次增至 66 次。现在只有脏状态或保存状态变化时重新注册，内容版本继续通过引用更新。迟到的确认无法放弃已变化或重新挂载的草稿。

新增两项回归在旧 main 和旧工作区均失败。独立 main 六组 68 项、工作区六组 94 项以及各自类型和架构检查通过，两处计数分别记录。覆盖继续输入、变化后恢复原文、取消与确认、保存中保护、迟到确认及导入表单。

Android 岛屿深色中文竖屏中，旧版连续输入时出现 `Maximum update depth exceeded`，被动更新计数达到 51，超过 React 的 50 次限制。其中 127 次被动更新来自草稿离页保护。修复后的同类诊断计数最高为 3，保护更新仅在首次进入脏状态时发生，没有新增该警告。

74 字符分段输入、取消离开后保留完整正文、最终放弃并返回原页面通过。实际挂载的设置边界导出已核对，真机截图已目视检查。778 字符连续 Android 注入仍出现正文截短；带诊断与无断点条件下的失败均保留，继续调查该独立问题。这些结果仅覆盖本次输入与离页保护范围。

第 31 份源码快照直接读取设备缓存，并与当前 Metro 主包逐字节比较。2,140 项输入、1,182 个映射文本、三份字体、三语资源及九个已挂载导出通过。既有安装仍为 1.1.8/133，源码版本 1.1.16/141。同步和受保护重载保留进程 907；路由实例键随刷新重建，路径和层级保持。旧警告及完整栈保留在收据中，未调用日志 clear 或 dismiss。

独立前后检查确认原 53 张表、四项存储、六组草稿与恢复槽、全部用户资料、编辑器、当前路由、设备和 70 条请求一致。临时表单已放弃；本次没有供应商保存或模型请求。截图采用唯一的临时设备文件，读回 PNG 后只移除该文件。

证据：[旧工作区复现](../../test-evidence/implementation/native-routing-groups-20261115-01/settings-draft-typing-old-workspace-20261119-1147.json)、[独立 main 检查](../../test-evidence/implementation/native-routing-groups-20261115-01/settings-draft-typing-main-validation-20261119-1149.json)、[工作区检查](../../test-evidence/implementation/native-routing-groups-20261115-01/settings-draft-typing-workspace-validation-20261119-1150.json)、[旧版原生计数](../../test-evidence/implementation/native-routing-groups-20261115-01/native-fast-token-input-diagnostic-20261119-1148.json)、[修复后原生计数](../../test-evidence/implementation/native-routing-groups-20261115-01/native-fast-token-input-diagnostic-20261119-1155.json)、[无断点长串失败](../../test-evidence/implementation/native-routing-groups-20261115-01/native-fast-token-input-diagnostic-20261119-1156.json)、[分段输入和取消](../../test-evidence/implementation/native-routing-groups-20261115-01/native-settings-draft-typing-paced-20261119-1157.json)、[设备缓存与源码](../../test-evidence/implementation/native-routing-groups-20261115-01/native-loaded-settings-typing-20261119-1154.json)、[独立原资料检查](../../test-evidence/implementation/native-routing-groups-20261115-01/native-settings-typing-originals-20261119-1158.json)。

Web 当前运行源码、其余语言、主题、尺寸、无障碍、恢复及性能矩阵继续验收。`fullAcceptance`、`nativeVerified`、`visualAcceptance` 和广义 `loadedRuntimeVerified` 保持 false。未构建、导出、安装或上传 APK，未派发或重跑工作流。

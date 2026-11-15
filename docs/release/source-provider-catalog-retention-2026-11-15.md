# 多密钥刷新后的缓存模型保留

[完整原目标](../architecture/full-application-improvement-goal.md)持续进行中，预算无限制。目标栏仍登记旧批次摘要，未成功改写；本项沿用完整原始要求。

同一连接中，A密钥刷新成功时，B密钥刷新失败或处于停用状态，其已有模型和参数会从连接总目录消失。最小HEAD候选补回各密钥保留的目录及原模型参数，成功刷新结果优先。工作区原有功能保留；本项只提交该修复、四项必要回归与本记录。

四项回归中，原HEAD三项失败，成功刷新参数优先的原行为通过。最小候选四套18项、工作区六套53项及两侧类型通过，两组测试有重叠。两侧依赖、架构与模块边界共六项通过。早期类型检查的测试数据结构错误已校正，原失败回执保留。

真机在既有独立调试应用完成五项实际行为：刷新失败目录保留、保存重开、停用目录与选择保留、停用保存重开、重新启用后恢复可用。使用中文Animal深色、普通字号，七张最终图完整查看。实际模型列表请求分别为两次和一次，没有聊天请求。停用模型不会出现在可用选择中；首轮检查器要求它仍显示的失败保留。

Web在英文Minimal浅色320×844完成对应五项行为，七张最终图完整查看，缓存模型选中与新增模型未选中状态清楚。停用场景只请求A密钥，重新启用不新增请求。早期900×496图片和缓存行未完整可见的图片保留，不计作窄屏最终证据。模块识别检查器的三个失败记录保留。

运行界面使用工作区原有实现，独立最小HEAD候选分别经过源码回归和类型检查；不据界面验收声明最小快照已在设备运行。第06次独立复核确认2,122项stage源码与完整原始状态，同一进程7625。原历史、消息、设置、供应商、用量、六组草稿和恢复槽、实际编辑器文字/附件/选区/焦点、路由、设备设置和请求日志保持。测试连接与新增端口映射移除，Inspector自然关闭。

Web八项存储和六个OPFS文件逐字节恢复，实际原应用重载后仍一致；原会话、英文、主题、输入、焦点、选区和320×844尺寸恢复，验收空间关闭。原SQLite恢复检查点继续保留。临时模型接口九条请求记录完整，服务核对身份后停止；正常stdin停止不可用及共享文件读取的失败均保留，没有停止其他服务。

本项计入第五项产品修复，提交推送后按既定节奏同步1.1.11 / 136并实际发布三语GitHub Release。固定安装身份仍为1.1.8 / 133，APK候选仍为1.1.2 / 127。没有构建、导出、安装APK或派发工作流。

同模型路由组、供应商完整协议流程、31生产路由、55原型页及主题/语言/字体/键盘/无障碍/恢复/性能矩阵继续。`fullAcceptance`、`nativeVerified`、`visualAcceptance`和广义`loadedRuntimeVerified`全部保持false。

证据：[范围验收](../../test-evidence/implementation/native-provider-catalog-retention-20261115-01/acceptance-catalog-retention-15.json)、[最小候选与类型](../../test-evidence/implementation/native-provider-catalog-retention-20261115-01/catalog-required-checks-05.json)、[真机完整状态](../../test-evidence/implementation/native-provider-key-policy-20261115-01/original-state-audit-06.json)、[Web完整恢复](../../test-evidence/implementation/native-provider-catalog-retention-20261115-01/browser-catalog-originals-mounted-12.json)。

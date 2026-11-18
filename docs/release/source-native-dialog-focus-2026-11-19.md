# 原生确认操作的输入焦点

放弃未保存文档并返回聊天后，输入焦点仍指向已关闭的文档正文。确认操作现在先释放原生输入焦点，再执行离开操作。[完整改进目标](../architecture/full-application-improvement-goal.md)

Android 岛屿深色中文竖屏中，实际搜狗输入「你」、方向键插入、预览返回与继续输入得到 `87你`。取消离开保留正文；确认放弃草稿后，文档库和聊天中的输入焦点均为空。测试未保存文档或发送模型请求。独立复核原 53 张表、四项原始存储、六组草稿与恢复槽、编辑器、原路由、设备和 70 条请求，均与本轮基线一致。

新增 19 项回归覆盖五主题的 Android/iOS 确认、取消、终止确认、通知、Web 和无焦点状态。使用实际 TextInputState 与键盘释放实现，模拟原生命令派发。独立 main 候选修复前 10 项失败、9 项通过，修复后四组 103 项通过，类型和架构检查通过；工作区四组 113 项通过，两组计数不相加。

真机第 28 份快照的 2,136 项输入均已核对。设备缓存 26,765,803 字节与 Metro 主包完全相同，1,182 个映射文本、三份字体、三语资源和九个已挂载导出均对应当前源码。该记录覆盖现有 Android 调试安装中的本次操作；完整应用和环境矩阵继续验收。

证据：[修复前回归](../../test-evidence/implementation/native-routing-groups-20261115-01/dialog-input-focus-before-20261119-1052.json)、[独立 main 验证](../../test-evidence/implementation/native-routing-groups-20261115-01/dialog-focus-main-validation-20261119-1064.json)、[设备缓存与源码](../../test-evidence/implementation/native-routing-groups-20261115-01/native-loaded-editor-20261119-1059.json)、[文档复测](../../test-evidence/implementation/native-routing-groups-20261115-01/native-document-editor-ime-20261119-1061.json)、[独立原状态复核](../../test-evidence/implementation/native-routing-groups-20261115-01/native-dialog-focus-originals-20261119-1062.json)。

# IsleMind 1.1.12 源码版本更新记录

日期：2026-11-17。五项已验证产品改动完成提交推送，源码版本由1.1.11更新为1.1.12，Android源码版本码由136更新为137。三语公开说明见[v1.1.12.md](./v1.1.12.md)。[完整目标](../architecture/full-application-improvement-goal.md)继续进行中。

## 五项改动与累计

从前一检查点`e9b382ae82fca7fdd50cff0a01d45f6cbabf021e`之后累计，覆盖阅读栏宽度引起的列表更新循环、请求详情文案、路由方案变化后的配置状态、数字参数键盘避让及关闭保存与焦点清理。

- `f37bcbe67ad0cb7707ebcc0f6a36ee58ff76bd25`：fix(chat): 修正阅读栏宽度导致的列表更新循环
- `d98e7770ae2bdf5650919c1c14f72e7a37931140`：fix(i18n): 精简请求执行来源与数量文案
- `e4ec0b12ca0286e399ff162c6c74fe1588351369`：fix(chat): 在会话路由方案变更后刷新配置状态
- `0b9f8d8b5623853998ad694f1aa5a8d03a8e666e`：fix(chat): 保持参数输入在数字键盘上方可见
- `d601750f0ab9b3c16ee5cf2ae0f76fdcafcaa879`：fix(chat): 关闭配置时保存数字草稿并清除焦点

新检查点为`d601750f0ab9b3c16ee5cf2ae0f76fdcafcaa879`，本次版本维护不计入产品提交，下一周期从0/5累计。此前38个Release的历史保持，实际发布结果另行记录。

## 验证与保留范围

本次关闭修复的独立main候选旧代码8项失败，修复后47项及类型、架构边界、模块边界、依赖检查通过；工作区55项及类型检查通过，两组有重叠。真机四种退出路径的8项保存、清焦点与返回检查通过；310截图名称冲突导致的中断保留，完整恢复后314仅补测剩余路径。基线与当前两轮14张图完整查看。

当前加载bundle与Metro逐字节一致，四项模块及源码映射符合冻结源码；没有断点逐调用绑定。独立复核确认53表3256行、四项原始存储、六组草稿/恢复槽、编辑器、路由、设置、原前台与35条请求保持。2126项调试源码输入已核对，本版本元数据变更尚不构成新的运行源码资格。

相关记录见[请求详情文案](./source-usage-request-copy-2026-11-17.md)、[路由状态](./source-routing-health-refresh-2026-11-17.md)、[参数键盘](./source-chat-parameter-keyboard-2026-11-17.md)与[关闭保存](./source-chat-parameter-close-2026-11-17.md)。最小提交只纳入各项已验证差异，工作区原有未完成功能持续保留。

## 版本与发布边界

版本和三语README、索引、公开说明及持久计数同步。固定安装身份仍为1.1.8/133，updates/android.json保持实际1.1.2/127候选和空资产。全程不构建、导出、安装APK或触发Actions。每次提交、推送、标签与发布前核对远端全部工作流触发事件，完成后核对任务列表。

参数标题与输入行对齐、请求参数载荷、路由组及31路由深层操作、主题/语言/尺寸/字号/无障碍/恢复/性能继续。fullAcceptance、nativeVerified、visualAcceptance及广义loadedRuntimeVerified保持false。

证据位于test-evidence/release/source-version-1.1.12-20261117-01/及test-evidence/implementation/native-routing-groups-20261115-01/。

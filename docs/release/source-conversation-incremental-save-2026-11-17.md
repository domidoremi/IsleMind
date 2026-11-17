# 会话消息增量保存

日期：2026-11-17。

保存流式回复时，之前会先移动全部消息序号，再逐条写回；只有最后一条内容变化也会重写整段会话。现在仅在保留消息的实际顺序改变时移动序号，普通内容更新、尾部追加和删除只写受影响的消息。只改会话元数据时不写消息行，重排的序号唯一约束和事务回滚保持。

独立main候选只含本次保存优化、六项真实SQLite回归测试及测试入口登记。旧代码六项中三项失败；修复后13组122项SQLite测试、类型与三项架构检查通过。工作区15项相关测试与类型检查通过。已有附件、回答版本校验及动画配置改动未纳入候选。

已安装Android调试应用通过当前已初始化仓库导出，在独立内存数据库中执行8条与256条消息各11项检查，包括内容更新、元数据、追加、尾部删除、交换、中部插入删除、替换、失败回滚、重试与清空。256条消息更新最后一条时，消息行写入512→1、仓库SQL调用261→5；本次观察841→58毫秒。元数据消息写入512→0，追加513→1，尾部删除514→1。计时含调试环境和观测开销，数据库为内存库；不代表磁盘/WAL或连续聊天总延迟。全量读取和JSON比较仍随消息数增加。

源码已同步并完成一次保护性重载。实际加载bundle与当前Metro逐字节匹配，完整仓库模块和源码映射与工作区相同。最终383独立复核53表3256行、四项原始存储、六组草稿与恢复槽、全部原始历史和设置、编辑器文字/附件/选区/焦点、原路由、设备、日志和外部前台task2993一致。进程5970保持，重载后输入实例218；2126项源码输入无漂移，累计43条请求未增加。

369候选比较发现预存动画配置差异，370仅修正检查方式；371原生脚本emoji编译失败未开始数据库操作，373确认无运行中任务并恢复前台，374修正传输编码。376重载前发现页面为联网与资料并停止，378核对原数据未变，379恢复原会话并完整复核；页面变化原因未知，失败保留。

证据：

- test-evidence/implementation/native-routing-groups-20261115-01/incremental-save-scoped-acceptance-20261117-384.json
- test-evidence/implementation/native-routing-groups-20261115-01/incremental-save-candidate-checks-20261117-370.json
- test-evidence/implementation/native-routing-groups-20261115-01/native-incremental-save-before-20261117-374.json
- test-evidence/implementation/native-routing-groups-20261115-01/native-incremental-save-after-20261117-382.json
- test-evidence/implementation/native-routing-groups-20261115-01/native-incremental-originals-audit-20261117-383.json

本项为v1.1.12之后第二项合格产品改进。源码1.1.12/137、固定安装1.1.8/133；未构建、导出、安装APK或触发Actions。连续请求完成延迟、内存增长、Web及全应用环境矩阵继续验证，四项整体资格保持false。

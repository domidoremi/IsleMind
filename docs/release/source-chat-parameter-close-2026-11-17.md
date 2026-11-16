# 会话参数关闭保存与焦点清理

日期：2026-11-17。

AI配置在关闭或进入连接管理前提交本面板待保存的数字草稿，并清除输入焦点。返回键与背景点击使用同一提交范围；Android首次返回仍先收起键盘。数字范围限制、清空后跟随模型、无效草稿回退及已保存值去重保持，切换会话不会把旧草稿带入新会话。

基线302实际输入0.6后直接关闭，保存值仍为0.3，原生焦点指向已关闭输入。独立main候选复现8项行为失败，修复后四组47项及类型、架构边界、模块边界和依赖检查通过。工作区四组55项与类型检查通过，两组测试有重叠。候选和真机工作区的参数提交、关闭及注册函数AST一致，其余未完成改动继续保留。

真机310完成关闭按钮、两次Android返回和背景点击的保存与重开，共6项通过；随后因截图文件名重复中断，原图和失败保留。完整恢复后，314仅补验进入连接管理和返回关闭的2项，两项通过。四条路径在恢复辅助逻辑执行前确认焦点为空，没有使用焦点移交补救。其他参数、设置、供应商、模板、会话方案和编辑器保持，累计请求仍为35。

实际加载bundle与当前Metro字节一致，面板、配置弹层、提交注册hook及键盘视口四个完整模块、已初始化导出和源码映射已核对。未执行断点逐调用绑定。独立复核确认53表3256行、四项原始存储、六组草稿和恢复槽、完整历史与设置、编辑器文字/附件/选区/焦点、路由、设备设置和原前台task2993完整。2126项调试源码输入无漂移，同一进程4090保持。

基线及当前两轮共14张图已完整查看，范围为中文Animal深色、1080×2400竖屏和普通字号。关闭图确认弹层和键盘消失，存储与原生焦点另由实际检查证明。长度标题在恢复按钮出现后换行，左右输入行高度不齐，仍待优化；Web、请求参数载荷及完整环境矩阵继续。304键盘模拟失败保留；修正后的305检查通过。

证据：

- test-evidence/implementation/native-routing-groups-20261115-01/parameter-close-scoped-acceptance-20261117-318.json
- test-evidence/implementation/native-routing-groups-20261115-01/parameter-close-candidate-checks-20261117-313.json
- test-evidence/implementation/native-routing-groups-20261115-01/native-parameter-close-20261117-310.json
- test-evidence/implementation/native-routing-groups-20261115-01/native-parameter-close-20261117-314.json
- test-evidence/implementation/native-routing-groups-20261115-01/native-parameter-close-originals-audit-20261117-312.json

本项验证时源码1.1.11/136，固定安装1.1.8/133。该产品提交将完成本周期第五项，随后按既定节奏更新源码版本并发布Release。全程未构建、导出、安装APK或触发工作流。完整目标和四项整体资格保持未完成。

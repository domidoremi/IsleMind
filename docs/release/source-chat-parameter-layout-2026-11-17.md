# 会话参数标题与输入行对齐

日期：2026-11-17。

AI配置中的数字参数将标题和取值范围分行排列，并固定保留44×44dp的重置按钮位置。重置按钮出现或消失时，回答创造性与回答长度上限的输入框保持对齐。原有数字草稿、范围限制、保存、清空和重置逻辑保持。

独立main候选只提取ParamInput布局，函数与真机工作区在归一化换行后完全一致。四组47项已有测试、类型、架构边界、模块边界和依赖检查通过；工作区四组55项及类型检查通过，两组测试有重叠。330首次准备的语法错误及CRLF/LF比较失败保留，331修正检查脚本后完成验证。

真机326完成真实键盘输入0.8、1024、0.7，失焦保存、关闭重开、逐项重置与再次重开，共11项通过。8组实际控件几何观测确认标题单行、范围位于标题下方、左右输入框对齐，重置目标保持44×44dp。六张完整原图已逐张查看，覆盖中文Animal深色、1080×2400竖屏和普通字号；几何记录也包含尚未滚入屏幕的控件，不单独证明可见性。

源码元数据1.1.12/137与布局已同步到隔离stage，固定原生app.json保持，保护性重载仅一次。实际加载bundle与当前Metro字节一致，四个完整模块、已初始化导出及源码映射与当前输入一致；未进行逐调用断点绑定。独立329复核53表3256行、四项原始存储、六组草稿与恢复槽、全部历史与设置、实际编辑器文字/附件/选区/焦点、原路由、设备设置、请求日志及原前台task2993完整。2126项调试源码输入无漂移，同一进程4090保持，累计请求仍为35。

证据：

- test-evidence/implementation/native-routing-groups-20261115-01/parameter-layout-scoped-acceptance-20261117-333.json
- test-evidence/implementation/native-routing-groups-20261115-01/parameter-layout-candidate-checks-20261117-331.json
- test-evidence/implementation/native-routing-groups-20261115-01/native-parameter-layout-20261117-326.json
- test-evidence/implementation/native-routing-groups-20261115-01/native-parameter-layout-visual-review-20261117-332.json
- test-evidence/implementation/native-routing-groups-20261115-01/native-parameter-layout-originals-audit-20261117-329.json

本项为v1.1.12之后第一项合格产品改进。固定安装仍为1.1.8/133，全程未构建、导出、安装APK或触发工作流。请求参数载荷、Web及其余环境矩阵继续；完整目标与四项整体资格保持未完成。

# 会话参数面板的 Android 键盘避让

日期：2026-11-17。

聊天页 AI 配置面板现在依据 Android 键盘和滚动区域的实际边界显示当前输入框。创造性、回答长度上限及 Top P 在数字键盘开启时保持完整可见。滚动调整保留输入草稿，参数仍在失焦时单独保存；关闭键盘时保留用户主动滚动的位置。

基于 main 的独立候选复现两项旧代码键盘行为失败。修复后五组、41项测试及类型、架构边界、模块边界和依赖检查通过；含现有未完成功能的工作区集成测试为五组、49项通过。本次提交包含面板接入、两项行为回归与本记录。

既有 Android 调试应用通过11项真实输入、失焦保存、关闭重开及独立重置检查。输入切换期间保持数字键盘开启，三项参数在输入前后共六次完整可见，实际原生焦点和UI坐标一致。其他参数、设置、供应商、路由模板和会话副本保持一致，没有新增模型请求。加载bundle与当前Metro输出逐字节一致，两项完整模块、已初始化导出和源码映射已核对；未执行断点逐调用绑定。

六张当前截图和一张修复前截图已查看，范围为中文、Animal深色、1080×2400竖屏及普通字号。重开图只覆盖面板上部；默认值图中的Top P未完整露出，三项持久化和重置由实际输入与存储核对。长度标题在恢复按钮出现后换行、关闭面板后的原生焦点引用、参数请求载荷和完整环境矩阵仍需继续检查。

独立复核确认53张表3256行、四项原始存储值、所有原始会话与消息、设置、供应商、用量、六组草稿与恢复槽、编辑器文字/附件/选区/焦点、路由、设备设置、原前台task2993及35条请求均保持一致。2125项调试源码输入无漂移。早期字段形状、系统内存回收、键盘遮挡、焦点清理及检查脚本失败均保留，并分别记录恢复和复核结果。

证据：

- test-evidence/implementation/native-routing-groups-20261115-01/parameter-keyboard-scoped-acceptance-20261117-298.json
- test-evidence/implementation/native-routing-groups-20261115-01/parameter-keyboard-candidate-checks-20261117-295.json
- test-evidence/implementation/native-routing-groups-20261115-01/native-parameter-independence-20261117-290.json
- test-evidence/implementation/native-routing-groups-20261115-01/native-parameter-keyboard-originals-audit-20261117-296.json

源码版本保持1.1.11/136，固定安装版本保持1.1.8/133。全程没有构建、导出、安装APK或派发工作流。全应用四项整体资格保持未通过。

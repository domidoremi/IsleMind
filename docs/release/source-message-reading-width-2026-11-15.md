# 聊天阅读栏尺寸修正

日期：2026-11-15。

聊天列表在连续请求确认和尺寸更新过程中出现 React 更新循环。阅读栏宽度约束现应用于消息、页头、页尾和空状态容器，列表的测量内容容器保留正常布局宽度。

当前工作区的 Web 生产运行模式通过 900→320→900→320 四次尺寸切换，消息身份和内容保持一致，无横向溢出。连续请求、取消、Esc 关闭及 A→C→B 的路由组请求通过，首选密钥和实际上游模型保持一致。

既有独立调试应用已重载这项源码修正。已加载模块及源码映射与冻结源码一致，实际挂载组件使用新的内容包装布局；1080×2400 截图已查看。86 条原消息、原设置、供应商、用量、六组草稿、恢复槽、编辑器和进程均保持一致。

最小 `main` 候选通过类型检查、三项架构检查及 21 项现有测试。当前工作区此前通过四个相关测试文件，共 19 项测试。运行验证使用当前工作区源码；提交候选包含阅读栏修正及本记录。

验收记录：

- `test-evidence/implementation/native-routing-groups-20261115-01/browser-width-continue-and-request-35.json`
- `test-evidence/implementation/native-routing-groups-20261115-01/browser-routing-cancel-36.json`
- `test-evidence/implementation/native-routing-groups-20261115-01/browser-routing-continue-39.json`
- `test-evidence/implementation/native-routing-groups-20261115-01/main-reading-width-validation-36.json`
- `test-evidence/implementation/native-routing-groups-20261115-01/native-loaded-reading-width-46.json`

本记录覆盖聊天阅读栏修正。全应用验收继续依照完整目标与覆盖账本推进。

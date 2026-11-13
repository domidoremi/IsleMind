# 文档保存状态的无障碍修正

文档编辑器使用透明文字预留保存提示的宽度，避免保存过程中标题移动。该文字原先只有原生无障碍隐藏属性，在 Web 上仍进入 Chromium 无障碍树：已保存时出现两条“Saved locally”，未保存时还会暴露错误的已保存提示。

辅助测量文字现在显式设置 `aria-hidden`，保留原有尺寸和原生无障碍属性。实际状态继续通过原有的礼貌通知区域播报。

验证结果：

- 原页面的实际 Chromium 无障碍树记录到两条未忽略的“Saved locally”。
- 使用新独立快取启动 Web 服务后，实际测量节点收到 `aria-hidden="true"`；已保存状态只保留一条“Saved locally”，未保存状态只保留一条“Unsaved”。
- 两种状态的预留宽度和高度一致，正文未变化，临时修改的标题已恢复，未执行额外保存。
- 仅含此属性修正的独立 `main` 候选通过既有五项保存状态测试；候选及工作区 TypeScript、两项架构检查均通过。

证据：`test-evidence/release/document-status-accessibility-20261114-01/checks-01.json`，以及 `test-evidence/implementation/reader-routing-info-2026-11-13/ego-main-readers-20261114-01/document-save-status-ax-baseline-13.json`、`document-save-status-ax-candidate-16.json`、`document-unsaved-status-ax-candidate-17.json`、`temporary-editor-unsaved-restored-17.json`。

重载后诊断监听器未保留的脚本失败，以及旧服务仍加载旧节点的复验失败均保留。此记录支持 Web 保存状态的无障碍修正，不代表完整 Android 或全应用验收。

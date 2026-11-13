# 来源阅读器返回位置修复

从来源阅读器打开帮助后，重新取得焦点会把已加载正文切换为加载状态，导致段落列表重新挂载。本次在重新读取同一来源时保留已完成的读取结果，待新的结果返回后更新正文。主动刷新、来源切换、读取失败和来源删除仍按实际结果更新。

新增三项回归测试，验证返回时保留正文和全部段落选择、重新读取后的更新或删除、主动刷新及旧读取取消。提交只包含这项读取行为和对应测试，其余进行中的功能继续独立验证。

当前工作区的相关测试共 82 项通过；新增测试的类型修正后单独复测三项通过，TypeScript 和两项架构检查通过。320 × 844 的实际浏览器操作确认，打开帮助前后滚动位置均为 380px，三个保存段落、展开状态和原回答预览保持一致；后续回答仍使用选中的第 2 版，未发出模型请求。

另外使用已提交版本制作独立副本：原版本在返回时保留正文的测试失败，应用本次焦点修复后三项测试全部通过，确认提交不依赖其他进行中的改动。

本地证据：

- `test-evidence/implementation/reader-routing-info-2026-11-13/ego-20261113-reader-completion-03/source-current-code-help-return-32.json`
- `test-evidence/implementation/reader-routing-info-2026-11-13/reader-help-validation-20261114-02.json`
- `test-evidence/release/source-retention-commit-check-20261114-01/isolated-check.json`

以上记录覆盖本项修复。原生文件导入、全部页面及视觉矩阵继续验证，整体验收标志保持未完成。

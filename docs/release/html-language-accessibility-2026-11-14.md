# 网页语言标记同步

网页切换为日文或简体中文后，界面已经翻译，HTML 的 `lang` 却继续保持英文。浏览器和辅助工具因而无法从页面语言标记取得正确的朗读语言。

语言初始化和手动切换现在同步更新页面语言标记。同步函数在存在文档对象时执行，沿用现有语言选择和持久化流程。

实际 320×844、Minimal 浅色浏览器完成英文初始化、日文即时切换及重载、简体中文即时切换及重载、英文即时还原与返回原会话。六个语言阶段的 HTML 标记、界面标题和保存设置一致；全部原存储哈希、原设置与空输入框精确还原，没有外部请求或模型请求。

TypeScript、依赖架构、模块边界审计与边界契约检查通过。首次检查误用了不存在的依赖脚本，该失败记录保留；按 `package.json` 中的实际命令复验通过。没有新增测试文件或构建产物。

证据：`test-evidence/release/html-language-20261114-01/checks-02.json`；`test-evidence/implementation/reader-routing-info-2026-11-13/ego-main-readers-20261114-01/html-language-browser-restored-55.json`。本项验收范围为网页语言标记，整体验收标志保持 false。

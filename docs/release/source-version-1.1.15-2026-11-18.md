# IsleMind 1.1.15 源码版本更新记录

2026-11-18，五项聊天模型菜单改动达到发布节奏。源码版本由 1.1.14 升至 1.1.15，Android 源码版本码由 139 升至 140。[三语更新说明](./v1.1.15.md)

从检查点 `56c38c5d57dca06eac849f1a25f42fb0145e9cd3` 开始，本次纳入以下提交。

- `e1bff097d40edaf6615aab80ba3c3be85f1992f9` fix(chat): 修正模型菜单的安全区定位
- `7dca4e8e1b4813f7a48400da84db711a41c54750` fix(chat): 保持模型选择器点击时的输入焦点
- `1b15c9efe00865bd07e82a3270f4e857d122dbe7` fix(chat): 扩大模型菜单关闭按钮的点击区域
- `a0ef2300cec3c01fb2b6c153c882437b2f626b8e` fix(chat): 保持输入区折行时模型按钮的焦点
- `31a5737252300ab4684c990820da7a942b95170a` fix(chat): 调整窗口或缩放时保持模型菜单可见

下一周期从 `31a5737252300ab4684c990820da7a942b95170a` 之后计数。版本维护提交不计入产品改动。

真机横屏安全区、模型按钮点击及关闭按钮边缘操作的范围分别见[安全区](./source-model-menu-safe-area-2026-11-18.md)、[鼠标焦点](./source-model-selector-focus-2026-11-18.md)和[关闭按钮](./source-model-menu-close-target-2026-11-18.md)。Web 三语四尺寸共 24 组焦点转移和返回检查通过。连续调整窗口的九个场景及双倍缩放的两个场景通过。动态视口修复在工作区和独立候选各通过 42 项测试。细节见[折行焦点](./source-model-selector-wrap-focus-2026-11-18.md)和[动态视口](./source-model-menu-web-viewport-2026-11-18.md)。

原有工作区改动、用户资料和 APK 候选目录受保护。现有隔离安装为 1.1.8/133，APK 候选仍为 1.1.2/127。真实网页按键、手机输入法、SQLite 启动锁，以及 31 条路由与 55 个原型的完整验收继续跟进。[完整目标](../architecture/full-application-improvement-goal.md)

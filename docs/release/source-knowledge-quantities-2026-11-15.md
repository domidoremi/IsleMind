# 知识片段与阅读段落的英文数量

知识卡片在一个片段时显示 `1 chunk`，阅读页在一个保存段落时显示 `1 saved section`；零个及多个继续使用复数。英文资源新增四个 i18next 数量键，保留原有基础键及全部既有翻译值。

实际翻译引擎核对中英日的 0、1、2 数量，TypeScript 检查通过。本项仅修改资源，不新增永久测试。英文网页在实际 320×844 视窗中通过两次文件选择导入，卡片分别显示 `1 chunk · 0 KB` 和 `2 chunks · 1 KB`，阅读页分别显示 `1 saved section` 和 `2 saved sections`。四张实际截图已逐张完整查看，数量文字和可见按钮未裁切。

最初的文件导入失败记录保留。已加载的浏览器 SQLite 报告 `no such module: fts5`；原有合成测试数据库含有宿主 SQLite 创建的 FTS5 投影。检查保存原数据库及其 OPFS 文件头，仅将临时测试副本的两个可重建投影调整为应用既有的 Web 普通表结构，原有 30 个非 FTS 表及投影行值保持一致。后续导入使用实际文件选择器和应用导入流程。这项测试准备没有修改产品的 SQLite 实现，也没有将最初失败改记为通过。

检查结束后，原有六个 OPFS 文件逐字节恢复，应用重新加载后的六文件哈希仍与原始值一致。原知识正文、八项浏览器存储、原会话地址、空且未聚焦的输入、英文及极简浅色恢复原值。两份检查导入的数据由原始数据库恢复移除，没有清空浏览器配置文件；专用浏览器空间已关闭。

当前源码为 1.1.10 / 135。此次四个新键尚未取得原生运行验证，原有原生集合数量与消息组件检查另按各自范围记录。完整路由、主题、尺寸、大字号、TalkBack、恢复及性能验收继续；`fullAcceptance`、`nativeVerified`、`visualAcceptance` 和广义 `loadedRuntimeVerified` 保持 `false`。本项不构建、导出、安装 APK，也不派发工作流。

证据：[翻译引擎检查](../../test-evidence/implementation/knowledge-section-quantities-20261115-01/applied-quantities.json)、[TypeScript 检查](../../test-evidence/implementation/knowledge-section-quantities-20261115-01/typecheck.json)、[实际单数卡片与阅读页](../../test-evidence/implementation/knowledge-section-quantities-20261115-01/browser-single-card-reader-13.json)、[实际复数卡片与阅读页](../../test-evidence/implementation/knowledge-section-quantities-20261115-01/browser-multiple-card-reader-14.json)、[完整图像复核](../../test-evidence/implementation/knowledge-section-quantities-20261115-01/browser-quantity-visual-review-18.json)、[原数据库最终复核](../../test-evidence/implementation/knowledge-section-quantities-20261115-01/browser-mounted-database-exact-17.json)、[原界面与存储恢复](../../test-evidence/implementation/knowledge-section-quantities-20261115-01/browser-originals-restored-16.json)、[版本节奏](./source-version-cadence.md)。

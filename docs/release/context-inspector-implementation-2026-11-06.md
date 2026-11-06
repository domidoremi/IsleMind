# 上下文检查器：请求快照、草稿预览与来源详情

日期：2026-11-06。本轮实现 [Magpie 源码研究](../research/magpie-source-study-2026-11-05.md)的 P0-B。

## 用户可见行为

- 聊天顶部的上下文入口提供“上次请求”和“草稿预览”两个范围。上次请求使用持久化的上下文计划，保留捕获时间、执行身份、原连接、模型、预算与来源；修改当前模型或草稿不会改写它。
- 草稿预览使用当前会话、模型别名对应的上游模型、生成参数及会话上下文策略。点击预览或刷新时读取输入框已提交的内容与附件数量，不依赖延迟保存的草稿。当前模型或设置变化会重新估算所捕获的草稿。
- 预览仅覆盖已载入的消息、系统提示和草稿文字。检索、工具声明与附件正文在发送时才能确定；附件数量保留为未计量，不以零估算代表零成本。正在发送或生成、草稿尚未载入、连接未绑定分别说明不可预览的原因。
- 每个上下文分项可以展开来源标识、分项身份、纳入／裁剪／排除决定、原始估算、纳入估算、上限、范围及规划原因。来源和身份列表每次展开八项，翻页仅使用当前快照。
- 消息身份列表明确标为“规划时的消息”，不能将它解释为压缩后逐条保留的消息。旧投影没有来源明细时显示说明；缺失或仅有模型家族推断值的窗口显示未知，隐藏容量条、分项比例条与压缩距离。未知窗口的草稿不以临时预算推断超限或压缩节省。
- 供应商回传输入与本地估算分别展示。回传值缺失、关联不完整、存在多个匹配的成功尝试或只有估算时显示未知。
- 详情的返回动作先回到构成。Web Escape 和 Modal 返回遵循同一顺序；关闭按钮关闭检查器。读取失败可刷新重试。
- 面板遵循现有主题材质。分项、范围、分页与返回控件至少 44dp；短窗口使用可滚动正文。容量条为原生和 Web 分别提供数值范围，超预算时保留完整估算说明并限制进度值的范围。
- 同步修正短窗口中长草稿抬高输入区后的模型菜单：按上下方可用空间定位并约束高度，模型列表与“AI 配置”按钮保持可滚动、可触达。

“上次请求”是最近捕获的请求计划，不证明供应商已接收或成功执行。只有可准确关联的成功回传记录才提供额外的供应商计数。

## 实现入口与边界

| 入口 | 职责 |
| --- | --- |
| [ContextCapacitySheet](../../src/components/chat/ContextCapacitySheet.tsx) | 快照／预览范围、刷新、过期读取隔离、历史身份及独立回传数 |
| [ContextCapacitySources](../../src/components/chat/ContextCapacitySources.tsx) | 已捕获来源元数据、八项分页与返回 |
| [chatContextDraft](../../src/components/chat/chatContextDraft.tsx) | 单个聊天工作区中的按需草稿读取器 |
| [Composer](../../src/components/chat/Composer.tsx) | 发布已提交的输入状态，不将每次输入提升到全局状态 |
| [ChatWorkspace](../../src/components/chat/ChatWorkspace.tsx) | 隔离工作区读取器，切换范围时保留组件挂载身份 |
| [contextCapacityDraftRuntime](../../src/bootstrap/contextCapacityDraftRuntime.ts) | 使用现有规划和打包策略进行本地预览，关闭运行事件输出 |
| [contextCapacityRuntime](../../src/bootstrap/contextCapacityRuntime.ts) | 读取最近的持久化计划；读取有界用量记录并严格匹配 |
| [contextCapacityProjection](../../src/modules/assistant-runtime/application/contextCapacityProjection.ts) | 纯投影与来源字段白名单，不携带原始正文 |
| [Diagnostics usage repository](../../src/modules/diagnostics/adapters/sqliteUsageRecordRepository.ts) | 按精确执行／连接读取有界尝试记录，保留歧义与截断信息 |
| [floatingComposerGeometry](../../src/components/chat/floatingComposerGeometry.ts) | 模型菜单的上下方空间选择与最大高度 |

`ContextCapacityView` 的 `sources`、`sourceMessageIds` 和 `manifestId` 是可选的诊断元数据；数组与策略对象不共享输入的可变引用。`ContextCapacityLoadResult` 的就绪结果新增可选 `reportedInput`。现有 Settings 上下文工作区继续使用同一构成组件。

没有新增持久化表、迁移或请求回执版本。来源明细不会调用 Knowledge 正文读取器、执行工具或请求供应商；预览不会持久化运行、修改设置、获取检索来源或输出运行事件。模型摘要策略在本地预览中只采用现有本地打包路径，不执行远程摘要。

供应商计数必须同时匹配 `runId`、`conversationId`、连接 ID、上游模型以及成功的初始 Chat 操作；测量来源必须为真实供应商回传。Diagnostics 新增 `findRunAttempts`／`runAttempts` 读取方法，使用现有连接索引与记录中的运行身份，最多返回 500 条并报告截断。截断、匹配记录损坏或读取失败都不提供计数，也不会隐藏已知计划。续调、其他会话和估算不能替代；较新的无关请求不会遮住精确匹配记录。

## 验证

17 个针对性 Jest 文件共 **438 项通过，0 失败**，覆盖来源字段白名单与数组隔离、读取取消与重试、工作区草稿隔离、模型／草稿变化与历史分离、Responses 原生／兼容协议、未知窗口、附件未计量、供应商计数匹配及原有输入持久化／上下文设置行为；还包括模型菜单短窗口定位、禁用／拒绝选择与动画关闭行为。

真实 SQLite 的生命周期、运行归属与用量仓库三个测试文件共 **46 项通过，0 失败**，包括按精确运行读取、多条尝试、较新无关请求、500 条上限与损坏记录。类型检查、架构依赖门禁和移动布局检查通过。

- [Jest 结构化结果](../../test-evidence/implementation/context-inspector-2026-11-06/focused-verified.json)
- [代码检查汇总](../../test-evidence/implementation/context-inspector-2026-11-06/completion-code-status.json)
- [类型检查](../../test-evidence/implementation/context-inspector-2026-11-06/typecheck-verified.log)
- [真实 SQLite 检查](../../test-evidence/implementation/context-inspector-2026-11-06/sqlite-verified.log)
- [架构依赖检查](../../test-evidence/implementation/context-inspector-2026-11-06/architecture-verified.log)
- [移动布局检查](../../test-evidence/implementation/context-inspector-2026-11-06/mobile-layout-verified.log)
- [中英日键与插值核对](../../test-evidence/implementation/context-inspector-2026-11-06/localization-parity.json)

浏览器使用一次性 Chromium 上下文、虚构连接及生产存储适配器，在真实 Expo SQLite 中保存会话、请求计划与诊断用量。所有非本地请求均在验证上下文中阻止并记录。供应商回传数来自明确标注的测试记录，没有调用真实供应商。

五套主题共 20 种布局、**125 项浏览器检查通过**，没有脚本错误或外部网络请求。每套主题覆盖 390×844 手机浅色、320×640 窄屏深色、1280×900 桌面深色和 800×480 短窗口。检查覆盖来源展开与分页、键盘返回、当前模型与草稿变化、输入框挂载身份、未知窗口、计数不匹配／歧义、快照损坏与刷新恢复以及会话切换。来源展开和草稿预览的插桩均未发现额外 SQLite 读写、请求计划重读、运行事件或供应商调用。

结果见 [浏览器验证记录](../../test-evidence/implementation/context-inspector-2026-11-06/application-browser-results.json)和 [完成汇总](../../test-evidence/implementation/context-inspector-2026-11-06/completion-summary.json)。截图人工抽查包括五套主题、窄屏长身份、短窗口、未知窗口和修正后的模型菜单；[手机请求快照](../../test-evidence/implementation/context-inspector-2026-11-06/minimal-mobile-light-recorded.png)、[来源详情](../../test-evidence/implementation/context-inspector-2026-11-06/monet-narrow-dark-sources.png)和 [未知窗口预览](../../test-evidence/implementation/context-inspector-2026-11-06/minimal-mobile-light-unknown-window.png)可直接查看。

Web 初次检查确认 React Native Web 没有将 `accessibilityValue` 输出为范围属性，容量条仅有标签与角色。本轮添加显式 `aria-valuemin`、`aria-valuemax` 和 `aria-valuenow`，保留 [修正前 DOM 证据](../../test-evidence/implementation/context-inspector-2026-11-06/application-browser-before-web-gauge.json)。

短窗口初次检查还复现了长草稿下的模型菜单落到屏幕外，保留 [原始失败](../../test-evidence/implementation/context-inspector-2026-11-06/application-browser-before-menu-placement.json)和 [修正后截图](../../test-evidence/implementation/context-inspector-2026-11-06/minimal-short-landscape-current-model-and-new-draft-retain-historical-receipt-raised-model-menu.png)。

## 验证限度与后续

草稿不是完整发送模拟；检索结果、工具声明、附件正文、服务端分词与远程压缩结果仍在真实发送时确定。现有常规 Chat 用量链路保留逻辑请求／回答身份，但未保证携带 AssistantRun 的 `runId`；无法准确关联的记录继续显示未知，本轮没有通过时间或“最近一条”推测关联。

Android 原生触摸、系统键盘／返回键、WebKit 与真实供应商尚未在本轮验证。P0-A 中已经确认的三个既有全局断言冲突见 [模型选择器验证限度](./model-picker-implementation-2026-11-05.md#既有全局检查失败)，此记录不宣称全局兼容检查通过。工具目录、发现与声明预算属于 P1-A。

# IsleMind 功能与主题协调升级 · 2026-11-06

本轮以已落地的模型选择、上下文检查、路由方案和请求诊断为基础，统一设置与详情页的标题、选择和操作层级，完善供应商、路由、请求、资源与帮助之间的使用路径。升级计划 A–F 已完成实施与离线/Web 验收；[G 批工具按需发现](./tool-discovery-implementation-2026-11-06.md)和[H 批场景方案](./scene-plans-implementation-2026-11-06.md)也已完成，并各自补充独立 Android 证据。真实供应商与完整原生资格继续按实际范围记录。

首页底部栏是本轮视觉参照。首页、主分页壳和底部栏相关的六份源码指纹均与本轮开始时一致；原有未提交成果作为基线保留。

## 页面与交互变化

| 范围 | 完成后的行为 |
| --- | --- |
| 设置、供应商、详情和帮助 | 使用共享标题区，统一返回、上下文说明、主要操作和阅读宽度。Liquid Glass 保留玻璃材质，其他主题使用克制的分隔与背景层级。 |
| 选项与分组 | 共享选择控件表达选中、禁用和触控状态；标签与单选组支持键盘方向键、Home/End，并跳过禁用项。减少动态效果时使用有限的透明度反馈。 |
| 窄屏与字号 | 标题操作可以换行，空间不足时上下排列；布局依据有效宽度和字体缩放调整。主题或文字更新保持业务子树，避免重新进入动画打断编辑。 |
| 路由管理与会话选用 | 管理页使用轻列表、共享输入和单选控件，保留执行顺序预览。删除操作满足触控尺寸；保存期间目标选择器的分页与关闭也会禁用。会话选择的作用范围在完整 AI 配置中明确显示。 |
| 请求与用量 | 总览分组使用共享标签控件；修正供应商分组误用模型列表无障碍标签的问题。请求详情保留完整尝试、原选模型与供应商报告模型的区分，并可返回原筛选视图或进入准确连接。 |
| MCP 已保存连接 | 详情进入共享任务工作区，标题显示连接名称；进入详情从内容顶部开始，返回恢复原列表位置。既有草稿、操作和生命周期保护继续由原模块负责。 |
| 知识、记忆、Skills、Agent 与偏好 | 通过共用设置壳协调页面层级，并复核窄屏、局部错误、编辑保持与原有任务操作。 |
| 文档、来源与帮助 | 回归长目录、输入、预览、保存、来源阅读和返回位置。帮助阅读器采用共享标题；中、英、日模型章节补充路由预览、会话副本、跨连接询问和请求记录说明。 |

全量清单包含 37 个路由模板；帮助模板展开为 12 个章节后，共有 48 个目的页面。动态详情使用隔离数据或缺失状态，内部编辑、实际数据、错误和返回行为由任务链补充验证。自动布局检查覆盖全部矩阵；人工视觉审阅覆盖代表页面，未把两者等同。

## 架构与执行范围

| 所有者 | 本轮落实的边界 |
| --- | --- |
| Core | 会话上下文策略的共享纯类型归入 Core，保持无副作用；路由引用也只定义版本化数据结构。 |
| Conversations / Settings | 会话领域不再依赖旧聊天契约。会话保存选用时的路由副本，Settings 维护模板；修改模板不会自动重定向已有会话。 |
| Providers / Assistant Runtime | 跨模块通过公开入口访问；私有运行时桥接测试归入所属模块。派发时明确冻结已解析请求，现有访问、凭据、取消、流式输出和续调规则继续生效。 |
| Diagnostics | 原选目标、实际尝试、供应商报告模型与工具续轮各自保留归属。供应商筛选不删掉完整请求中的其他尝试，无法确定的数据继续显示未知。路由归属为本地字段，不进入供应商载荷。 |
| Presentation / Bootstrap | 共享标题、控件和页面壳只负责呈现与交互；Bootstrap 继续组合已有适配器。没有增加界面侧持久化或执行权威。 |

首选加一个明确备用、跨连接默认询问、会话副本和来源绑定续调均是此前已实现的基础；本轮改善管理与阅读路径并验证这些约束。没有新增任意候选扩展、复杂策略排序或网关账号调度。

工程说明按研究、设计、发布和原型归属整理，架构目录只保留规范入口。架构审计修正了与当前实现不符的断言，保留自测与突变拒绝，未放宽模块契约。文案对保存的旧 `tavern` 身份做展示映射，保持存储兼容。

## 验证证据

A–F 的完成版 Web 导出为 `test-evidence/qa/islemind-upgrade-20261106/web-pass-f/`，以下浏览器记录对应这一批源码。G/H 的当前导出、运行时与原生证据分别见[G 报告](./tool-discovery-implementation-2026-11-06.md)和[H 报告](./scene-plans-implementation-2026-11-06.md)，不以较早页面矩阵代替新增机制的验收。

| 验证 | 结果 | 最新通过记录 |
| --- | --- | --- |
| 全页面矩阵 | 48 个目的页面 × 5 主题 × 2 模式 × 2 宽度，960/960；页面异常、控件和页面横向溢出均为零 | [全页面](../../test-evidence/qa/islemind-upgrade-20261106/visual-pass-f/results.json) |
| 窄屏资源与帮助 | 320 像素下 8 个入口 × 5 主题 × 2 模式，80/80 | [窄屏](../../test-evidence/qa/islemind-upgrade-20261106/visual-narrow-f/results.json) |
| 路由任务链 | 5 主题 × 2 模式 × 320/390/1280 像素，30 用例；创建、保存、刷新恢复、会话选用、范围说明与键盘操作通过 | [路由](../../test-evidence/qa/islemind-upgrade-20261106/routing-pass-f-v2/browser-results.json) |
| 工作状态 | 125 视图、37 工作流检查；真实 SQLite 中的合成文档、请求和供应商记录可读取，搜索与局部恢复通过 | [工作状态](../../test-evidence/qa/islemind-upgrade-20261106/working-pass-f/results.json) |
| 详情与编辑 | 19 视图、6 工作流检查；保存恢复、配置入口和脱敏错误通过 | [详情](../../test-evidence/qa/islemind-upgrade-20261106/detail-pass-f/results.json) |
| 写作与来源 | 85 视图、20 工作流检查；300 文档目录保持虚拟化，输入节点、40–80 选择区间、输入滚动 200 和目录返回位置 1100 保持 | [写作](../../test-evidence/qa/islemind-upgrade-20261106/writing-pass-f-v3/results.json) |
| 执行归属 | 5 主题 × 2 模式，10 用例；完整尝试、请求与报告模型、未知值、准确连接、筛选返回、同一回复的工具续轮通过 | [执行归属](../../test-evidence/qa/islemind-upgrade-20261106/execution-pass-f/results.json) |
| 资源与共享导航回归 | 8 套件、370 项通过，包含 MCP 导航、Skills、记忆、Agent 与键盘/减少动态效果检查 | [资源回归](../../test-evidence/qa/islemind-upgrade-20261106/resource-regression.log) |
| 内容与设置回归 | 11 套件、202 项通过 | [内容与设置](../../test-evidence/qa/islemind-upgrade-20261106/final-content-settings-regression.log) |
| 路由与运行时回归 | 7 套件、76 项通过 | [路由与运行时](../../test-evidence/qa/islemind-upgrade-20261106/final-routing-runtime-regression.log) |
| 真实 SQLite | 12 文件、107 项、620 断言通过 | [SQLite](../../test-evidence/qa/islemind-upgrade-20261106/final-sqlite.log) |
| 架构 | 无依赖环；997 文件、0 模块边界问题；14/14 架构项通过 | [依赖](../../test-evidence/qa/islemind-upgrade-20261106/final-architecture-dependencies.log)、[模块边界](../../test-evidence/qa/islemind-upgrade-20261106/final-module-boundary-v2.json)、[架构审计](../../test-evidence/qa/islemind-upgrade-20261106/final-architecture-boundary-v2.json) |
| 主题与静态门禁 | 主题审计 47 项、对比度、主题源码、命名、移动布局、Web 样式和字体缩放检查通过 | [主题](../../test-evidence/qa/islemind-upgrade-20261106/final-theme-audit.log)、[布局](../../test-evidence/qa/islemind-upgrade-20261106/final-mobile-layout-v2.log)、[字号](../../test-evidence/qa/islemind-upgrade-20261106/final-font-scale.log) |
| 类型、帮助与参照 | TypeScript 通过；帮助 10 项通过；搬迁文档 123 个本地链接无缺失；首页参照 6/6 一致 | [类型](../../test-evidence/qa/islemind-upgrade-20261106/final-typecheck.log)、[帮助](../../test-evidence/qa/islemind-upgrade-20261106/guide-regression.log)、[文档链接](../../test-evidence/qa/islemind-upgrade-20261106/moved-document-links.json)、[首页指纹](../../test-evidence/qa/islemind-upgrade-20261106/home-reference-verification.json) |

测试集合存在重叠，不汇总为独立测试总数。较早失败探测保留在证据目录，上表使用修正后最新通过记录。

最终 Web 导出 SHA-256：

```text
3d0f10725c9ab96d4292b3864586341cf1b8088ade7efd30a0e4212737efab6e
```

## 截图与复核入口

[本地图册](../../test-evidence/qa/islemind-upgrade-20261106/index.html)包含 479 张完成版截图和 90 张基线截图，支持主题、模式、宽度、页面和任务步骤筛选，以及相同组合的前后对照。没有保存截图的组合明确标出；全页面检查记录仍可查看。

图册数据嵌入 HTML，可直接打开，无需网络或启动生产服务。索引生成器为 [islemind-upgrade-atlas.cjs](../../scripts/islemind-upgrade-atlas.cjs)，清单为 [atlas-manifest.json](../../test-evidence/qa/islemind-upgrade-20261106/atlas-manifest.json)。索引只读取既有证据，不修改生产导出或检查结果。

图册本身通过 30 个主题/模式/宽度组合与 4 项交互复核，确认筛选、前后对照、未留截图说明和页面清单导航可用，页面异常与外部请求为零。记录见 [atlas-verification.json](../../test-evidence/qa/islemind-upgrade-20261106/atlas-verification.json)。交付时再次确认[生产导出和首页指纹一致](../../test-evidence/qa/islemind-upgrade-20261106/delivery-source-verification.json)，并复核[实施文档的本地链接](../../test-evidence/qa/islemind-upgrade-20261106/final-document-links.json)。

本报告位于可进入版本记录的发布维护目录。计划、研究、原型和测试证据仍遵循仓库现有忽略规则，作为工作区本地记录保存。

## 后续资格验证与研究

本轮浏览器数据均隔离，真实供应商调用为零，复制操作使用受控测试实现，没有写入系统剪贴板。合成尝试记录能验证阅读、归属和返回路径；模拟执行器回归能验证回退策略，二者都不能替代上游联网结果。

G/H 已在独立 Android 包中验证五主题双模式、保存与重启，以及真实数字输入在主题变化后的文字、焦点和键盘上方可见性。H 另外验证原生未选目标、场景配置、规范历史、冲突、新的未发送草稿和实际帮助章节。正式包公开安装身份/APK 和 OS 设置前后一致，未检查正式私有数据。Android/iOS 的完整输入法、系统动态字号、TalkBack/VoiceOver、减少动态效果和多设备材质资格仍需独立验收。真实供应商验收需使用对应连接，核对流式输出、跨连接询问、取消、来源绑定续调、工具发现及回传模型/用量。

Magpie 的按需工具发现与声明预算已在 G 批落地，沿用冻结目录、原权限和已有检查点，并提供首轮字符记录；本地合成字符收益不代表真实 Token 或整体任务费用。H 已完成常用配置保存、作用范围/缺失引用预览和独立会话副本，提供 300 场景 Web 视图/80 检查、70 关联入口视图与 43 Android 视图/6 组检查。其[图册](../../test-evidence/qa/islemind-scene-plans-20261106/index.html)保留 413 张完成版截图。更复杂的路由策略继续按用户任务、模块所有者、作用范围和收益独立评估。持续计划见[本地升级计划](../plans/islemind-upgrade-2026-11-06.md)，产品研究见[Magpie 功能与设计研究](../research/magpie-product-design-study-2026-11-06.md)。

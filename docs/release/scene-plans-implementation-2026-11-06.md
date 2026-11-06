# 场景方案保存、预览与应用 · H 批实施验收

日期：2026-11-06。反复进行研究或写作时，可以把常用模型、路由、技能、提示词、资源与上下文配置保存为方案。应用前查看目标会话、配置变化和引用状态；应用后会话使用自己的配置副本，修改模板不会重新配置已应用的会话。

本批承接[功能与主题协调升级](./islemind-upgrade-2026-11-06.md)和[G 批工具发现](./tool-discovery-implementation-2026-11-06.md)。实现、行为回归、完整场景 Web 矩阵和独立 Android 实测已完成。网页交付导出为 `web-h6`，操作证据为 `views-h6`，关联入口证据为 `routes-h6`，原生实测为 `native-h6`。

## 使用行为

| 场景 | 当前行为 |
| --- | --- |
| 设置入口 | 设置 → 模型 → 场景方案，路由为 `/settings/scenes`。列表可以新建、编辑、删除和进入应用预览。完整 AI 配置提供“选择方案”和“保存为方案”。 |
| 保存范围 | 可选的准确模型目标与路由副本、技能引用及类型化变量、提示词、工具与知识来源、会话压缩阈值和工具定义方式。凭据、全局功能开关、权限决策、消息历史和运行状态不进入方案。 |
| 保留、清空与继承 | 未指定字段保留目标当前值；显式空资源列表表示该范围不使用资源；上下文或工具定义方式恢复全局时清除会话覆盖。供应商内置搜索和记忆继续在上下文偏好中管理。 |
| 路由 | 保存首选、备用和跨连接规则的独立副本。编辑原路由模板不改动场景；编辑场景不改动已应用会话。预览和原执行路径继续核对准确连接、模型与访问条件。 |
| 技能与变量 | 使用 Conversations 原有技能组合。预览显示组合产生的提示词、模型、生成参数和资源变化，场景中的显式配置随后覆盖。必填变量缺失、未知引用或不支持的值阻止应用；技能第一条消息不会自动发送。 |
| 应用预览 | 明确显示已有会话或新草稿、前后配置、路由顺序、缺失引用与当前关闭的功能。关闭的全局资源功能保持关闭；目录读取失败提供重试。预览不发送供应商请求。 |
| 应用到已有会话 | 只提交单个会话的配置，后续请求使用该配置。历史消息和已捕获请求保留自身记录；运行中、目标删除、配置变化或预览过期会阻止提交。 |
| 新会话 | 创建没有消息的本地草稿，应用本身不写入持久化历史。打开会话后，首次发送继续经过原有保存与运行屏障。 |
| 来源 | 记录上次应用的方案名称、ID、版本和时间。它是应用来源，后续手动调整配置不会形成与模板同步的关联。 |
| 保存故障与冲突 | 保存失败保留表单并支持重试。外部模板版本变化保留本地文字，可以重新载入或另存新方案。会话保存失败不会发布半完成配置。 |

旧会话的空工具和知识列表继续保持原有不限制语义。新增 `islemind.conversation-resource-scope.v1` 标记区分 `selected` 与 `none`；工具在已准入、冻结的正式目录中按准确身份收窄，知识按准确文档身份检索。工具 `none` 不建立正式工具会话或 MCP 上下文；知识 `none` 排除检索和正式 RAG 工具。旧的唯一名称或标题可以由资源所属模块解析，未知或重名引用保持关闭。后续明确的技能或资源编辑同步更新已有范围标记。

## 架构与提交保护

| 所有者 | 本批职责 |
| --- | --- |
| Core | 纯方案、资源范围和应用来源契约，复用递归冻结的 `snapshotPlainData`。 |
| Settings | 有界模板校验、版本冲突、保存和删除，通过既有 Settings 队列持久化。 |
| Conversations | 技能组合、会话配置修订、白名单配置复制、单会话锁与提交，以及旧参数偏好的领域规范化。 |
| Providers | 原有准确模型目录、路由策略和访问检查。 |
| Knowledge / Integrations | 准确资源引用和执行范围，继续拥有资源目录与能力端口。 |
| Bootstrap | 组合公开模块入口；将准确预览对象与内部补丁绑定，重新核对目标、引用和版本，并接入现有持久化适配器。 |
| Presentation | 编辑、预览、反馈和导航，通过工作区端口调用行为；没有新增持久化或执行权威。 |

预览是递归冻结的快照，并通过 WeakMap 绑定准确对象和内部配置补丁。克隆、重复使用、修改来源或目标均不能扩大提交。应用重新核对模板、会话配置、模型访问、技能定义和资源目录，锁内拒绝运行中、已删除或冲突目标。

实际 Web 验收发现，旧会话加载时补全生成参数覆盖标记，会与磁盘的等价旧表示产生错误冲突。现在 Store 加载和配置修订共用 Conversations 的领域规范化规则；有限的旧参数值仍表示明确覆盖，已有覆盖映射继续保持自身语义。等价表示允许应用，真正切换为模型默认仍被识别为修改。该纯规则只引用 Core 和 Conversations 自己的领域契约。

现有保存队列在提交时再读规范会话记录，只复制允许的配置字段。磁盘消息、标题和其他元数据保持规范记录的内容，界面中净化过的历史投影不能覆盖原始工具轨迹。回归包含原始轨迹元数据的保留；真实 SQLite 操作检查历史消息 JSON 字节、事务失败回滚和重试。

锁与修订保护限于当前应用进程和单会话记录。模板、资源、会话与运行时没有被宣称为跨模块事务；本批不认证多实例并发写入。规范见[架构](../architecture/architecture.md)、[公开 API](../architecture/module-public-api.md)和[本批设计](../design/scene-plans-2026-11-06.md)。

## 页面与主题

场景列表使用共享导航行与 `layers` 图标。会话、资源、上下文分成三个编辑页签，应用预览沿用共享标题、选择、阅读与反馈控件；返回、主要操作和作用范围说明保持同一层级。

Minimal、Monet、Material、Liquid Glass、Animal Island 保留各自材质与字体，同时共用触控、选择与反馈规则。主题和尺寸变化保持编辑节点、文本选择和焦点；窄屏操作可以换行，保存或应用期间阻止重复提交和离开。选择反馈遵守原有减少动态效果规则。

原生验收发现 Animal Island 的 Select 将 Web 游走焦点的 `tabIndex=-1` 传给未选中的启用选项，导致 Android 移除它的焦点和点击动作。项目使用的 UI fork 现在仅在 Web 使用该选项焦点顺序；所有启用的原生选项保持可聚焦，禁用项仍不能选择。组件样式与公共 API 保持，修正同时适用于供应商、路由等使用该控件的页面。

UI fork 的源码回归与重建后的消费应用回归分别验证原生未选项、禁用项、Web 焦点顺序、搜索与定位。英文和中文原生工作流同步；既有 Button 和其他未提交适配保留，远端源码 pin 没有推进。构建记录绑定当前链接的 224 份非测试 UI 源文件，Node/Jest 消费产物另有指纹。

本批以首页底部栏为参照。[六份首页与底部栏参照指纹](../../test-evidence/qa/islemind-scene-plans-20261106/home-reference-verification-h6.json)全部一致；本批未修改这些文件。

## 验证结果

| 验证 | 结果 | 完成版证据 |
| --- | --- | --- |
| 行为与运行时回归 | 17 套件、238 项通过；模板校验、变量、保存/冲突、不可变预览、运行中保护、规范历史、精确资源、目录读取后的取消、分支、旧数据和构建后的原生选项 | [行为回归](../../test-evidence/qa/islemind-scene-plans-20261106/final-focused-h9.log) |
| 领域类型归属调整 | 2 套件、32 项通过，TypeScript 和领域边界检查通过；与上述集合重叠 | [领域回归](../../test-evidence/qa/islemind-scene-plans-20261106/final-domain-h4.log)、[类型与架构](../../test-evidence/qa/islemind-scene-plans-20261106/final-architecture-h4.json) |
| 真实主机 SQLite | 2 文件、7 项、29 断言通过；消息字节、来源与范围、旧记录迁移、重启和保存失败回滚 | [SQLite](../../test-evidence/qa/islemind-scene-plans-20261106/final-sqlite-h2.log) |
| 场景 Web 操作 | 5 主题 × 2 模式 × 320/390/960 CSS 像素；300 视图、80 项流程检查通过；编辑保持、真实 Settings 主题命令、故障/重试、实际事务回滚、引用、冲突、会话副本与新草稿 | [场景 Web](../../test-evidence/qa/islemind-scene-plans-20261106/views-h6/results.json) |
| 关联 Web 入口 | 设置、供应商、路由、上下文、MCP、用量、模型帮助 × 5 主题 × 2 模式 × 390 CSS 像素，70/70；页面异常、外部请求和横向溢出为零 | [关联入口](../../test-evidence/qa/islemind-scene-plans-20261106/routes-h6/results.json) |
| 独立 Android | 43 视图、6 组流程检查通过；五主题双模式的列表/编辑/预览，保存与重启、输入/焦点/键盘可见性、路由与历史、缺失引用、冲突、新草稿、原生选项和实际帮助章节 | [Android](../../test-evidence/qa/islemind-scene-plans-20261106/native-h6/results.json) |
| 模块与依赖 | 1,578 文件、6,540 边、0 环；1,024 模块文件、0 边界问题；边界自测和架构契约通过 | [依赖](../../test-evidence/qa/islemind-scene-plans-20261106/final-dependencies-h4.log)、[架构](../../test-evidence/qa/islemind-scene-plans-20261106/final-architecture-h4.log) |
| 类型、主题与指南门禁 | 15 个主工程命令通过；14 个架构项、主题 47 项、对比度、移动布局、Web 样式、字号、命名、三语指南及 10 项指南自测 | [门禁清单](../../test-evidence/qa/islemind-scene-plans-20261106/final-gates-h6.json) |
| UI fork 与构建产物 | 3 套件、58 项通过；源码类型、所改文件 lint、文档同步和格式通过；lint 为 0 错误、4 项既有内联样式警告 | [UI 回归](../../test-evidence/qa/islemind-scene-plans-20261106/ui-select-tests-h7.log)、[源码与消费产物](../../test-evidence/qa/islemind-scene-plans-20261106/ui-consumer-verification-h6.json) |
| 图册 | 413 张当前截图；离线筛选 50 个组合、4 项交互检查通过；页面异常和外部请求为零 | [图册验证](../../test-evidence/qa/islemind-scene-plans-20261106/atlas-verification.json) |
| 交付指纹 | 1,166 份非测试 app/src 与 stage 核对，保留三处已记录的资格改动；38 份指南输入和 224 份链接 UI 源码绑定；首页 6/6、APK、导出、截图与本地文档链接复核 | [交付核对](../../test-evidence/qa/islemind-scene-plans-20261106/delivery-source-verification.json) |

各组测试存在重叠，分别报告。自动矩阵检查全部通过；人工视觉复核覆盖代表列表、编辑、预览、窄屏材质和原生键盘页面，未扩大为逐图人工认证。Web 使用隔离浏览器数据和真实 Expo SQLite，模型连接、资源与历史均为有界合成数据。

新入口已进入正式工作清单；当前为 38 个路由模板，帮助展开后为 49 个目的页面。H 的场景任务与关联入口单独验收，不把 A–F 的较早全入口矩阵算作 H 的新构建验收。

## 构建与交付范围

[本地图册](../../test-evidence/qa/islemind-scene-plans-20261106/index.html)索引 370 张 Web 与 43 张 Android 截图，可以筛选平台、五主题、深浅模式、实际宽度和任务步骤。数据嵌入 HTML，直接从磁盘打开即可使用；未留截图的组合明确说明。Web 标注 CSS 像素，Android 标注设备像素。生成器为 [scene-plans-atlas.cjs](../../scripts/scene-plans-atlas.cjs)，离线浏览器复核为 [verify-scene-plans-atlas.cjs](../../scripts/verify-scene-plans-atlas.cjs)。

最终 Web 导出位于 `test-evidence/qa/islemind-scene-plans-20261106/web-h6/`。原生 Select 修正后重新导出并完成场景与关联页面矩阵，`views-h6` 和 `routes-h6` 均对应当前内容。关联页面记录首次落入脚本的新默认目录，原记录保留；整理后的结果与截图经过逐字节核对，见[来源记录](../../test-evidence/qa/islemind-scene-plans-20261106/routes-h6/evidence-origin.json)。

```text
SHA-256 8698a224d01ce500c9e4627aef692ac4b1767018040081f8d87bcda0553272ac
```

Android 使用独立 `com.islemind.stage9`：offline、无 INTERNET、backup=false、arm64-v8a、优化 Hermes、dev support disabled 的 debuggable qualification 构建。当前源码刷新记录为[H6 构建](../../test-evidence/qa/islemind-scene-plans-20261106/native-refresh-h6/build-after.json)与[源码及构建输入](../../test-evidence/qa/islemind-scene-plans-20261106/native-refresh-h6/source-refresh.json)，刷新前 APK、源码和收据均保留。三处 stage 专用改动用于隔离嵌入端口、启动与 SQLite 读回调。

源码核对发现旧 stage 文档会在 Metro 阶段重新生成旧帮助，而 Gradle 的输入判断未覆盖文档和链接 UI 的全部变化。当前刷新器同步 38 份完整指南/素材与生成器输入，构建后核对生成文件和源文件；资格构建只强制重做 JS bundle 并禁用其缓存，原生任务按原规则复用。实际 APK 命令确认三语模型章节都包含 `scenes` 锚点，实际帮助阅读器另行检查场景章节。较早探测和构建保留为历史。

```text
SHA-256 cb45f24527ff78c2054ea8f2f55b0232ee7bbe96a955212bae9465b876d068dc
```

设备为 M2007J3SC、Android 12/SDK31。真实输入 `65` 在主题变化后保留文字与焦点，输入框底部与键盘顶部相距约 24 个 React Native 逻辑像素；新目标的实际原生层级记录显示 enabled/clickable/focusable 均为 true。

本批不调用真实供应商或真实能力端口。正式 `com.islemind.app` 的公开安装身份、版本/APK 与 OS 显示、密度、字号、夜间模式和读屏设置前后一致，不读取正式包私有数据。合成连接缺少真实凭据，打开新草稿时原执行前检查会显示配置提醒；这验证原凭据限制仍生效。真实供应商流式输出、路由询问与取消、实际工具收益、iOS、完整读屏、更多输入法及系统动态字号继续需要各自的资格证据。

持续计划见[升级计划](../plans/islemind-upgrade-2026-11-06.md)；本批证据独立保存，较早失败探测保留，不以 G 批构建或页面结果代替 H 批验收。

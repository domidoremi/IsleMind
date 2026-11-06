# 工具按需发现与声明预算 · G 批实施验收

日期：2026-11-06。正式工具目录较大时，每轮提供全部参数会增加输入体积。本批在默认“完整定义”之外增加“自动按需”：先提供冻结目录的摘要，再按查询提供完整参数，真实操作继续使用自身身份和原有授权路径。设置、历史请求记录、帮助和隔离 Android 验收均已完成。

本批承接[功能与主题协调升级 A–F](./islemind-upgrade-2026-11-06.md)。最新证据使用 `web-g4` 和 `native-g5`，对应包含两处原生交互修正的最终源码；较早构建、失败探测和图册保留为历史记录。

## 使用行为

| 场景 | 当前行为 |
| --- | --- |
| 设置入口 | 设置 → 上下文 → 工具定义，可搜索并深链接到 `/settings/context?section=tool-declarations`。使用共享任务工作区、标题、单选、保存和反馈控件。 |
| 旧设置与默认 | 缺少新字段的记录仍使用完整定义；畸形字段也不会启用自动按需。已在真实 Android 持久化中保存缺少字段的记录，并重启验证默认值。 |
| 自动按需 | 超过 10 项真实操作或完整声明超过 12,000 字符时，先提供摘要目录和发现声明。小目录继续直接提供完整参数。选择保持为草稿，显式保存后用于新运行。 |
| 发现与后续执行 | 对当前冻结、已缩小范围的目录做确定的名称、ID、说明查询和分页。每页最多 8 项完整定义；下一轮取得参数后，模型以操作本身的身份请求执行。 |
| 声明目标 | 12,000 字符是目标，完整 JSON Schema 保留。单项超过目标时单独提供并记录超出目标，不能为满足数字截断参数。简单目录采用发现也可能增加字符；帮助和设置提示可能多一次模型请求。 |
| 批量与恢复 | 出版页在整组调用完成后用于下一次请求；同组后续调用不能借发现扩大自己的声明范围。后续拒绝保留已成功出版的页。全局 full/auto 改变后，恢复运行仍使用捕获时的模式和准确页。 |
| 历史请求记录 | 展示该运行首轮提供的真实工具数量、待发现数量、声明字符和完整定义字符。与正文估算、供应商 Token 分别记录；旧记录缺少收据时保持可读，当前草稿预览不冒充历史事实。 |
| 帮助 | 中、英、日工具章节及生成的离线指南同步，说明作用范围、发现步骤、兼容模式和字符计数的含义。 |

## 架构与授权

| 所有者 | 本批职责 |
| --- | --- |
| Integrations | `planModelOperationDeclarations`、`discoverModelOperations`、`readModelOperationPublication` 转换已经冻结的目录；`MODEL_OPERATION_DISCOVERY_METADATA_CLASS` 明确标记为 `frozen-catalog-only`。发现不读取实时用户状态、目录或能力端口。 |
| Assistant Runtime | 继续管理 Harness 步数、取消、持久化活动边界、确认/批量/恢复检查点，并捕获可选的首轮声明收据。 |
| Tasks | 真实操作继续经过原权限、确认、具体能力端口与幂等路径。参数出版不获得执行权限。 |
| Providers | 使用既有 Native/Tagged 协议序列化、来源绑定和续调路径，接收当前请求的声明投影。 |
| Settings | 在既有设置记录中规范化可选模式；完整定义保持为兼容默认，保存通过既有队列。 |
| Bootstrap | 组合公开适配器，验证出版页与冻结操作的名称、ID、schema、权限和修订准确一致，拒绝损坏的恢复状态。 |
| Presentation | 编辑设置、显示诊断与处理输入和滚动。参数页沿用请求/确认/批量检查点，不新增界面侧发现存储或执行权威。 |

冻结目录的 64 项真实操作上限与修订不包括虚拟发现声明。发现仍消耗原步数，并等待持久化活动检查点；取消或持久化失败会阻断后续处理。

回归覆盖未声明/禁用/未知操作、同名重复、伪造与过期 schema、越界查询、损坏出版回执、确认、取消、持久化失败、来源绑定、批量顺序、子范围和恢复模式变化。规范见[架构](../architecture/architecture.md)与[公开 API](../architecture/module-public-api.md)，本地设计见[G 批设计](../design/tool-discovery-2026-11-06.md)。

## 界面与原生修正

工具定义页沿用首页参照的轻边界、明确选中标记和紧凑操作。Minimal、Monet、Material、Liquid Glass、Animal Island 保留各自材质与字体；共享标题、触控尺寸、表单反馈和作用范围说明协调页面层级。工具编辑页隐藏无关知识资源的载入/重试状态，内部标题使用“参数提供方式”。

原生验收发现并修正了两处共享交互问题：

1. Web 的 `tabIndex=-1` 被传到原生选项，会被 React Native 转为 `focusable=false` 并移除 Android 无障碍点击动作。共享选项现在仅在 Web 使用焦点顺序；原生已启用的选项保留焦点、点击和单选语义，禁用项继续阻断修改。
2. 主题变化会让文字重新排版，原先仅在键盘弹出时滚动，导致仍有焦点的输入框被遮住。设置页现在按输入框窗口坐标和键盘位置调整滚动，Android 在键盘显示期间保留滚动空间；主题、内容和视口重排重新检查。拖动、失焦、新布局或卸载会拒绝旧测量回调，减少动态效果时立即调整。

Android 数字输入 `65` 在真实主题切换后保留文本与焦点。输入框底部约为 509.45、键盘顶部约为 534.91，间隔约 25.45 个 React Native 逻辑像素；截图确认完整可见。恢复后输入回到 `80`，持久化会话覆盖设置仍不存在。记录见[原生结果](../../test-evidence/qa/islemind-tool-discovery-20261106/native-g5/results.json)。

## 本地合成目录的字符证据

真实 SQLite、会话、Harness 和正式目录适配器配合合成模型/执行器端口，分别完成 Native/Tagged 三轮模型交互。每种协议包含 24 项真实操作、2 条操作回执、2 条活动和 1 次合成执行器调用；真实供应商与真实能力执行均为零。

| 协议 | 完整定义字符 | 按需首轮字符 | 提供 1 项完整定义后的字符 |
| --- | ---: | ---: | ---: |
| Native | 34,562 | 5,848 | 7,287 |
| Tagged | 38,931 | 6,650 | 8,225 |

目录修订为 `islemind.model.operation.catalog.v1:1db54gh`。这组数字只证明此合成目录的声明体积变化，不代表供应商 Token、整体任务费用、延迟或所有工具目录的收益。[主机 fixture](../../test-evidence/qa/islemind-tool-discovery-20261106/fixture-g2/manifest.json)与[原生 fixture](../../test-evidence/qa/islemind-tool-discovery-20261106/native-g5/results.json)中的首轮与出版字符一致。

## 验证结果

| 验证 | 结果 | 完成版证据 |
| --- | --- | --- |
| 工具发现与持久化契约 | 9 套件、143 项通过 | [工具回归](../../test-evidence/qa/islemind-tool-discovery-20261106/final-tool-discovery-regression.log) |
| 供应商与运行时 | 6 套件、386 项通过，包含正确的续调绑定测试 | [运行时回归](../../test-evidence/qa/islemind-tool-discovery-20261106/focused-regression-g3.log) |
| 原生布局与共享设置 | 6 套件、320 项通过，包含焦点、键盘重排、旧测量拒绝、MCP 导航和草稿保持 | [布局回归](../../test-evidence/qa/islemind-tool-discovery-20261106/final-native-layout-regression-g4.log) |
| 真实主机 SQLite | 12 文件、109 项、634 断言通过 | [SQLite](../../test-evidence/qa/islemind-tool-discovery-20261106/final-sqlite.log) |
| 工具 Web 矩阵 | 5 主题 × 2 模式 × 320/390/960 像素；120 视图、60 工作流检查；默认、搜索、键盘、未提交选择、保存故障/重试、重启、记录与帮助通过 | [工具 Web](../../test-evidence/qa/islemind-tool-discovery-20261106/views-g4/results.json) |
| 重点 Web 入口 | 设置、上下文、MCP、用量、路由、工具帮助 × 5 主题 × 2 模式 × 390/1280 像素，120/120；页面异常、外部请求和横向溢出为零 | [入口回归](../../test-evidence/qa/islemind-tool-discovery-20261106/routes-g4/results.json) |
| 隔离 Android | 25 视图、3 组工作流检查通过；五主题双模式实际渲染，旧设置、保存与重启、输入/焦点/可见性、恢复和离线帮助通过 | [Android](../../test-evidence/qa/islemind-tool-discovery-20261106/native-g5/results.json) |
| 类型与静态门禁 | 12 个命令通过；类型、1556 文件/6406 边/0 环、1003 模块文件/0 问题、14 架构项、主题 47 项、布局/字号/命名、三语指南与 10 项指南自测 | [门禁清单](../../test-evidence/qa/islemind-tool-discovery-20261106/final-static-gates-g4.json) |
| 源码与构建 | 1150 个非测试 app/src 文件与隔离 stage 一致，除三处已记录的验收代码改动；APK 与构建收据一致；首页参照 6/6 一致；265 张截图指纹通过 | [交付指纹](../../test-evidence/qa/islemind-tool-discovery-20261106/delivery-source-verification.json) |
| 图册 | 265 张截图；离线筛选 50 个组合与 4 项交互检查通过 | [图册验证](../../test-evidence/qa/islemind-tool-discovery-20261106/atlas-verification.json) |

各组测试存在重叠，分别报告，不相加为独立总数。自动布局矩阵全部通过；人工视觉复核覆盖代表设置、保存失败、请求记录与原生键盘页面，不等同于逐图认证。

## 构建、图册与范围

[本地图册](../../test-evidence/qa/islemind-tool-discovery-20261106/index.html)支持平台、主题、模式、宽度与任务步骤筛选。Android 标注设备像素，Web 标注 CSS 像素；未留截图的组合有明确说明。图册直接从磁盘打开即可使用，生成器为 [tool-discovery-atlas.cjs](../../scripts/tool-discovery-atlas.cjs)。

最终 Web 导出：`test-evidence/qa/islemind-tool-discovery-20261106/web-g4/`。

```text
SHA-256 cdca6a8626cb6cd69401ea140c2e9e2ed260eba4f0d279478fafcff4901c2e1f
```

最终 Android 为独立包 `com.islemind.stage9`，offline、无 INTERNET、backup=false、arm64-v8a、优化 Hermes、dev support disabled 的 debuggable qualification 构建。外部 stage 构建成功；最终刷新 26 个指定文件，保留刷新前源码、APK 和收据。此包用于隔离资格验收。[构建收据](../../test-evidence/qa/islemind-tool-discovery-20261106/native-refresh-g4/build-after.json)与[刷新记录](../../test-evidence/qa/islemind-tool-discovery-20261106/native-refresh-g4/source-refresh.json)记录完整身份和源码指纹。

```text
SHA-256 eb932a7c7a733972c0e8f3dc903f5ea5c6d51952437cc16b44a6994464b75704
```

设备为 M2007J3SC、Android 12/SDK31。主题与目的页面由隔离入口调用正式 Store/Router；选择、保存、文字、返回和滚动使用 Android 的真实触摸/键盘输入事件。SQLite 和正式会话运行路径真实运行，模型及能力端口为合成实现。三处 stage 验收代码改动用于隔离嵌入端口、启动与 SQL 读回调，已在构建收据和源码核对中列明。

正式 `com.islemind.app` 的公开安装身份、版本与 APK 指纹前后一致，OS 显示、密度、字号、夜间模式和读屏设置前后一致。未读取正式包私有数据；这些证据不声称私有数据完整性认证。

本批未调用真实供应商。iOS、完整 TalkBack/VoiceOver、系统动态字号、不同输入法组合输入和多设备材质/性能资格仍需独立证据。当前结果证明所列 Android 设备和离线/合成工作流的范围。后续持续计划见[升级计划](../plans/islemind-upgrade-2026-11-06.md)。

# 模型选择器：跨连接搜索与收藏

日期：2026-11-05。此轮将 [Magpie 源码研究](../research/magpie-source-study-2026-11-05.md)中的模型选择流程接入 IsleMind。

## 用户可见行为

- 聊天的“AI 配置”可浏览全部模型、收藏或单个连接。搜索涵盖连接名称与 ID、请求模型 ID、上游模型、显示别名和模型来源。
- 跨连接同名模型保留各自的连接 ID；路由别名保留实际请求 ID，并展示对应上游名称。当前模型优先显示，目录移除的当前项仍保留可辨识身份。
- 收藏使用“连接 ID＋请求模型 ID”，与模型切换分别操作。收藏停用连接的缓存模型仍然可用；原有连接、策略、网络及回答状态限制继续控制模型选择。
- 收藏通过现有设置保存队列持久化，最多 128 项。保存失败保留当前操作并提供重试；达到上限与连接已删除分别提示。重试保存最新设置，不能重建已删除连接的收藏。
- 取消全部收藏后，导出明确携带空列表；仅恢复设置时可清空目标收藏。旧备份没有收藏字段时保留目标值。删除连接清理该连接的收藏，保留其他连接。
- 每页最多 24 项，搜索覆盖完整本地目录。可用性证据只读取当前页的本地记录，每批最多四个读取；搜索、收藏及翻页不会触发供应商探测。
- 五套主题沿用各自的模型行与范围入口。手机入口紧凑换行，打开面板不会主动聚焦搜索框；模型、收藏与范围按钮至少 44dp。
- 模型入口由外层按钮承接点击。按下期间，即使标题更新并替换动画文字节点，同一次松开仍然打开选择器。

选择模型更新当前会话的下一次请求配置及最近选择；默认连接、已有回答的模型身份与用量快照不随之改写。收藏仅更新常用列表。

## 实现入口

| 入口 | 职责 |
| --- | --- |
| [ChatOptionsPanel](../../src/components/chat/ChatOptionsPanel.tsx) | 范围、搜索、分页、主题呈现、当前页证据与保存反馈 |
| [chatModelPickerPresentation](../../src/components/chat/chatModelPickerPresentation.ts) | 本地候选目录、组合查询、连接顺序、精确身份 |
| [Settings identity](../../src/modules/settings/identity.ts) | 收藏规范化、数量上限、组合身份及连接清理 |
| [Settings store](../../src/store/settingsStore.ts) | 原设置队列中的保存与重试 |
| [Portable export policy](../../src/modules/settings/settingsPortableExportPolicy.ts) | 空列表与旧备份缺失字段的区别 |
| [ChatPersistentHeader](../../src/components/chat/ChatPersistentHeader.tsx) | 避免标题重挂载打断按下中的点击 |

收藏 ID 保留原始 Unicode 序列，不使用显示名称或上游模型取代请求身份。界面别名按现有设置规则规范化；搜索可匹配规范化后的显示别名。

## 验证

11 个针对性 Jest 测试文件共 **143 项通过，0 失败**，覆盖五主题交互、同名模型、别名、分页、收藏上限、保存失败与重试、连接删除、旧备份、空列表导入、原有切换限制及过期读取隔离。类型检查、架构依赖门禁、移动布局检查和项目规定的 Bun 设置检查通过。参数兼容检查在前序验证中通过，本次入口修正没有改动参数处理。

- [Jest 结构化结果](../../test-evidence/implementation/model-picker-2026-11-05/focused-jest-complete.json)
- [代码检查状态](../../test-evidence/implementation/model-picker-2026-11-05/completion-code-status.json)
- [Bun 设置检查](../../test-evidence/implementation/model-picker-2026-11-05/settings-actions-bun-resume.log)
- [浏览器结果](../../test-evidence/implementation/model-picker-2026-11-05/application-browser-results.json)

浏览器使用一次性 Chromium 上下文、虚构连接、生产设置适配器及真实 Expo SQLite 会话仓库。外部请求在测试上下文中阻止并记录；该验证不调用真实供应商。

五套主题共 17 种布局、**156 项浏览器检查全部通过**，没有脚本错误或外部请求。每套主题覆盖 390×844 手机浅色、320×640 窄屏深色和 1280×900 桌面深色；Minimal 与 Liquid Glass 另覆盖 844×390 短横屏。真实存储写入失败与重试、65 项目录分页、末项搜索及连接删除在隔离的手机场景额外验证。中文、英文与日文的 16 个新增或修改文字键均存在且插值参数一致，记录见 [翻译核对](../../test-evidence/implementation/model-picker-2026-11-05/localization-review.json)。

初次完整浏览器检查在窄屏重载后发现一次入口点击丢失。通过“按下后更新标题，再在同一位置松开”稳定复现，修正为外层按钮接收点击。原始失败与修正后的事件记录保留：

- [初次浏览器结果](../../test-evidence/implementation/model-picker-2026-11-05/application-browser-before-header-fix.json)
- [修正前事件](../../test-evidence/implementation/model-picker-2026-11-05/model-control-title-change-before.json)
- [修正后事件](../../test-evidence/implementation/model-picker-2026-11-05/model-control-title-change-after.json)

## 既有全局检查失败

两项全局兼容脚本仍失败。使用 [本轮开始前的源文件快照](../../test-evidence/implementation/model-picker-2026-11-05/baseline.json)，在独立子进程中替换文件读取，得到与当前工作区相同的三个失败断言：

| 脚本 | 相同失败 |
| --- | --- |
| `theme-qa-selftest.js` | 固定要求 RN fallback；页面导航的主题组成断言 |
| `product-experience-compatibility-tests.js` | 固定要求消息气泡不出现用量字段，与工作区已有用量回执实现冲突 |

[对照结果](../../test-evidence/implementation/model-picker-2026-11-05/baseline-compatibility-comparison.json)记录了当前与快照的退出码及断言名称。此对照确认这些失败在本轮改动前已存在，不代表全局检查通过。

Android 原生触摸、系统键盘与返回键、WebKit 及真实供应商调用尚未在此轮验证。收藏数据沿用现有设置备份，不引入数据库表、供应商调用或新的执行权限。上下文来源下钻和工具声明预算仍属于后续实现。

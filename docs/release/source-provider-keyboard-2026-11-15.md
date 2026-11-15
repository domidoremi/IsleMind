# 已存连接的密钥输入与键盘避让

本项承接[全应用完整目标](../architecture/full-application-improvement-goal.md)。已存连接详情复用现有键盘滚动视口，实际视口完成调整后滚动当前输入框。收起键盘时恢复自动滚动产生的位置；用户拖动后保留其位置。替换密钥草稿、遮蔽状态与焦点保持。

新增两项行为回归在原实现失败，修复后通过。工作区五套80项、最小HEAD候选五套55项通过，两组有重叠。两侧TypeScript、架构依赖与边界检查通过。三项既有ApiKeyPanel断言失败已在未修改组件的基线复现，本次按已提交的草稿保存行为校正断言与重试范围，没有为校正断言修改产品逻辑。较早候选失败记录保留。

既有独立调试应用在中文Animal深色、普通字号完成第09轮18次实际操作。A密钥替换准确，B原值与B-only模型选择保持。实际输入框底部为515.27dp，键盘顶部为527.27dp；键盘开启时滚动视口留出345.45dp，收起后恢复为0。三张有效图像完成完整复核。两处键盘开启截图均失败，未取得有效图像；该部分视觉资格继续待验。没有据此推断截图失败原因。

英文Minimal浅色Web在320×844和360×844验证实际密钥输入、遮蔽、焦点、草稿及保存。目录区分选中与未选中模型，取消修改保留原持久化，可用列表只含已选模型。四张最终图像完成完整复核。

原生测试连接已移除。第03次独立复核确认2,122项运行源码输入与完整原始状态一致，同一进程7625，Inspector自然关闭，清理错误为空。历史与消息、设置、供应商、用量、六组持久草稿及恢复槽、实际编辑器文字、附件、选区与焦点、原路由、设备设置和请求日志保持。

Web第09轮恢复失败记录保留。新增数据库结构及页面重排导致主OPFS文件变化，29张原业务表与原33条迁移记录仍一致。用同版本Web SQLite引擎重放原结构后，第32次候选与原SQLite正文、完整OPFS文件的哈希一致，30张原表哈希与完整性检查通过；随后只写回已验证的主文件。原空间10在写回前已不在可用列表，关闭原因未确定，未向该空间写入。续接空间11先核对同一来源数据，再恢复六个OPFS文件和八项原始存储；实际应用重载后原会话、英文、空且未聚焦输入及320×844视口一致，六文件仍逐字节一致。续接空间已关闭。

源码保持1.1.10 / 135，固定安装身份保持1.1.8 / 133。仅提交已验证的最小产品差异、两项回归、三项既有断言校正及本记录，原有491个未完成路径保留。本项合格产品提交计入版本节奏，累计4/5，尚未达到下一次发布节点。没有构建、导出、安装APK或派发工作流。

后续继续多密钥策略、模型目录与归属、同模型路由组、全部深层操作及主题、语言、尺寸、大字体、TalkBack、恢复和性能矩阵。`fullAcceptance`、`nativeVerified`、`visualAcceptance`及广义`loadedRuntimeVerified`保持`false`。

证据：[范围验收](../../test-evidence/implementation/native-provider-key-policy-20261115-01/acceptance-provider-keyboard-18.json)、[最终候选检查](../../test-evidence/implementation/native-provider-key-policy-20261115-01/keyboard-sheet-checks-03.json)、[原生操作](../../test-evidence/implementation/native-provider-key-policy-20261115-01/native-key-policy-09.json)、[原生图像范围](../../test-evidence/implementation/native-provider-key-policy-20261115-01/native-key-policy-visual-09.json)、[最新原生复核](../../test-evidence/implementation/native-provider-key-policy-20261115-01/original-state-audit-03.json)、[四张Web图像](../../test-evidence/implementation/native-provider-key-policy-20261115-01/web-keyboard-visual-review-12.json)、[原始数据库精确重建](../../test-evidence/implementation/native-provider-key-policy-20261115-01/browser-opfs-reconstruction-32.json)、[实际重载后的原始状态](../../test-evidence/implementation/native-provider-key-policy-20261115-01/browser-keyboard-originals-restored-16.json)、[空间关闭](../../test-evidence/implementation/native-provider-key-policy-20261115-01/browser-keyboard-space-finished-17.json)。

## 2026-11-15：多密钥策略与明确模型选择补验

第10轮四项实际原生操作通过：未保存的首选与停用只影响当前草稿，保存后保留轮转策略、B首选及A停用；重开仍一致，重新启用A后恢复其已选模型。停用期间仅共享模型可用，已选模型清单未被删减。

第11轮三项实际原生操作通过：只选择B-only后可用清单只含该模型，三个目录模型完整保留；重开后取消修改保留原选择；A密钥准确替换，B原值和模型选择保持。实际输入底部515.27dp，键盘顶部527.27dp，收起键盘恢复滚动留白。

两轮8张有效最终图像均完成完整复核，范围为中文Animal深色、普通字号。第11轮键盘开启时两处截图仍未取得有效图像，失败记录保留，不根据失败推断原因，也不扩展视觉通过范围。

第04次独立复核确认2,122项stage源码输入及完整原始状态一致，同一进程7625，临时连接已删除，Inspector自然关闭，清理错误为空。原请求日志、设备设置、所有历史、消息、设置、供应商、用量、六组草稿和恢复槽、编辑器文字、附件、选区、焦点与原路由保持。本次仅补验记录，产品周期维持4/5。

完整原目标仍进行中、预算无限制，目标登记的旧批次摘要未改写成功。继续供应商、同模型路由组及全应用矩阵；fullAcceptance、nativeVerified、visualAcceptance和广义loadedRuntimeVerified保持false。没有构建、导出、安装或派发工作流。

证据：[七项范围](../../test-evidence/implementation/native-provider-key-policy-20261115-01/acceptance-provider-policy-supplement-20.json)、[第10轮图像](../../test-evidence/implementation/native-provider-key-policy-20261115-01/native-key-policy-visual-10.json)、[第11轮图像](../../test-evidence/implementation/native-provider-key-policy-20261115-01/native-key-policy-visual-11.json)、[最新原始状态复核](../../test-evidence/implementation/native-provider-key-policy-20261115-01/original-state-audit-04.json)。

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

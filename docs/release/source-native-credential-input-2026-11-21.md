# 真机密钥输入、取消与替换

2026-11-21（台北），第 44 份运行源码，版本 1.1.21 / 146。中文岛屿深色竖屏，在既有 Android 调试应用中使用一个停用的合成连接，未发送模型请求。

两次通过 Android 输入事件录入完整合成密钥，输入期间系统键盘可见。挂载的输入框启用了 `secureTextEntry`，Android 层级只返回等长遮蔽字符。放弃第二把密钥的更改后重开，两把原密钥、健康记录和配置均一致。保存第一把密钥的替换后重开，安全存储中的第一把等于新值，第二把保留原值。仅第一把的失败次数归零，使用及失败时间戳清除。两组模型目录、明确的模型选择、首选密钥和轮换策略保持。

面板实际挂载模块 3759 对应设备包里的模块工厂及当前源码映射。测试连接和三个对应安全存储槽均已清理。新 Inspector 会话独立复核 53 张表的 3,256 行、四项原始存储、六组草稿与恢复槽、编辑器正文、附件、选区、焦点和原根路由；PID 596、编辑器 218、原 USB 设置任务及 70 条请求一致。Inspector 已关闭，临时 8092 映射已撤销。

第 236 次因层级采集器没有 `password` 字段而在输入前停止，清理与独立回读通过。第 237 次没有提取到输入连接的密码类型，依据挂载属性及 Android 层级验证遮蔽；两次键盘开启截图均未返回 PNG。仅目视核对重开后可见的连接页上半部，截图未覆盖输入框。TalkBack、其余语言和主题、横屏、大字体和原生性能仍待验收。此补验不计入产品发布周期，保持 1/5。

证据：[真机输入和保存](../../test-evidence/implementation/native-routing-groups-20261115-01/native-credential-key-input-20261121-237.json)、[独立原值回读](../../test-evidence/implementation/native-routing-groups-20261115-01/native-credential-key-input-20261121-237-independent.json)、[映射恢复](../../test-evidence/implementation/native-routing-groups-20261115-01/native-credential-key-input-20261121-237-transport.json)、[第 236 次原始失败](../../test-evidence/implementation/native-routing-groups-20261115-01/native-credential-key-input-20261121-236.json)、[重开后的连接页](../../test-evidence/implementation/native-routing-groups-20261115-01/native-request-credential-key-input-237-saved-reopened-key-settings.png)。

# 密钥轮换与请求健康记录

2026-11-20。普通聊天的连续三次实际请求均使用同一密钥，连接已保存“轮换使用”，两把密钥均启用。所用密钥的最近使用时间没有更新；成功使用过的另一把密钥也保留旧失败次数。

请求成功、失败及故障切换现在统一更新实际连接与密钥的使用时间和失败次数。普通聊天与 Rich 聊天共用这条记录路径，消息收尾不再重复计数。HTTP 与 WebSocket 成功结果在记录完成后交给后续请求。更换密钥与健康写入串行处理，旧密钥的晚到结果不会标记新密钥已使用或失败，也不会重新启用已停用的密钥。

连接选择、后续请求和恢复校验仅排除密钥的使用时间、失败时间及失败次数，并读取最新健康记录；密钥、地址、协议、模型目录与其他配置仍受原有校验保护。健康记录变化不会阻断同一回复的后续请求或已允许的故障切换。

修正测试准备顺序后的独立主线基线为7失败、3通过。接入公共健康更新后，进一步复现了旧配置快照阻断读取、后续请求和故障切换的3个失败，并一并修复。最终主线与工作区均通过11组、218项测试，涵盖实际执行器、跨连接切换、同名密钥组、替换密钥、并发保存、停用密钥、配置撤销和上下文容量。两边类型检查与架构边界检查通过。

最终 Web 验证通过四次实际本地请求，依次使用 B、A、B、A；第三次后刷新页面，第四次仍按保存的使用记录选择 A。每次只产生一个成功请求，所用密钥的使用时间更新、失败次数清零，设置及密钥启用状态保持。完整运行脚本、同源响应、源码映射及八个实际函数绑定与本次冻结源码一致。没有外部模型请求。

主线架构自检单独核对。工作区自检存在原有草稿会话测试夹具缺项；通过逐字重建并校验修改前脚本的哈希，确认相同失败在本次修改前已经存在。原失败记录保留，普通架构边界检查通过。

本项为1.1.20之后的第五项产品修复。版本发布另行记录。原435个未完成路径按受限差异保留。当前真机仍运行第42份源码，本项尚未取得真机或视觉验收；全应用路由、主题、语言、尺寸、TalkBack、恢复和性能检查继续进行。`fullAcceptance`、`nativeVerified`、`visualAcceptance`、`loadedRuntimeVerified`保持`false`。没有构建、导出、安装APK或派发Actions。

证据：`test-evidence/implementation/provider-current-20261120-01/`中的`browser-credential-rotation-139.json`、`rotation-main-baseline-145.json`、`rotation-main-baseline-152.json`、`rotation-*-expanded-158.json`、`rotation-*-types-154-exit.json`、`rotation-*-architecture-158-exit.json`、`rotation-original-workspace-audit-162.json`、`rotation-main-auditself-165-exit.json`、`browser-rotation-final-fixed-163.json`与`browser-rotation-final-bind-164.json`。

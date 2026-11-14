# 原生阅读、输入与消息源码验收范围

本记录承接[全应用完整目标](../architecture/full-application-improvement-goal.md)。以下结果分别覆盖英文集合数量、正文输入范围和指定消息组件的运行源码；完整应用验收继续进行。

英文集合数量第 03 轮通过六个实际标题：知识文件与记忆各自的 0、1、2 数量。四个非空清空按钮及两次实际清空确认通过，仓储回读确认受控资料已移除。十四张最终截图已完整查看。资料通过受控公共仓储写入准备，未将其记为系统文件导入；此前失败与恢复记录保留。

非空粘贴草稿第 03 轮通过六个实际原生阶段。空白、短文、缩短和清空后的正文框为 160dp；927 字符长草稿及折叠重开后为 280dp，完整文字、选择及焦点按记录核对，标签未与正文重叠。原始目录与完整用户状态恢复，失败轮次保留。

消息源码第 05 轮通过实际原消息操作按钮触发渲染。该时点完整已加载 bundle 的 26,742,423 字节与同源 Metro 一致，完整 `MessageBubble.tsx` factory 及 source-map 原文与冻结源码一致。原生 `MessageBubbleComponent` 调试帧确认实际导出的 memo 渲染函数和词法 exports 均绑定到已初始化模块。暂停 363.2042ms，原生输入至恢复的上界为 701.8103ms，保底恢复计时器未触发。原消息菜单已由实际返回操作关闭，断点移除，Debugger 停用，Inspector 自然关闭。

消息记录固定到 bundle SHA-256 `06262d7360036417e7f2a6f49c27d029d6584ae8df6381ab83fb0ddace472427`，factory SHA-256 `6d9d77b2764b0de23354dc96bd49cb8155059c12d4581bedb8c4cef9a48ae51a`。之后的英文片段数量资源更新已有[独立的原生资源和页面证据](./source-knowledge-quantities-2026-11-15.md)；消息证据保留其原执行时点，未扩展为后续整包、依赖或性能认证。

完整状态编码核对全部历史与消息、设置、供应商、用量、六组持久草稿及恢复槽、实际编辑器文字与附件、选择和焦点、路由路径和层级、设备设置及原请求日志。早前一次失败的历史导航生成了新的内部路由 key；该 key 不纳入完整状态编码，本记录不声称恢复该次失败前的任意 key。后续操作均核对并恢复各自进入检查时保留的路由结构。

片段数量资源更新后的第 05 次独立复核通过：2,121 项运行源码输入一致，同一原生进程 7625 的完整原始状态保持一致，清理错误为空，Inspector 自然关闭。固定安装配置保留原值并单独核对。

源码保持 1.1.10 / 135，固定安装身份为 1.1.8 / 133。没有构建、导出或安装 APK，没有派发工作流。受控内存归因、完整主题与深浅色、中英日、尺寸、大字体、TalkBack 和 31 个路由及深层操作继续待验，`fullAcceptance`、`nativeVerified`、`visualAcceptance` 和广义 `loadedRuntimeVerified` 保持 `false`。

证据：[英文集合数量](../../test-evidence/implementation/native-reader-locale-input-20261115-01/native-quantities-20261115-03.json)、[十四图复核](../../test-evidence/implementation/native-reader-locale-input-20261115-01/native-quantities-visual-review-20261115-03.json)、[实际非空正文](../../test-evidence/implementation/native-reader-locale-input-20261115-01/native-nonempty-draft-20261115-03.json)、[正文图像复核](../../test-evidence/implementation/native-reader-locale-input-20261115-01/native-body-frame-visual-review-20261115-03.json)、[完整消息 factory 绑定](../../test-evidence/implementation/native-reader-locale-input-20261115-01/native-message-factory-binding-20261115-05.json)、[导航 getter 只读核对](../../test-evidence/implementation/native-reader-locale-input-20261115-01/native-navigation-getter-read-only-20261115-01.json)、[最新原始状态复核](../../test-evidence/implementation/native-reader-locale-input-20261115-01/originals-preflight-20261115-05.json)。

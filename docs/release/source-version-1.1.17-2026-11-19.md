# IsleMind 1.1.17 源码版本更新记录

2026-11-19，五项修复达到发布节奏。源码版本由 1.1.16 升至 1.1.17，Android 源码版本码由 141 升至 142。[三语更新说明](./v1.1.17.md)

从检查点 `27f29317cb7bcf2e6e5d8465e50f54d72c0d5239` 后开始，本次纳入以下提交。

- `61edd52500175641fe6eaf9c11c815ed20102a0f` fix(providers): 保留新建连接的手动协议选择
- `0dd003009a3c98e6eaf126804ceb5df756ff8d59` fix(providers): 保留结构化导入的密钥与模型状态
- `c0d1706b20d5ba400e90d30add257c9699ec876d` fix(settings): 稳定输入草稿时的离页保护
- `c8799209786b1bdabb2e0b18f67af88734657e12` fix(providers): 保留导入后密钥的名称与启停编辑
- `643fb43c90c8e231037d336abb0084b751fce514` fix(providers): 拒绝将无效 JSON 解析为连接密钥

下一周期从 `643fb43c90c8e231037d336abb0084b751fce514` 之后计数。版本维护与发布记录提交不计入产品改动。

手动协议在输入服务地址后保持；结构化连接导入保留密钥组、目录、模型选择与调度设置；配置持续输入避免重复更新；导入后的密钥名称与启停编辑保持；无效对象或数组 JSON 不再作为密钥保存。见[接口协议](./source-provider-form-protocol-2026-11-19.md)、[连接导入](./source-provider-import-state-2026-11-19.md)、[配置输入](./source-settings-draft-typing-2026-11-19.md)、[密钥编辑](./source-provider-credential-edits-2026-11-19.md)及[JSON 语法保护](./source-provider-credential-json-2026-11-19.md)。

最后一项的独立 main 六组 61 项、工作区六组 86 项，以及各自类型和架构检查通过，计数不相加。Web 无效输入、纠正、保存、重载、重开和精准移除通过。当前网页实际 0 items、1 item、2 items、回复收据及请求字段、八个挂载组件与当前执行脚本绑定已核对；原来源 13 项存储、六个 OPFS 文件和 70 条请求保持。

Android 中文岛屿深色竖屏完成错误输入、纠正、模型步骤、一次保存、冷启动回读、安全凭据回读及实际关闭重开。只移除精确匹配的合成连接与其密钥后，53 表、四项原始存储、六组草稿与恢复槽、全部原资料、编辑器及选区、原首页、设备与 70 条请求完整；原前台精确恢复，Inspector 关闭，cleanup/pending 为空。旧进程退出原因未确定；新 PID、编辑器数值 tag 重用和路由实例重建单列。失败与接续记录均保留，没有重复创建或保存连接。

第 33 份当前工作区快照包含 2,142 项输入，设备缓存 26,766,472 字节，SHA-256 为 `7f53cd55e6514d5c2bca50a30f57a995d950e1d5cac4b288ab8fb344f3581bfb`。该快照早于本次版本字段维护；既有隔离安装仍为 1.1.8/133，APK 候选仍为 1.1.2/127。

778 字符高速连续 Android 注入的截短尚未确认根因，分段输入的通过不替代该项。真实网页键鼠、其余主题语言与尺寸、无障碍、完整供应商/密钥/模型/同模型路由组以及 31 路由、55 原型的完整矩阵继续验收。fullAcceptance、nativeVerified、visualAcceptance 和广义 loadedRuntimeVerified 保持 false。[完整目标](../architecture/full-application-improvement-goal.md)

原有未完成工作与 APK 候选保持；没有构建、导出、安装、上传 APK 或派发工作流。

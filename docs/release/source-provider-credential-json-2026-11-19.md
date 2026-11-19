# 凭据 JSON 语法保护（2026-11-19）

明确输入凭据时，以对象或数组开头的无效 JSON 返回空的凭据列表。表单保留原文、显示格式错误并禁用下一步；完整 JSON、明文命名密钥、JWT 和多行输入继续使用原解析规则。

九项新增回归在旧 main 中七项失败、两项通过。修复后独立 main 六组 61 项、工作区六组 86 项，以及各自类型和架构检查通过，计数不相加。见[独立 main](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-credential-json-main-validation-20261119-1210.json)与[工作区](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-credential-json-workspace-validation-20261119-1207.json)。

Web 实际输入未闭合对象和数组，原文保留、错误提示和禁用下一步通过；纠正后保存、重载及定向移除通过。见[表单记录](../../test-evidence/implementation/native-routing-groups-20261115-01/web-credential-json-acceptance-20261119-1220.json)。当前源码补验了 0 items、1 item、2 items，实际打开回复收据、展开唯一请求的 20 个字段并返回首页。八个实际挂载组件与当前 factory、source map 和完整执行脚本一致；原来源 13 项存储、六个 OPFS 文件和 70 条请求完全一致，浏览器任务空间已关闭。见[当前运行核验](../../test-evidence/implementation/native-routing-groups-20261115-01/continue-web-20261119/round-16.json)。

Android 第 33 份快照的 2,142 项输入和设备缓存已核对。中文岛屿深色竖屏两种错误 JSON 的保留、错误提示和禁用按钮，以及纠正后恢复可用通过。1234 实际进入模型页并只保存一次停用连接；其 undefined 字段与 JSON 比较过严的失败记录保持。见[错误输入](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-credential-json-20261119-1233.json)和[实际保存现场](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-credential-json-20261119-1234.json)。

旧进程 907 随后退出，原因未确定。接续重新核对实际前台的可恢复性，只启动现有安装一次，进程变为 32730；编辑器数字 tag 218 在新进程中重用，编辑器实例与路由键重建单列。首次启动的前台检查过早退出，1244 已独立恢复原商店 ActivityRecord 和 task。1251 核对全部原资料，仅供应商原始记录多出精确匹配的已保存合成连接，其余三项 raw 和 53 表一致。见[恢复复核](../../test-evidence/implementation/native-routing-groups-20261115-01/native-json-existing-runtime-recovery-20261119-1251.json)。

1256 在相同进程中实际打开、关闭并重开已保存 ID，回读安全凭据与元数据通过。运行时省略的 undefined 路径单列，所有已定义值与实际持久化记录一致。按当前对象的无损编码和原供应商、设置保护条件，仅移除该连接及其安全凭据；随后 53 表、四项 raw、六组草稿和恢复槽、全部会话与设置、用量、编辑器内容及选区、原首页、设备与 70 请求均恢复一致，Inspector 关闭、原前台精确恢复，cleanup/pending 为空。见[重开及最终恢复](../../test-evidence/implementation/native-routing-groups-20261115-01/native-credential-json-saved-resume-20261119-1256.json)。冷启动的惰性模块、表达式转义和根路由菜单归属导致的接续失败均保留，没有重复创建或保存连接。

本项最小提交只含一处解析守卫、九项回归和本记录，排除注册表其余既有改动。计入当前周期第五项后，按既定节奏准备 1.1.17/142 源码发布。全部整体资格保持 false；高速连续输入、其他环境与完整路由矩阵仍待验。没有构建、导出、安装或上传 APK，没有派发工作流。

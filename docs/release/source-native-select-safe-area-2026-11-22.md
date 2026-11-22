# 岛屿主题原生选择菜单安全区

岛屿主题的原生选择菜单现在按实际弹层视口和安全区限制位置与大小。长菜单可以滚动，键盘缩小弹层时重新约束可用范围；禁用选项不能激活，返回关闭菜单并保留选择。Web 延续原有选择组件。

工作区与独立 main 先分别复现三项失败，最终四组测试分别为96项、85项通过，两侧类型检查通过。独立 main 使用1959份基线输入与18份虚拟输入，实际类型读取16份虚拟输入，候选目录零写入。工作区架构14项通过，模块边界检查1138个文件无问题。用量测试改为公开接口的维护提交 c74dd97 不计产品项。

第53份既有调试应用源码包含2169份输入、4161个模块、三处运行变化及17个绑定。实际 Inspector 脚本与单独获取的 Metro 脚本哈希均为 `285f45d69359022c759660bcb556a83a8d73836d2737470d40b96a61243925f2`，设备缓存仅有已记录的来源尾注差异。新增模块追加为4159、4160，原有模块编号保持。源码元数据1.1.24/149已同步，既有调试应用标识保留；没有构建、导出或安装 APK。

355完成中英日三组真实触控与键盘操作：预览第二个同名方案、选择新会话、只读预览、返回列表、改名、保存、重开及确认删除。第一个方案和原会话保持。三个菜单的首项及整个面板均位于安全区，控件触控范围达到44dp。九张截图已逐张目视，仅授予岛屿深色、原横屏2400×1080、font_scale 1.0下的菜单、编辑器可见部分和删除确认局部资格。全页、其他主题与尺寸、动效及 TalkBack 不在此资格内。

356独立回读53张表3256行、四项原始存储、六组草稿与恢复槽、编辑器所有值、原路由与完整堆栈、前台、设备设置及70条请求。357再通过 SQLite 只读连接与 AsyncStorage 接口分别比较全部六项原始键和原文，并核对原数据库结构及字段。离线副本逐项哈希保持；Inspector、临时端口映射与 pending 清退。PID8685、编辑器数字204及355操作前后路由键保持；不以数字相同宣称跨重载实例身份保持。

保留342菜单首项侵入状态栏的真实产品失败，固定模块表拒绝新增模块的 HTTP 500，停旧 Metro 时误停其监督服务的失误，以及 reload-r1 未加载、reload-r2 在零重载请求时因容器原型比较停止、reload-r3 暂时超时。350因删除按钮定位错误未完成三语案例，351因内存 undefined 属性与持久化 JSON 比较错误停止；352查明差异，353精确清退两项测试方案并恢复全部原值，354与356独立回读通过。失败原件与恢复记录保持。

v1.1.24已经实际发布，本项是此后第一项合格产品改动，周期1/5。每个 Git 对象写入、暂存、提交及推送阶段均独立核对六个远端工作流和41条原 Actions 记录；成功回执另存证据。原438个未完成路径在明确的本项补丁与文档追加之外逐项保护，共享组件库保持。

场景保存失败后确认放弃仍在列表显示错误，已保留真实 Web 配额失败，继续作为下一项独立修复。31个生产路由、55个原型、完整主题明暗与三语、尺寸、大字体、输入、静默无障碍、恢复和原生高内存仍有未完成范围。`fullAcceptance`、`nativeVerified`、`visualAcceptance`和广义`loadedRuntimeVerified`继续为 false。没有启用或播放设备音频、启用 TalkBack、调整音量或触发 Actions。

证据：

- `test-evidence/implementation/native-select-safe-area-20261122/qualification-final.json`
- `test-evidence/implementation/native-select-safe-area-20261122/publication.json`
- `test-evidence/implementation/native-routing-groups-20261115-01/native-stage53-348-loaded.json`
- `test-evidence/implementation/native-routing-groups-20261115-01/native-scene-actions-20261122-355.json`
- `test-evidence/implementation/native-batch-20261121/native-stage53-356-originals.json`
- `test-evidence/implementation/native-batch-20261121/native-stage53-all-six-357.json`

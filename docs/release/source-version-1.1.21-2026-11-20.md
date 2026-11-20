# IsleMind 1.1.21 源码版本更新记录

2026-11-20，五项产品修复达到发布节奏。源码版本由1.1.20升至1.1.21，Android源码版本码由145升至146。[三语更新说明](./v1.1.21.md)

从检查点`92f132070e23533f995390151e8fd096a70c3fcd`后计入以下五项已验证、已推送改动。

- `fb451904e9cab9d9a698f95a773b76e0ed2f0c2f` fix(providers): 保存连接配置时保留最新密钥健康状态
- `6001107a4fbf71ea880b146bd66aaec57a6a445b` fix(providers): 保留MiMo导入模式与区域
- `001e8a124848daddeeeee05ea2665312d7587f29` fix(providers): 保留导入配置的明确模型选择
- `a808a2ed38fb371635fa28165cf2e3bab60de52c` fix(providers): 选择模型时正确识别停用密钥
- `ade2d7cfcdca3320260251edea7cab5d43f2567e` fix(providers): 按实际请求更新密钥轮换与健康记录

下一周期从`ade2d7cfcdca3320260251edea7cab5d43f2567e`之后开始。版本与维护文档提交不计入。

保存连接保留相同密钥的最新健康记录，更换密钥时重置记录；MiMo导入保留计费模式及区域；模型导入保留明确的空或部分选择；显式密钥全部停用时不回退遗留主密钥，并显示正确三语状态。实际请求统一更新所用连接与密钥的使用及失败记录，普通聊天恢复轮换，Rich收尾不重复计数；旧密钥晚到结果不更新替换后的密钥。选择与继续请求校验允许纯健康记录变化，配置与授权保护保持。

独立主线与工作区分别验证，重叠计数不相加：健康记录保存5组69／95项；MiMo导入4组34／34项；导入选择5组74／100项；停用选择4组78／104项；实际轮换11组218／218项。两边类型与架构边界检查通过，最终主线架构自检通过。逐字重建修改前工作区脚本并核对哈希后，确认工作区架构自检的草稿会话fixture缺项早已存在，原失败保留。

Web独立测试域名已验证MiMo模式和区域、导入选择、停用全部密钥、首选与停用切换，以及路由组轮转、取消确认、重试、固定成员和会话策略。最终轮换使用四次实际本地HTTP成功请求，顺序B／A／B／A；第三次后刷新，健康记录与设置保持，第四次继续轮换。八个实际运行函数绑定完整加载脚本、同源响应、工厂和源码映射，与冻结源码一致。没有外部模型请求。截图超时不计视觉通过；Web独立域名清理及原浏览器资料复核仍待执行。

原生应用本周期仅完成连接恢复及原资料独立核对。当前仍为第42份旧源码，PID15464、编辑器8256；53表、四raw、六组草稿、编辑器正文／附件／选区／焦点、原路由及70请求保持。后续以native-baseline-111为资料参考，将本周期修复同步后再验收。不能将Web或旧原生快照作为当前源码真机资格。

保留各项真实失败及准备错误：轮换最初连续使用同一密钥；修复公共健康记录后发现健康变化被旧配置快照误判冲突；测试准备顺序、store action绑定与备用策略fixture随后修正。最终验证通过后才提交推送。原435个未完成路径按哈希及限定改动记录保护。

每次Git写入、标签和发布前重读远端六工作流、完整Actions及main来源PR。APK候选清单保持1.1.2/127，没有构建、导出、安装或上传APK。历史被自动审批拒绝清理的目录保持，没有换机制删除。

31路由／55原型、五主题深浅色、三语尺寸、TalkBack、输入恢复、真实存储故障、性能及系统内存终止仍待闭环。fullAcceptance、nativeVerified、visualAcceptance及loadedRuntimeVerified保持false。[完整目标](../architecture/full-application-improvement-goal.md)

证据：[健康保存](./provider-credential-health-2026-11-20.md)、[MiMo导入](./provider-mimo-import-2026-11-20.md)、[导入选择](./provider-import-selection-2026-11-20.md)、[停用选择](./provider-disabled-selection-2026-11-20.md)、[实际轮换](./provider-credential-rotation-2026-11-20.md)、[最终Web请求](../../test-evidence/implementation/provider-current-20261120-01/browser-rotation-final-fixed-163.json)、[运行函数绑定](../../test-evidence/implementation/provider-current-20261120-01/browser-rotation-final-bind-164.json)。

## 实际发布

版本提交`406f915799896a6ab83924c568405e527b6b682a`已推送，v1.1.21于2026-11-20 20:59:27（台北）实际发布。标签固定到版本提交，三语正文逐字一致；GitHub API核对公开稳定状态与最新版本。47个历史Release、原有标签和41条Actions保持。五组版本资料检查及22项版本契约测试通过，436个原未完成路径除package版本字段外保持。详见[发布记录](./source-release-1.1.21-2026-11-20.md)。


## 发布后真机验证与资料恢复

本周期修复已同步至第43份原生源码并完成受保护重载。完整设备缓存、服务脚本、源码映射、三字体、三语及本周期模块绑定核对通过。四次真实键盘请求均返回HTTP200，实际密钥按1／2／1／2轮换；使用时间和持久化健康记录更新，四条用量及最后请求详情归属正确。三张截图仅覆盖中文岛屿深色原竖屏的模型菜单、末次回复和详情可见区域。

测试清理曾因健康记录变化及JSON／undefined比较停止，失败记录保留。定向恢复后另开Inspector回读：53表3256行、四项原始存储、六组草稿与恢复槽、原会话设置及编辑器文字／附件／选区／焦点全部一致，八个测试密钥已移除；原USB设置任务和70条请求保持。当前进程15464、编辑器8968，Inspector关闭且无遗留操作。

Web独立域名已清空，原浏览器13项存储与六文件保持，空间已关闭，8108和8214测试服务已停止，24条请求记录保留。12份可再生临时基线的删除被自动审批拒绝，文件保持。版本仍1.1.21/146，周期0/5；全应用验收和系统内存问题继续，四项整体资格保持false。

[真机检查点](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-cycle-checkpoint-20261120-188.json)、[独立原值回读](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-current-20261120-185.json)、[限定目视记录](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-rotation-visual-review-20261120-188.json)。


## 首选与停用策略的真机补充

两次真实键盘请求均使用已保存的首选密钥2。停用操作后的验收脚本因可选健康字段undefined的表示差异停止，失败记录保留并完成精确恢复。随后使用两个新请求分别验证：首选停用时选择密钥1；重新启用并取消首选后，按最久未用策略选择密钥2。后两次请求的持久化用量与实际密钥、健康记录及请求详情一致。配置更改使用受条件保护的设置接口，本次未计入原生密钥编辑器覆盖。

最终独立回读53表3256行、四项原始存储、六组草稿与恢复槽、全部资料和编辑器状态一致；原USB设置任务、进程15464和70条请求保持，当前编辑器19680。测试对象和密钥均已清除，Inspector关闭，本轮8092映射已撤销并恢复原空映射。四张图片仅作中文岛屿深色原竖屏可见区域记录，整体四项资格保持false。12份临时基线与本轮Web缓存的删除被自动审批拒绝，文件保留。版本1.1.21/146，周期0/5。

[真机策略检查点](../../test-evidence/implementation/native-routing-groups-20261115-01/native-credential-policy-checkpoint-20261120-199.json)、[最终独立回读](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-current-20261120-197.json)、[原端口映射恢复](../../test-evidence/implementation/native-routing-groups-20261115-01/native-transport-restored-20261120-198.json)。


## 原生密钥编辑器保存与取消验收

第43份源码下，真实原生点击完成密钥策略、首选、单密钥停用与重新启用；继续编辑保留草稿，放弃修改后恢复已保存值。四次保存并重开核对通过，持久化记录、安全密钥、2／1模型目录、明确模型选择和合成健康数值均符合预期，没有发送模型请求。前两轮脚本分别因导航归属与页面挂载等待停止，均在保存前完成恢复，失败原件保留；最终使用新测试身份通过。

场景结束时全部原值恢复；随后独立回读发现进程15464被MIUI内存服务终止，系统记录PSS约1.4GB。离线53表3256行及四项原始存储核对一致，执行一次冷启动后，全部资料、六组草稿与恢复槽、编辑器正文／附件／选区／焦点和首页路由值再次核对通过；三个测试连接及九个安全存储槽不存在。当前进程596、编辑器218，进程、编辑器与路由实例已变化。原USB设置任务和70条请求保持，Inspector关闭，本轮8092映射已撤销；内存终止问题仍未解决。

三张截图仅覆盖中文岛屿深色原竖屏可见区域。长连接名末字符单独换行已列入布局待办；密钥实际输入／更换和完整语言、主题、尺寸及辅助功能矩阵继续。源码1.1.21/146，周期0/5，四项整体资格保持false；没有构建、导出、安装APK或触发Actions。

[原生编辑验收检查点](../../test-evidence/implementation/native-routing-groups-20261115-01/native-credential-editor-checkpoint-20261120-209.json)、[冷启动原值回读](../../test-evidence/implementation/native-routing-groups-20261115-01/native-cold-runtime-20261120-213.json)、[原端口映射恢复](../../test-evidence/implementation/native-routing-groups-20261115-01/native-transport-restored-20261120-208.json)。


## 窄屏连接标题与内存归因初探

配置页在窄屏或字体放大后，将连接名称与操作区分行，标题使用完整宽度；保留三行上限、完整无障碍名称、状态反馈、帮助和44dp关闭按钮。真机原名称Native-key-editor-206完整单行显示，末字符独占一行的问题已消除；关闭重开后布局和配置保持。

工作区和独立main副本各2项组件测试及类型检查通过；测试覆盖尺寸变化时节点与操作保持，以及五主题重新渲染。第44份源码2157输入、4159模块、完整设备缓存与服务脚本、源码映射、三字体和三语核对通过，挂载标题模块绑定一致。初次真机脚本错误要求闲置状态指示可点击，失败保留且原值恢复；修正后使用新测试身份通过。独立副本首次因mise目录信任检查停止，改用工作区已解析的同一Node完成测试，原日志保留。

最终独立回读53表3256行、四项原始存储、六组草稿与恢复槽、全部资料和编辑器正文／附件／选区／焦点一致；测试连接和三个安全密钥槽已移除。PID596、editor218、USB设置前台和70条请求保持，Inspector关闭，pending为空，216添加的8092映射已撤销。原436个未完成路径逐项哈希保持。

只读内存观测显示Hermes活动JS堆约64MB，原生分配器libc_malloc的PSS约716MB，Hermes内存段约105MB；尚未确定具体分配来源，系统内存终止问题仍开放。验收后的进程内存快照另行记录，不据此宣称性能通过。

截图仅覆盖中文岛屿深色原竖屏标题可见区域；其他主题、三语、横屏、实际系统大字体、TalkBack及全应用覆盖继续。源码1.1.21/146，本修复成功提交推送后计入新周期第1项；四项整体资格保持false。没有构建、导出、安装APK或触发Actions。本轮可再生header-candidate-219删除被自动审批以blocked by policy拒绝，命令未启动，副本保留且未换机制重试。

[标题验收检查点](../../test-evidence/implementation/native-routing-groups-20261115-01/native-header-checkpoint-20261120-231.json)、[限定目视记录](../../test-evidence/implementation/native-routing-groups-20261115-01/native-header-visual-review-20261120-231.json)、[内存映射](../../test-evidence/implementation/native-routing-groups-20261115-01/native-memory-maps-20261120-218.json)。

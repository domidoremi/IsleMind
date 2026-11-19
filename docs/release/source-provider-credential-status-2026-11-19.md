# 已保存密钥的停用状态（2026-11-19）

连接页完成安全凭据回读后，分别显示“密钥已保存，可检查连接”“已保存密钥均已停用”或“需要填写连接密钥”。只有停用组中存在非空密钥时显示停用提示；结构化密钥组存在时，残留的旧格式主密钥不覆盖组的实际状态。请求准入、启用开关和测试行为沿用原规则。

九项新增回归在旧工作区中五项失败、四项通过，旧 main 中六项失败、三项通过；main 额外复现了旧格式残留密钥掩盖空组的问题。独立 main 四组 49 项、工作区五组 87 项测试，以及各自类型与架构检查通过，计数不相加。原 main 的两项源码契约断言在修复前也失败，前后失败一致并保留。原面板测试的安全读取夹具补充了结构化组的凭据回填。[main 验证](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-credential-status-main-validation-20261119-1268.json)、[既有契约基线](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-credential-status-main-existing-baseline-20261119-1267.json)、[工作区验证](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-credential-status-workspace-validation-20261119-1269.json)。

Web 实际创建并保存一条停用的合成连接，安全存储回读、关闭重开和刷新回读通过。中、英、日实际状态标题均正确；启用密钥并保存后显示可检查连接，再次停用并保存后显示停用，替换为真正无凭据的空组后显示缺失。当前挂载面板与模块范围、源码映射和完整执行脚本已绑定。空字符串更新按原规则保留安全凭据，首次缺失场景的夹具误判保留；修正夹具后通过。浏览器截图接口超时保留，三语 Web 视觉验收未据此标记通过。[实际保存](../../test-evidence/implementation/native-routing-groups-20261115-01/web-credential-status-save-20261119-1283.json)、[三语及启停](../../test-evidence/implementation/native-routing-groups-20261115-01/web-credential-status-matrix-20261119-1285.json)、[缺失与精准移除](../../test-evidence/implementation/native-routing-groups-20261115-01/web-credential-status-finish-20261119-1287.json)。

原来源 13 项存储、六个 OPFS 文件和 70 条请求保持一致。合成连接和凭据已移除，独立来源恢复为初始空状态，浏览器任务空间关闭，临时 Web 服务停止。[来源恢复](../../test-evidence/implementation/native-routing-groups-20261115-01/web-credential-status-restoration-20261119-1289.json)。

Android 原有调试安装加载第 34 份源码快照，2,143 项输入、设备缓存与 Metro 可执行脚本、源码映射、三份字体、三语资源和九个已挂载导出均核对。原进程 32730 保持；源码同步和显式重载导致编辑器及路由实例重建，已分别记录。岛屿深色中文竖屏中实际点按完成停用回读、关闭重开、启用保存、再次停用保存及空组缺失提示。重开截图可见停用状态。Hermes 函数字符串仅返回 `[bytecode]`，使用当前模块编号、挂载导出身份、设备缓存和映射记录绑定来源，首次字符串比较失败保留。[加载来源](../../test-evidence/implementation/native-routing-groups-20261115-01/native-loaded-credential-status-20261119-1282.json)、[真机行为与恢复](../../test-evidence/implementation/native-routing-groups-20261115-01/native-credential-status-20261119-1288.json)。

仅移除本次合成连接与对应安全凭据后，原 53 张表、四项原始存储、六组草稿与恢复槽、全部会话、供应商、设置、用量、编辑器内容与选区、原路由、设备和 70 条请求均通过复核。实际当前前台精确保持，Inspector 关闭，cleanup/pending 为空。[最终独立复核](../../test-evidence/implementation/native-routing-groups-20261115-01/native-credential-status-originals-after-20261119-1293.json)。

本项为 v1.1.17 发布后第一项合格改动，周期 1/5，源码版本继续为 1.1.17/142。未构建、导出、安装、上传 APK 或派发工作流。供应商、密钥、模型、同模型路由组和全应用环境矩阵继续，四项整体资格仍为 false。

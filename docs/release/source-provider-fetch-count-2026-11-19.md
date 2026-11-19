# 模型获取结果数量提示

供应商目录有五个模型、只选择两个时，获取成功提示此前写成“已配置 5 个模型”。获取目录本身不会保存这五个模型为已选项，提示与实际配置不符。

获取完成后改用已有的中性模型数量文案，按当前策略允许的完整目录计数；已配置数量继续显示实际选择。中文显示“5 个模型”，英文显示“5 models”，日文显示“5 モデル”，英文单项保持“1 model”。复用现有翻译与目录规则，只修改获取成功消息。

[代码验证](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-fetch-count-validation-20261119-1327.json)中，独立 main 五组 52 项、工作区五组 86 项测试及两处类型、架构检查通过，计数不相加。未新增重复实现的测试。

[Web 实测](../../test-evidence/implementation/native-routing-groups-20261115-01/web-fetch-count-acceptance-20261119-1335.json)验证三语目录五项、已选两项、连接停用、三组安全凭据及设置保持。两个启用密钥组各返回三个模型，重复 ID 合并，`Model` 与 `model` 分别保留；停用组不发请求。失败重试、选择保存与取消、密钥组启停导致的目录变化已有独立实测记录。浏览器可信点击、文字按键、Tab 及滚轮已观测；系统硬件输入和三语截图视觉仍待验，截图两次超时的失败保留。

[Android 实测](../../test-evidence/implementation/native-routing-groups-20261115-01/native-fetch-count-20261119-1336.json)读到“模型获取完成 · 5 个模型”，两个已选模型及安全凭据保持。当前挂载面板与第 35 份源码缓存、模块工厂和源码映射绑定。截图已目视，能看到已配置两项、五项目录及大小写独立模型；成功提示在截图前已消失，其文字来自实际挂载原生控件。Hermes 返回字节码标记，不作函数源码文本证明。

1336 的恢复检查发现保留策略移除了 32 条原有旧观察记录并推进流水号，原报告保持 incomplete。[逐条审查及定向恢复](../../test-evidence/implementation/native-routing-groups-20261115-01/native-fetch-count-retention-restore-20261119-1339.json)后，53 张表及原始健康记录一致。[最终独立复核](../../test-evidence/implementation/native-routing-groups-20261115-01/native-fetch-count-restored-20261119-1343.json)确认四项 raw、六组草稿与恢复槽、全部用户资料、编辑器正文、附件、选区和焦点、原路由、设备及原 70 条请求保持。测试连接、三组安全凭据及临时端口转发均已移除；Inspector 关闭，实际当前前台保持。

[Web 恢复](../../test-evidence/implementation/native-routing-groups-20261115-01/web-provider-review-restoration-20261119-1341.json)精准移除测试连接和三组凭据，专属来源恢复初始空状态，原来源 13 项存储、六个文件及 70 条请求保持。测试空间关闭，新增的 8108 和 8215 服务停止，原服务保留。

本次为 1.1.17 发布后的第二项合格产品改动，周期 2/5，源码仍为 1.1.17/142。供应商完整流程、同模型路由组、31 路由、55 原型及完整环境矩阵继续，四项整体资格保持 false。未构建、导出、安装或上传 APK，未触发工作流。

# 新建供应商保留已选协议

新建连接时，手动选择协议或导入配置后，修改地址会重新按地址推断协议。现在保留已选协议；重新选择供应商预设、放弃草稿或成功保存后，恢复地址自动识别。[完整改进目标](../architecture/full-application-improvement-goal.md)

新增七项回归覆盖 OpenAI 与 Anthropic 的手动选择、地址修改和清空、导入协议、实际提交参数、关闭重开和预设重选。旧 main 四项失败、三项通过；最小修复后三组 59 项、类型和架构检查通过。工作区四组 99 项及类型、架构检查通过，两处计数不相加。自定义地址保留用户输入的末尾斜线。

Android 岛屿深色中文竖屏中，实际点按 Anthropic 兼容，再输入 `http://127.0.0.1:8213/v1`，仍选中 Anthropic。取消未保存表单后，先核对设置父页，再返回原首页。没有保存供应商或新增模型请求。独立复核原 53 张表、四项原始存储、六组草稿和恢复槽、编辑器、路由、设备及 70 条请求，均与本轮基线一致。

真机第 29 份快照核对 2,137 项输入。设备缓存 26,766,050 字节与 Metro 主包完全相同；1,182 个映射文本、三份字体、三语资源、九个已挂载导出及实际新建表单导出均已对应。截图中的地址和 Anthropic 选中状态已目视复核，范围为本次中文深色竖屏操作。完整供应商流程和全应用环境矩阵继续验收。

原生修复前报告 1072 保留其恢复未完成状态；1080 已独立恢复。夹具渲染和末尾斜线预期的失败记录也保持，产品语义复现使用修正夹具后的 1082。

证据：[独立 main 验证](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-protocol-main-validation-20261119-1082.json)、[工作区回归](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-protocol-workspace-validation-20261119-1084.json)、[设备缓存与源码](../../test-evidence/implementation/native-routing-groups-20261115-01/native-loaded-provider-protocol-20261119-1088.json)、[真机点按输入](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-form-protocol-20261119-1089.json)、[独立原状态复核](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-protocol-originals-20261119-1090.json)。

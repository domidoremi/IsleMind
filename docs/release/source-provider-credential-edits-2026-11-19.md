# 导入后密钥名称与启停编辑（2026-11-19）

完整导入连接后，再输入仅含密钥组的 JSON，新名称和 enabled 会生效；只输入明文标签时，名称更新，原启停状态保留。按密钥身份保留组 ID、目录和首选关系，重排普通密钥时保留身份，新增组使用自己的目录状态。

四项回归在旧 main 和旧工作区各有两项失败、两项通过。修复后独立 main 五组 52 项、工作区五组 77 项及各自类型、架构检查通过，计数不相加。见[独立 main](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-credential-edits-main-validation-20261119-1175.json)和[工作区结果](../../test-evidence/implementation/native-routing-groups-20261115-01/provider-credential-edits-workspace-validation-20261119-1177.json)。

Android 岛屿深色中文竖屏输入完整配置，再以 JSON 或明文修改密钥组。通过 TextInput 选区接口选中合成文本、核对原生选区事件后投递 Delete，再分段输入新内容；实际保存、回读两组安全凭据、关闭重开通过。根目录、各组目录、空的已选模型、手工模型、首选与调度策略保持。每个合成连接及仅其安全凭据随后精准移除，两次前后复核原 53 表、四项 raw、六组草稿和恢复槽、全部用户资料、编辑器、路由、设备与 70 请求一致，cleanup/pending 空。硬件全选快捷键仍待验。见[实际原生场景](../../test-evidence/implementation/native-routing-groups-20261115-01/native-provider-credential-edits-20261119-1202.json)。

第 32 份快照包含 2,141 项输入。手机缓存 26,766,417 字节与 Metro 完整相同，SHA-256 `92b1da45dedf05452c408ef67462ca61bcd38d20c29ad0f1a85f43556960dd93`；1,182 个映射文本、三字体、三语和九个挂载导出已核对。4,159 个模块编号保持，进程 907 保持；源码同步和受保护重载引起的编辑器、路由实例重建单独记录。安装仍为 1.1.8/133，源码为 1.1.16/141。见[设备缓存与源码核对](../../test-evidence/implementation/native-routing-groups-20261115-01/native-loaded-credential-edits-20261119-1182.json)。

Web 两种编辑均通过保存、重载、重开和合成连接移除。10 次函数绑定与 4 个实际执行脚本核对通过；重复 Metro 定义按函数真实脚本位置及完整定义范围绑定。原来源 13 项 localStorage 和六个 OPFS 文件完整。操作覆盖 DOM 按钮事件和 Chromium 输入协议，系统键鼠和整体视觉资格继续待验。见[Web 保存验证](../../test-evidence/implementation/native-routing-groups-20261115-01/web-provider-credential-edits-20261119-1193.json)。

1179 的前置状态错误在复制前停止；同步后的临时根路由观察失败保留，1188 接续稳定状态核对，没有重复复制。1186 的脚本位置检查、1191 将 Zustand 生成函数视为本模块字面函数的检查，以及 1185 的原生 Ctrl+A/Delete 清空失败均保留。1195 的方向键移至下一步按钮，退格和首次清理均未通过；1200 实际核对按钮焦点，1201 关闭合成表单并独立恢复全部原始状态，没有保存连接。连续 778 字符截短仍未解决，1163—1168 的密钥显示、普通名称和原生受控/非受控对照保持 incomplete。

本项仅提交两份源码、四项回归和本记录。全应用、原生、视觉及广义 loadedRuntime 资格均为 false。没有 APK 构建、导出、安装、上传或工作流派发。1105 的五份离线副本清理遭自动审批拒绝，文件保持原位。

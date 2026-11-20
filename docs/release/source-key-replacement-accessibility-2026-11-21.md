# 同名连接密钥的无障碍辨识

连接设置中的密钥更换按钮使用序号和密钥名称区分同名条目，并提供独立的展开状态。新密钥密码框使用单独的无障碍名称；已保存的密钥不会填入该输入框。

Web 在 `320×844` 中英日各操作两把同名密钥。六个场景使用 Tab、Shift+Tab 和 Enter，核对浏览器无障碍树的按钮名称、展开状态和密码框名称；未操作的另一把保持收起，收起后按钮仍有焦点，空输入框重开后仍为空。没有发送模型请求。专用域名的 localStorage、IndexedDB 和 OPFS 已恢复到初次读取的空状态；初次导航后出现的浏览器握手标记未能保持相同值，相关原值检查失败保留，测试空间和预览服务均已关闭。

独立 `main` 复现同名键无法按名称区分；修复后独立 `main` 46 项、工作区 81 项通过，两处类型检查通过。补充空密码框断言后，相关组件套件分别通过 33 和 58 项，计数有重叠。

真机实际加载第 45 份运行源码。已核对 2,157 个源码输入、4,159 个模块编号、设备缓存及服务脚本字节；实际挂载的面板模块 3759 对应当前源码映射，三语词条及中文同名按钮的收起属性通过。第 238 次定位控件失败，发生在启用 TalkBack 之前；第 239 次绑定 TalkBack 后，测试双指滑动未能滚到按钮。两次均未完成使用 TalkBack 探索或激活按钮。按用户的静默要求停止进一步的真机交互，不授予 TalkBack、Android 层级的两个密码框、真机其他语言或视觉通过。

独立回读确认原 53 张表共 3,256 行、四项原始存储、六组草稿与恢复槽、编辑器正文、附件、选区、焦点和根路由一致；测试连接与对应安全存储槽不存在。原前台 USB 设置任务、进程 596 和 70 条请求保持，编辑器实例在源码重载时由 15046 重建为 218。TalkBack 三项原始设置为 `空 / 0 / 0`，临时 8092 映射已撤销，Inspector 已关闭。源码重载就绪时的 Inspector 超时保留。

本地证据：[Web 六个场景](../../test-evidence/implementation/credential-accessibility-20261121/browser-keys-1.json)、[Web 存储回读](../../test-evidence/implementation/credential-accessibility-20261121/browser-restore-original-baseline.json)、[第 45 份源码重载](../../test-evidence/implementation/native-routing-groups-20261115-01/native-key-accessibility-20261121-reload45.json)、[第 238 次失败](../../test-evidence/implementation/native-routing-groups-20261115-01/native-key-accessibility-20261121-238.json)、[第 239 次失败](../../test-evidence/implementation/native-routing-groups-20261115-01/native-key-accessibility-20261121-239.json)、[独立原值回读](../../test-evidence/implementation/native-routing-groups-20261115-01/native-key-accessibility-20261121-239-independent.json)、[端口及设置回读](../../test-evidence/implementation/native-routing-groups-20261115-01/native-key-accessibility-20261121-239-transport.json)。

# Web 外观模式偏好同步

2026-11-21，修复运行中切换外观后 HTML 的模式偏好仍保留首次绘制值的问题。根布局将原始 themeMode 与实际明暗模式分别同步，并在浅色／深色与系统跟随的实际颜色相同时更新偏好。原生平台与未就绪阶段保持跳过 Web 同步。

主线原始实现和当前工作区均复现缺陷；独立 main 文件副本应用同样六处限定修改后，34 个运行时用例通过。工作区同样34项通过；首次类型检查发现调用处未传新参数，补齐后 TypeScript --noEmit 通过。首次绘制回归、主题 QA 41项、主题审计47项、Web源码30项及架构边界检查通过。7组113项背景与输入连续性回归通过。既有四处 pattern="none" 为组件库默认行为的显式防护，不另计产品项。

当前 Web 外观页在320×844与568×320分别完成五主题×三语×明暗模式的30个组合，共60个。真实键盘激活后，模式偏好、实际主题、保存设置、唯一选中状态及未提交颜色输入节点／文本一致。两个报告各有8个组合发现背景选项触控宽度不足；矩阵均为 incomplete。竖屏系统跟随检查超时；横屏仅极简主题的深浅两个跟随状态通过，随后超时。截图首次及一次重试均超时，没有新增视觉资格。视口覆盖以每条记录实际尺寸为准，先前跨浏览器轮次未维持尺寸的记录不计入。

8个实际运行模块的工厂与同源响应、源码映射和当前文件哈希一致；根布局、外观页、预览与屏幕组件已挂载。独立测试域名的localStorage、OPFS、IndexedDB和原始sessionStorage逐项恢复一致。首次恢复检查在写入前因跨轮次注入守卫不存在而停止；守卫只覆盖最初导航，不能宣称覆盖后续重载。后续资源记录未见外部来源，也没有执行模型发送操作。所有失败记录保留。

第45份真机另行完成8个挂载消息组件的相关源码绑定和原值复核：53表3256行、四项原始存储、六组草稿／恢复槽、编辑器、原路由、前台、PID596及原70条请求保持。Inspector关闭，临时8092映射撤销。本项Web同步没有执行新的真机UI验收；设备音频、音量与无障碍设置未操作。

本项成功提交推送后达到当前发布周期5/5，随后按约定准备1.1.22源码发布。31路由／55原型、全环境视觉、系统大字体、静默原生层级、存储故障与内存终止仍未闭环；fullAcceptance、nativeVerified、visualAcceptance、loadedRuntimeVerified均为false。

证据：[竖屏](../../test-evidence/implementation/silent-continuation-20261121/theme-matrix-320x844-retry2.json)、[横屏](../../test-evidence/implementation/silent-continuation-20261121/theme-matrix-568x320.json)、[当前源码绑定](../../test-evidence/implementation/silent-continuation-20261121/browser-14-source.json)、[Web恢复](../../test-evidence/implementation/silent-continuation-20261121/browser-16-restore.json)、[独立main回归](../../test-evidence/implementation/silent-continuation-20261121/main-bridge.json)、[真机原值与绑定](../../test-evidence/implementation/native-routing-groups-20261115-01/native-message-loaded-stage45-20261121-retry4-transport.json)。

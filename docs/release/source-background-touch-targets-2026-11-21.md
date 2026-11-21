# 外观背景选项触控尺寸

2026-11-21，补齐背景选项共用点击容器的 44dp 最小宽度，保留原有 44dp 最小高度。Web 现场曾测得莫奈与流光玻璃主题中文选项宽度约 37.6 CSS px；调整后两种主题的背景变化、预设、动态与强度选项均保留最小点击范围。

工作区两组 66 项组件测试通过。独立 main 副本先复现两个宽度断言失败，并复现一个既有岛屿主题测试仍期待已移除背景控件的失败；将岛屿主题转入原有纯画布断言后，完整面板 44 项测试通过，无跳过。工作区与独立 main 的 TypeScript --noEmit 均通过。初次恢复核对脚本因预期测试名少写空格而停止，原始失败报告保留，后续直接核对已有结果。

当前 Web 外观页在 320×844 与 568×320 分别完成五主题、三语、明暗模式共 30 个组合，合计 60 个状态和 DOM 尺寸检查通过；未见触控范围不足、横向溢出或控件越界，未提交颜色文本及输入节点保持。八个实际运行模块的工厂、同源响应、源码映射与当前文件一致。两个完整矩阵仍为 incomplete：系统跟随模式超时另行追踪；既有两次截图超时，没有取得新增视觉资格。

本项没有执行新真机 UI 操作。第45份真机原始资料的最终独立核对通过，53表3256行、四项存储、六组草稿与恢复槽、编辑器、原路由、前台、PID596与70条请求保持，Inspector关闭、临时8092映射撤销。设备音频与音量未操作。源码版本维持1.1.22/147，本项成功提交推送后计入新周期第1项。31路由、55原型、系统大字体、静默原生层级、输入、恢复与性能验收继续；四项整体验收资格保持false。没有构建、导出、安装或派发工作流。

证据：[主线回归](../../test-evidence/implementation/silent-continuation-20261121/target-main-recovery.json)、[类型检查](../../test-evidence/implementation/silent-continuation-20261121/background-target-types.json)、[竖屏](../../test-evidence/implementation/silent-continuation-20261121/theme-matrix-320x844-targets.json)、[横屏](../../test-evidence/implementation/silent-continuation-20261121/theme-matrix-568x320-targets.json)、[运行源码](../../test-evidence/implementation/silent-continuation-20261121/browser-20-targets-source.json)、[系统跟随诊断](../../test-evidence/implementation/silent-continuation-20261121/browser-21-system-diagnostic.json)。

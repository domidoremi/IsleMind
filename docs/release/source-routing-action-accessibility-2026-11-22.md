# 同名路由方案操作的无障碍上下文

日期：2026-11-22（Asia/Taipei）。源码版本1.1.23，Android源码版本号148。

路由列表的编辑和删除操作增加方案序号及名称，支持简体中文、英文和日文。同名方案也有各自可区分的操作名称；改名后名称同步更新。可见按钮文案保持简洁，操作仍绑定原方案ID。

## 验证范围

新增测试在工作区与独立main原实现中各复现三项失败。修复后，工作区五组48项、独立main五组43项通过，均无失败或跳过，两侧计数不相加。相邻测试保留原有用例，只适配显式无障碍名称。两侧类型检查和main架构检查通过；main使用八份实际读入的虚拟输入，只读候选目录零写入。

独立Web缓存的16个相关模块完成当前文件、source map、实际Metro factory及挂载列表组件身份核对；三语运行资源与当前JSON逐项一致。五主题、明暗、中英日、320×844及844×390共60组合的DOM和实际Chromium无障碍树均取得四个可区分的按钮名称，按钮尺寸至少44×44 CSS像素。环境通过公开存储方法设置，此项不代表设置页面交互验收。

两尺寸各三语共六组实际键盘流程通过：焦点进入第二方案编辑按钮，Tab到其删除按钮，Shift+Tab返回，Enter打开编辑器；修改名称后键盘保存，再用Enter删除该方案。每次操作后，首个方案完整保持，改名后的删除名称正确。实际操作前通过真实滚轮揭示完整目标，并核对安全视口、命中和至少44像素范围。连接及方案由公开应用接口准备，不计为UI创建流程。

隔离来源`islemind-routing-actions-20261122.localhost:8147`在卸载应用后恢复，localStorage、sessionStorage、IndexedDB及OPFS与最初完整快照一致。没有全profile清理；网络和音频保护记录为空，没有模型请求或音频播放。

## 保留的限制

首轮相邻测试仍查找旧操作名称，独立main资源映射未覆盖相对解析；原始失败保留，调整后全部用例继续启用。Web状态页没有移动viewport元数据，首次宽度断言失败；跨调用注册的保护脚本未进入新文档，随后在同次调用中注册并加载，核对后再准备测试数据。连接插入顺序断言、导航自动滚动和横屏输入框可见性失败均保留，后两者改用真实滚轮揭示后通过，未虚计产品修复。

本项仅取得限定Web功能及静默语义证据，没有新增截图目视或真机资格；设备仍为第50份源码，新名称尚未加载到真机。全31生产路由、55原型、完整视觉环境、大字体、其它输入、静默无障碍、恢复及性能继续。TalkBack按静默约束保持未测。`fullAcceptance`、`nativeVerified`、`visualAcceptance`及广义`loadedRuntimeVerified`均为`false`。

本项成功推送后，合格产品周期从3/5到4/5，尚未达到下一次Release阈值。没有构建、导出或安装APK，没有操作TalkBack、音量或设备音频；提交及推送前后另行核对GitHub Actions。

证据目录：`test-evidence/implementation/routing-action-labels-20261122/`。核心回执为`tests-verification-v2.json`、`types-architecture-verification.json`、`web-07-sources.json`、`web-08-matrix.json`、`web-09-keyboard.json`、`web-10-keyboard-landscape.json`及`web-11-restore.json`。

# IsleMind 1.1.24 实际发布记录

v1.1.24于2026-11-22 15:32:59（台北，UTC为07:32:59）实际发布。标签固定到源码提交`b5a68044095dd7a1a96e14fee430b4b7d6d38c5a`；GitHub Release为稳定、非草稿及latest。三语正文与已提交的[公开更新说明](./v1.1.24.md)逐字一致，历史50个Release和50个标签的名称、正文、发布时间、目标及全部附件保持。

[GitHub Release](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.24)。源码版本1.1.24、Android源码版本码149；实际APK候选继续为1.1.2/127，updates/android.json原值保持。未构建、导出、安装或上传APK。

本周期五项产品改动均已独立验证并推送main，覆盖重叠密钥错误遮蔽、路由保存／删除失败回滚、路由编辑器失效错误提示、同名路由操作与同名场景操作及编辑触控范围。下一周期从`3e74f96360037d131ccc3ccaccb6670a9cdbe5f1`之后开始，当前0/5。纯版本和维护回执不计产品项。

版本资料五组检查及22项契约通过；十个最小版本文件均已审查，package.json中原有未完成字段保留。每次Git对象、index、提交和推送之前分别核对当前远端工作流；标签与Release创建前另有两个独立审计阶段，发布后再次回读。六工作流仅有pull_request及workflow_dispatch，41条Actions零新增／运行中，main来源PR为零。未派发、重跑或触发Actions。

场景操作的60组Web DOM／Chromium AX名称与尺寸和六组真实键盘归属流程已通过，限定证据见[场景维护记录](./source-scene-action-accessibility-2026-11-22.md)。337再次独立回读53表3256行、四raw、六组草稿／恢复、编辑器全部值、原路由及完整堆栈、设备设置、前台和70请求一致，PID8685与编辑器204保持。六项RKStorage raw的最近独立证明为328。

发布时原生仍为第51份源码，场景操作补丁和1.1.24元数据尚未取得实际加载及界面证据；第52份只读预检核对2165输入、八个预期差异和一个新测试，无新增运行输入或暂存漂移。全应用31路由／55原型、五主题明暗模式、三语、尺寸、大字体、输入、静默无障碍、恢复及高内存性能仍未完成，fullAcceptance、nativeVerified、visualAcceptance及广义loadedRuntimeVerified保持false。

静默设备约束保持，未启用或播放音频、未启用TalkBack、未调整音量。真实失败和被自动审批拒绝清理的既有资料继续保留。核心回执位于test-evidence/implementation/scene-action-context-20261122/release-1124-publication.json。

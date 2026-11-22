# IsleMind 1.1.24 源码版本更新记录

2026-11-22，五项已验证并推送的产品改动达到发布节奏。源码版本1.1.23→1.1.24，Android源码版本码148→149。实际APK候选仍为1.1.2/127，候选清单保持。

- `21425cfea307aa441b28f6572cde01a4c704145b` fix(providers): 完整遮蔽同步错误中的重叠密钥
- `e94da1393f9fda3d64e6a9ec66fca77eff49797a` fix(routing): 保存失败时恢复路由配置
- `c2ecd5c3e9309bb4d1502cbf2b154f22e9f76b2f` fix(routing): 关闭编辑器后隐藏失效错误
- `dfe271259070ba770ed73f934c11fd8d82b23227` fix(routing): 区分同名方案的无障碍操作
- `3e74f96360037d131ccc3ccaccb6670a9cdbe5f1` fix(scenes): 区分同名场景并补齐触控尺寸

下一周期从`3e74f96360037d131ccc3ccaccb6670a9cdbe5f1`之后开始。

场景操作改动在工作区5组44项、独立main5组43项及两侧类型／架构检查通过。Web14模块的源码、source map、实际factory及挂载组件对应；五主题明暗、三语、双尺寸共60组DOM／Chromium AX名称与尺寸，以及六组真实键盘预览、编辑、保存、删除归属检查通过。隔离来源localStorage、sessionStorage、IndexedDB及OPFS原值已恢复。暂存检查发现新测试的混合换行，已仅规范入库换行，原失败与工作区原值保持。

当前原生为第51份源码；三语同名路由编辑、保存、删除及六项content-desc已有限定证据，尚未包含本次场景操作补丁与新版本元数据。336独立核对53表3256行、四raw、六组草稿／恢复槽、编辑器全部值、原路径与完整堆栈、设备设置、前台及70请求一致。全部六项RKStorage raw的最近独立证明为328。PID8685、编辑器204保持。本次发布不扩大原生资格。

最新内存证据记录PSS1,632,032KB，libc_malloc映射PSS1,216,756KB；jemalloc两arena实际分配1,103,201,712字节。保留原因和性能未确立。31路由／55原型、全主题三语尺寸、大字体、输入、静默无障碍、真实存储故障、恢复与性能继续；fullAcceptance、nativeVerified、visualAcceptance、loadedRuntimeVerified保持false。

只使用main，438个原未完成路径在明确补丁之外保持。每次Git对象、暂存、提交、推送及Release操作前单独只读核对六工作流和完整Actions。未操作音频、TalkBack或音量，未构建、导出、安装或上传APK。历史Release、标签、正文与附件保持；此前被自动审批拒绝清理的资料继续保留。

[三语更新说明](./v1.1.24.md)；[场景操作修复](./source-scene-action-accessibility-2026-11-22.md)。实际发布后补充独立发布回执。

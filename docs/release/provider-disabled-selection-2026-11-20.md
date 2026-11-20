# 模型选择正确识别停用密钥

连接的密钥全部停用后，点击“使用模型”会返回连接编辑，并显示“已保存密钥均已停用”。明确存在密钥分组时，遗留主密钥不再让选择流程进入启用操作；分组没有保存密钥时继续显示缺少密钥。已有的启用密钥及无分组的旧连接保持可用。

修复只调整 ApiKeyPanel 的选择前凭据检查和提示，复用已有中英日文案，不发起在线检查或模型请求。新增六项回归，覆盖三语停用提示、停用分组伴随遗留主密钥、空分组及启用空分组与停用已保存分组并存。

独立主线修复前九项通过、六项失败；失败中保留了错误进入 updateProvider 的证据。修复后主线四组 78 项、工作区四组 104 项，以及各自类型和架构检查通过，计数不相加。

Web 在隔离测试域名先复现错误提示，再通过实际 Enter 验证新提示。实际挂载 ApiKeyPanel 与 ProviderSettingsContent 已核对到加载脚本、同源响应、模块工厂及当前源码映射。该操作前后连接、设置、会话和请求日志完全一致，未新增请求。证据位于 `test-evidence/implementation/provider-current-20261120-01/` 的 `browser-credential-all-disabled-action-127.json`、`disabled-choice-main-baseline-129.json`、`disabled-choice-*-131*` 和 `browser-disabled-fixed-136.json`。

本项完成后源码版本仍为 1.1.20 / 145，当前周期 4/5，不发布新版本。真机仍使用第 42 份旧源码；本项未授予真机或全局视觉通过。fullAcceptance、nativeVerified、visualAcceptance、loadedRuntimeVerified 均保持 false。未构建、导出、安装 APK 或派发 GitHub Actions。

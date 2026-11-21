# 模型同步错误中的重叠密钥遮蔽

日期：2026-11-21。源码版本1.1.23，Android版本号148。仅源码改动，不更新APK候选。

## 修复范围

模型目录获取失败时，先在原始错误文本中定位全部主密钥和分组密钥，再合并重叠范围并统一遮蔽。避免较短密钥先被替换后，较长密钥或部分重叠密钥留下片段。禁用分组的密钥同样遮蔽；重复、首尾空白和正则字符按字面值处理。保留其它诊断文字、已有模型目录与实际密钥值，不修改用户配置。

仅修改`providerCredentialGroups.ts`的错误文本处理函数，增加定向回归。其余既有未完成改动保持。

## 验证

- 工作区原实现复现9项失败、1项通过；修复后5组43项全部通过，未跳过。类型与架构检查通过。
- 独立main源码同样复现9项失败、1项通过；虚拟补丁后5组43项全部通过。使用本机TypeScript 7同步API检查3288份源文件，零诊断，架构检查通过。两侧测试计数不相加。
- 只读复用既有main验证副本，1932个受检输入与HEAD一致；其中package.json的版本字段仍为1.1.22，其余字段逐项一致。补丁、回归及显式测试入口通过虚拟文件系统注入，副本零写入。未提交工作区的其它改动没有进入独立main验证。
- 首次验证脚本发生快照／输出命名冲突；独立main首次类型脚本使用了不适用的旧API，最终包字段比较曾误用未提交工作区。相关失败和原始日志保留，修正后的完整回执另存。

证据目录：`test-evidence/implementation/credential-error-20261121/`。核心回执为`verification-workspace-before.json`、`verification-workspace-after.json`和`main-complete-verification.json`。

## 未覆盖范围

此补丁尚未同步到既有Android调试应用，未新增Web或真机界面资格。31个生产路由、55个原型、五主题明暗模式、三语、尺寸、真实输入、静默无障碍、恢复及性能目标继续。`fullAcceptance`、`nativeVerified`、`visualAcceptance`及广义`loadedRuntimeVerified`保持`false`。不操作设备音频、TalkBack或音量，不构建、导出、安装APK或触发Actions。

# Google Play 上架准备

适用：Android `com.islemind.app`。政策核对日期：2026-09-23。
这是发布操作说明和待确认材料，不是上架批准、已生效隐私政策或已完成的商店申报。
当前用户尚未准备运营主体名称、公开支持邮箱或隐私政策 URL。

## 分发渠道

| 项目 | GitHub APK（保持现状） | Google Play |
| --- | --- | --- |
| EAS profile | `preview` / `production` | `google-play` |
| 分发类型 | internal / APK | store / Android App Bundle（AAB） |
| `ISLEMIND_DISTRIBUTION` | 未设置或 `github` | `google-play` |
| 应用更新 | GitHub 更新检查、APK 下载与系统安装器 | 由 Google Play 管理；禁止应用内外部 APK 更新 |
| 安装包权限 | 保留既有行为 | 移除 `REQUEST_INSTALL_PACKAGES`、`SYSTEM_ALERT_WINDOW`，保留已有共享存储权限阻断 |
| EAS submit profile | 既有配置 | internal track + draft；不会配置直接生产发布 |

`app.config.js` 把渠道写入 Expo 内嵌配置 `extra.distributionChannel`；它不是用户设置。
Play profile 与渠道变量冲突时直接报错。旧 APK 缺少渠道元数据时继续使用既有更新方式。
源 `app.json`、包名和现有版本号保持不变。Play 构建使用默认 `no-model` 模型包；
不要把小型检索模型描述为完整离线聊天模型。

### 本地检查（不构建、不上传）

在项目根目录使用 `mise which node` / `mise which bun` 返回的真实可执行文件。
检查 Expo 配置时设置 `EXPO_NO_DOTENV=1`，不要输出本地 `.env` 或完整构建环境。

```powershell
$node = (& mise which node).Trim()
& $node scripts/google-play-config-tests.js
& $node node_modules/typescript/bin/tsc --noEmit
& $node node_modules/jest/bin/jest.js --runInBand --runTestsByPath `
  src/platform/native/androidApkUpdates.test.ts `
  src/components/main/SettingsScreenContent.test.tsx
& $node scripts/android-build-toolchain-tests.js
& $node scripts/android-release-hardening-tests.js
```

配置测试执行真实 Expo manifest introspection，不改写现有 `android/`。
它不是 Gradle 合并 manifest、签名 AAB、真机或 Play Console 验证。

### AAB 构建路径

当前仓库的 `apk:local:release` 是侧载 APK 流程，缺少签名配置时可能生成 **debug 签名 QA 包**，
不能拿它代替 Play 上传包。也不要直接对既有侧载 `android/` 运行 `bundleRelease`；
必须在同一渠道环境下重新生成原生工程和 JS bundle。

优先在专用本地构建副本中操作，包含当前工作区与 `../animal-island-ui` 对应源码，
避免覆盖开发中的原生工程。以下是待执行步骤，不是已经通过的构建记录：

1. 使用 `mise.toml` 的工具链、Bun frozen lockfile 和既有 postinstall 补丁。
   先执行 `node scripts/android-build-toolchain.js` 验证实际 JDK/Node/Bun。
2. 在整个 prebuild 和 Gradle 会话中设置 `ISLEMIND_DISTRIBUTION=google-play`、
   `EXPO_NO_DOTENV=1`、`NODE_ENV=production`。
3. 确认 `src/generated/modelBundle.ts` 为 `no-model`，且 Android assets 未残留模型文件。
   必要时在构建副本中运行 `node scripts/prepare-model-bundle.js --variant no-model`。
4. `node node_modules/expo/bin/cli prebuild --platform android --no-install`。
   为本机 SDK 配置 `ANDROID_HOME`；JDK 使用 `scripts/android-build-toolchain.js` 的
   `selectAndroidJavaHome()` 返回值，并保留 `JAVA_TOOL_OPTIONS=--enable-native-access=ALL-UNNAMED`。
5. 通过安全凭据存储提供以下 Gradle 项目属性（例如外部用户级 Gradle 配置或
   `ORG_GRADLE_PROJECT_` 环境变量），不要写入仓库或命令行日志：
   `ISLEMIND_UPLOAD_STORE_FILE`、`ISLEMIND_UPLOAD_STORE_PASSWORD`、
   `ISLEMIND_UPLOAD_KEY_ALIAS`、`ISLEMIND_UPLOAD_KEY_PASSWORD`。
   keystore 路径使用绝对路径。没有真实上传密钥时停止，不生成或冒用生产身份。
6. `node scripts/configure-android-release.js`，**不使用** `--skip-signing` / `--unsigned`。
7. 在 `android/` 中运行本机 Gradle wrapper：
   `bundleRelease -PreactNativeArchitectures=arm64-v8a,x86_64 -PislemindAbiFilters=arm64-v8a,x86_64 -PislemindEnableAbiSplits=false -PislemindUniversalApk=false`。
   预期输出 `android/app/build/outputs/bundle/release/app-release.aab`。
8. 用 bundletool 验证 AAB、查看最终 manifest（包名、versionCode、targetSdk、权限、非 debuggable），
   校验 JAR/AAB 签名为上传证书且非 debug；用 bundletool 生成 APK，再执行
   `node scripts/validate-android-16kb-apk.js --strict <APK 路径>`。
   APK 的 zipalign 检查不能直接用在 AAB 上。
9. 在 16 KB Android 设备/模拟器及普通 Android 设备上安装此 AAB 生成的 APK，验证冷启动、
   图片/语音权限、服务商配置、聊天/检索、前台任务取消、数据清理及 Play 更新提示。
   检查启动与更新页不再请求 GitHub 更新，不弹出未知来源安装器。

本地构建不自动增加 versionCode；提交前必须与 Play Console 已用值及 EAS remote version 对齐，
确保递增。`google-play` EAS 构建继承 `autoIncrement`，使用 remote version source。
不要凭 `app.json` 的数字推断云构建的最终 versionCode。

若以后授权云构建，可使用锁定版本 EAS CLI 的
`eas build --platform android --profile google-play`，先确认云镜像符合当前 JDK/Gradle 约束及
相邻 UI workspace 的准备方式。此 profile 尚未进行云构建验证；不得自动触发 Actions 或花费配额。
首次上传通过 Play Console 人工完成；后续自动提交必须选 `--profile google-play` 和明确的构建 ID，
不要使用可能指向侧载 APK 的 `--latest`，不要使用 `--auto-submit`。

## 提交前阻塞项

| 项目 | 当前状态 / 放行条件 |
| --- | --- |
| 开发者身份 | 未准备。决定个人/组织，完成 Google Play Console 注册和身份核验；名称须与隐私政策一致。注册、付费与接受条款由账号持有人完成。 |
| 支持与隐私政策 | 未准备公开邮箱/URL。完成下方草稿，托管公开 HTTPS HTML（无需登录、无地域限制、非 PDF），在商店及应用内提供可访问入口。当前官网“数据边界”介绍不是完整隐私政策。 |
| AI 内容举报与安全措施 | 未确认存在符合 Play 要求的完整链路。需应用内对具体生成内容举报/标记，明确告知发送范围，接入真实运营接收端、失败重试和审核流程；仅本地标记、复制文本、邮件跳转或 GitHub issue 外链不能替代应用内提交。第三方/BYOK 模型也不能免除开发者责任。不要把 API key 或完整对话自动附到举报。 |
| UI 与模型授权 | UI 上游 LICENSE 为 CC BY-NC 4.0；拟分发/商业用途授权未确认。免费上架不自动等于非商业使用；先确认许可范围，必要时取得授权。逐一核对模型、字体、图标及依赖署名；不在此认定侵权或自动替换 UI。 |
| Data safety | 需按真实网络行为及第三方接收方填写，不因为“本地优先”或“用户自己的 Key”就声明不收集数据。参见下表。 |
| 传输与备份 | 现有原生配置允许 cleartext、Android backup；需核对所有 provider/proxy/MCP/工具路径是否允许敏感数据经 HTTP 发送，以及 SQLite/文件备份范围。未确认前不能宣称所有数据传输加密、数据库加密或完全不离开设备。 |
| 前台服务 | 当前插件使用 `dataSync`，音频插件还有 `mediaPlayback`。核对实际用途、用户可见启停、后台时限，并按 Console 要求提供声明/演示；不得用不相符类型维持任意后台 Agent。 |
| 正式包与兼容性 | 尚无本次 Play 签名 AAB/Play 安装实测。当前 RN 工具链声明 targetSdk 36，但最终制品仍需验证。16 KB 严格检查是发布门槛，不能沿用旧版“第三方限制”豁免说明。 |
| 审核访问 | 聊天依赖用户配置服务商。准备审核专用、限权限额且审核期间可用的访问方式和操作步骤，通过 Console 安全提供，不把生产 Key 写入源码、文案或截图；不能要求审核员自行购买 API 服务。 |
| 年龄/内容分级 | 按聊天、图像、角色扮演等真实能力填写 IARC、目标受众和内容问卷；未决定前不要声称适合儿童。价格、国家/地区、广告/收费声明须由运营者确认。 |
| 测试资格 | 2023-11-13 后创建的个人开发者账户通常需至少 12 名测试者连续参与封闭测试 14 天，再申请生产访问；internal testing 不替代此要求。以账号 Console 为准。 |

## 数据安全梳理（申报输入，不是已经勾选的答案）

| 数据 / 功能 | 当前代码可见处理方式 | 申报前核实 |
| --- | --- | --- |
| 聊天文本、记忆、检索片段 | 本地存储；请求模型时所选上下文发往用户配置的服务商/代理 | 用户内容类别、用途、必需/可选、第三方保留/训练政策，代理及远程压缩路径 |
| 图片、录音、导入文档 | 用户选择/录制，依功能提供给模型、转录或检索服务 | 照片/视频、音频、文件/文档类别及实际传输范围；权限拒绝不应阻塞纯文本使用 |
| API Key / 令牌 | 原生凭据适配使用 Expo SecureStore；调用服务商时用于认证 | 导入导出、备份、日志脱敏及代理接收方；SecureStore 不等于整个 SQLite 已加密 |
| 搜索、网页、MCP/工具 | 启用功能时与对应端点通信 | 查询/工具参数、设备动作信息、IP 和第三方服务日志，SDK/服务商是否适用 sharing 例外 |
| 运行诊断/可观测性 | 运行日志有启用设置，另有可配置的导出目标和同意设置 | 是否真的默认关闭、字段范围/留存、实际外发端点，崩溃/诊断类别 |
| 本地模型下载 | 从模型源/镜像下载模型文件 | 接收方 IP/请求记录、下载许可；不能将模型下载描述为 APK/动态可执行代码更新 |
| 删除/导出/备份 | 设置提供聊天清理、重置和清空数据；导出文件及第三方副本是独立副本 | 实测清除范围，Android 系统备份，外部副本保留和删除途径。当前未发现 IsleMind 自有账号注册流程；若新增账号，补齐应用内及 Web 账号删除途径 |
| 举报（待开发） | 不把未来举报后台当作已存在 | 确定接收主体、最小字段、留存时间、删除渠道及处理承诺后更新政策和申报 |

## 商店资料草稿

以下文案不承诺尚未验证的全部离线、隐私零收集或后台自动化能力。

### 简体中文

- 应用名称（最多 30 字符）：**IsleMind**
- 简短说明（最多 80 字符）：**连接你选择的 AI 服务，管理对话、知识库与个人记忆。**
- 建议类别：效率（需在 Console 确认）。

完整说明草稿（最多 4,000 字符）：

> IsleMind 是一款可连接多种 AI 服务的个人助手客户端，帮助你在手机上管理对话和参考资料。
>
> • 连接你选择的 AI 服务，管理模型与服务商配置。
> • 整理对话、导入资料，并结合知识库进行问答。
> • 管理个人记忆，按需导出或清理应用数据。
> • 支持简体中文、英语和日语界面，以及多种外观设置。
>
> 使用聊天功能需要配置兼容的 AI 服务。服务可用性、模型能力和费用由你选择的服务商决定，IsleMind 不包含通用的免费 API 额度。
> 本地检索模型不等同于离线生成式聊天模型。使用在线服务、搜索或工具时，相关内容会发送到对应服务。
> AI 输出可能不准确，请核实重要信息，不要仅凭生成内容作出医疗、法律或财务决定。

### English

- Name: **IsleMind**
- Short description: **Connect your AI services and organize chats, knowledge and personal memory.**

> IsleMind is a personal AI client for managing conversations and reference material on your phone.
>
> • Connect compatible AI services and manage provider and model settings.
> • Organize conversations, import reference material and use knowledge-assisted chat.
> • Manage personal memory and export or clear app data when needed.
> • Choose from Simplified Chinese, English and Japanese interfaces and multiple appearance settings.
>
> Chat requires a compatible AI service configuration. Availability, model capabilities and fees depend on your chosen provider. IsleMind does not include a general-purpose free API allowance.
> Local retrieval models are not offline generative chat models. Online AI, search and tool features send relevant content to the services you configure.
> AI output may be inaccurate. Verify important information and do not rely on generated content alone for medical, legal or financial decisions.

### 图片资料

- Google Play 图标：512×512 PNG，遵循 Play 图标规范；不是直接把 Android adaptive foreground 当成完成品。
- Feature graphic：1024×500，PNG 或 JPEG，无透明度。
- 至少 2 张真实手机截图；JPEG 或 24-bit PNG（无 alpha），边长 320–3840，长边不超过短边 2 倍。
  建议统一 1080×1920，覆盖对话、知识库、记忆和设置；以本次候选包实拍，不用浏览器截图冒充 Android。
- 只使用合成演示数据，隐藏 Key、真实邮件/对话和个人设备信息；不伪造评分、排名、Google 背书或尚未开放能力。
- 现有 `assets/icon.png` 及品牌源文件可以作为制图来源；本次没有生成或声称完成商店截图。

## 隐私政策草稿（待确认，勿直接发布）

必须填写全部 `【待确认】`，与网络/删除测试核对，再由运营者审阅发布。
公开版本需提供面向上架地区的对应语言，商店网址和应用内入口必须指向同一有效政策。

> **IsleMind 隐私政策**
>
> 生效日期：【待确认】。运营者／数据责任主体：【待确认】。隐私与支持联系方式：【待确认公开邮箱】。
>
> **处理的数据与目的**：IsleMind 在设备上保存对话、设置、知识库、记忆及功能所需的文件。
> 当你使用在线 AI、语音、图片、搜索或外部工具功能时，完成该功能所需的输入、附件、上下文和工具参数可能发送到你配置的服务商或代理。
> 连接服务时使用你提供的 API Key 或令牌。请勿提交无权提供的第三方信息。
>
> **接收方与服务**：实际接收方取决于你启用的服务商、代理、搜索、MCP 和诊断导出设置。
> 请在使用前了解其隐私政策及数据处理方式。【待确认：运营者是否提供任何中转、遥测、举报或支持后台；逐项列明名称、目的、数据类型、地区与政策链接。】
>
> **权限与选择**：麦克风用于你主动录制的音频；文件或图片由你选择。通知和前台任务按启用的功能工作。
> 你可以在系统设置管理权限，并在应用中管理服务和数据。【待确认：准确权限清单及拒绝后的可用功能。】
>
> **存储与保护**：Android 凭据使用系统支持的安全存储。对话与资料存储不应被理解为全部数据库已加密。
> 系统备份、导出文件和第三方服务可能形成独立副本。【待确认：备份范围、所有传输协议、访问控制和保护措施。】
>
> **保留与删除**：你可使用应用设置清理聊天或应用数据。已导出的文件需在保存位置另行删除，已发送到第三方的数据按对应服务的规则处理。
> 【待确认：本地残留、运营者后台/举报/支持记录的保留期限、删除请求途径和处理流程；不要承诺未实现的彻底删除。】
>
> **受众、地区与权利**：【待确认：目标受众、年龄要求、上架地区、适用的访问/更正/删除等权利及联系方法。】
>
> **政策变更**：重要的数据处理变化将通过【待确认的通知方式】说明，并在需要时征得同意。

## 官方依据

- [Target API：自 2026-08-31 起新应用及更新至少 Android 16 / API 36](https://support.google.com/googleplay/android-developer/answer/11926878)
- [16 KB page sizes：检查 ELF、ZIP 对齐及设备运行](https://developer.android.com/guide/practices/page-sizes)
- [REQUEST_INSTALL_PACKAGES 限制](https://support.google.com/googleplay/android-developer/answer/12085295)
- [AI-generated content：内容安全及应用内举报](https://support.google.com/googleplay/android-developer/answer/14094294)
- [User Data / 隐私政策](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- [个人开发者测试要求](https://support.google.com/googleplay/android-developer/answer/14151465)
- [商店预览资源要求](https://support.google.com/googleplay/android-developer/answer/9866151)

发布前再次核对 Console 的实时要求；自动测试通过不代表商店审核、授权审查或法律合规已经通过。

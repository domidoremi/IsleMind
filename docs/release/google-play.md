# Google Play 上架准备

适用：Android `com.islemind.app`。政策核对日期：2026-09-23。
这是发布操作说明和待确认材料，不是上架批准、已生效隐私政策或已完成的商店申报。
当前用户尚未准备运营主体名称、公开支持邮箱或隐私政策 URL。

### 2026-10-04 当前验收状态（优先于下方历史记录）

整体里程碑 **未完成**。用户本轮再次确认仅做本地发布准备；不提交、推送、发布或归档会话。
下方按日期保留的通过记录只覆盖其当时源码、制品、设备和场景，不自动升级为当前全量通过。

- 证据目录：`test-evidence/qa/agent-platform/continuation-20261004-01a1059d`。
  开始时 1,482 个构建输入与 9 月 30 日快照内容相同，22 份引用回执的 SHA-256 已核对。
  历史文件中断目标实际为完整 64 MiB，**不能**作为部分写入中断证据。
- 配套 UI 固定输入已解除旧阻塞：`animal-island-ui` HEAD 为
  `122151919fcf4f29a6dd4d77ed674c2dcd67a2cc`，工作树干净，414 个 tracked 文件均与 HEAD 匹配；准备脚本通过。
- 类型检查排除取证目录而不删除历史备份；Expo 及关联包只更新 Doctor 要求的补丁版本。
  Doctor 当前 21/21；新增导入启用竞态回归后完整 Jest 为 214 套件 / 1,649 测试通过。
  后续回归 fixture 与过期静态检查仍需按最终结果核对，不能隐去中途失败日志。
- 导入启用修复：模型发现前先落盘批量启用补丁，避免发现捕获的配置权限被自己的延迟写入作废。
  真机旧 APK 暴露的同步失败已记录；是否修复以新 APK 实际重试为准。
- 三语隐私指南补充举报实际字段、尽力脱敏、连接元数据、缺配置禁发、接收不等于审核，以及
  取消/超时不能证明未送达；本地生成与校验通过。这不是已生效的公开隐私政策。
- 本轮授权端点为 `https://x666.me`，目录实际返回 6 个模型；不沿用旧端点的身份或无限预算。
  直接 `ministral-3b-latest` 文本、无副作用工具提议及工具结果续接通过，报告用量分别为
  33 / 129 / 84 Token；不是应用/Harness 的真实模型全流程验收。后续模型与总预算仍待明确确认。
  单页 PDF 返回 HTTP 422；音频虽 HTTP 200 / 97 Token，但回答不足以证明实际音频识别。
  目录没有容量/媒体计量元数据，安全共享预算保持 fail-closed，不能按模型名称猜支持。
- 用户授权 Android 35 与 Android 37（16 KB）AVD 各 60 分钟，串行执行。
  AVD 只能补充兼容性、前后台恢复与内存观察；不替代真实跨机型功耗、温度或高刷验收。
  原包 `com.islemind.app` 不变，只更新隔离包 `com.islemind.app.milestoneqa`；测试签名不是正式签名。
- 外部仍缺：额外实体设备及实体长时功耗/温度/高刷范围、正式签名与运营身份、专用举报接收端点、
  公开隐私政策及运营验收授权。公网发送、正式制品发布和商店操作均未执行。

当前设备长测、APK 绑定与最终检查回执在同一证据目录持续记录；未记录结果的项目仍为未验收，
不得用主机测试、协议探测或模拟器空闲采样替代实际 Agent 工作负载通过。

**2026-09-29：用户再次确认暂缓运营与发布，仅做本地准备。** 现有域名及部分子域由其他项目使用，不默认复用其端点、
Tunnel、凭据或运营身份。下列本地工程验证可以继续；公网举报、正式签名、商店提交和政策承诺仍需另行授权。

### 2026-09-29 获授权真实供应商探测与用量修正

- 用户已授权测试模型调用且不设总费用上限，供应商约 **10 RPM**；此前“等待模型与预算授权”的
  状态不再适用。模型从 `/v1/models` 获取，返回 **27 个 ID**，不把名称当作完整能力证据。
  本授权不包含公网举报、生产签名、商店发布或政策承诺。
- 直接协议探测使用 `gemini-2.5-flash-lite` 做文本检查，`gemini-2.5-flash` 做原生工具提议及
  工具结果续接，三次均 HTTP **200**，供应商报告总量依次 **13 / 108 / 90 Token**。
  工具为无外部副作用的合成 echo；这不是应用/Harness、真实文件操作或多工具验收，费用金额未验证。
- 真实兼容响应同时返回正数 `prompt_tokens/completion_tokens` 和零值 `input_tokens/output_tokens`，
  原解析优先取后者，导致输入/输出计数为零。现对重叠别名取较大有效计数，不相加；缓存与推理
  别名同理。新增回归先失败后通过；用量及共享预算 **10 项 Jest**、Provider intelligence、类型及
  diff 检查通过。将三份真实 usage 交给当前解析器重放后分别保留 **12+1 / 88+20 / 89+1**。
- `dadaa813` 的隔离包内已同步 **27 个模型**并通过启用流程，供应商页显示 **已启用 1/1**。
  中文 IME 改写 ADB 输入的问题已通过有读回断言的原生字段赋值解决；已保存
  `QA-Real-Gemini-20260929`（纯文本、无工具权限）并绑定 `gemini-2.5-flash-lite`。
  实际普通聊天 `Reply-exactly-OK.` 返回 `OK.`，不是 Agent 执行证明。临时 IME 设置已恢复。
- 用量修复后完整 Jest **211 套件 / 1,628 测试**、类型和 diff 检查通过。
  复用的构建根实际为 `G:\tmp\im-milestone-cK2grc\IsleMind`；此前“目录不存在”是漏写
  `IsleMind` 子目录的路径错误，不是基底丢失。同步后 **1,480 个构建输入**除显式 QA `app.json`
  外与主工作区一致，增量构建 **749 tasks / 3m 17s**通过。
  首次构建漏设仓库要求的 `JAVA_TOOL_OPTIONS`，失败日志保留；补齐后重跑，没有豁免检查。
- 该轮 APK 为 `C:\Users\barna\AppData\Local\Temp\islemind-continuation-01a0ed4c\IsleMind-milestoneqa-usage-arm64.apk`，
  SHA-256 `7f0133f956c4a2980a8b882d5b4228c3bbe1c7e02d030ca3d498ac5ab81cf5d2`。
  既有 Android Debug 测试签名、非 debuggable、arm64、targetSdk 36，严格 16 KB ZIP/ELF 检查、
  独立包保留数据更新和冷启动通过。协议、构建和 usage 证据在上述临时目录，不含凭据。

### 2026-09-30 真机发现并修复新 Agent 的启动拒绝

- 在上述 APK 的真实会话中选择已保存的 Agent，提交纯文本合成任务后，界面显示通用失败，
  刷新仍没有新运行。检查发现 Agent 有意不读取旧会话，传入空消息来源列表，而上下文装配器
  无条件拒绝空列表，导致请求在创建运行前失败。新增回归先复现失败，再修复为允许有任务正文的
  无历史快照；空任务/空会话仍拒绝，不伪造旧消息来源或修改工具授权。
- 启动页现像运行详情页一样展示截断、脱敏后的拒绝原因；草稿保留且不自动重试。
  上下文和页面专项 **17 测试**、类型检查通过。当前源码 SQLite **12 文件 / 91 测试**、
  walking-skeleton 和 workflow-run 通过；误用 Node 运行 Bun 脚本的失败日志保留，已用 Bun 重跑。
  修复后完整 Jest **212 套件 / 1,632 测试**通过，diff 检查通过。
- 同一隔离基底增量构建 **749 tasks / 2m 26s**通过。构建前后 **1,481 个输入**稳定，
  主工作区与隔离输入仍只差显式 QA `app.json`。本节 APK：
  `C:\Users\barna\AppData\Local\Temp\islemind-continuation-01a0ed4c\agent-start\IsleMind-milestoneqa-agent-start-arm64.apk`，
  SHA-256 `67fef520b1fd7a38ac1b3ce703c1d955d4ce415a80838b5b25a3c669c96b2288`。
  保持既有 Android Debug 测试签名、独立包、非 debuggable、arm64、targetSdk 36；
  严格 16 KB ZIP/ELF 检查、保留数据更新安装及冷启动通过，不是正式发布制品。
- 真机从会话进入任务页，选择已保存的纯文本 Agent，发送合成任务，运行
  `run-005a4e29-d049-480c-93e4-f16205a5f7e5` 实际完成并显示 `AGENT_QA_OK`。
  页面显示 **模型请求 1、工具 0、实际 56 Token、估算 0、预留 0**；force-stop 后冷启动打开
  相同运行，状态、输出及用量保持。没有保存 Documents、执行工具或验证账单金额。
- 另一合成长文本运行 `run-d5f00659-aa5d-4d55-86a4-7fd30ae5a1dd` 在执行中手动暂停，
  **1 次请求 / 4,235 Token 预留**转成 **4,235 Token 估算 / 0 预留**。
  force-stop 后打开仍暂停、请求数仍为 1；明确点击继续后变为 **2 次请求**，原估算保留，
  新增 4,235 预留。执行中停止后显示 **已停止、8,470 估算 / 0 预留**，再次重启仍保持，
  无继续按钮或新请求。这证明本次文本路径的暂停/恢复/停止及预算持久性；中断时未收到完整
  provider usage，因此估算不冒充实际消耗，也不代表供应商已停止计费。
- 本节日志、输入/签名收据、完成截图及前后状态 JSON 位于上述 `agent-start` 目录。
  **尚未验证**工具批准/拒绝/过期、逐操作文件副作用、在途进程死亡与权限恢复、长期后台、
  跨机型/功耗/高刷以及兼容网关 PDF/音频；旧的严格拒绝和共享预算约束不变。

### 2026-09-30 原生工具声明、发现元数据与真实批量执行

- 供应商设置补上既有能力覆盖中的“原生工具”控件，并说明它是人工声明，不是验证或操作授权。
  真机再次发现：只返回模型 ID 的兼容端点被映射为 `supportsTools: false`，与明确禁止混淆。
  现将缺失元数据持久化为 `null`；不按模型名称回填支持，必须另有明确供应商声明。
  远端明确否定、完整参数列表不含工具及旧版保存的 `false` 仍拒绝，不自动迁移旧否定值。
  实际在应用重新获取 `/models` 后绑定既有 Agent，才从“仅文本”变为“原生工具调用”。
- 上述修正后类型、Provider intelligence、完整 Jest **213 套件 / 1,637 测试**通过。
  隔离基底增量构建 **749 tasks / 2m 21s**，**1,482 个输入**前后稳定，主工作区仍只差
  QA `app.json`。APK 位于
  `C:\Users\barna\AppData\Local\Temp\islemind-continuation-01a0ed4c\tool-discovery\IsleMind-milestoneqa-tool-discovery-arm64.apk`，
  SHA-256 `a4cbc187e2c410b29fd128562353f86808188bdb26e8eb893fbae298dbc671bd`。
  既有测试签名、独立包、非 debuggable、arm64、targetSdk 36、严格 16 KB ZIP/ELF 及更新安装通过。
- 真机 Agent `QA-Tools-Gemini-20260930` / `gemini-2.5-flash` 仅允许 `android:storage.audit` 时，
  `run-8e77f126-3933-4beb-bb00-420c8801d78e` 完成同轮两次只读调用，分别显示输入和真实存储回执，
  返回 `QA_TWO_AUDITS_OK`。**2 次模型请求、2 次工具、实际 1,090 Token、估算/预留均 0**。
  force-stop 后相同运行仍完成，预算和两条记录保留；不是两个模型轮次分别调用工具。
- 将 Agent 允许列表明确扩展到目录申请、扫描、预览和应用文件操作后，
  `run-d11c75b9-a645-4c80-a8e1-602247a1cc48` 提出同轮两次目录申请。
  界面显示“第 1 / 2 项”；拒绝首项得到 `confirmation_declined`，后项 `batch_stopped`，
  两项均未执行，也未弹系统选择器。最终 `QA_DECLINE_CHECK_DONE`，
  **2 次模型请求、0 次工具、实际 2,230 Token、估算/预留均 0**。
- `run-d0979d1e-8eb1-4037-bbd5-79c00b9f70e3` 的单项目录确认在 force-stop 后仍等待，
  **1 次模型请求、0 次工具、829 实际 Token**和原确认到期时间不变，没有自动授权或新请求。
  明确批准后系统选择器确实打开合成目录 `Documents/IsleMind-QA-20260930`，其中仅有 47 字节
  `seed.txt`。但系统 Activity 跳转触发“未启用后台执行”暂停，显示操作结果未知且不能继续，
  不把它算作成功目录调用。随后只读系统查询发现该目录对 QA 包已有 URI grant；不能依据
  取消回执声称外部权限未改变，也没有自动重试或撤销权限。该生命周期问题正在单独修复复验。
- 本节状态 JSON、截图、构建及签名证据在上述 `tool-discovery` 目录。系统选择器的结果交回、
  文件副作用、确认过期、在途进程死亡及长期后台/跨机型仍未完成，不据模型成功文本推断文件成功。

#### 系统选择器生命周期修复与复验

- 为已经通过逐操作授权的本地 SAF 选择器增加 host 等待范围，仅允许单个活动前台调用进入。
  等待期间释放 CPU lease、拒绝后续模型/工具分派；其他运行的后台门禁、内存压力、取消及
  预算截止不变。不设置后台授权，不采纳模型参数或远端 metadata 作为等待权限。
  必须取得系统结果且应用回到前台后才交回；迟到结果不能清除取消/压力屏障。
- 修复后类型、架构边界 **14/14**、模块边界和完整 Jest **213 套件 / 1,642 测试**通过。
  同一隔离基底构建 **749 tasks / 2m 49s**，1,482 个输入前后稳定，严格 16 KB、测试身份核对、
  保留数据更新及冷启动通过。APK：
  `C:\Users\barna\AppData\Local\Temp\islemind-continuation-01a0ed4c\picker\IsleMind-milestoneqa-picker-arm64.apk`，
  SHA-256 `8d68ca057ae17ff7645cf9f235a96af0690f9c5dea5ebe12b77b0f78c76a1715`。
- 旧未知结果运行经核实后显式停止，没有恢复/重放。新运行
  `run-cc364fb4-738a-43cd-a220-4953a44533e6` 在后台开关关闭时，经应用“仅批准一次”、
  系统“使用此文件夹”和确认合成目录的“允许”三个步骤完成。回执显示已授权的精确 SAF URI，
  最终 `QA_DIRECTORY_CHECK_DONE`；**2 次模型请求、1 次工具、实际 1,947 Token、估算/预留 0**。
  这是实际选择器结果交回验证，不是首次授予一个从未授权目录的证明，也不是后台持续执行验收。
  构建、签名、截图与状态证据位于上述 `picker` 目录。
- 文件链首次运行 `run-635ca7ef-e143-42bf-b7ad-ea593cf1869c` 完成一次扫描和两次预览后，
  被当前配置的 **3 步**上限阻止写入；界面明确显示 `step_limit_reached`，没有文件副作用。
  模型后续重提仍被拒绝，最终 `provider_failed` / stream ended unexpectedly，
  **7 次模型请求、3 次只读工具、实际 11,592 / 估算 23,110 / 预留 0 Token**。
  只读复核目录仍仅有原始 `seed.txt`。未修改上限检查；后续通过产品设置临时改为 **6 步**
  进行五操作场景，后续双复制测试结束已通过同一设置页恢复并读回原来的 **3 步**。
- 第二次运行 `run-eb1219cf-3ae2-4ee8-9e73-c8e25b759019` 暴露文件工具 schema 缺少数组项结构：
  模型仅发送清单 ID 字符串，仍能进入确认页，无法核对源/目标；没有批准，已显式停止。
  **3 次模型请求、3 次只读工具、实际 5,475 Token**；确认不等于写入。
  现为 apply/undo 的数组项补全清单对象字段与必需 id/action，明确 ID 字符串不合法；
  两个回归测试先复现错误接受，再通过。保留执行层 SAF/动作白名单和逐操作授权检查。
- 清单 schema 修复后类型、相关 **47 测试**、Android 能力边界/工具政策、完整 Jest
  **213 套件 / 1,644 测试**通过；构建 **749 tasks / 2m 13s**，1,482 个输入核对通过。
  最新 APK：`C:\Users\barna\AppData\Local\Temp\islemind-continuation-01a0ed4c\operation-schema\IsleMind-milestoneqa-operation-schema-arm64.apk`，
  SHA-256 `56957e71156439882d870eac4a707ba13c5fa8d51c79d88471104b2ad59061e3`。
  仍为相同隔离测试身份、非 debuggable、arm64、targetSdk 36，严格 16 KB 和保留数据更新通过。

#### 双复制、部分进度重启与真实在途文本中断

- 最新 APK 的 `run-48798513-a8d5-4fc7-8313-2501f48e36d1` 完成扫描、两次预览及分别明确批准的
  两次复制。模型在**不同响应轮次**提出两个 apply，不把本例当成同一响应多写队列证明。
  A 完成、B 待确认时，实际目录中仅新增 A；force-stop 后打开相同运行，仍为
  **4 次模型请求 / 4 次工具 / 实际 10,019 Token**，B 保留原截止时间，未自动批准或重放 A。
- 核对完整清单后批准 B，最终 `QA_TWO_COPIES_OK`，**5 次模型请求 / 5 次工具 / 实际
  14,456 Token / 估算与预留均 0**。两条独立原生副作用回执均记录 47 字节、`created → copied`；
  ADB 逐字节比较 `seed.txt`、`qa-copy-a.txt`、`qa-copy-b.txt` 一致，三者 SHA-256 均为
  `7e19b05783e99f4e71dd0a7b0e0aa8e5d681c1975099ce7411afdb0ceb883664`。
  文件仅位于 `/sdcard/Documents/IsleMind-QA-20260930`，没有删除、移动或覆盖。
  完成后再次 force-stop/restart，状态、回执和预算保持。合成文件和目录 grant 保留。
- 恢复步骤上限后，字号 **1.0**、无障碍开关 **0**、IME
  `com.tencent.wetype/.plugin.hld.WxHldService` 读回不变；未清除应用数据。
- 纯文本运行 `run-0c0d5a72-6e7b-4978-b181-29dd1c9c6fe7` 于 **2026-09-30 11:27:09 +08:00**
  被观察为“执行中”、**1 请求 / 0 工具 / 4,287 Token 预留**后立即 force-stop，事前没有暂停或后台切换。
  随后确认进程不存在；冷启动同一运行显示“已暂停 / 进程曾被终止”，请求和预留不变，空闲再次读取也未新增请求。
  这才是在途进程死亡验证，不沿用先暂停再重启的证据。
- 显式追加缩短任务的指令后仍暂停；点击“继续此运行”才完成 `QA_INFLIGHT_RESUMED_OK`。
  **2 请求 / 0 工具 / 实际 163 / 估算 0 / 预留 4,287 / 合计占用 4,450 Token**。
  原请求没有收到最终 usage，按既有策略保守保留预留，未冒充实际消耗、重复结算或退款；
  不能据本机进程停止推断供应商停止计费。完成后再次冷启动，相同输出与上述账目保持。
  此例不证明在途文件写入恢复。
- 双项目录提议 `run-2a34cfc6-ae6f-4a04-9ebf-0b16c69082d2` 自然等待超过 **15 分钟**，
  未更改系统时钟、未提前批准；期间经历上述进程重启，原截止时间 **11:33:40 +08:00** 不变。
  过期后界面显示“授权已过期”及“交回 Agent（不执行）”，无可执行批准按钮。
  点击交回后首项 `confirmation_expired`、次项 `batch_stopped`，最终 `QA_EXPIRY_CHECK_DONE`。
  **2 次模型请求 / 0 次工具 / 实际 2,620 Token / 估算与预留均 0**，未打开系统选择器。
- 随后 `run-c0222edd-dd05-4909-b114-8e6f5f2710f0` 真正验证了**同一响应两个 apply 调用**：
  先同轮取得两个预览，再同轮提出分别包含完整清单的两次复制；界面为“第 1 / 2 项”。
  仅批准 C 后，实际生成 `qa-batch-c.txt`，D 尚不存在；此时 **2 请求 / 3 工具 / 实际 5,004 Token**。
  force-stop/restart 后仍是相同计数、“第 2 / 2 项”及原截止时间 **11:53:24 +08:00**，
  C 没有重放、D 没有自动批准。再次核对 D 的完整源/目标清单并仅批准一次，最终
  `QA_SAME_RESPONSE_COPIES_OK`，**3 请求 / 4 工具 / 实际 9,349 Token / 估算与预留均 0**。
  两份端侧回执分别记录 C/D、47 字节、`created → copied`；两个真实文件逐字节等于 seed，
  哈希与上文一致。完成后再次冷启动，状态与预算保持。
  本例通过设置页临时将步骤上限 **3 → 4**，结束后已恢复并读回 **3**，未改动限制逻辑。
- 上述前后状态、文件比较与截图保存在
  `C:\Users\barna\AppData\Local\Temp\islemind-continuation-01a0ed4c\operation-schema`。

### 2026-09-29 接续：移除产品路由中的合成取证入口

- 本节后续完整复核：当前源码 **210 套件 / 1,625 项 Jest**、**12 文件 / 91 项真实 SQLite**
  和双渠道 Expo manifest introspection 通过。与前次最终输入快照相比，**1,481 个当前输入**
  仅少了下述合成路由；配套 UI 内容没有变化，但仍不是干净的固定提交。
- 只读查询确认获授权设备 `dadaa813` 在线，字号为 **1.0**、无障碍总开关为 **0**；
  未据此宣称新增 Android 功能或性能验收。举报容器仍为 **Exited (0)**，未擅自启动。
- 临时 `app/qa-agent-states.tsx` 已移出 Expo Router 的 `app` 目录，原字节保留在本机
  `tmp/agent-ui/qa-agent-states.tsx.evidence`，SHA-256 为
  `0ad2c21713988b96d52273ef3cd0878d1c8cf60255063c2ccec2f74f71652afb`。
  这是取证文件保留位置，不是发布输入；正式 `/agent` 和 `/settings/agents` 路由不变。
- 移出后应用类型检查通过；真实 SQLite 的 Harness 生命周期、共享预算和逐操作副作用
  三个文件合计 **41 项**通过。这不替代真机进程中断或真实模型验收。
- 禁用 dotenv 加载后的 Web production export 通过；检查全部 **34 个 JS 输出文件**，
  合成路由名、合成 run ID 和样例扫描回执均不存在，正式 Agent 列表、运行详情及定义设置路由模块保留。
  这是构建及路由打包检查，不是浏览器交互验收。日志及路由检查收据保存在本机临时目录
  `islemind-continuation-01a0ed4c`。指南 **12 章 × 3 语言**及 UI 集成 **15 项**通过；
  真实配套 pin 仍因本地改动被守卫拒绝，没有放宽校验。
- 同一 production export 经本机 loopback 服务实测：390×844 下 `/agent` 正常显示无运行，
  `/settings/agents` 可打开/关闭手册并把焦点还给“查看使用说明”，两个页面均无横向溢出。
  本轮未配置供应商或执行模型。取证工具拒绝读取其允许目录之外的旧 JSON 夹具，未绕过限制，
  因此不宣称本轮完成导入/持久化回归；先前的导入证据仍按其原始范围保留。测试服务已停止。
- 下方 APK 是移出之前的历史测试包，仍含合成路由，不是当前源码的最终候选。
  需要在配套 UI 固定输入明确后重新构建并验收；不改写旧构建收据来冒充当前制品。

### 2026-09-29 先前续作：安装修复与真实页面验收（尚未完成全部里程碑）

本节取代下方历史记录中“共享 RN 补丁仍失败”和“媒体修正未进入设备 APK”的当前状态描述；
不把已经执行的局部验证扩大为真实模型、全设备或发布验收。

- 当前应用类型、**209 套件 / 1,608 项 Jest**、**12 文件 / 91 项真实 SQLite**通过。
  Provider、架构依赖/边界/合同、权限、安全、预算、工作流、Harness 取消、指南与原生插件 host
  检查通过。源码稳定性专项使用 Jest 为 **13 项**通过；曾误用 Node runner 的失败日志保留。
  指南与真实 loopback 举报服务的 Node 测试合计 **21 项**通过，不是公网或模型验收。
- **共享 RN 安装已修复**：先将仓库中既有 RN 0.86.3 补丁应用到临时副本，确认 8 个输出文件
  与下述已构建隔离安装逐字节一致，再以独立文件替换共享安装的对应文件。原文件有 Bun 缓存
  硬链接，未原地截断/改写缓存；原字节和前后哈希留存。没有安装升级、改写 lockfile 或覆盖 UI 源码。
  修复后的共享双渠道 Expo introspection、Doctor **21/21**通过；隔离 UI 原始源码类型也通过。
- 复用 `G:\tmp\im-milestone-cK2grc` 基底，仅同步 8 个后续媒体/预算源码与测试输入。
  当前 arm64 增量构建 **743 tasks / 4m 22s**通过；构建前后 **1,482 个配套输入**一致，
  与主工作区只差明确的 QA 包名/scheme 覆盖。签名与之前生成的 Android Debug 测试身份一致，
  非 debuggable、targetSdk 36，严格 16 KB ZIP/ELF 检查通过。未使用生产签名。
- 用户再次明确授权 `dadaa813`。独立包更新安装、启动通过；实际系统文件选择器导入合成定义，
  编辑形成未保存草稿，200% 字号横屏→竖屏及同进程后台返回保留输入；显式保存后 force-stop
  并冷启动仍能读到相同本地定义 ID 和编辑值。没有配置测试模型或授予工具权限。
  这是定义持久化验证，不是未保存草稿的进程死亡恢复，也不是完整 Agent 执行。
- TalkBack **12.0.0** 实际绑定；键盘 Tab/Enter/Back 打开并关闭手册，绿色焦点框返回
  “查看使用说明”。启用期间没有运行 UIAutomator。没有认证触摸手势或 TTS 听读。
  字号、自动旋转、user rotation、无障碍开关/服务列表均已回读确认恢复原值；未清除数据。
- Web 在实际 `/settings/agents` 完成合成定义导入、编辑、保存及页面 reload 后重新读取，
  确认自定义请求数 **2**、Token 上限 **2,048** 和指令保持。390×844、844×390 无页面横向溢出，
  打开/关闭手册保留草稿并返回 Help 焦点；实际 `/agent` 显示无运行，没有把导入当成执行。
  浏览器 reload 不是长期 OPFS 或浏览器进程重启持久性证明。
- 原外部阻塞审计会在指定设备不可用时退到另一台设备，现要求显式 `--device` 或
  `QA_DEVICE_SERIAL`，未授权、离线、歧义及 ADB 失败均不生成新证据；支持 `--adb` 固定可执行路径
  和 `--output` 隔离证据。此审计只做查询，不安装、改设置、授予权限或执行工具。
  调用示例：`node scripts/android-external-blocker-audit.js --device <获授权序列号> --adb <adb绝对路径> --output <证据JSON绝对路径>`。
  其他旧 collector 的默认设备/包名不能作为授权；运行前仍须逐个核对，不批量执行。

当前测试 APK：`C:\Users\barna\AppData\Local\Temp\islemind-milestones-eb97b8ff\IsleMind-milestoneqa-media-arm64.apk`。
SHA-256：`f36c23d46f5acea815aafc8a91cc423575cc5e95146cfa6610d7d88483866aa5`。
该目录保存输入、构建、签名、测试日志、RN 修复收据、设备截图和设置恢复记录；Web 截图位于
Playwright output 的 `islemind-agent-persisted-eb97b8ff.png`。正式 `com.islemind.app` 未覆盖，QA 包与合成数据保留。

**仍未完成，不能标记整体通过：**

- 配套 UI 精确提交 pin 仍被其未提交修改阻断；内容收据不等于可从远程重建的干净提交。
  保留现有暂存/未暂存改动，没有提交、推送或重置。当时的 `app/qa-agent-states.tsx` 为临时合成路由，
  不用于本节真实页面验收；现已按上节移出，不能作为产品执行证据。
- PDF 缺少可信计量而拒绝；WAV 仅为既有窄范围估算，未知/压缩格式与远程引用仍拒绝。
  尚未接入共享根预算的辅助模型路径继续本地降级，不宣称全部模型路径已可计量运行。
- 用户稍后提供获授权的模型配置；尚无本轮真实模型、端侧多工具批准/过期/暂停恢复取消、
  逐操作文件副作用回执及进程中断权限/预算恢复的完整端到端验收。
- 没有跨机型、长时后台、内存、功耗或高刷性能验收。此次设备接 AC 电，不据短时页面测试推断耗电。
- 公网举报端点、运营身份、政策及实际审核处置未提供；生产签名、正式 AAB/APK 与商店发布均未授权。
  本地服务合成测试不替代 Play 安全/隐私申报。当前无会话读取/归档工具，不自动归档。

### 2026-09-29 先前获授权的隔离 Android 与 Web 回归（历史记录）

- 本轮修改前应用和 UI 原始源码类型检查通过，Jest 全集 **208 套件 / 1,585 测试**、真实 SQLite
  **12 文件 / 90 测试**通过；Provider、架构、指南、预算、Harness/工作流及原生插件 host 检查通过。
  以下偏好布局修复后应用类型与相关 Jest **3 套件 / 14 测试**通过，不把修改前全集称作最终全集。
- `google-play-config-tests.js` 的真实 Expo introspection 现使用空的临时项目，避免已有 Play
  prebuild Manifest 污染 GitHub 渠道权限检查。隔离安装的双渠道检查通过；共享安装仍因缺少 RN
  字号补丁被守卫拒绝，没有豁免断言或覆盖共享依赖。
- 用户授权设备 `dadaa813`（M2007J3SC / API 31）安装、启动独立包并临时调整字号、旋转、TalkBack。
  正式 `com.islemind.app` 未覆盖，未清数据。测试完成已回读确认恢复原始字号 **1.0**、自动旋转 **1**、
  user rotation **0**、无障碍开关 **0**及空的服务列表。QA 包和合成测试数据保留。
- 真机发现 **200% 字号横屏右栏裁切**：按 window 宽度计算断点忽略了 safe area、padding 和父容器
  maxWidth。偏好页现按根内容 `onLayout` 实测宽度切换双栏/单栏；未测量前单栏，不重挂载编辑器。
  最终包横屏 200% 为可滚动单栏，已建立的未保存合成草稿在手册开关、旋转及同进程后台返回中保留。
  动态 100% ↔ 200% 的手册文本确实放大，关闭手册后输入未聚焦且 IME 未打开。
- TalkBack **12.0.0** 已实际绑定并启用触摸探索。纯 ADB 键盘 Tab/Enter/Back 与截图验证进入 Help、
  打开/关闭手册后绿色焦点框回到“查看使用说明”；没有用会干扰服务的 UIAutomator dump 认证焦点。
  **未验收**完整触摸手势、TTS 听读、全应用无障碍、进程死亡恢复或 iOS。
- Web 实际查看浅色确认/过期、深色恢复及偏好页：390×844 为单栏，872×393 的实测内容宽度
  836 为双栏，无页面/控件横向溢出；草稿及关闭手册返回 Help 焦点保留。Agent 页面仍是合成状态，
  不是真实模型、多工具执行或副作用成功的证据。截图位于本机 Playwright output 的
  `islemind-agent-*-20260929.png`、`islemind-settings-*-20260929.png`。

本轮最终设备 APK：`C:\Users\barna\AppData\Local\Temp\islemind-acceptance-682d59d9\IsleMind-milestoneqa-settings-reflow-arm64.apk`，
SHA-256：`9b7b3da0bde9216817faf17d9f71fcc6ad1489f6e746773832564ae43bef38c9`。
包名 `com.islemind.app.milestoneqa`、版本 `1.1.2` / `127`、arm64、targetSdk 36、release 非 debuggable，
**仅 Android Debug 测试签名**。使用下节完整源码重编的基底，纳入最终授权复核与布局修复后增量构建
**743 tasks / 2m 31s**通过；28 个原生库与源码重编基底哈希一致，严格 16 KB ZIP/ELF 检查通过。
构建前后核对 **1,480 个配套输入**，只有显式 QA 包名/scheme 的 `app.json` 覆盖不同。
首轮误漏自定义 ABI 参数而尝试 x86_64 的失败日志也保留；成功构建同时指定
`reactNativeArchitectures=arm64-v8a`、`islemindAbiFilters=arm64-v8a`、`islemindEnableAbiSplits=false`。

同一临时证据目录保存构建、签名、输入收据、Android 截图和系统设置恢复记录。这不是发布制品；
共享 RN 安装、脏 UI 精确 pin、QA route 清理、真实模型及完整 Agent 端到端、跨机型长时后台/内存/功耗、
高刷性能及运营/发布仍未完成。设备接 AC 电的短时测试不构成功耗验收，单次启动时间也不是启动 p95。

#### 2026-09-29 后续媒体/共享预算修正（host 范围，未纳入上方设备 APK）

- 最终请求门禁新增指定 Google Gemini 模型的内联 `audio/wav` 估算，只接受经实际字节校验的
  16-bit PCM 单/双声道、常见采样率、**8 MiB / 5 分钟**以内文件。严格核对 Base64、RIFF 长度、
  chunk 边界、byte rate 和帧对齐；不解码/复制整个二进制，不信任调用方 duration 元数据。
  按官方 32 token/秒规则向上取整并增加 framing 余量，进入既有上下文与实际尝试预算；不是精确账单。
  压缩/扩展格式、歧义容器、远程引用、未知模型仍拒绝，**PDF 计量尚未实现**。
  未新增文件选择入口/录音编码器，也未把 WAV 支持写成 M4A/MP3/全音频支持。
- 复现并修复服务商返回偏小 `totalTokens` 时少计预算：完整消耗不小于输入加输出，仍不重复加算
  cache/reasoning 子计数；重开 SQLite 后子任务也不能利用错误总计绕过根预算。
- 相关 **4 套件 / 88 Jest 测试**及 **4 项真实 SQLite 测试**通过。覆盖实际附件序列化、
  校验→实际尝试归因→传输顺序、预算拒绝零发送、畸形音频零归因/零发送，以及合成 Google
  usage 的真实响应解析和结算。类型检查通过，没有调用真实模型或提交音频。
- 这些新增源码晚于上方 Android APK，不能将旧包的设备证据作为新媒体/预算代码的原生验收。
  预运行模型摘要、embedding/FLARE 等尚未接入根预算的辅助路径继续使用原有本地降级；
  真实模型/费用、跨机型长时后台/功耗和完整 Agent 设备链路仍未验收。
- 后续当前源码全集重跑：**209 套件 / 1,608 Jest 测试**、**12 文件 / 91 SQLite 测试**通过；
  应用类型、Provider 全集、预算治理、架构依赖/边界/合同与指南 **10 测试**通过。
  全集检查前后 **1,482 个配套输入内容无变化**，不是将共享 UI 工作树声明为干净或发布冻结。
  `final-jest.log`、`final-sqlite.log`、`final-host-inputs-before/after.json` 及各 gate 日志在上述临时目录。
  Web 页面与本轮专用 Metro 服务已关闭，没有终止其他会话进程。

### 2026-09-28 源码复核（历史记录，不是平台完成或发布认证）

- 主工作区类型检查通过；确认类型修正后的 Jest 全集 **208 套件 / 1,580 测试**通过，真实 SQLite
  **12 文件 / 90 测试**通过。发布输入专项 **13 测试**通过；不把专项与全集相加。
- Provider 全集、含类型的架构依赖（无环）、架构边界 **14/14**、模块边界
  **814 文件 / 0 问题**、架构合同、指南 **12 章 × 3 语言**及指南/举报服务合计 **21 测试**通过。
  举报 transport 为合成 loopback 验证，没有提交真实内容或接通公网服务。
- 权限、安全、预算治理、隐私保留、Tasks、walking skeleton、Rich 取消方向和工作流回归通过。
  旧 evidence-first 测试曾错误期待“有证据即可自动写入”；现验证读写/破坏性操作必须明确确认，
  确认和证据不能越过禁用策略。工作流 host 测试隔离未被使用的原生默认装配，误调用该装配仍直接失败；
  没有放宽生产权限规则或用原生空实现冒充设备证据。进一步回归发现真值型非布尔输入会误作确认，
  已把策略、任务确认、授权匹配及审计字段统一为严格布尔判断；数字、字符串和对象均不触发
  要求确认的读取或写入。新增测试先复现实际 host 执行，再验证未调度与持久等待确认状态；
  相关 Harness→Tasks→Android port 的 **18 项 host 测试**通过，不宣称远程可利用性或原生端到端验收。
- 发布输入收据现同时覆盖应用 `tsconfig.json`、指南生成器及 Markdown/SVG 源、UI 的
  `tsconfig.json` / `tsconfig.build.json` / `babel.config.js`。新增、修改、删除均使旧收据失效；
  不采集 `.env` 或 UI 生成的 `dist`。原发布加固 **38** 个 host 构建情景和发布 readiness 回归通过。
- Android 字号、焦点、高刷、状态通知、能力边界及设备工具插件的 host 检查通过；
  文件插件的当前 Kotlin 源用缓存编译器实际编译，JVM 执行容量、重复请求、取消、截止时间、
  副作用和复制/返回值上限、I/O 失败检查通过。JVM 不等于 Android DocumentsProvider 实际运行。
- 当前组件在 **390×844** Web 实际渲染：液态玻璃浅色确认/过期、深色恢复状态无横向溢出，
  过期状态没有批准/恢复按钮；回执保留部分写入与未知副作用警告。使用既有合成 QA route，
  不代表真实模型或完整任务端到端执行。截图在本机 Playwright output 的 `islemind-agent-*-20260928.png`。

本轮确认的未完成条件：

- **共享安装的 RN 字号补丁守卫仍失败**，不能把 host 插件通过当作共享原生安装已集成。
  新隔离副本 `G:\tmp\im-milestone-cK2grc` 冷安装、类型、真实双渠道 Expo introspection、Doctor **21/21**
  和 prebuild 已通过；当前源码的独立 QA 原生集成结果见下，不据此改写共享安装或认证设备行为。
- UI 仍在已固定的 RN HEAD，但当前另有 **50 文件的已暂存改动**，精确 pin 检查按设计拒绝；
  未重置、清理、提交这些改动。旧记录中的“干净 HEAD”不是当前工作树状态。
- `app/qa-agent-states.tsx` 是现有临时合成取证页面，不是生产功能；最终发布候选须先处理这类 QA 路由，
  不能把展示的合成成功回执当成真实任务结果。
- 真实模型/媒体验证等待测试供应商及费用上限；不能以合成响应认证 PDF/音频计量或真实模型工作流。
  设备安装、字号/旋转/TalkBack、后台、跨机型、长期内存功耗及高刷实测尚须对应证据，不能由本节放行。

#### 本轮独立 QA 原生集成制品

- 首轮离线构建因缺少 Boost 等源码归档而失败；只复制此前同一已补丁 RN 构建使用的 6 个归档，
  校验副本 SHA-256、保留失败日志后续建。没有升级依赖、改用未补丁 AAR 或绕过下载任务。
- 完整 arm64 源码集成 **803 tasks / 38m 50s** 成功，不包含首轮失败的 **4m 40s**。
  随后在该副本纳入当前严格确认修正，构建前后核验输入，增量构建 **803 tasks / 3m 18s** 成功。
  当前最终 APK 的 28 个原生库与完整重编基底逐一哈希相同，JS 则包含后续修正。
- APK 为 `com.islemind.app.milestoneqa`、`1.1.2` / `127`、arm64-v8a、targetSdk 36，
  release 模式且非 debuggable，**仅生成的 Android Debug 测试签名**；不是生产签名或商店制品。
  严格 16 KB ZIP/ELF LOAD 检查通过，没有内置模型、没有启用举报端点，渠道隔离为 `google-play`。
  Expo 内嵌的空举报配置实际序列化为 `{}`，不是原始 JS 中的 `null`；未配置任何运营字段。
- APK：`G:\tmp\im-milestone-cK2grc\IsleMind-1.1.2-milestoneqa-arm64-v8a.apk`。
  SHA-256：`8ea4d55532fa3a58964bb10d636b138a24cc8f3b2a6bb92baa81a96aaca19801`。
  同目录保存配套输入、QA 包名覆盖、源码增量、构建日志、source sidecar、签名及 `final-apk-validation.json`。
- **截至 2026-09-28 未安装、未启动此包**；后续获授权安装的是上方 2026-09-29 新制品。
  当时已读取用户指定的 `dadaa813` 基本配置，独立包安装及临时设置确认尚待回复。
  没有覆盖 `com.islemind.app`、清除应用数据、改变系统字号/旋转/TalkBack 或调用模型。

## 本地准备状态（2026-09-24 历史记录；当前复核见下）

已补齐 Expo SDK 57 要求的 6 个补丁版本，并更新 Bun lockfile。React、React Native、SVG
通过应用根目录的 overrides 固定；postinstall 在 UI 声明构建前把相邻 RN workspace 的
这 3 个生成依赖入口链接到宿主安装，避免 Metro 使用宿主、原生 autolinking 却发现另一版本。
不会改写 UI 的 package.json，也不会关闭 Doctor 的重复依赖检查。

相邻 `animal-island-ui` 的 ref、Input 事件与原生宽度类型已兼容宿主 RN 0.86.3；
Jest preset 随实际安装的 RN 版本选择。这些是与应用配套的源码修改，构建副本必须包含它们。
在两个仓库的对应修改被正常保存并提供给构建环境前，不要用远程 UI 分支的旧源码代替；
云构建前应通过 `ANIMAL_ISLAND_UI_REF` 固定包含这些修正的完整提交 SHA。

2026-09-24 直接执行的历史证据（不自动适用于后续源码）：

- Bun frozen-lockfile 安装、postinstall 和 UI 声明构建通过。
- Expo Doctor **21/21** 通过；应用 TypeScript 检查通过。
- Play/GitHub 配置与真实 Expo manifest introspection 通过。
- 更新服务／更新设置页 **12** 个测试、UI 集成 **14** 项检查通过。
- UI 受影响组件 **9** 个套件、**234** 个测试通过（宿主 RN 0.86.3）。
- Android 工具链测试、发布加固 host 测试与依赖安全回归通过。
- 架构依赖门禁通过（含 type-only imports，无环）。
- `ISLEMIND_DISTRIBUTION=google-play`、`EXPO_NO_DOTENV=1` 下 Android production
  Hermes bundle 导出通过（3,679 个模块）；导出文件位于系统临时目录，没有覆盖 `android/`。

以上不等于签名 AAB、最终 manifest、16 KB 原生兼容、设备/Play 安装或政策审核已通过。
工作区另有并行的运行时修改，当前不是已冻结、已签名的发布候选。
下面的提交前阻塞项仍然有效，尤其是尚未接通真实运营端的应用内举报链路。

### 2026-09-26 复核记录（非最终候选认证）

- 应用类型检查、完整 `provider-intelligence-tests.js` 及真实 SQLite 的 **11 文件 / 78 测试**通过。
  先前 `actual-execution-target` 的 `invalid_capacity` 失败已不再复现；不再把它列为当前阻塞。
- 相关 Jest **16 套件 / 201 测试**通过，覆盖 Harness 预算/执行资源、执行宿主、容量门禁、
  Android 计时/执行桥、设置草稿/指南/布局和更新隔离。这些是 host 测试，不是 TalkBack 或设备验收。
  并行运行时改动后的复跑另有 Assistant/Tasks/Documents/Knowledge **18 套件 / 135 测试**通过；
  两组覆盖有重叠，不应相加当作独立测试总数。
- 架构依赖（含类型、无环）、**14/14** 架构边界及架构运行时合同通过。
  模块边界曾在 **794 文件**中发现 2 个跨模块深层导入；后续已改用合法入口。
  **2026-09-27 最新复跑为 814 文件 / 0 问题**，未豁免边界规则。
  离线指南 **12 章 × 3 语言**一致，指南 **10** 项测试通过。
- 字号、无障碍焦点、Agent 执行、状态通知、高刷插件与工具链的 host 检查通过；
  Harness/Rich 取消方向、工具权限、安全策略、预算治理及发布加固检查通过。
  Provider 传输测试补齐了新增计时模块所需的路径别名解析，实际 loopback HTTP 测试验证
  跨源重定向不携带请求体/合成凭据、响应后的取消与超时；没有替换真实计时实现或放宽断言。
- 发布 readiness 的旧断言仍查找已移除的 Settings overview 实现；已改为验证实际的
  `SettingsNavigationContent` 委托，以及返回聊天、标题和可编辑搜索，完整检查重跑通过。
- **共享安装仍未集成字号补丁**：真实 Expo introspection 在 RN 补丁守卫处失败。
  `LayoutMetrics` / `RootShadowNode` 缺少必需变更，`SurfaceHandler` 仍有被替代实现。
  不能跳过守卫、只凭插件测试通过或重用旧 AAR 宣称集成完成；应在隔离副本完成安装与原生构建。
- **隔离冷安装已通过**：全新目录、无旧 `node_modules` / `dist`，执行 Bun
  `--no-env-file install --offline --frozen-lockfile --backend copyfile`，UI prepare 和宿主 postinstall
  均通过，lockfile 内容未改变。随后真实 Play/GitHub Expo introspection、UI 接入 **15** 项、
  Doctor **21/21** 及 UI 受影响组件与几何测试 **12 套件 / 312 测试**通过。
  两个 workspace 的 RN 入口实际指向该副本的同一份已补丁 RN，不链接共享开发安装。
  此结果验证安装、配置和 host 组件，不等于 C++/Kotlin 原生编译或设备运行通过。

以上不包含真实模型调用、最终原生包、草稿/旋转/TalkBack 设备回归、后台/跨机型/长时功耗、
正式签名或 Play 安装。没有执行提交、推送、Actions、发布或生产签名。
期间检测到 Tasks/MCP/模型操作的并行源码变化，最新一轮验证窗口内 `package.json` 也增加了
SQLite 测试入口；因此上述结果不是“共享工作树已经冻结”的声明。合并验收须在所有者确认边界后，
对最终配套输入重新执行相关门禁。短暂出现的输出类型收窄错误在后续类型复跑中已消失，未由本轮改写运行时。

### 2026-09-27 当前源码 host 回归（非最终候选认证）

- 当前 Jest 全集以 `--runInBand --silent` 执行，**208 套件 / 1,562 测试**通过；应用类型检查通过。
- 完整 Provider 回归、含类型依赖的无环检查、架构边界 **14/14** 与模块边界 **814 文件 / 0 问题**通过。
- 其中最终容量门禁两套件 **60 测试**覆盖实际附件序列化与 HTTP/WebSocket 拒绝路径。
  修复 Google snake_case、OpenAI Chat `file`、Perplexity `file_url` 漏检；未计量 PDF 在网络、
  执行归因、预算结算和压缩之前拒绝。媒体仍受既有 JSON 大小/结构守卫约束，Base64 不当作自然语言 token。
  这不是启用 PDF/音频计量，也不证明真实模型费用或上下文上界。
- 本机 Docker 举报接收服务在首次部署及恢复演练时为 healthy，仍仅监听 loopback；没有开启公网
  Tunnel 或应用真实发送。**同日晚间复查 Docker 引擎已停止**；启动报 Secrets Engine 残留 socket
  无法访问，当前接收服务不可用。未重置凭据、删除数据卷或恢复出厂设置；须先由主机恢复引擎，
  再核对原容器/卷和健康状态，不能把早先 healthy 当作持续可用证据。
  部署、运营和公网前置条件见 [内容举报服务](./content-reporting.md)。

以上不替代最终配套源码冻结、原生构建、真机/跨机型、长时后台/功耗和商店验收。

### 2026-09-27 当前集成制品（仅未签名 QA）

本次使用独立内容副本：应用 HEAD `d13e747507c92285d9cca5b37978eeb900d40634` 加当前未提交
应用改动，UI 使用固定提交 `122151919fcf4f29a6dd4d77ed674c2dcd67a2cc` 的 Git archive。
应用文件集合及内容经过复制前后校验；构建前后再绑定源码哈希和制品，不复用共享依赖或旧原生工程。
UI 工作区后续暂存的 Web Upload、文档、LICENSE 等改动不在此候选中，也未被撤销或提交。

- 全新私有 Bun frozen-lockfile 安装、应用类型检查、Android prebuild 通过。
  Expo Doctor **21/21** 通过；prebuild 后最初的 non-CNG 警告来自副本缺少仓库 `.gitignore`，
  补齐同一文件后通过，没有关闭检查。React/RN/SVG/ONNX 均解析到副本内。
- RN 字号补丁及其原生消费者完成 arm64 源码编译。首轮在 RN 阶段完成后进程中断，没有完成制品；
  确认进程已不存在、源码未变后从同一私有构建目录增量续建，Gradle **808 tasks / 26m 10s** 成功。
  这段时长不包含首轮编译；没有把旧 Expo 版本的 QA 底包当作当前集成结果。
- 未签名 `no-model` APK 的严格 **16 KB ZIP / ELF LOAD** 检查通过。实际包为
  `com.islemind.app`、`1.1.2` / `127`、arm64-v8a、targetSdk **36**，非 debuggable；
  合并后的权限不含外部 APK 安装、悬浮窗及配置中阻断的共享存储/媒体读取权限。
- 同源 `bundleRelease` **750 tasks / 5m 48s** 成功，未签名 AAB 通过 bundletool **1.18.3**
  `validate`。包内配置为 `PAGE_ALIGNMENT_16K`；28 个 `.so` 和 Hermes bundle 均与上述 APK
  内容哈希相同，未包含模型文件。JAR/APK 签名检查确认未签名，不是可提交 Play 的正式包。

仓库外证据目录：`G:\tmp\im-integrated-2e32f937`，包括源输入清单、构建日志、APK source sidecar、
`apk-manifest-check.json` 和 `aab-validation-result.json`。制品 SHA-256：

| 制品 | SHA-256 |
| --- | --- |
| `IsleMind-1.1.2-android-release-unsigned-no-model-arm64-v8a.apk` | `d053cf82a11f76ebcb8e5748f9b68b80093d9495fdc349f1d1d22a34cbfc4d3f` |
| `IsleMind-1.1.2-android-release-unsigned-no-model-arm64-v8a.aab` | `280c22e095d40ac42d05e85629a618d341f57ae5f9319c5c9d5bc275de641e60` |

未安装这些制品，也未上传 Play。R8/resource shrinking 仍按当前默认关闭；未使用生产签名。
上述结果不证明当前集成版本的动态字号/举报/Agent 设备行为、16 KB 设备安装、跨 OEM、后台功耗、
实际模型费用或运营处置已通过；不能用 AAB 配置检查代替 Play 实际生成 APK 的安装验收。

### 配套构建输入与并发边界

后续当前工作区复核：IsleMind 已切换到 `main`，HEAD 为
`d13e747507c92285d9cca5b37978eeb900d40634`；此前 Harness/配套构建修改已进入提交。
UI 的 `rn` HEAD 为 `122151919fcf4f29a6dd4d77ed674c2dcd67a2cc`，首次 pin 检查时工作树干净，
该提交包含 RN 类型与 Jest preset 修正。只读 `git ls-remote` 已核对远端 `rn` 指向同一 SHA，
准备脚本已将其记录为 `pairedUiRevision` 默认值，真实已有 checkout 的 pin 检查与 UI 接入 15 项通过。
没有设置远程变量或触发云构建；这也不是包含后续举报与并行文件操作改动的最终 IsleMind 候选。
后续模块边界检查为 **808 文件 / 0 问题**，旧记录中的两个深层导入已不再出现；
期间仍有并行的文件操作/模型操作源码变化，不能视为最终冻结输入。

`prepare-animal-island-ui.js` 默认使用源码内已保存的配套 SHA；`ANIMAL_ISLAND_UI_REF` 可显式覆盖，
但必须是完整 SHA，分支名在 clone 前被拒绝。已有仓库的 HEAD 和干净状态都必须匹配，
不重置、不清理开发者改动。普通本地 postinstall 仍只链接运行时/构建声明，允许在已有 UI 上开发，
但不证明它是该 HEAD 的精确构建。四个 GitHub 工作流保留可选仓库变量覆盖；如果使用覆盖，
EAS 云环境也必须单独配置同名变量，不能假定 runner 环境自动传入云构建。
两处变量均未设置时使用同一源码默认值。**不要用旧 HEAD 冒充包含未提交修复的固定版本**。

本地隔离验证可使用同时包含两仓库未提交改动的内容哈希副本；复制前后校验文件集合和内容，
不复制 `.env`、签名材料、共享 `node_modules` 或旧 `android/`。内容副本不等于已提交的发布候选。
根 `package.json` 使用 Bun 1.4.2 的 `workspaces.selfContained`，让相邻 UI 在自身 `prepare`
期间就可解析完整依赖及 React 类型；Bun 会先执行 workspace prepare，再执行根 preinstall/postinstall，
仅靠根 postinstall 修复链接对冷安装太迟。之后仍由既有 postinstall 统一 React/RN/SVG 的实际入口。
不取消 UI prepare、不忽略类型错误、不修改上游 manifest，也不改变版本锁定。
`release:source-stability` 使用与制品收据相同的两仓库输入集合，保留每次采样发现的变更，
即使后续恢复原样也失败；采样间隙仍可能发生未观察到的变更，**通过不等于获得工作区锁**。
并行任务必须先划分源码/设备所有权，最终构建继续使用构建前后内容校验和制品绑定，不能只看时间戳。

## 动态字号修复的原生构建要求

设置页动态字号修复固定在 `patches/react-native@0.86.3.patch`，由 Bun
`patchedDependencies` 安装；没有升级 RN/Expo。它回移
[React Native #57246](https://github.com/facebook/react-native/pull/57246)
（`45904c866882f136edde55df2fe453327057d387`）并补齐字号变化时的根布局失效。
仅添加 manifest `fontScale` 或 Activity 回调不能修复旧的 Yoga 测量缓存。

- 在专用构建副本中执行 `bun install --frozen-lockfile`，再运行 Android prebuild 和完整原生构建。
  `plugins/android-font-scale` 检查 RN 版本及补丁，并将新旧 RN Maven 坐标都替换为源码工程。
  **首次集成不能复用未按此补丁重编的 AAR/APK、Expo Go 或仅更新 JS bundle**：补丁改变
  `LayoutMetrics` C++ ABI，RN、Reanimated、Worklets 等原生消费者必须使用同一份头文件重编译。
  已完整重编且验证同一补丁的原生 QA 底包，可用于之后仅修改 JS 的专项验证；不能据此认证其他原生改动。
- Gradle 启动 JDK 仍按既有工具链选择；RN 源码 Kotlin 编译另需 **JDK 17 toolchain**。
  离线构建前准备该 toolchain、NDK、CMake 和源码构建依赖缓存；不能靠换用 Maven RN 绕过缺失依赖。
  补丁默认 CMake **3.22.1**（可用 `CMAKE_VERSION` 显式指定已验证版本）。
  Hermes 仍使用 RN 自带 `sdks/hermes-engine/version.properties` 对应的已发布引擎，
  默认 Hermes V1 为 `250829098.0.17`，不单独升级或重编译引擎。
- RN CMake 编译/链接池默认各共用 **1** 个任务槽，避免 Ninja 忽略 Gradle worker 限制而耗尽内存。
  有足够物理内存时可用 `-PislemindNativeBuildJobs=N` 调整；仍建议 Gradle `--max-workers=1`
  和 `-Dorg.gradle.parallel=false`。PowerShell 中每个 Gradle 参数分别加引号。
- 共享头文件也影响 iOS。插件设置 `ios.buildReactNativeFromSource=true` 和
  `EXPO_USE_PRECOMPILED_MODULES=false`；不要用环境变量重新开启预编译 RN，或复用旧 Pods。
  Windows 上只验证了这些配置的生成，没有进行 iOS 构建/运行验证。
- 本次范围是离线、debug 签名的 Android 35 x86_64 隔离 QA：动态字号、指南返回、草稿及旋转。
  不替代 arm64、真机、16 KB 设备、正式签名或 Play 验收。升级 RN 时必须重新审查并移除已被上游
  覆盖的补丁/构建适配，重跑 `test:android-font-scale` 和同样的原生场景，不能只改版本守卫。

### 2026-09-27 原生专项结果

Android 35、x86_64、1080×2340 / 440 dpi、2 GiB 隔离模拟器（host GPU），无可用默认网络，
仅合成草稿；未连接实体设备、未清除用户应用数据、未调用模型。

- 在完整源码重编 RN 的 QA 底包上直接验证 100%↔200% 字号：冷启动参照及 5 次前台/后台动态切换
  的「Close guide」文字尺寸一致，导入草稿未丢失，键盘不意外弹出；横竖屏、继续编辑、确认丢弃及重新打开验证通过。
- 截图发现 200% 下导入来源按钮仍并排而截断。`ProviderImportModal` 现按 `width / fontScale`
  决定来源/底部操作的排列，不缩小或关闭系统字号；手机大字号时纵排，横屏有效宽度足够时恢复并排。
  组件 **5 项 Jest**（含动态字号、旋转及草稿保留回归）通过。
- 在隔离源码副本重新导出包含此修正的 Hermes bundle，并使用已重编底包重新 debug 签名，
  28 个原生 `.so` 的 SHA-256 均与底包一致。安装后重复上述原生检查通过，实际截图确认按钮文字完整可见。
- TalkBack 启用且触摸探索为 true；分别在 100%/200% 字号用系统注入触点打开指南、Tab/Enter 关闭，
  逐图检查绿色焦点从「Close guide」返回「Open user guide」，草稿保留且 `mInputShown=false`。
  初次脚本未实际打开指南的失败证据保留；处理系统提示、稳定布局后重新操作并核对截图，不以脚本退出码代替焦点检查。
  这验证了该流程的原生焦点恢复，不等于语音播报、真实手势、全部页面或 OEM 无障碍验收。
- 当前工作区类型检查和模块边界复跑通过。并行临时取证文件造成的较早类型错误，以及测试的深层导入问题，
  在后续工作区状态中已消失；没有删改这些文件或放宽检查来取得此结果。

专项 APK SHA-256：`dd62f09d9d6e43fd123e1fb503733e9e24f68587015f314d79348dc6c2cc94d3`。
本机证据位于 `G:\tmp\im-goal-font-01a0db9b\font-hostgpu-490432b5\reflow-runtime\evidence`，
包与输入记录在其父目录。测试完成已停止本轮模拟器及私有 ADB，保留此前失败证据。
该 QA 包基于已冻结的字号专项源码再加入导入布局修正，不包含其后所有 Harness/举报改动；
共享安装补丁、最终候选原生构建、arm64/16 KB、实体设备和 Play 验收仍不能由此放行。

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
  src/components/settings/SystemSettingsPanelContent.test.tsx
& $node scripts/isle-ui-upstream-sync-tests.js
& $node node_modules/expo-doctor/bin/expo-doctor.js
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
   从 IsleMind 根目录安装，让相邻 UI 使用同一套 React/RN/SVG；若之后在 UI 仓库独立安装依赖，
   回到应用根目录重新执行安装。不能只重跑 Metro 就认为原生依赖已经去重。
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

## 应用内内容举报：客户端协议与运营接入

已结束的助手消息 → 消息操作「更多」→「举报 AI 内容」。路由仅携带本地会话/消息 ID，
不把内容放入 URL。仅提取该消息的可见最终文本（不带隐藏思考、逐条活动或附件），
按已知凭据模式遮盖后截取最多 4,000 个 UTF-16 单元；用户可进一步删减并选择原因，
添加最多 1,000 个单元的说明。检测并不全面，界面要求用户自行检查敏感内容。
预览期间不发送；只有点击「确认并发送举报」才执行独立 HTTP 请求，不经过模型/Provider、
代理设置或其认证头。初次编辑、预览与发送分别是不同步骤。

### 构建配置（全部是公开信息，不是凭据）

- `ISLEMIND_REPORT_ENDPOINT`：运营者确认的 HTTPS POST 地址。
- `ISLEMIND_REPORT_OPERATOR`：与隐私政策一致的真实运营主体名称。
- `ISLEMIND_PRIVACY_POLICY_URL`：公开可访问的 HTTPS 隐私政策页面。

三项需一起提供；部分配置会在 Expo 配置阶段报错，全部缺失时 `extra.contentReporting=null`。
客户端还拒绝 URL 凭据、非 HTTPS、非默认端口、查询/片段、IP、本地/保留示例域名等。
这是 URL 语法门禁，**不是 DNS、域名所有权、政策有效性或运营者身份验证**。
不会根据 BYOK 设置、用户粘贴的 URL 或开发环境猜测接收端。Docker 本机服务已实现并以合成数据验证；
当前仍未配置真实公网 endpoint、运营主体或政策，应用发送仍保持禁用。

### 接收端合同（Docker 实现已提供，公网与运营仍待验收）

本机接收、持久化幂等、审核 CLI、基础限流和可选 Tunnel 配置见
[内容举报服务部署](./content-reporting.md)。管理仅通过受控本机 Docker 访问，不暴露 HTTP 管理面。

POST 的 JSON 仅有以下字段；不包含会话 ID、消息 ID、设备 ID、完整历史、API Key、
Provider 配置、工具日志或文件。网络接收方仍可见 IP 地址及标准请求元数据，不能宣称匿名传输。

| 字段 | 合同 |
| --- | --- |
| `schemaVersion` | `1` |
| `reportId` | 随机 UUID v4；同一预览的手动重试保持不变，同时发送为 `Idempotency-Key` |
| `appVersion` | 当前原生应用版本（Web 使用源码版本），不是安装/设备标识 |
| `reason` | `child_safety`、`hate_harassment`、`sexual_content`、`dangerous_content`、`privacy` 或 `other` |
| `excerpt` | 用户最终确认的非空摘录，最多 4,000 个 UTF-16 单元 |
| `note` | 用户确认的说明，最多 1,000 个 UTF-16 单元；未填为 `""` |

接收端应限制请求体（本协议可用 32 KiB 上限）、限制频率、验证字段并提供持久幂等接收；
同一 ID/相同请求重复到达不得重复建案，同一 ID/不同请求不得覆盖原举报。
只有确实接收成功才能返回 HTTP `200`、`201` 或 `202`、`Content-Type: application/json`
及 `{ "reportId": "原请求编号", "status": "received" }`。建议回复 `Cache-Control: no-store`；
Web 接入还需正确处理应用来源的 CORS 预检（`Content-Type`、`Idempotency-Key`），无需 Cookie。
不得通过 30x 跳转接收正文；客户端 `redirect:error`、`credentials:omit`，拒绝重定向和错误来源的响应。
客户端最多读取 4,096 字节确认体，整个请求/读取共用 15 秒截止；错误详情不展示服务端原文。

无自动重试、后台队列或本地举报草稿存储。后台、退出或「停止等待」会取消等待/请求，
但不能撤回服务端已收到的内容。失败后的手动重试重用同一 ID；返回编辑并重新预览生成新 ID。
客户端「已接收」只代表确认报文，不代表审核完成或已处置。
运营者仍需确认接收方/处理地区、访问控制、保留/删除周期、举报编号查询/删除渠道、
安全分级、审核与处置流程、失败监控和必要的升级处理；本文件不替其作出承诺。

### 已执行与未执行

- `test:content-reporting` 的本地合成 HTTP 测试覆盖最小正文、同编号重试、五种重定向隔离、
  确认体大小/编号/状态、取消、镜像截止触发及未配置/非法内容的零网络发送。
  截止测试实际触发已有 execution timer mirror；没有等待真实 15 秒，也不是 Android 后台计时验收。
- 相关 Jest 共 **4 套件 / 21 测试**覆盖策略、预览/确认、重试、重复点击、后台/卸载取消、
  消息来源隔离和菜单 memo；这是组件/host 验证，不是原生 TalkBack 验收。
- 当前应用 Web production 导出通过（3,237 模块），在 390×844 浏览器中实际查看了未配置的
  举报页面，未出现发送按钮、布局溢出或控制台错误；测试浏览器拦截所有非本地请求。
  此次浏览器检查不覆盖已配置表单的真实提交，亦不是 Android 设备截图。
- 应用类型和架构依赖门禁通过。网络边界登记了举报专属的 adapter 与 bootstrap 两个精确路径，
  不放行整个模块；扩展自测仍拒绝 UI/举报 application policy 中的网络调用。边界自测及 **14/14**
  正式边界检查通过。共享安装缺少字号补丁的历史限制没有被豁免；新私有安装的 prebuild、
  Doctor 和 arm64 集成构建现已通过，见上方当前集成制品记录。
- **未执行**真实举报、审核处置、真实政策可访问性、原生提交/无障碍和 Play 验收。
- 2026-09-27：Docker 本机服务实测非 root/只读 rootfs/loopback 端口、接收、重启后同 ID 幂等、
  本机审核、单案内容删除与旧请求不可复活；合成正文已删除，仅留随机编号占位。服务端 Node 测试
  覆盖 SQLite/HTTP 安全边界和生产客户端 adapter 的 loopback 联调；不代表公网/真实运营验收。

## 提交前阻塞项

| 项目 | 当前状态 / 放行条件 |
| --- | --- |
| 开发者身份 | 未准备。决定个人/组织，完成 Google Play Console 注册和身份核验；名称须与隐私政策一致。注册、付费与接受条款由账号持有人完成。 |
| 支持与隐私政策 | 未准备公开邮箱/URL。完成下方草稿，托管公开 HTTPS HTML（无需登录、无地域限制、非 PDF），在商店及应用内提供可访问入口。当前官网“数据边界”介绍不是完整隐私政策。 |
| AI 内容举报与安全措施 | 客户端及 Docker 本地持久接收/审核工具已实现；本地接收/备份恢复演练通过，2026-09-29 查询容器为 Exited (0)，未擅自启动。真实公网端点、运营主体、公开政策、留存规则与人工审核/处置闭环未就绪，当前构建仍禁用发送。本地合成测试不是运营验收；第三方/BYOK 模型也不能免除开发者责任。 |
| UI 与模型授权 | UI 上游 LICENSE 为 CC BY-NC 4.0；拟分发/商业用途授权未确认。免费上架不自动等于非商业使用；先确认许可范围，必要时取得授权。逐一核对模型、字体、图标及依赖署名；不在此认定侵权或自动替换 UI。 |
| Data safety | 需按真实网络行为及第三方接收方填写，不因为“本地优先”或“用户自己的 Key”就声明不收集数据。参见下表。 |
| 整体回归与配套输入 | 按上方最新分段记录核对源码、制品和测试范围；最新完整 Jest 为 213 套件 / 1,644 项，SQLite 本次复跑 12 文件 / 91 项通过。共享 RN 字号、媒体/预算、用量、Agent 启动、工具发现、系统选择器生命周期与文件清单 schema 修正已进入独立 QA APK。获授权 M2007J3SC 的有限字号/草稿/旋转/TalkBack 键盘、真实文本 Agent、同响应只读批量、拒绝/过期、同响应逐项批准双复制、部分进度重启、在途文本进程死亡及显式恢复预算持久性通过。在途文件写入、跨机型/长时、云构建及最终发布冻结仍待完成；脏 UI 精确 pin 未放行。 |
| 传输与备份 | 现有原生配置允许 cleartext、Android backup；需核对所有 provider/proxy/MCP/工具路径是否允许敏感数据经 HTTP 发送，以及 SQLite/文件备份范围。未确认前不能宣称所有数据传输加密、数据库加密或完全不离开设备。 |
| 前台服务 | 当前插件使用 `dataSync`，音频插件还有 `mediaPlayback`。核对实际用途、用户可见启停、后台时限，并按 Console 要求提供声明/演示；不得用不相符类型维持任意后台 Agent。 |
| 正式包与兼容性 | 当前未签名 arm64 APK/AAB 已构建并验证实际 targetSdk 36、权限过滤、APK 严格 16 KB 和 AAB 16 KB 配置；没有正式上传证书签名、Play 生成/安装或 16 KB 设备运行证据。R8/resource shrinking 尚未启用验收；不能沿用旧版“第三方限制”豁免说明，也不能把未签名 QA 包提交为正式发布。 |
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
| 内容举报 | 用户确认后发送单条摘录/原因/说明/应用版本/随机编号；Docker 本地服务持久化并提供人工审核与单案内容删除，尚未启用公网 | 确定接收主体、Cloudflare/本机处理地区、正文与编号占位留存时间、删除渠道及处理承诺后更新政策和申报 |

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

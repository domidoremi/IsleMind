# 内容举报接收服务：Docker 本机部署

服务源码在 `services/content-reporting/`，与设备端模块独立，不参与 Metro/native bundle。
使用 Node 24 内置 SQLite，无运行时 npm 依赖。客户端合同见 [Google Play 准备](./google-play.md#应用内内容举报客户端协议与运营接入)。
这份说明不是隐私政策或处置时限承诺；公网和商店接入须先完成下方运营条件。

## 本地启动

从仓库根目录执行（Windows 用 `NUL`，Linux/macOS 将它换成 `/dev/null`）：

```powershell
docker compose --env-file NUL -f services/content-reporting/compose.yaml up -d --build --wait
docker compose --env-file NUL -f services/content-reporting/compose.yaml ps
```

显式空 env 文件避免自动加载应用根目录的 `.env`。如需参数，可使用进程环境变量或仓库外专用配置。
独立 Compose project `islemind-reporting`；不复用/修改本机其他项目的容器、网络、数据库或 Tunnel。
只将 `127.0.0.1:8787` 映射到容器，不能从 LAN 直接访问。健康检查为 `GET /healthz`。
容器使用非 root、只读 rootfs、移除 capabilities、192 MiB 内存/0.5 CPU 上限，持久数据为
`islemind-reporting_reports-data` Docker volume 中的 `/data/reports.sqlite` 及 SQLite WAL。
镜像构建上下文 allowlist 不含应用 `.env`、聊天、密钥、Android 制品或其他文件。
服务没有 Cookie、用户注册或公网上的管理接口，不需要在应用里嵌入共享接收密钥。

停止但保留举报：`docker compose --env-file NUL -f services/content-reporting/compose.yaml stop`。
不要在升级/停止时使用 `down -v`、删除 volume 或清空 Docker 数据；它们会删除举报。
Docker Desktop 必须运行，本机断电、睡眠、磁盘满或断网会影响公网服务。

若 Docker CLI 连不上 `dockerDesktopLinuxEngine`，先检查引擎，而不是重建举报容器。
2026-09-27 晚间复查发现引擎已停止，重新启动在 Secrets Engine 的 `engine.sock` 处报
“The file cannot be accessed by the system”；这不是举报服务的 HTTP/SQLite 故障。
当时不能声称接收服务在线，需主机管理员恢复 Docker Desktop/WSL 后，核对原容器、volume 和
`/healthz`。不要用恢复出厂设置、删除数据卷、重置凭据或修改访问控制来换取健康状态。
先前接收和恢复演练的成功记录不证明此后持续可用。

2026-09-29 续作只读复核：Docker Engine **29.8.1** 已可访问，但原
`islemind-reporting-reports-1` 为 **Exited (0)**，没有运行中的同 project/service 容器。
这取代“当前引擎不可用”的旧状态，不代表举报服务已恢复；本轮未启动、重建、清空容器或卷，
未复用其他项目的 Tunnel/域名。当前源码的 11 项真实 SQLite/loopback 服务测试通过，
仍需获授权的端点、运营者及上线验证，不能把独立测试进程当作常驻接收服务。

## 接收语义与限制

- 仅 `POST /v1/reports` 接收严格的六字段 JSON，与客户端同 UUID 的 `Idempotency-Key` 必填。
- 32 KiB 请求体、8 KiB headers、5 秒读体截止、10 秒 HTTP 请求上限、128 个连接上限；拒绝压缩体、非法 UTF-8、非 JSON、错误字段、Cookie/Authorization。摘录/备注按 UTF-16 计量。
- SQLite `WAL` + `synchronous=FULL`；事务提交后才回复 `201 {reportId,status:"received"}`。
  相同 ID/相同六字段返回 `200`，不重复建案；同 ID/不同内容 `409`。确认仅代表接收，不代表审核完成。
- 全局每分钟最多 120 个举报路径请求（含预检/失败请求）；每小时最多 500 个新案，后者持久化跨重启。
  手动幂等重试不占新案额度，但仍受请求限流。`429` 时稍后手动重试，客户端不自动上传。
  不信任 `CF-Connecting-IP` / `X-Forwarded-For` 做鉴权或配额身份，也不落库保存 IP。
- 默认最多 10,000 条记录（含删除后的编号占位），满时新案返回 `503`，不会覆盖旧案。
  主数据库页数硬上限 131,072（默认 4 KiB 页约 512 MiB），WAL/卷/主机仍需磁盘监控。
  `REPORT_MAX_RECORDS`（1–100,000）、`REPORT_MAX_NEW_PER_HOUR`、`REPORT_REQUESTS_PER_MINUTE` 可显式配置。
- 不提供附件上传、任意转发、报告公开查询、HTML 渲染或政策占位页面；错误响应不回显正文/异常。
  服务日志仅启动/静态存储故障代码，不记录报告、IP、请求头/URL。Docker、Cloudflare 和主机仍有独立日志边界。
- 原生客户端不依赖 Origin。Web 默认关闭；`REPORT_WEB_ORIGINS` 是逗号分隔的精确 HTTPS origin allowlist，
  例如运营者实际 Web 应用的 origin（不含结尾斜线或路径）。绝不使用 `*` 或允许 Cookie。

这些限制是基础滥用防护，不保证阻止分布式攻击或恶意占满匿名队列。公网前还需边缘限流、存储/容量告警及人工值守。
不要通过浏览器验证码/交互式 Access 登录直接保护原生 POST 路径，否则 App 将无法举报。

## 本机审核与处置

操作权限来自受控的 Docker/主机访问，不是 App 或公网 token。Docker 访问权限等同高权限运维权限。
以下命令均带相同的 `docker compose --env-file NUL -f services/content-reporting/compose.yaml` 前缀：

```powershell
docker compose --env-file NUL -f services/content-reporting/compose.yaml exec -T reports node manage.cjs stats
docker compose --env-file NUL -f services/content-reporting/compose.yaml exec -T reports node manage.cjs list received 50
docker compose --env-file NUL -f services/content-reporting/compose.yaml exec -T reports node manage.cjs show <report-uuid>
# 审核备注是 stdin 中的 JSON 字符串，不是命令行参数；使用受保护输入，不把真实敏感内容写入 shell 历史。
# Get-Content -Raw <仓库外受保护的审核备注JSON文件> | docker compose ... exec -T reports node manage.cjs review <report-uuid> action_required
# 对无需行动的案件使用 no_action；备注必须非空，最长 2,000 UTF-16 单元。
```

`list` 仅列概要，不输出摘录。`show` 显示举报原文；只在受控终端使用，不把结果复制到普通日志、CI 或本仓库。
JSON 输出转义控制字符，不渲染报告中的链接或命令。`review` 记录决策和备注，**不会自动移除第三方模型输出、
封禁模型、通知用户或报警**；审核员须落实对应实际行动，并记录可核对的处理结果。

经授权的单案内容删除命令：`... exec -T reports node manage.cjs purge <report-uuid> --confirm`。
它清空正文、原因、审核备注，保留随机举报编号/接收时间/`purged` 占位，旧编号重试返回 `410`，不能复活内容。
不自动清除这些占位，也不擅自设定法律留存周期；上线前必须制定内容/占位分别的保留和清理规则。
SQLite 启用 secure_delete 并尝试截断 WAL，但这不是 SSD、Docker Desktop 虚拟磁盘、备份或快照的物理擦除保证。

运维至少应监控健康状态、`stats` 中待审数量/最早时间、存储故障代码、磁盘剩余量、Tunnel 连通和外部合成探测。
Docker healthcheck 不会自动重启仍存活但 unhealthy 的进程，也不代表审核有人处理。
备份应在维护窗口停止接收服务，整体备份 volume，保护访问与加密、记录期限；不要只复制正在写入的主 SQLite 文件。
恢复先在隔离卷中验证查询/重试/处置，再经授权替换；删除请求也须遵守已确认的备份处理规则。

### 维护窗口备份与隔离恢复

先创建仓库外、仅运维账户可读写的加密备份目录，确认维护窗口并记录当前镜像 ID。
下面使用默认 volume 名称；定制过 project/volume 的部署须先核对实际名称，不能凭名称猜测数据来源。
不要将备份提交到源码仓库或普通云盘，也不要向未授权人员展示 `show` 的原文。

```powershell
$backup = '<已创建的受保护备份目录绝对路径>'
$image = docker inspect --format '{{.Image}}' islemind-reporting-reports-1
# 停止接收后再复制整个卷；备份失败也恢复原服务，不把失败备份当作可恢复副本。
docker compose --env-file NUL -f services/content-reporting/compose.yaml stop reports
if ($LASTEXITCODE -ne 0) { throw '未能停止接收服务，不执行备份' }
try {
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --mount 'type=volume,src=islemind-reporting_reports-data,dst=/data,readonly' --mount "type=bind,src=$backup,dst=/backup" $image sh -c 'umask 077; tar -C /data -cf /backup/reports-volume.tar .'
  if ($LASTEXITCODE -ne 0) { throw '备份失败；不要使用输出文件恢复' }
  Get-FileHash -Algorithm SHA256 -LiteralPath "$backup\reports-volume.tar"
} finally {
  docker compose --env-file NUL -f services/content-reporting/compose.yaml start reports
}
```

每次使用新的空备份目录，避免覆盖已有恢复点；记录镜像 ID、归档 SHA256、时间和已确认的备份期限。
恢复时先核对哈希，创建**新的隔离 volume**，使用同一镜像及只读备份挂载运行
`tar -C /data -xf /backup/reports-volume.tar`。仅将该隔离卷挂到测试容器，不替换在线卷。
验证 `PRAGMA integrity_check`、数据库权限、待审/已审状态、审核备注、删除占位、幂等重试和持久配额；
最后在恢复副本上验证新的审核/删除操作。经运营者授权后才安排实际切换，保留明确的回退路径。

2026-09-27 已用当前服务镜像完成一次**真实 Docker volume** 恢复演练：仅创建合成举报，停止测试接收服务，
整卷归档并恢复到另一空卷；上述状态、`200/409/410/429` 重试语义、SQLite 完整性、`0600` 权限、
恢复后审核/删除及日志无正文均通过。演练容器、卷和合成备份已移除；没有停机、读取或替换正在运行的本机举报卷。
这证明该维护窗口恢复流程可行，不证明已配置定时备份、加密/异地保管、告警、保留期限或真实运营处置。

## Cloudflare Tunnel（独立、可选）

1. 运营者先确认实际域名、运营主体、支持邮箱、有效 HTTPS 隐私政策，以及 Cloudflare 作为传输接收方的披露。
2. 在自己的 Cloudflare 账号创建**本服务专用** named tunnel，配置公开 hostname 到 `http://reports:8787`。
   不借用其他本机项目的 token/域名，不使用临时 Quick Tunnel 作为正式应用 endpoint。
3. 将该 tunnel token 保存为仓库外、仅运维账户可读的受保护文件。不要粘贴到聊天、Compose、命令行参数、镜像或应用配置。
   将环境变量 `ISLEMIND_REPORT_TUNNEL_TOKEN_FILE` 设为该文件的绝对路径（不是 token 内容）。
4. 在同一个 project 中叠加配置启动：

```powershell
docker compose --env-file NUL -f services/content-reporting/compose.yaml -f services/content-reporting/compose.tunnel.yaml up -d --wait
```

Sidecar 只向外连接，无入站端口，token 以 Docker secret 文件提供。服务通过内部网络的 `reports` 名称可达。
公网 hostname 仅路由举报 API；不转发本机 Docker API/管理接口。Cloudflare 终止 HTTPS，内部 HTTP 流量和报告正文对
Cloudflare 及被授权的本机运维可见；这不是端到端加密。默认 compose 不启用 tunnel，当前未配置公网 hostname 或凭据。
Cloudflare 付费、DNS 变更和公开服务需运营者对应授权；不要自动套用其他项目的 Access/WAF 规则。

上线前用**合成举报**从外网验证合法提交、同 ID 重试不重复、错误请求、限流、无重定向、审核落库及网络中断。
然后将真实 `/v1/reports` URL、运营名称和政策 URL 配入应用构建，验证最终 Android 包的提交/取消/TalkBack。
仅本地 curl/Node 测试不能替代这项验收。安全地删除合成案件，避免污染待审队列。

## 自动验证

`node --test scripts/content-reporting-service-tests.js` 覆盖真实 SQLite/HTTP、并发幂等、重启持久化、字段/大小限制、
CORS、限流/容量、故障不误报成功、审核/内容删除和生产客户端 adapter 到此服务的合成 loopback 交互。
不调用模型或外部举报站点、不使用真实聊天；不代表运营审核、公网 TLS、备份恢复、原生 App 或 Play 审核通过。

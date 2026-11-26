# IsleMind 1.1.33 实际发布记录

v1.1.33 于 2026-11-27 01:14:49（台北，UTC 为 2026-11-26T17:14:49Z）公开发布，标签固定到版本提交 `504ce4290e49520934baf107a720edeaa6b46890`。源码版本为 1.1.33／158。GitHub 独立读回确认 Release `459706728` 为公开稳定版本、非草稿、latest、零附件。

[GitHub Release](https://github.com/domidoremi/IsleMind/releases/tag/v1.1.33) · [三语说明](./v1.1.33.md) · [七项产品提交](./source-version-1.1.33-2026-11-27.md)

2026-11-27 01:16:49（台北）完成独立只读核对，`allRequestedChecksPass=true`。远端 main 与 `v1.1.33` 标签均指向上述版本提交。三语正文与版本提交内的说明逐字节一致，均为 2,448 bytes，Git blob 均为 `dd7a0565528660f731f1ae8cf0005f327c82892e`。

当前共有 60 份 Release 和 60 个标签；原有 59 份 Release、59 个标签的身份及完整元数据均保留，唯一新增项为 v1.1.33。六个工作流保持不变；Actions 完整清单仍为相同的 41 个 run ID，活动为零，run ID 集合的 SHA256 为 `a271ad89932344d0841b852f1d2b17bf65adc2488da9760d4f058f47ca133d31`。

版本提交精确包含十个版本与文档路径，全部暂存 blob 匹配已测试快照。独立 main 快照的两个发布合约套件／92 项通过，实际版本关系为源码 1.1.33／158 与 APK 候选 1.1.2／127。本周期七项产品改动覆盖搜索、进度、公共反馈、页面介绍、工具提示和来源摘录的主题排版，以及实际表面上的单选标记对比度；产品验证及适用范围详见源码版本记录。

完整生产路由、深层入口、三语、横屏、大字体、键盘、恢复及原生视觉矩阵仍未完成。此前受阻的浏览器／原生执行未重试或绕过。`fullAcceptance`、`nativeVerified`、`visualAcceptance`、`loadedRuntimeVerified` 均为 false，局部组件与源码门禁结果不授予全局验收资格。

原有保护入口在 `src/components/ui/isle/Primitives.tsx` 的哈希冲突保留：期望 `ddd85c83eeb06802630b55d532aeee3a21a3392f70db8ebf6cb6e0920efa1652`，实际 `1fbaed0a81abe5d766357a971b0177297670cc2905ce8bd41c8992795b9f2382`；该文件及保护记录未改动。原有并发改动继续保留，`updates/android.json` 不变，APK 候选仍为 1.1.2／127。未构建、导出或安装 APK，未派发或重跑 Actions，未创建 PR、请求模型或操作设备音频、TalkBack、音量。

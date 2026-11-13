# TXT 导入保留段落和标题

在缺少 `Intl.Segmenter` 的运行环境中，知识文件导入的备用分句逻辑曾移除换行，将 Markdown 标题与正文连接。Android Hermes 上的实际 TXT 文件因此生成过长的标题路径，被 SQLite 拒绝并报出 `The chunk heading path is invalid.`。

备用分句现在保留原有换行，维持段落、列表和标题边界。空白文件仍在保存前被拒绝。新增五项回归覆盖缺失或抛错的分句器、CRLF、段落与列表、多段切块和空白输入。

验证结果：

- 已提交 `main` 的独立副本在新增回归中出现四项失败，并以实际 TXT 样本复现原生 SQLite 错误。
- 仅包含本修正的独立候选通过 33 项 Jest 测试、TypeScript 和两项架构检查；工作区的类型与架构检查也通过。
- 同一 TXT 样本在真实内存 SQLite 中保存并读回八个分块，原有标题、段落及六个内容标记保留。
- Android 系统文件选择器已选择实际 TXT，导入返回成功，八个分块处于可用状态。该轮流程随后因检查器传输改变 JSON 属性顺序而失败，原失败报告保留，不计为完整阅读器验收。
- 独立恢复已删除本轮临时文件记录及索引，恢复原会话、空输入框、设置和全部原数据。冷启动后的第 31 次独立核对通过，37/174 条请求日志的完整哈希不变。

测试与独立候选证据：`test-evidence/release/knowledge-fallback-newlines-20261114-01/checks-02.json`、`baseline-sqlite.json`、`candidate-sqlite.json`。

真机证据：`test-evidence/implementation/native-deep-readers-2026-11-12/native-txt-import-diagnostic-20261114-07.json`、`knowledge-readers-ui-p34-import-diagnostic-20261114-22/report.json`、`native-import-json-order-recovery-20261114-22-04.json`、`native-restarted-reader-originals-20261113-31.json`。

本项只修正分句时的换行保留。原生知识阅读、捕获来源阅读的完整滚动与返回流程，以及全应用验收仍在进行；暂存源码哈希不代表已加载字节码身份。

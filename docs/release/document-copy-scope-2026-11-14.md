# 文档复制范围说明修正

文档详情中的复制范围说明在打开面板时就会显示。英文原文以 “Copied” 开头，日文也使用“コピーしました”，让尚未执行复制的用户看到完成状态。

两种语言改为说明复制操作的范围：只复制可编辑正文，来源与修正上下文保留在文档中。中文已经采用说明语气，继续沿用原文。

- 英文：`Copy includes only the editable text. Sources and review context stay in Documents.`
- 日文：`コピーするのは編集本文のみです。出典と修正コンテキストはドキュメント内に残ります。`

验证：从 `main` 生成独立资源候选，逐个比较完整 JSON，确认每个文件只修改 `documents.copyNotice` 的值。工作区 TypeScript、依赖架构及模块边界检查通过。静态说明的渲染位置是 `DocumentWorkspaceContext` 的详情面板。

证据：`test-evidence/release/document-copy-scope-20261114-01/candidate-check.json` 与 `checks-01.json`。此前浏览器已核对详情面板、取消删除和精确删除测试文档，并完整恢复原存储；原验收空间随后关闭，因此本项没有追加新文案的浏览器截图验收。

本项只涉及两条静态说明。当前 Android 阅读器验证采用独立的既有源码回执，未将本项英文、日文资源变更算作原生验证。

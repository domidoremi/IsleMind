# 文档目录

## 目录规划

`docs/` 默认归档公开交付文档。根目录保留默认入口、配置、脚本入口和运行所需文件；开发使用、内部协作、提示词、Skill、用户画像和架构草案必须放入已忽略的 `local-docs/`。

| 目录 | 职能 | 内容 |
| --- | --- | --- |
| [`readme/`](readme/) | 多语言 README | 英文、日文和简体中文镜像文本。根目录 [`README.md`](../README.md) 是默认简体中文入口。 |
| [`production-qa-matrix.md`](production-qa-matrix.md) | 发布验收 | Android 发布、质量门槛和验收证据矩阵。 |

## 归档规则

- README 默认入口必须保留在根目录，默认语言为简体中文。
- 多语言 README 镜像必须放入 `docs/readme/`，并从根目录 README 链接进入。
- 发布验收矩阵必须保留在 `docs/production-qa-matrix.md`。
- 开发使用文档必须放入 `local-docs/`，该目录不参与仓库交付。
- 私密材料必须不从公开 README 链接进入。

# IsleMind Local Model Notice

IsleMind has two Android package modes:

- `no-model`: the default APK. It bundles no local embedding model files.
- `with-model-small`: bundles only `all-MiniLM-L6-v2` for local embedding.

The model catalog lives in `assets/models/catalog.json`. It records each model id, version, source URL, publisher, upstream model, listed contributors, file sizes, and SHA-256 hashes.

## Catalog

| Model | Capability | Source | Upstream / contributors | License |
| --- | --- | --- | --- | --- |
| `all-MiniLM-L6-v2` | Embedding | `https://huggingface.co/Xenova/all-MiniLM-L6-v2` | ONNX distribution by Xenova; upstream `sentence-transformers/all-MiniLM-L6-v2` | Apache-2.0 |
| `bge-small-zh-v1.5` | Embedding | `https://huggingface.co/Xenova/bge-small-zh-v1.5` | ONNX distribution by Xenova; upstream `BAAI/bge-small-zh-v1.5` | MIT |
| `paraphrase-multilingual-MiniLM-L12-v2` | Embedding | `https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2` | ONNX distribution by Xenova; upstream `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Apache-2.0 |
| `bge-reranker-base` | Reranker | `https://huggingface.co/BAAI/bge-reranker-base` | Optional capability placeholder by BAAI | MIT |
| `colbertv2.0` | ColBERT | `https://huggingface.co/colbert-ir/colbertv2.0` | Optional capability placeholder by ColBERT IR | See upstream model card |
| `llmlingua-2-xlm-roberta-large-meetingbank` | Compressor | `https://huggingface.co/microsoft/llmlingua-2-xlm-roberta-large-meetingbank` | Optional capability placeholder by Microsoft | MIT |

Model files are not authored by IsleMind contributors. Users and distributors should review the upstream model cards and licenses before redistribution or commercial use. IsleMind verifies downloaded model files against the hashes in the catalog and falls back to hash embeddings when a model is unavailable.

Capability placeholder rows document the intended upstream source and attribution before model files are added. They are not bundled and cannot be downloaded until file manifests and hashes are added to the catalog.

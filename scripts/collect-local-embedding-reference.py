# /// script
# requires-python = ">=3.11"
# dependencies = ["tokenizers==0.23.2", "onnxruntime==1.24.3", "numpy==2.5.3"]
# ///
"""Independent, local-only reference for the catalogued quantized model.

Input: {"cases": [{"id", "text", optional "inputIds"}], optional provenance}.
No provider calls or model downloads. Existing output is never overwritten.
Use --tokenizer-only with --tokenizer-file to check another catalogued tokenizer
without downloading its model weights; that mode supplies no vector evidence.
"""
import argparse
import hashlib
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import onnxruntime as ort
import tokenizers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--model-id", default="all-MiniLM-L6-v2")
    parser.add_argument("--model-dir", type=Path, help="Separate catalogue-verified model cache; does not change shipped assets")
    parser.add_argument("--tokenizer-only", action="store_true")
    parser.add_argument("--tokenizer-file", type=Path)
    args = parser.parse_args()
    if args.tokenizer_file and not args.tokenizer_only:
        parser.error("--tokenizer-file requires --tokenizer-only; inference uses the installed catalogue files")
    root = Path(__file__).resolve().parent.parent
    model = next(item for item in json.loads((root / "assets/models/catalog.json").read_text())['models'] if item['id'] == args.model_id)
    folder = args.model_dir or root / "assets/models" / model['id']
    hashes = {}
    for file in model['files']:
        if args.tokenizer_only and file['path'] != 'tokenizer.json':
            continue
        file_path = args.tokenizer_file if file['path'] == 'tokenizer.json' and args.tokenizer_file else folder / file['path']
        data = file_path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if len(data) != file['bytes'] or digest != file['sha256']:
            raise ValueError(f"Catalog file mismatch: {file['path']}")
        hashes[file['path']] = digest
    tokenizer = tokenizers.Tokenizer.from_file(str(args.tokenizer_file or folder / "tokenizer.json"))
    # The bundled export carries padding/truncation for an old sample batch.
    # IsleMind's single-sentence path uses the model card's catalogued limit.
    tokenizer.no_padding()
    tokenizer.enable_truncation(max_length=model['maxTokens'], direction='right')
    if not args.tokenizer_only:
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(folder / "onnx/model_quantized.onnx"), sess_options=options, providers=['CPUExecutionProvider'])
    cache = {}

    def embed(ids):
        key = tuple(ids)
        if key not in cache:
            feeds = {'input_ids': np.array([ids], dtype=np.int64), 'attention_mask': np.ones((1, len(ids)), dtype=np.int64)}
            if any(item.name == 'token_type_ids' for item in session.get_inputs()):
                feeds['token_type_ids'] = np.zeros((1, len(ids)), dtype=np.int64)
            hidden = session.run(['last_hidden_state'], feeds)[0]
            pooled = hidden[:, 0] if model.get('pooling', 'mean') == 'cls' else hidden.mean(axis=1)
            vector = (pooled / np.linalg.norm(pooled, axis=1, keepdims=True))[0]
            if len(vector) != model['dimension'] or not np.isfinite(vector).all():
                raise ValueError('Invalid reference output')
            cache[key] = vector.astype(float).tolist()
        return cache[key]

    inputs = json.loads(args.inputs.read_text(encoding='utf-8'))
    cases = []
    for case in inputs['cases']:
        encoded = tokenizer.encode(case['text'])
        current = {**case, 'referenceInputIds': encoded.ids, 'referenceAttentionMask': encoded.attention_mask,
                   'referenceTokenTypeIds': encoded.type_ids}
        if not args.tokenizer_only:
            current['referenceVector'] = embed(encoded.ids)
        if 'inputIds' in case:
            current['inputIdsMatch'] = case['inputIds'] == encoded.ids
            if not args.tokenizer_only:
                current['measuredVector'] = embed(case['inputIds'])
        cases.append(current)
    result = {'evidenceClass': 'Host verified', 'createdAt': datetime.now(timezone.utc).isoformat(),
              'scope': 'tokenizer only; no inference' if args.tokenizer_only else 'tokenizer and quantized-model inference',
              'modelId': model['id'], 'modelVersion': model['version'], 'dimension': model['dimension'],
              'maxTokens': model['maxTokens'], 'pooling': model.get('pooling', 'mean'), 'hashes': hashes,
              'reference': {'python': platform.python_version(), 'tokenizers': tokenizers.__version__,
                            'onnxruntime': None if args.tokenizer_only else ort.__version__,
                            'numpy': None if args.tokenizer_only else np.__version__,
                            'executionProvider': None if args.tokenizer_only else 'CPUExecutionProvider'},
              'inputProvenance': inputs.get('provenance'), 'cases': cases}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('x', encoding='utf-8') as file:
        json.dump(result, file, ensure_ascii=False, indent=2)
        file.write('\n')
    print(json.dumps({'out': str(args.out), 'cases': len(cases),
                      'matched': sum(item.get('inputIdsMatch', False) for item in cases),
                      'reference': result['reference']}))


if __name__ == '__main__':
    main()

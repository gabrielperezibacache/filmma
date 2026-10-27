"""Lossless BF16 loading strategy for the pinned ltx-mlx runtime on 36 GB Macs.

Only the loading order changes: identical mapping and BF16 values, while FP32
shards are retired individually instead of retaining the complete 19 GB T5 set.
"""
import gc
import json
from pathlib import Path
import mlx.core as mx
from mlx.utils import tree_unflatten
from ltx_mlx.models.text_encoder import T5Encoder, _map_hf_key


def load_t5_streamed(model_dir, dtype=mx.bfloat16):
    directory = Path(model_dir)
    config = json.loads((directory / 'config.json').read_text())
    model = T5Encoder(vocab_size=config['vocab_size'], dim=config['d_model'],
                      num_heads=config['num_heads'], head_dim=config['d_kv'],
                      dim_ff=config['d_ff'], num_layers=config['num_layers'])
    shards = sorted(directory.glob('model-*.safetensors'))
    if not shards:
        raise FileNotFoundError('No se encuentran los pesos T5.')
    mapped = {}
    for index, shard in enumerate(shards):
        raw = mx.load(str(shard))
        converted = {}
        for name, tensor in raw.items():
            target = _map_hf_key(name)
            if target is not None:
                converted[target] = tensor.astype(dtype)
        mx.eval(converted)
        mapped.update(converted)
        del raw, converted
        gc.collect()
        mx.clear_cache()
        print(f'T5 shard prepared {index + 1}/{len(shards)}', flush=True)
    model.update(tree_unflatten(list(mapped.items())))
    mx.eval(model.parameters())
    return model


class Float32Output:
    """Expose decoded pixels in NumPy-compatible FP32, retaining BF16 inference."""
    def __init__(self, decoder):
        self.decoder = decoder

    def __call__(self, *args, **kwargs):
        return self.decoder(*args, **kwargs).astype(mx.float32)

"""Optional GPU parity checks; run with runtime/.venv/bin/python on macOS."""
import contextlib
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:
    import mlx.core as mx
    from mlx.utils import tree_flatten
    from ltx_mlx.models.text_encoder import T5Encoder, load_t5_encoder
    from ltx_memory import load_t5_streamed, Float32Output
    HAS_MLX = True
except ImportError:
    HAS_MLX = False


@unittest.skipUnless(HAS_MLX, 'Requires the isolated MLX runtime and Metal access')
class StreamedEncoderParity(unittest.TestCase):
    def test_decoded_bf16_pixels_convert_without_numpy_buffer_errors(self):
        import numpy as np
        decoder = Float32Output(lambda: mx.array([-0.5, 0.0, 0.5], dtype=mx.bfloat16))
        pixels = np.array(decoder())
        self.assertEqual(pixels.dtype, np.float32)
        self.assertEqual(pixels.tolist(), [-0.5, 0.0, 0.5])

    def test_shard_loading_preserves_weights_and_dynamic_context(self):
        configuration = {'vocab_size': 32, 'd_model': 8, 'num_heads': 2, 'd_kv': 4, 'd_ff': 16, 'num_layers': 1}
        mx.random.seed(42)
        source = T5Encoder(vocab_size=32, dim=8, num_heads=2, head_dim=4, dim_ff=16, num_layers=1)
        hf_weights = {}
        for name, value in tree_flatten(source.parameters()):
            if name == 'shared.weight':
                mapped = name
            elif name == 'pos_bias.embedding.weight':
                mapped = 'encoder.block.0.layer.0.SelfAttention.relative_attention_bias.weight'
            elif name == 'final_layer_norm.weight':
                mapped = 'encoder.final_layer_norm.weight'
            else:
                match = re.fullmatch(r'blocks\.(\d+)\.layer_(\d+)_(.*)', name)
                mapped = f'encoder.block.{match[1]}.layer.{match[2]}.{match[3]}'
            hf_weights[mapped] = value.astype(mx.float32)
        keys = list(hf_weights)
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            (directory / 'config.json').write_text(json.dumps(configuration))
            mx.save_safetensors(str(directory / 'model-00001-of-00002.safetensors'), {k: hf_weights[k] for k in keys[:6]})
            mx.save_safetensors(str(directory / 'model-00002-of-00002.safetensors'), {k: hf_weights[k] for k in keys[6:]})
            with contextlib.redirect_stdout(io.StringIO()):
                oracle = load_t5_encoder(folder, mx.bfloat16)
                streamed = load_t5_streamed(folder, mx.bfloat16)
            expected = dict(tree_flatten(oracle.parameters()))
            actual = dict(tree_flatten(streamed.parameters()))
            self.assertEqual(set(expected), set(actual))
            for key in expected:
                self.assertEqual(actual[key].dtype, mx.bfloat16)
                self.assertTrue(mx.array_equal(expected[key], actual[key]).item(), key)
            for length in (128, 256, 512):
                tokens = mx.array([[i % 32 for i in range(length)]])
                left, right = oracle(tokens), streamed(tokens)
                mx.eval(left, right)
                self.assertTrue(mx.array_equal(left, right).item(), f'context length {length}')


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Isolated MLX inference process. Invoked only after parent preflight."""
import contextlib
import json
from pathlib import Path
import sys
import math
import sentencepiece as spm
import imageio.v2 as imageio
import mlx.core as mx
import numpy as np
from PIL import Image, ImageOps
from ltx_mlx import LTXPipeline
import ltx_mlx.pipeline as ltx_pipeline
from ltx_memory import load_t5_streamed, Float32Output

# Retire each FP32 shard before loading the next, preserving exact BF16 weights.
ltx_pipeline.load_t5_encoder = load_t5_streamed

request = json.loads(Path(sys.argv[1]).read_text())

def progress(stage, message):
    print(json.dumps({'type': 'progress', 'stage': stage, 'message': message}), flush=True)

prompt_tokenizer = spm.SentencePieceProcessor(model_file=str(Path(request['modelDirectory']) / 'tokenizer' / 'spiece.model'))
prompt_tokens = len(prompt_tokenizer.encode(request['prompt'])) + 1
if prompt_tokens > 512:
    print(json.dumps({'type': 'error', 'code': 'PROMPT_TOO_LONG', 'message': f'El prompt tiene {prompt_tokens} tokens; resume el plano a un máximo de 512 para conservar toda la continuidad.'}), flush=True)
    sys.exit(2)
context_length = max(128, math.ceil(prompt_tokens / 8) * 8)
progress('loading', 'Cargando LTX 2B y T5 en MLX.')
# Logs from the upstream library go to stderr, which the parent captures.
with contextlib.redirect_stdout(sys.stderr):
    pipe = LTXPipeline(request['modelDirectory'], checkpoint='ltxv-2b-0.9.8-distilled.safetensors')
    pipe.tokenizer.max_length = context_length
    pipe.vae = Float32Output(pipe.vae)
    image = None
    if request.get('inputImage'):
        with Image.open(request['inputImage']) as source:
            image = np.array(ImageOps.exif_transpose(source).convert('RGB'))
    frames = pipe.generate(request['prompt'], width=request['width'], height=request['height'],
                           num_frames=request['numFrames'], num_steps=request['steps'], seed=request['seed'], image=image)
progress('encoding', 'Codificando los fotogramas reales a H.264.')
imageio.mimwrite(request['outputPath'], frames, fps=request['fps'], codec='libx264', quality=8,
                macro_block_size=1, output_params=['-pix_fmt', 'yuv420p', '-movflags', '+faststart'])
progress('complete', 'Video local escrito; comprobando integridad.')

print(json.dumps({"type": "progress", "stage": "metrics", "message": "Pico de memoria MLX medido.", "mlxPeakMemoryBytes": mx.get_peak_memory(), "promptTokens": prompt_tokens, "textContextLength": context_length}), flush=True)

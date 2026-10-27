"""Exercise H3's real host-only shard reader with macOS metadata companions."""
import importlib.util
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / 'runtime/vendor/h3'
SPEC = importlib.util.spec_from_file_location('filmma_runtime', ROOT / 'runtime/filmma_runtime.py')
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)

HOST_READER = r'''
#include "h3_weights.h"
#include <stdio.h>
#include <stdlib.h>
h3_gpu_tensor *h3_gpu_tensor_load_bf16(h3_gpu *g, const char *p, uint64_t o, size_t n) { abort(); }
h3_gpu_tensor *h3_gpu_tensor_load_f32(h3_gpu *g, const char *p, uint64_t o, size_t n) { abort(); }
const char *h3_gpu_error(const h3_gpu *g) { abort(); }
int main(int argc, char **argv) {
    char error[512] = {0};
    if (argc != 2) return 2;
    h3_weight_store *store = h3_weight_store_open(argv[1], error, sizeof(error));
    if (!store) { fprintf(stderr, "%s\n", error); return 1; }
    printf("%zu\n", h3_weight_store_shards(store));
    h3_weight_store_free(store);
    return 0;
}
'''


@unittest.skipUnless(shutil.which('clang') and VENDOR.is_dir(), 'H3 source and clang required')
class HostWeightStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='filmma-h3-host-')
        cls.directory = Path(cls.temp.name)
        source = cls.directory / 'reader.c'
        source.write_text(HOST_READER)
        cls.binary = cls.directory / 'reader'
        subprocess.run(['clang', '-std=c11', '-D_DARWIN_C_SOURCE', '-I', str(VENDOR),
                        str(source), str(VENDOR / 'h3_weights.c'), str(VENDOR / 'h3_safetensors.c'),
                        '-o', str(cls.binary)], check=True, capture_output=True, text=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def fixture(self, folder):
        directory = self.directory / folder
        directory.mkdir()
        header = json.dumps({'fixture': {'dtype': 'F32', 'shape': [1], 'data_offsets': [0, 4]}}).encode()
        valid = struct.pack('<Q', len(header)) + header + struct.pack('<f', 1.0)
        (directory / 'model-00001-of-00001.safetensors').write_bytes(valid)
        (directory / '._model-00001-of-00001.safetensors').write_bytes(b'AppleDouble metadata, not tensors')
        (directory / '.hidden.safetensors').write_bytes(b'Hidden metadata')
        return directory

    def test_hidden_companions_are_ignored_but_preserved(self):
        directory = self.fixture('hidden')
        before = {p.name: p.read_bytes() for p in directory.iterdir()}
        result = subprocess.run([str(self.binary), str(directory)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), '1')
        self.assertEqual(before, {p.name: p.read_bytes() for p in directory.iterdir()})

    def test_visible_corrupt_shard_is_still_rejected(self):
        directory = self.fixture('corrupt')
        (directory / 'broken.safetensors').write_bytes(b'Not a real shard')
        result = subprocess.run([str(self.binary), str(directory)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('broken.safetensors', result.stderr)


@unittest.skipUnless(VENDOR.is_dir(), 'H3 source required')
class RuntimePatchTests(unittest.TestCase):
    def test_clean_checkout_patch_is_idempotent_and_preserves_unknown_edits(self):
        manifest = json.loads((ROOT / 'runtime/patches/h3.json').read_text())['patches'][0]
        patched = (VENDOR / manifest['path']).read_text()
        original = patched.replace(manifest['after'], manifest['before'])
        with tempfile.TemporaryDirectory(prefix='filmma-h3-patch-') as folder:
            target = Path(folder) / manifest['path']
            target.write_text(original)
            RUNTIME.apply_h3_runtime_patches(folder)
            self.assertEqual(target.read_text(), patched)
            first_mtime = target.stat().st_mtime_ns
            RUNTIME.apply_h3_runtime_patches(folder)
            self.assertEqual(target.stat().st_mtime_ns, first_mtime)
            edited = target.read_bytes() + b'\n/* User change. */\n'
            target.write_bytes(edited)
            with self.assertRaises(RUNTIME.RuntimeFailure) as error:
                RUNTIME.apply_h3_runtime_patches(folder)
            self.assertEqual(error.exception.code, 'RUNTIME_PATCH_CONFLICT')
            self.assertEqual(target.read_bytes(), edited)


if __name__ == '__main__':
    unittest.main()

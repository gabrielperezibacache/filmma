"""Exercise Filmma's actual subprocess launch without GPU, model weights or video."""
import importlib.util
import os
from pathlib import Path
import shlex
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('filmma_h3_launch_runtime', ROOT / 'runtime/filmma_runtime.py')
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)


class H3LaunchContextTests(unittest.TestCase):
    def test_actual_launch_from_another_directory_resolves_engine_symlink_and_assets(self):
        with tempfile.TemporaryDirectory(prefix='filmma h3 launcher ') as folder:
            base = Path(folder).resolve()
            engine_dir, caller = base / 'installed engine', base / 'caller'
            engine_dir.mkdir()
            caller.mkdir()
            engine = engine_dir / 'h3'
            marker = base / 'observed-launch.txt'
            # A host-only substitute exercises the real Popen/cwd path. Deliberate
            # exit 7 prevents media validation; exit 8 means the shader was missing.
            engine.write_text('#!/bin/sh\npwd > ' + shlex.quote(str(marker)) + '\n'
                              'printf "%s\\n" "$@" >> ' + shlex.quote(str(marker)) + '\n'
                              'test -s h3_shaders.metal || exit 8\nexit 7\n')
            engine.chmod(0o755)
            shader = engine_dir / 'h3_shaders.metal'
            shader.write_text('// Host fixture only; never compiled.\n')
            alias = caller / 'h3 alias'
            alias.symlink_to(engine)
            reference = base / 'original reference.png'
            reference.write_bytes(b'original-preserved')
            output = base / 'new output' / 'take.mp4'
            model = base / 'weights'
            previous_cwd = Path.cwd()
            try:
                os.chdir(caller)
                with mock.patch.dict(os.environ, {'FILMMA_H3_BIN': 'h3 alias'}), \
                     mock.patch.object(RUNTIME, 'model_dir', return_value=model), \
                     mock.patch.object(RUNTIME, 'hardware', return_value={'appleSilicon': True, 'memoryGB': 36, 'ffmpeg': '/fake/ffmpeg', 'ffprobe': '/fake/ffprobe'}), \
                     mock.patch.object(RUNTIME, 'inspect_files', return_value={'complete': True}), \
                     mock.patch.object(RUNTIME, 'prepare_h3_view', return_value=str(model)), \
                     mock.patch.object(RUNTIME, 'emit'):
                    with self.assertRaises(RUNTIME.RuntimeFailure) as error:
                        RUNTIME._generate({'model': 'minimax-h3', 'prompt': 'Launch context only',
                                           'outputPath': str(output), 'references': [{'type': 'image', 'path': str(reference)}]})
                    self.assertEqual(error.exception.code, 'ENGINE_FAILED')
                    self.assertEqual(error.exception.details['exitCode'], 7)
            finally:
                os.chdir(previous_cwd)
            observed = marker.read_text().splitlines()
            self.assertEqual(observed[0], str(engine_dir))
            self.assertEqual(observed[observed.index('-d') + 1], str(model))
            self.assertEqual(observed[observed.index('--ref-image') + 1], str(reference))
            self.assertEqual(Path(observed[observed.index('-o') + 1]).parent, output.parent)
            self.assertEqual(reference.read_bytes(), b'original-preserved')
            self.assertEqual(shader.read_text(), '// Host fixture only; never compiled.\n')
            self.assertFalse(output.exists())

    def test_missing_or_empty_metal_source_fails_before_starting_engine(self):
        with tempfile.TemporaryDirectory(prefix='filmma-h3-missing-') as folder:
            engine = Path(folder).resolve() / 'h3'
            engine.touch()
            with mock.patch.object(RUNTIME, 'executable', return_value=engine):
                for empty_file in (False, True):
                    if empty_file:
                        (engine.parent / 'h3_shaders.metal').touch()
                    with self.assertRaises(RUNTIME.RuntimeFailure) as error:
                        RUNTIME.engine_working_directory('minimax-h3')
                    self.assertEqual(error.exception.code, 'RUNTIME_ASSET_MISSING')
                    self.assertEqual(error.exception.details['path'], str(engine.parent / 'h3_shaders.metal'))

    def test_ltx_keeps_project_context_and_does_not_resolve_its_python_symlink(self):
        with mock.patch.object(RUNTIME, 'executable', side_effect=AssertionError('LTX executable must stay unchanged')):
            self.assertEqual(RUNTIME.engine_working_directory('ltx-2b'), ROOT)

    def test_doctor_does_not_report_ready_when_shader_is_missing(self):
        with tempfile.TemporaryDirectory(prefix='filmma-h3-doctor-') as folder:
            engine = Path(folder) / 'h3'
            engine.touch()
            engine.chmod(0o755)
            with mock.patch.object(RUNTIME, 'MODEL_NAMES', {'minimax-h3': 'MiniMax H3'}), \
                 mock.patch.object(RUNTIME, 'executable', return_value=engine), \
                 mock.patch.object(RUNTIME, 'hardware', return_value={'appleSilicon': True, 'ffmpeg': '/fake/ffmpeg', 'ffprobe': '/fake/ffprobe'}), \
                 mock.patch.object(RUNTIME, 'inspect_files', return_value={'complete': True}), \
                 mock.patch.object(RUNTIME, 'last_validation', return_value=None), \
                 mock.patch.object(RUNTIME, 'download_plan', return_value={}), \
                 mock.patch.object(RUNTIME, 'config', return_value={}):
                model = RUNTIME.doctor()['models'][0]
            self.assertFalse(model['available'])
            self.assertFalse(model['installed'])
            self.assertFalse(model['engineInstalled'])
            self.assertEqual(model['status'], 'runtime_missing')
            self.assertIn('archivo Metal', model['message'])


if __name__ == '__main__':
    unittest.main()

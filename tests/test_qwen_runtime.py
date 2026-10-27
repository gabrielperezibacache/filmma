"""Hermes bridge contracts without loading a model or accessing the network."""
from array import array
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('filmma_qwen_tts', ROOT / 'runtime/filmma_qwen_tts.py')
qwen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qwen)


def write_audio(path, seconds=1, amplitude=6000):
    frames = round(seconds * 24000)
    samples = array('h', [amplitude if index % 2 else -amplitude for index in range(frames)])
    with wave.open(str(path), 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(samples.tobytes())


class QwenTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.output = self.folder / 'filmma.wav'
        self.request = {'text': 'La película comienza ahora.', 'voiceId': 'hermes-default', 'language': 'es',
                        'speed': 1, 'outputPath': str(self.output), 'maxDurationSeconds': 15}
        self.config = {'model': 'test-Qwen', 'modelRevision': 'revision'}
        for key, name in [('binaryPath', 'llama-tts'), ('modelPath', 'model.gguf'), ('projectorPath', 'projector.gguf')]:
            self.config[key] = self.folder / name
            self.config[key].write_bytes(b'GGUF' + name.encode())
        self.config['referencePath'] = self.folder / 'reference.wav'
        write_audio(self.config['referencePath'])
        for prefix in ['model', 'projector']:
            self.config[prefix + 'Sha256'] = qwen.sha256(self.config[prefix + 'Path'])
            self.config[prefix + 'Bytes'] = self.config[prefix + 'Path'].stat().st_size
        self.reference_hash = qwen.sha256(self.config['referencePath'])

    def tearDown(self):
        self.temporary.cleanup()

    def assert_code(self, code, callback):
        with self.assertRaises(qwen.QwenError) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_dialogue_and_reference_fingerprint_survive(self):
        checked = qwen.validate_request({**self.request, 'text': ' ¿Volverás, Lucía? ', 'expectedReferenceSha256': self.reference_hash})
        self.assertEqual(checked['text'], '¿Volverás, Lucía?')
        self.assertEqual(checked['expectedReferenceSha256'], self.reference_hash)
        self.assertEqual(checked['voiceId'], 'hermes-default')

    def test_request_types_and_limits(self):
        self.assert_code('INVALID_REQUEST', lambda: qwen.validate_request([]))
        for value in ['', ' ', 2, 'x' * 601, '\x00', 'hola\x1b']:
            self.assert_code('INVALID_TEXT', lambda: qwen.validate_request({**self.request, 'text': value}))
        for value in [True, float('nan'), float('inf'), .69, 1.31, '1']:
            self.assert_code('INVALID_SPEED', lambda: qwen.validate_request({**self.request, 'speed': value}))
        for value in [True, 0, -1, 15.01, float('nan')]:
            self.assert_code('INVALID_DURATION', lambda: qwen.validate_request({**self.request, 'maxDurationSeconds': value}))
        for value in ['', '../../some-file', 42]:
            self.assert_code('INVALID_REFERENCE', lambda: qwen.validate_request({**self.request, 'expectedReferenceSha256': value}))

    def test_only_registered_reference_and_languages(self):
        for value in ['anything.wav', 'ef_dora', None]:
            self.assert_code('INVALID_VOICE', lambda: qwen.validate_request({**self.request, 'voiceId': value}))
        self.assert_code('INVALID_LANGUAGE', lambda: qwen.validate_request({**self.request, 'language': 'auto'}))

    def test_output_and_dangling_symlink_never_overwritten(self):
        self.output.write_bytes(b'original')
        self.assert_code('OUTPUT_EXISTS', lambda: qwen.validate_request(self.request))
        self.assertEqual(self.output.read_bytes(), b'original')
        link = self.folder / 'link.wav'
        link.symlink_to(self.folder / 'missing.wav')
        self.assert_code('OUTPUT_EXISTS', lambda: qwen.validate_request({**self.request, 'outputPath': str(link)}))
        for value in ['relative.wav', str(self.folder / 'other.mp3'), None]:
            self.assert_code('INVALID_OUTPUT', lambda: qwen.validate_request({**self.request, 'outputPath': value}))

    def test_offline_command_uses_existing_paths_and_bounded_resources(self):
        request = qwen.validate_request(self.request)
        command = qwen.build_command(self.config, request, self.folder / 'text.txt', self.output)
        self.assertIn('--offline', command)
        self.assertNotIn('-hf', command)
        self.assertNotIn('--model-url', command)
        self.assertIn(str(self.config['modelPath']), command)
        self.assertIn(str(self.config['referencePath']), command)
        self.assertEqual(command[command.index('-c') + 1], '2048')
        self.assertEqual(command[command.index('-n') + 1], '256')
        self.assertNotIn(request['text'], command)  # private input stays in a temporary file

    def test_limited_generation_is_rejected_even_when_audio_seems_short(self):
        self.assertEqual(qwen.validate_completion('generated 42 frames, 100 bytes of WAV audio'), 42)
        self.assert_code('DURATION_LIMIT', lambda: qwen.validate_completion('generated 256 frames, 100 bytes of WAV audio'))
        self.assert_code('QWEN_COMPLETION_UNKNOWN', lambda: qwen.validate_completion('output complete'))

    def test_silent_and_overlong_audio_rejected_without_truncation(self):
        write_audio(self.output, 15.001)
        before = qwen.sha256(self.output)
        self.assert_code('DURATION_LIMIT', lambda: qwen.inspect_wav(self.output, 15))
        self.assertEqual(before, qwen.sha256(self.output))
        write_audio(self.output, amplitude=0)
        self.assert_code('SILENT_AUDIO', lambda: qwen.inspect_wav(self.output, 15))

    def test_model_hash_cache_invalidated_after_change(self):
        with patch.object(qwen, 'ROOT', self.folder / 'runtime'):
            qwen.ROOT.mkdir()
            with patch.object(qwen, 'sha256', wraps=qwen.sha256) as hashed:
                qwen.verify_models(self.config)
                self.assertEqual(hashed.call_count, 2)
                qwen.verify_models(self.config)
                self.assertEqual(hashed.call_count, 2)
                self.config['modelPath'].write_bytes(b'GGUFchanged model')
                self.assert_code('QWEN_MODEL_INTEGRITY', lambda: qwen.verify_models(self.config))
                self.assertEqual(hashed.call_count, 3)

    def fake_synthesis(self, seconds=1, frames=12, mutate_reference=False, race_output=False, request=None):
        original_reference = self.config['referencePath'].read_bytes()
        def render(command, log_path, **kwargs):
            if '-o' in command:
                write_audio(command[command.index('-o') + 1], seconds)
                Path(log_path).write_text('generated %s frames, 48044 bytes of WAV audio' % frames)
                if mutate_reference:
                    write_audio(self.config['referencePath'], amplitude=7000)
            else:
                shutil.copyfile(command[command.index('-i') + 1], command[-1])
                if race_output:
                    self.output.write_bytes(b'another original')
            return {'sampledPeakRssBytes': 123456, 'elapsedSeconds': .2}
        checked = qwen.validate_request(request or self.request)
        state = {'ready': True, 'referenceSha256': self.reference_hash}
        with patch.object(qwen, 'ROOT', self.folder), patch.object(qwen, 'doctor', return_value=state), \
             patch.object(qwen, 'connection', return_value=self.config), \
             patch.object(qwen, 'run_process', side_effect=render), \
             patch.object(qwen.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, stdout='')):
            result = qwen._synthesize(checked)
        self.assertEqual(original_reference, self.config['referencePath'].read_bytes())
        return result

    def test_success_creates_new_wav_and_records_reference_model_source(self):
        result = self.fake_synthesis()
        self.assertEqual(result['referenceSha256'], self.reference_hash)
        self.assertEqual(result['modelSha256'], self.config['modelSha256'])
        self.assertEqual(result['sha256'], qwen.sha256(self.output))
        self.assertEqual(result['duration'], 1)
        self.assertEqual(result['metrics']['sampledPeakRssBytes'], 123456)
        self.assertEqual(list(self.folder.glob('.filmma-qwen-*')), [])

    def test_overlong_result_not_published(self):
        self.assert_code('DURATION_LIMIT', lambda: self.fake_synthesis(seconds=16))
        self.assertFalse(self.output.exists())

    def test_predict_cap_not_published(self):
        self.assert_code('DURATION_LIMIT', lambda: self.fake_synthesis(seconds=1, frames=256))
        self.assertFalse(self.output.exists())

    def test_changed_reference_during_inference_not_published(self):
        self.assert_code('QWEN_SOURCE_CHANGED', lambda: self.fake_synthesis(mutate_reference=True))
        self.assertFalse(self.output.exists())

    def test_expected_reference_mismatch_rejected_before_loading_model(self):
        with patch.object(qwen, 'doctor', return_value={'ready': True, 'referenceSha256': self.reference_hash}), \
             patch.object(qwen, 'verify_models') as verification:
            self.assert_code('QWEN_REFERENCE_CHANGED', lambda: qwen._synthesize(qwen.validate_request({**self.request, 'expectedReferenceSha256': 'a' * 64})))
            verification.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_output_race_preserves_other_writer(self):
        self.assert_code('OUTPUT_EXISTS', lambda: self.fake_synthesis(race_output=True))
        self.assertEqual(self.output.read_bytes(), b'another original')

    def test_external_hermes_worker_blocks_before_model_load(self):
        with patch.object(qwen, 'doctor', return_value={'ready': True, 'referenceSha256': self.reference_hash}), \
             patch.object(qwen, 'connection', return_value=self.config), \
             patch.object(qwen.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout='1234\n')), \
             patch.object(qwen, 'verify_models') as verification:
            self.assert_code('QWEN_BUSY', lambda: qwen._synthesize(qwen.validate_request(self.request)))
            verification.assert_not_called()

    def test_profile_reference_uses_own_audio_without_mutating_hermes(self):
        reference = self.folder / 'character.wav'
        write_audio(reference, seconds=3, amplitude=3000)
        original_config = dict(self.config)
        request = {**self.request, 'voiceId': 'profile-character', 'referencePath': str(reference), 'expectedReferenceSha256': qwen.sha256(reference)}
        seen = []
        def render(command, log_path, **kwargs):
            if '-o' in command:
                seen.append(command[command.index('--tts-speaker-file') + 1])
                write_audio(command[command.index('-o') + 1])
                Path(log_path).write_text('generated 12 frames, 48000 bytes of WAV audio')
            else:
                shutil.copyfile(command[command.index('-i') + 1], command[-1])
            return {'sampledPeakRssBytes': 1, 'elapsedSeconds': .1}
        with patch.object(qwen, 'ROOT', self.folder), patch.object(qwen, 'doctor', return_value={'ready': False, 'modelReady': True, 'referenceSha256': None}), \
             patch.object(qwen, 'connection', return_value=self.config), patch.object(qwen, 'run_process', side_effect=render), \
             patch.object(qwen.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, stdout='')):
            result = qwen._synthesize(qwen.validate_request(request))
        self.assertEqual(seen, [str(reference.resolve())])
        self.assertEqual(self.config, original_config)
        self.assertEqual(qwen.sha256(self.config['referencePath']), self.reference_hash)
        self.assertEqual(result['referenceSha256'], qwen.sha256(reference))
        self.assertEqual(result['voiceId'], 'profile-character')

    def test_profile_missing_hash_relative_path_or_wrong_reference_rejected(self):
        base = {**self.request, 'voiceId': 'profile-character', 'referencePath': str(self.folder / 'character.wav')}
        self.assert_code('INVALID_REFERENCE', lambda: qwen.validate_request(base))
        self.assert_code('INVALID_REFERENCE', lambda: qwen.validate_request({**base, 'referencePath': 'character.wav', 'expectedReferenceSha256': 'a' * 64}))
        reference = self.folder / 'character.wav'
        write_audio(reference, seconds=3)
        with patch.object(qwen, 'doctor', return_value={'ready': True, 'modelReady': True}), patch.object(qwen, 'connection', return_value=self.config), patch.object(qwen, 'verify_models') as verify:
            self.assert_code('QWEN_REFERENCE_CHANGED', lambda: qwen._synthesize(qwen.validate_request({**base, 'expectedReferenceSha256': 'a' * 64})))
            verify.assert_not_called()

    def test_short_profile_rejected_before_model_loading(self):
        with patch.object(qwen, 'doctor', return_value={'ready': True, 'modelReady': True}), patch.object(qwen, 'connection', return_value=self.config), patch.object(qwen, 'verify_models') as verify:
            self.assert_code('INVALID_REFERENCE', lambda: qwen._synthesize(qwen.validate_request({**self.request, 'voiceId': 'profile-short', 'referencePath': str(self.config['referencePath']), 'expectedReferenceSha256': self.reference_hash})))
            verify.assert_not_called()

    def test_simultaneous_filmma_workers_rejected(self):
        with patch.object(qwen, 'ROOT', self.folder), qwen.exclusive_lock():
            self.assert_code('QWEN_BUSY', lambda: qwen.exclusive_lock().__enter__())


if __name__ == '__main__':
    unittest.main()

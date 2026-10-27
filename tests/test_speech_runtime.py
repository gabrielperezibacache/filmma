"""Speech request, preservation, duration and download integrity contracts."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import wave

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('filmma_speech', ROOT / 'runtime' / 'filmma_speech.py')
speech = importlib.util.module_from_spec(spec)
spec.loader.exec_module(speech)


class SpeechTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary.name)
        self.request = {'text': 'La película comienza ahora.', 'language': 'es', 'voiceId': 'ef_dora',
                        'speed': 1.0, 'outputPath': str(self.folder / 'voice.wav')}

    def tearDown(self):
        self.temporary.cleanup()

    def assert_code(self, code, callback):
        with self.assertRaises(speech.SpeechError) as raised:
            callback()
        self.assertEqual(raised.exception.code, code)

    def test_spanish_voice_and_unicode_text_survive(self):
        self.request['text'] = '  ¿Volverás, Lucía?  '
        checked = speech.validate_request(self.request)
        self.assertEqual(checked['voice'], 'ef_dora')
        self.assertEqual(checked['text'], '¿Volverás, Lucía?')
        self.assertEqual(checked['maxDurationSeconds'], 15)

    def test_wrong_language_voice_and_unknown_voice_rejected(self):
        for value in ['af_heart', '../../voice', None]:
            self.assert_code('INVALID_VOICE', lambda: speech.validate_request({**self.request, 'voiceId': value}))

    def test_text_and_numeric_limits_are_strict(self):
        for value in ['', '  ', 'x' * 601, 'a\x00b', 42]:
            self.assert_code('INVALID_TEXT', lambda: speech.validate_request({**self.request, 'text': value}))
        for value in [False, float('nan'), float('inf'), .49, 2.01, '1']:
            self.assert_code('INVALID_SPEED', lambda: speech.validate_request({**self.request, 'speed': value}))
        for value in [True, 0, 15.01, float('nan')]:
            self.assert_code('INVALID_DURATION', lambda: speech.validate_request({**self.request, 'maxDurationSeconds': value}))

    def test_existing_output_and_symlink_preserved(self):
        target = Path(self.request['outputPath'])
        target.write_bytes(b'original')
        self.assert_code('OUTPUT_EXISTS', lambda: speech.validate_request(self.request))
        self.assertEqual(target.read_bytes(), b'original')
        link = self.folder / 'link.wav'
        link.symlink_to(self.folder / 'missing.wav')
        self.assert_code('OUTPUT_EXISTS', lambda: speech.validate_request({**self.request, 'outputPath': str(link)}))
        self.assertTrue(link.is_symlink())

    def test_relative_and_nonwav_paths_rejected(self):
        for value in ['output.wav', str(self.folder / 'voice.mp3')]:
            self.assert_code('INVALID_OUTPUT', lambda: speech.validate_request({**self.request, 'outputPath': value}))

    def fake_synthesis(self, samples):
        engine = MagicMock()
        engine.create.return_value = (samples, 24000)
        with patch.object(speech, 'doctor', return_value={'ready': True}), \
                patch('onnxruntime.InferenceSession') as session, \
                patch('kokoro_onnx.Kokoro.from_session', return_value=engine):
            result = speech._synthesize(speech.validate_request(self.request))
            self.assertEqual(session.call_args.kwargs['providers'], ['CPUExecutionProvider'])
            return result

    def test_wav_published_only_after_signal_duration_validation(self):
        import numpy as np
        samples = np.sin(np.arange(24000, dtype=np.float32) / 20) * .25
        result = self.fake_synthesis(samples)
        with wave.open(self.request['outputPath'], 'rb') as output:
            self.assertEqual((output.getnchannels(), output.getframerate(), output.getnframes()), (1, 24000, 24000))
        self.assertEqual(result['sha256'], speech.sha256(self.request['outputPath']))
        self.assertEqual(result['duration'], 1.0)
        self.assertGreater(result['metrics']['peakRssBytes'], 0)
        self.assertFalse(list(self.folder.glob('*.part')))

    def test_overlong_dialogue_is_not_truncated_or_published(self):
        import numpy as np
        self.assert_code('DURATION_LIMIT', lambda: self.fake_synthesis(np.ones(360001, dtype=np.float32) * .2))
        self.assertFalse(Path(self.request['outputPath']).exists())

    def test_silence_and_nonfinite_audio_are_not_published(self):
        import numpy as np
        self.assert_code('SILENT_AUDIO', lambda: self.fake_synthesis(np.zeros(24000, dtype=np.float32)))
        self.assert_code('INVALID_AUDIO', lambda: self.fake_synthesis(np.array([float('nan')], dtype=np.float32)))
        self.assertFalse(Path(self.request['outputPath']).exists())

    def test_download_resumes_and_requires_sha256_before_publishing(self):
        content = b'verified official weights'
        entry = {'name': 'model.bin', 'url': 'https://example.invalid/model', 'bytes': len(content),
                 'sha256': hashlib.sha256(content).hexdigest()}
        partial = self.folder / 'model.bin.part'
        partial.write_bytes(content[:8])
        response = io.BytesIO(content[8:])
        response.status, response.headers = 206, {'Content-Range': 'bytes 8-%s/%s' % (len(content) - 1, len(content))}
        with patch.object(speech, 'MODELS', self.folder), patch('urllib.request.urlopen', return_value=response) as network:
            speech.download(entry)
        self.assertEqual(network.call_args.args[0].headers['Range'], 'bytes=8-')
        self.assertEqual((self.folder / 'model.bin').read_bytes(), content)
        self.assertFalse(partial.exists())

    def test_empty_partial_can_resume(self):
        content = b'weights'
        entry = {'name': 'model.bin', 'url': 'https://example.invalid/model', 'bytes': len(content),
                 'sha256': hashlib.sha256(content).hexdigest()}
        (self.folder / 'model.bin.part').touch()
        response = io.BytesIO(content)
        response.status, response.headers = 200, {}
        with patch.object(speech, 'MODELS', self.folder), patch('urllib.request.urlopen', return_value=response):
            speech.download(entry)
        self.assertEqual((self.folder / 'model.bin').read_bytes(), content)

    def test_corrupt_partial_is_retained_without_publishing(self):
        entry = {'name': 'model.bin', 'url': 'https://example.invalid/model', 'bytes': 7,
                 'sha256': hashlib.sha256(b'weights').hexdigest()}
        partial = self.folder / 'model.bin.part'
        partial.write_bytes(b'invalid')
        with patch.object(speech, 'MODELS', self.folder):
            self.assert_code('MODEL_INTEGRITY', lambda: speech.download(entry))
        self.assertEqual(partial.read_bytes(), b'invalid')
        self.assertFalse((self.folder / 'model.bin').exists())

    def test_simultaneous_workers_are_rejected(self):
        with patch.object(speech, 'SPEECH_ROOT', self.folder), speech.exclusive_lock():
            self.assert_code('SPEECH_BUSY', lambda: speech.exclusive_lock().__enter__())


if __name__ == '__main__':
    unittest.main()

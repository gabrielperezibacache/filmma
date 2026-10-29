import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

class PortableVoiceCatalog(unittest.TestCase):
    def test_new_installation_can_diagnose_without_a_speech_directory(self):
        runtime = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            for name in ['filmma_speech.py', 'portable_lock.py', 'speech-model.json']:
                shutil.copy2(runtime / name, target / name)
            self.assertFalse((target / 'speech').exists())
            result = subprocess.run([sys.executable, str(target / 'filmma_speech.py'), 'doctor', '--json'], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            status = json.loads(result.stdout)
            self.assertEqual(status['engine'], 'kokoro')
            self.assertFalse(status['ready'])
            self.assertFalse((target / 'speech' / 'models').exists())

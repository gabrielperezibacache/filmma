import os
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import portable_lock

class PortableLockTests(unittest.TestCase):
    def test_other_process_cannot_claim_lock_until_owner_releases(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'generation.lock'
            code="import portable_lock,sys; h=open(sys.argv[1],'a+');\ntry: portable_lock.acquire(h)\nexcept BlockingIOError: sys.exit(3)\nportable_lock.release(h)"
            environment={**os.environ,'PYTHONPATH':str(Path(portable_lock.__file__).parent)}
            with target.open('a+') as handle:
                portable_lock.acquire(handle)
                blocked=subprocess.run([sys.executable,'-c',code,str(target)],env=environment)
                self.assertEqual(blocked.returncode,3)
                portable_lock.release(handle)
            available=subprocess.run([sys.executable,'-c',code,str(target)],env=environment)
            self.assertEqual(available.returncode,0)

if __name__=='__main__': unittest.main()

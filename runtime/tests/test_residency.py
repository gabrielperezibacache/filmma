import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from weight_residency import residency_plan
import filmma_runtime as runtime

class ResidencyTests(unittest.TestCase):
    def test_low_memory_never_disables_streaming(self):
        h={'appleSilicon': True, 'memoryGB': 36}
        self.assertTrue(residency_plan(h)['ssdStreaming'])
        with self.assertRaises(ValueError): residency_plan(h, 'ram')

    def test_residency_never_weakens_existing_hd_supervisor(self):
        h={'appleSilicon': True, 'memoryGB': 128}
        self.assertFalse(residency_plan(h)['ssdStreaming'])
        self.assertTrue(residency_plan(h, profile='h3-hd-ssd')['ssdStreaming'])
        with self.assertRaises(ValueError): residency_plan(h, 'ram', 'h3-hd-ssd')
        with self.assertRaises(ValueError): residency_plan({'memoryGB':256}, 'ram')

    def test_real_command_changes_only_streaming_flag(self):
        r={'modelDirectory':'/models','prompt':'An actor speaks.','width':512,'height':320,'numFrames':22,'steps':20,'seed':42,'references':[{'type':'image','path':'elena.png'}]}
        a=runtime.h3_command(r,'new.mp4')
        b=runtime.h3_command({**r,'ssdStreaming':False},'new.mp4')
        self.assertIn('--ssd-streaming',a)
        self.assertNotIn('--ssd-streaming',b)
        self.assertEqual([v for v in a if v!='--ssd-streaming'],b)

if __name__=='__main__': unittest.main()

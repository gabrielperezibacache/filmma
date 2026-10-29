import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import signal
import subprocess
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
import filmma_runtime as r
import h3_quantized as q
import model_transfer as transfer
import h3_quant_benchmark as benchmark


class Response(io.BytesIO):
    def __init__(self, payload, start, end, total):
        super().__init__(payload)
        self.status = 206
        self.headers = {'Content-Range': 'bytes %d-%d/%d' % (start, end - 1, total)}


class QuantizedTests(unittest.TestCase):
    def test_unmounted_external_volume_is_rejected_before_creating_directories(self):
        with patch.object(transfer.os.path, 'ismount', return_value=False), patch.object(Path, 'mkdir') as mkdir:
            with self.assertRaisesRegex(RuntimeError, 'Conecta el volumen externo'):
                transfer.transfer({'files': []}, '/Volumes/Filmma-offline-qa/models')
            mkdir.assert_not_called()

    @unittest.skipUnless(os.name == 'posix', 'POSIX process groups')
    def test_cancel_stops_owned_child_before_releasing_generation_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder).resolve(); (base / 'locks').mkdir()
            worker = base / 'filmma-h3-gguf'; pid_file = base / 'child.pid'
            worker.write_text('#!' + sys.executable + '\nimport os,signal\nfrom pathlib import Path\nPath(' + repr(str(pid_file)) + ').write_text(str(os.getpid()))\nprint("ready",flush=True)\nsignal.pause()\n')
            worker.chmod(0o755)
            reference = base / 'reference.png'; reference.write_bytes(b'preserved-reference')
            harness = base / 'harness.py'
            harness.write_text('''import sys,argparse
from pathlib import Path
sys.path.insert(0, %r)
import h3_quant_benchmark as b
import filmma_runtime as r
b.ENGINE=Path(%r)
r.RUNTIME=Path(%r)
b.idle=lambda *_:None
r.normalize_request=lambda value:value
r.prepare_h3_view=lambda value:value
r.hardware=lambda:{'appleSilicon':True,'memoryGB':36}
r.generation_memory_preflight=lambda *_:{'pressureLevel':1,'swapUsedBytes':0,'freePercent':75}
class Monitor:
    failure=None
    def __init__(self,*_):pass
    def start(self):pass
    def close(self):return {'scope':'fake-worker'}
r.LongGenerationMonitor=Monitor
b.run(argparse.Namespace(model=%r,output=%r,variant='gguf-q4',reference=%r,prompt='fixture',width=512,height=320,frames=22,steps=20,seed=42,character_id='elena',project_id='qa',job_marker=None,api_port=None))
''' % (str(Path(__file__).resolve().parents[1] / 'runtime'), str(base), str(base / 'locks'), str(base), str(base / 'result'), str(reference)))
            child = subprocess.Popen([sys.executable, str(harness)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                deadline = time.monotonic() + 8
                while not pid_file.exists() and child.poll() is None and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue(pid_file.exists())
                native_pid = int(pid_file.read_text())
                child.send_signal(signal.SIGTERM)
                child.communicate(timeout=8)
                with self.assertRaises(ProcessLookupError): os.kill(native_pid, 0)
                result = json.loads((base / 'result/result.json').read_text())
                self.assertEqual(result['errorCode'], 'CANCELLED')
                with patch.object(r, 'RUNTIME', base / 'locks'), r.exclusive_lock('generation'):
                    self.assertEqual(reference.read_bytes(), b'preserved-reference')
            finally:
                if child.poll() is None:
                    child.kill(); child.wait()

    def test_managed_benchmark_ignores_only_its_own_job(self):
        jobs = {'jobs': [{'status': 'running', 'result': {'quantizedTestId': 'own'}}]}
        with patch.object(benchmark.urllib.request, 'urlopen', side_effect=lambda *_a, **_k: io.BytesIO(json.dumps(jobs).encode())):
            benchmark.idle('own', 5173)
            with self.assertRaises(RuntimeError): benchmark.idle()
            jobs['jobs'].append({'status': 'queued', 'result': None})
            with self.assertRaises(RuntimeError): benchmark.idle('own', 5173)

    def test_review_preserves_previous_validation_until_a_specific_trial_is_approved(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder); canonical = path / 'latest.json'
            original = {'variants': {'gguf-q4': {'previous': True}, 'gguf-q8': {'preserved': True}}}
            canonical.write_text(json.dumps(original))
            result = path / 'result.json'; result.write_text(json.dumps({'status': 'media-verified', 'request': {'modelVariant': 'gguf-q4'}}))
            with patch.object(q, 'VALIDATION', canonical), patch.object(r, 'RUNTIME', path), patch.object(q, '_check_trial'):
                recorded = q.record_trial('gguf-q4', result)
                self.assertEqual(json.loads(canonical.read_text()), original)
                with self.assertRaises(ValueError): q.review_trial('gguf-q4', 'stale-trial-id', True)
                q.review_trial('gguf-q4', recorded['trialId'], True)
                approved = json.loads(canonical.read_text())
                self.assertEqual(approved['variants']['gguf-q4']['visualReview']['status'], 'accepted')
                self.assertEqual(approved['variants']['gguf-q8'], original['variants']['gguf-q8'])
                another = q.record_trial('gguf-q4', result)
                q.review_trial('gguf-q4', another['trialId'], False)
                self.assertEqual(json.loads(canonical.read_text()), approved)

    def test_prepare_refuses_original_model_folder_before_installing(self):
        with tempfile.TemporaryDirectory() as folder:
            original = Path(folder).resolve()
            with patch.object(r, 'model_dir', return_value=original), patch.object(q, 'install') as install, patch.object(q, 'transfer') as download:
                with self.assertRaises(ValueError): q.prepare('gguf-q4', original, True, lambda *_a, **_k: None)
                install.assert_not_called(); download.assert_not_called()

    def test_progress_tracks_real_native_steps_and_keeps_final_encode_below_completion(self):
        events = []
        with patch.object(r, 'emit', side_effect=lambda kind, **body: events.append({'type': kind, **body})):
            for line in ('[filmma-h3-gguf] 7.1s denoise 1/20', '[filmma-h3-gguf] 150.2s denoise 20/20', '[filmma-h3-gguf] 170s encode 22/22'):
                r.report_engine_line(line)
        values = [e['progress'] for e in events]
        self.assertEqual(values, sorted(values))
        self.assertTrue(all(0 < v < 100 for v in values))
        self.assertEqual([e['completed'] for e in events], [1, 20, 22])
        self.assertEqual(events[-1]['enginePhase'], 'encode')

    def test_baseline_remains_default_and_failed_activation_preserves_config(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / 'config.json'
            content = json.dumps({'models': {'minimax-h3': {'directory': '/original/bf16', 'weightResidency': 'ssd'}}})
            config.write_text(content)
            with patch.object(r, 'CONFIG_PATH', config), patch.object(r, 'RUNTIME', Path(folder)), patch.object(q, 'VALIDATION', Path(folder) / 'absent.json'), patch.object(r, 'hardware', return_value={'appleSilicon': True}):
                self.assertIsNone(q.active())
                with self.assertRaises(ValueError):
                    q.activate('gguf-q4')
                self.assertEqual(config.read_text(), content)

    def test_catalog_does_not_mix_q4_and_q8_transformers(self):
        low, high = q.catalog('gguf-q4'), q.catalog('gguf-q8')
        a, b = {x['path']: x for x in low['files']}, {x['path']: x for x in high['files']}
        for name in q.Q8:
            self.assertNotEqual(a[name]['sha256'], b[name]['sha256'])
            self.assertIn('-Q8_0.gguf', b[name]['url'])
        self.assertEqual(a['FL2VA/text_encoder/model.gguf'], b['FL2VA/text_encoder/model.gguf'])

    def test_request_keeps_reference_order_and_continuity_ids(self):
        with tempfile.TemporaryDirectory() as folder:
            ref = Path(folder) / 'elena.png'; ref.write_bytes(b'fixture')
            links = {'projectId': 'film', 'sceneId': 'scene', 'characterIds': ['elena'],
                     'referenceAssetIds': ['elena-image'], 'referenceCharacterIds': ['elena']}
            normalized = r.normalize_request({'prompt': 'Elena turns.', 'outputPath': str(Path(folder) / 'new.mp4'),
                'continuityLinks': links, 'references': [{'type': 'image', 'path': str(ref)}]})
            self.assertEqual(normalized['continuityLinks'], links)
            normalized['engineExecutable'] = '/isolated/filmma-h3-gguf'
            command = r.h3_command(normalized, '/isolated/new.mp4')
            self.assertEqual(command[0], '/isolated/filmma-h3-gguf')
            self.assertEqual(command[command.index('--ref-image') + 1], str(ref.resolve()))
            self.assertIn('--ssd-streaming', command)
            self.assertEqual(ref.read_bytes(), b'fixture')
            with self.assertRaises(r.RuntimeFailure):
                r.normalize_request({**normalized, 'numFrames': 362})

    @unittest.skipUnless(hasattr(os, 'pwrite'), 'POSIX range writer')
    def test_range_resume_skips_committed_chunks_and_verifies_full_hash(self):
        payload = b'Elena retains her face and camel coat between scenes.'
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder); partial = directory / 'weights.part'
            partial.write_bytes(payload[:13] + b'\0' * (len(payload) - 13))
            entry = {'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(), 'url': 'https://huggingface.co/test/model/resolve/pinned/weights'}
            state = {'size': len(payload), 'sha256': entry['sha256'], 'prefix': 5, 'chunk': 8, 'complete': [0]}
            journal = Path(str(partial) + '.ranges.json'); journal.write_text(json.dumps(state))
            requests = []
            def open_range(request, **_):
                start, end = map(int, request.get_header('Range').removeprefix('bytes=').split('-'))
                requests.append((start, end + 1))
                return Response(payload[start:end + 1], start, end + 1, len(payload))
            with patch.object(transfer.urllib.request, 'urlopen', side_effect=open_range), patch.object(transfer, 'RESERVE', 0):
                transfer.ranged_fetch(entry, partial, directory, threading.Event(), lambda *_: None)
            self.assertEqual(partial.read_bytes(), payload)
            self.assertTrue(transfer.file_matches(partial, entry))
            self.assertFalse(any(start < 13 for start, _ in requests))
            self.assertTrue(journal.exists())

    def test_download_never_replaces_an_existing_original(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder); original = directory / 'weights'; original.write_bytes(b'original')
            manifest = {'files': [{'path': 'weights', 'size': 8, 'sha256': hashlib.sha256(b'new data').hexdigest(),
                'url': 'https://huggingface.co/test/model/resolve/pinned/weights'}]}
            with patch.object(transfer, 'RESERVE', 0), patch.object(transfer.urllib.request, 'urlopen') as network:
                with self.assertRaises(RuntimeError): transfer.transfer(manifest, directory, lambda *_: None)
                network.assert_not_called()
            self.assertEqual(original.read_bytes(), b'original')

    def test_paths_cannot_escape_model_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest = {'files': [{'path': '../original', 'size': 1, 'sha256': '0' * 64,
                'url': 'https://huggingface.co/test/model/resolve/pinned/weights'}]}
            with self.assertRaises(ValueError): transfer.transfer(manifest, Path(folder) / 'model', lambda *_: None)

    def test_bf16_evidence_does_not_validate_quantized_variant(self):
        with tempfile.TemporaryDirectory() as folder:
            evidence = Path(folder) / 'result.json'
            baseline = r.CATALOG['models']['minimax-h3']
            evidence.write_text(json.dumps({'model': 'minimax-h3', 'status': 'media-verified',
                'modelRevision': baseline['revision'], 'runtimeRevision': baseline['runtime']['revision']}))
            with patch.object(q, 'active', return_value='gguf-q4'):
                self.assertIsNone(r.read_validation(evidence, 'minimax-h3'))


if __name__ == '__main__':
    unittest.main()

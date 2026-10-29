import importlib.util
import json
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('filmma_runtime', Path(__file__).resolve().parents[1] / 'filmma_runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        # These contracts describe BF16. An installed GGUF selection on the
        # developer's machine must not switch their fixtures or read weights.
        backend = patch.object(runtime.h3_quantized, 'active', return_value=None)
        backend.start()
        self.addCleanup(backend.stop)
        self.request = {'model': 'minimax-h3', 'prompt': 'An actor crosses the station.',
                        'outputPath': str(self.root / 'take.mp4'), 'width': 512, 'height': 320}

    def tearDown(self):
        self.tmp.cleanup()

    def test_explicit_verification_checks_sha256_without_fetching_or_modifying_files(self):
        target = self.root / 'weights.bin'
        original = b'tiny fixture weights'
        target.write_bytes(original)
        entries = [{'path': 'weights.bin', 'size': len(original), 'sha256': hashlib.sha256(original).hexdigest()}]
        with patch.object(runtime, 'model_dir', return_value=self.root), patch.object(runtime, 'selected_files', return_value=entries), patch.object(runtime, 'exclusive_lock', return_value=__import__('contextlib').nullcontext()), patch.object(runtime, 'emit') as emit:
            runtime.verify_model('ltx-2b')
            self.assertTrue(emit.call_args.kwargs['complete'])
            self.assertEqual(target.read_bytes(), original)
            target.write_bytes(b'X' * len(original))
            with self.assertRaises(runtime.RuntimeFailure) as error:
                runtime.verify_model('ltx-2b')
            self.assertEqual(error.exception.code, 'MODEL_INTEGRITY_FAILED')
            self.assertEqual(target.read_bytes(), b'X' * len(original))

    def test_h3_frame_geometry_is_reported(self):
        normalized = runtime.normalize_request({**self.request, 'numFrames': 23})
        self.assertEqual(normalized['numFrames'], 39)
        self.assertEqual(normalized['requestedFrames'], 23)
        self.assertTrue(normalized['warnings'])

    def test_long_h3_profile_is_explicit_bounded_and_preserves_native_frames(self):
        normalized = runtime.normalize_request({**self.request, 'memoryProfile': 'h3-long-ssd', 'numFrames': 345, 'steps': 20})
        self.assertEqual(normalized['numFrames'], 345)
        self.assertEqual(normalized['numFrames'] / normalized['fps'], 14.375)
        self.assertEqual(normalized['memoryProfile'], 'h3-long-ssd')
        self.assertTrue(normalized['ssdStreaming'])
        self.assertEqual(runtime.normalize_request(self.request)['memoryProfile'], 'conservative')
        for invalid in ({'memoryProfile': 'unknown'}, {'model': 'ltx-2b'}, {'width': 544}, {'width': 512, 'height': 352}, {'steps': 21}, {'inputImage': 'reference.png'}, {'lastFrame': 'reference.png'}, {'references': [{'type': 'image', 'path': 'reference.png'}]}):
            with self.subTest(invalid=invalid), self.assertRaises(runtime.RuntimeFailure):
                runtime.normalize_request({**self.request, 'memoryProfile': 'h3-long-ssd', 'numFrames': 345, **invalid})

    def test_native_h3_profile_keeps_requested_canvas_and_bounds_aligned_visual_tokens(self):
        candidate = {**self.request, 'memoryProfile': 'h3-native-ssd', 'width': 1024, 'height': 576, 'numFrames': 22, 'steps': 20}
        for dimensions in ({'width': 1024, 'height': 576}, {'width': 576, 'height': 1024}, {'width': 768, 'height': 768}):
            normalized = runtime.normalize_request({**candidate, **dimensions})
            self.assertEqual(normalized['memoryProfile'], 'h3-native-ssd')
            self.assertEqual(normalized['numFrames'], 22)
            self.assertTrue(normalized['ssdStreaming'])
            command = runtime.h3_command(normalized, self.root / 'partial.mp4')
            self.assertEqual(command[command.index('--width') + 1], str(dimensions['width']))
            self.assertEqual(command[command.index('--height') + 1], str(dimensions['height']))
            self.assertNotIn('--render-width', command)
            self.assertIn('--ssd-streaming', command)
        for invalid in ({'numFrames': 193}, {'numFrames': 209}, {'numFrames': 345}, {'width': 1312}, {'width': 1280, 'height': 768}, {'width': 1000}, {'steps': 21}, {'model': 'ltx-2b'}, {'inputImage': 'reference.png'}, {'lastFrame': 'reference.png'}, {'references': [{'type': 'image', 'path': 'reference.png'}]}):
            with self.subTest(invalid=invalid), self.assertRaises(runtime.RuntimeFailure):
                runtime.normalize_request({**candidate, **invalid})

    def test_native_h3_budget_accepts_longer_lower_resolution_without_changing_clock(self):
        for width, height, frames, tokens in ((768, 448, 345, 34272), (448, 768, 345, 34272), (1024, 576, 192, 32832), (576, 1024, 192, 32832), (1024, 576, 90, 15552)):
            normalized = runtime.normalize_request({**self.request, 'memoryProfile': 'h3-native-ssd', 'width': width, 'height': height, 'numFrames': frames, 'steps': 20})
            self.assertEqual((normalized['width'], normalized['height'], normalized['numFrames']), (width, height, frames))
            self.assertEqual(runtime.h3_visual_tokens(width, height, frames), tokens)
        # Temporal rounding happens before the budget check: 193 becomes209,
        # which is already too expensive at1024x576; it must not round down.
        with self.assertRaises(runtime.RuntimeFailure) as caught:
            runtime.normalize_request({**self.request, 'memoryProfile': 'h3-native-ssd', 'width': 1024, 'height': 576, 'numFrames': 193})
        self.assertEqual(caught.exception.code, 'NATIVE_PROFILE_LIMIT')

    def test_native_hd_keeps_full_1280_by736_canvas_and_rejects_720_or_over_budget(self):
        for width, height, frames, tokens in ((1280,736,22,6440),(1280,736,124,34040),(736,1280,124,34040)):
            normalized = runtime.normalize_request({**self.request, 'memoryProfile': 'h3-native-ssd', 'width': width, 'height': height, 'numFrames': frames, 'steps': 20})
            self.assertEqual((normalized['width'], normalized['height'], normalized['numFrames']), (width,height,frames))
            self.assertEqual(runtime.h3_visual_tokens(width,height,frames),tokens)
            command = runtime.h3_command(normalized, self.root / 'partial.mp4')
            self.assertEqual(command[command.index('--width')+1],str(width))
            self.assertEqual(command[command.index('--height')+1],str(height))
            self.assertNotIn('--render-width', command)
        for patch in ({'height':720},{'numFrames':125},{'numFrames':141},{'numFrames':345},{'width':1312},{'height':768}):
            with self.subTest(patch=patch), self.assertRaises(runtime.RuntimeFailure):
                runtime.normalize_request({**self.request, 'memoryProfile':'h3-native-ssd', 'width':1280, 'height':736, 'numFrames':22, **patch})

    def test_hd_long_profile_is_separate_explicit_and_keeps_native_budget_unchanged(self):
        hd = {**self.request, 'memoryProfile': 'h3-hd-ssd', 'width': 1280, 'height': 736, 'numFrames': 345, 'steps': 20}
        for width, height in ((1280,736),(736,1280)):
            normalized = runtime.normalize_request({**hd,'width':width,'height':height})
            self.assertEqual(normalized['numFrames'],345)
            self.assertEqual(runtime.h3_visual_tokens(width,height,345),93840)
            command = runtime.h3_command(normalized,self.root/'partial.mp4')
            self.assertNotIn('--render-width',command)
            self.assertEqual(command[command.index('--width')+1],str(width))
            self.assertEqual(command[command.index('--height')+1],str(height))
        for patch in ({'memoryProfile':'h3-native-ssd'},{'width':1024,'height':576},{'width':960,'height':960},{'height':720},{'numFrames':346},{'steps':21},{'model':'ltx-2b'},{'inputImage':'ref.png'},{'lastFrame':'ref.png'},{'references':[{'type':'image','path':'ref.png'}]}):
            with self.subTest(patch=patch), self.assertRaises(runtime.RuntimeFailure):
                runtime.normalize_request({**hd,**patch})
        self.assertEqual(runtime.NATIVE_PROFILE_LIMITS['maxVideoTokens'],35000)
        self.assertEqual(runtime.HD_PROFILE_LIMITS['maxInferenceSeconds'],43200)
        for key in ('maxProcessFootprintBytes','maxProcessRssBytes','maxSwapGrowthBytes','minFreePercentBeforeStart','diskReserveBytes','sampleIntervalSeconds','warningSamplesBeforeStop'):
            self.assertEqual(runtime.HD_PROFILE_LIMITS[key],runtime.LONG_PROFILE_LIMITS[key])
        self.assertNotIn('maxInferenceSeconds',runtime.NATIVE_PROFILE_LIMITS)
        self.assertNotIn('maxInferenceSeconds',runtime.LONG_PROFILE_LIMITS)

    def test_hd_timeout_kills_and_reaps_a_term_ignoring_child_and_records_reason(self):
        # This child only sleeps. It has no GPU access or model inference.
        child = subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print("ready",flush=True); time.sleep(30)'],stdout=subprocess.PIPE,text=True,start_new_session=True)
        monitor = None
        try:
            self.assertEqual(child.stdout.readline().strip(),'ready')
            request = runtime.normalize_request({**self.request,'memoryProfile':'h3-hd-ssd','width':1280,'height':736,'numFrames':345})
            baseline = {'pressureLevel':1,'swapUsedBytes':0,'freePercent':50}
            with patch.object(runtime,'process_memory',return_value={'footprintBytes':1,'residentBytes':1,'startTime':10}), patch.object(runtime,'system_memory',return_value=baseline), patch.object(runtime,'emit') as emitted:
                monitor = runtime.LongGenerationMonitor(child,request,baseline)
                monitor.started -= 43201
                monitor._run()
                self.assertEqual(child.poll(),-runtime.signal.SIGKILL)
                self.assertEqual(monitor.failure.code,'GENERATION_TIMEOUT')
                self.assertGreaterEqual(monitor.stats['elapsedSeconds'],43200)
                events = [call.kwargs for call in emitted.call_args_list]
                self.assertTrue(any(event.get('stage')=='timeout-stop' and event.get('code')=='GENERATION_TIMEOUT' for event in events))
                self.assertIn('No se reintenta automáticamente',monitor.failure.message)
                self.assertFalse(Path(self.request['outputPath']).exists())
        finally:
            if child.poll() is None:
                child.kill(); child.wait()
            if child.stdout:
                child.stdout.close()

    def test_native_pilot_uses_existing_pressure_guards_and_reports_its_own_limits(self):
        from unittest.mock import Mock
        normalized = runtime.normalize_request({**self.request, 'memoryProfile': 'h3-native-ssd', 'width': 1024, 'height': 576, 'numFrames': 22})
        healthy = {'pressureLevel': 1, 'swapUsedBytes': 0, 'freePercent': 50}
        with patch.object(runtime, 'system_memory', return_value=healthy), patch.object(runtime, 'process_memory', return_value={'footprintBytes': 1}), patch.object(runtime, 'require_disk_reserve') as disk:
            self.assertEqual(runtime.generation_memory_preflight(normalized, {'memoryGB': 36}), healthy)
            disk.assert_called_once()
        for key in ('maxProcessFootprintBytes', 'maxProcessRssBytes', 'maxSwapGrowthBytes', 'diskReserveBytes', 'minFreePercentBeforeStart', 'warningSamplesBeforeStop', 'sampleIntervalSeconds'):
            self.assertEqual(runtime.NATIVE_PROFILE_LIMITS[key], runtime.LONG_PROFILE_LIMITS[key])
        monitor = runtime.LongGenerationMonitor(Mock(pid=987654), normalized, healthy)
        self.assertEqual(monitor.stats['profile'], 'h3-native-ssd')
        self.assertEqual(monitor.stats['limits']['maxFrames'], 345)
        self.assertEqual(monitor.stats['limits']['maxVideoTokens'], 35000)
        self.assertEqual(monitor.stats['limits']['maxPixels'], 1280 * 736)
        self.assertEqual(monitor.stats['limits']['maxDimension'], 1280)
        with patch.object(runtime, 'system_memory', return_value={**healthy, 'pressureLevel': 2}), self.assertRaises(runtime.RuntimeFailure):
            runtime.generation_memory_preflight(normalized, {'memoryGB': 36})
        with patch.object(runtime, 'system_memory', return_value=healthy), patch.object(runtime, 'process_memory', return_value=None), self.assertRaises(runtime.RuntimeFailure):
            runtime.generation_memory_preflight(normalized, {'memoryGB': 36})

    def test_h3_one_step_rejected_before_model_load_without_changing_ltx(self):
        with self.assertRaises(runtime.RuntimeFailure):
            runtime.normalize_request({**self.request, 'steps': 1})
        self.assertEqual(runtime.normalize_request({**self.request, 'model': 'ltx-2b', 'steps': 1})['steps'], 1)

    def test_long_profile_preflight_does_not_remove_conservative_budget(self):
        normalized = runtime.normalize_request({**self.request, 'numFrames': 345})
        with self.assertRaises(runtime.RuntimeFailure) as caught:
            runtime.generation_memory_preflight(normalized, {'memoryGB': 36})
        self.assertEqual(caught.exception.code, 'MEMORY_BUDGET')
        normalized['memoryProfile'] = 'h3-long-ssd'
        healthy = {'pressureLevel': 1, 'swapUsedBytes': 1024**3, 'freePercent': 50}
        with patch.object(runtime, 'system_memory', return_value=healthy), patch.object(runtime, 'process_memory', return_value={'footprintBytes': 1}), patch.object(runtime, 'require_disk_reserve') as disk:
            self.assertEqual(runtime.generation_memory_preflight(normalized, {'memoryGB': 36}), healthy)
            disk.assert_called_once()
            with self.assertRaises(runtime.RuntimeFailure):
                runtime.generation_memory_preflight(normalized, {'memoryGB': 24})
        for unhealthy in ({**healthy, 'pressureLevel': 2}, {**healthy, 'freePercent': 24}):
            with patch.object(runtime, 'system_memory', return_value=unhealthy), self.assertRaises(runtime.RuntimeFailure) as caught:
                runtime.generation_memory_preflight(normalized, {'memoryGB': 36})
            self.assertEqual(caught.exception.code, 'MEMORY_PRESSURE')

    def test_memory_monitor_thresholds_and_missing_telemetry_fail_closed(self):
        baseline = {'pressureLevel': 1, 'swapUsedBytes': 3 * 1024**3}
        sample = {**baseline, 'footprintBytes': 8 * 1024**3, 'residentBytes': 9 * 1024**3}
        self.assertIsNone(runtime.memory_stop_reason(sample, baseline, 0))
        self.assertIsNone(runtime.memory_stop_reason({**sample, 'pressureLevel': 2}, baseline, 2))
        for bad, warnings in [({'footprintBytes': 24 * 1024**3 + 1}, 0), ({'residentBytes': 28 * 1024**3 + 1}, 0), ({'pressureLevel': 4}, 1), ({'pressureLevel': 2}, 3), ({'swapUsedBytes': 5 * 1024**3 + 1}, 0)]:
            with self.subTest(bad=bad):
                self.assertIsNotNone(runtime.memory_stop_reason({**sample, **bad}, baseline, warnings))
        with patch.object(runtime, 'run_read', return_value=None), self.assertRaises(runtime.RuntimeFailure) as caught:
            runtime.system_memory()
        self.assertEqual(caught.exception.code, 'MEMORY_TELEMETRY_UNAVAILABLE')

    def test_memory_monitor_stops_only_its_process_group_without_retry(self):
        from unittest.mock import Mock
        child = Mock(pid=987654, poll=Mock(return_value=None))
        normalized = runtime.normalize_request({**self.request, 'memoryProfile': 'h3-long-ssd', 'numFrames': 345})
        baseline = {'pressureLevel': 1, 'swapUsedBytes': 0, 'freePercent': 50}
        with patch.object(runtime, 'process_memory', return_value={'footprintBytes': 25 * 1024**3, 'residentBytes': 10 * 1024**3, 'startTime': 10}), patch.object(runtime, 'system_memory', return_value=baseline), patch.object(runtime.os, 'killpg') as killed, patch.object(runtime, 'emit'):
            monitor = runtime.LongGenerationMonitor(child, normalized, baseline)
            monitor._run()
            killed.assert_called_once_with(child.pid, runtime.signal.SIGTERM)
            self.assertEqual(monitor.failure.code, 'MEMORY_PRESSURE')
            self.assertEqual(monitor.stats['samples'], 1)
        child.poll.return_value = 0
        with patch.object(runtime.os, 'killpg') as killed:
            monitor._halt('MEMORY_PRESSURE', 'late observation')
            killed.assert_not_called()

    def test_watchdog_terminates_a_real_child_without_gpu_or_output(self):
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'], start_new_session=True)
        baseline = {'pressureLevel': 1, 'swapUsedBytes': 0, 'freePercent': 50}
        normalized = runtime.normalize_request({**self.request, 'memoryProfile': 'h3-long-ssd', 'numFrames': 345})
        monitor = None
        try:
            with patch.object(runtime, 'process_memory', return_value={'footprintBytes': 25 * 1024**3, 'residentBytes': 10 * 1024**3, 'startTime': 10}), patch.object(runtime, 'system_memory', return_value=baseline), patch.object(runtime, 'emit'):
                monitor = runtime.LongGenerationMonitor(child, normalized, baseline)
                monitor.start()
                self.assertEqual(child.wait(timeout=5), -runtime.signal.SIGTERM)
                monitor.close()
            self.assertEqual(monitor.failure.code, 'MEMORY_PRESSURE')
            self.assertFalse(Path(self.request['outputPath']).exists())
        finally:
            if monitor:
                monitor.close()
            if child.poll() is None:
                child.kill()
                child.wait()

    def test_ltx_frame_geometry_is_reported(self):
        normalized = runtime.normalize_request({**self.request, 'model': 'ltx-2b', 'numFrames': 24})
        self.assertEqual(normalized['numFrames'], 25)

    def test_generation_never_exceeds_fifteen_seconds_after_temporal_rounding(self):
        for model, accepted, overflow in [('minimax-h3', 345, 346), ('ltx-2b', 353, 354)]:
            result = runtime.normalize_request({**self.request, 'model': model, 'numFrames': accepted})
            self.assertLessEqual(result['numFrames'] / result['fps'], 15)
            for frames in (overflow, 360, 362):
                with self.assertRaises(runtime.RuntimeFailure) as ctx:
                    runtime.normalize_request({**self.request, 'model': model, 'numFrames': frames})
                self.assertEqual(ctx.exception.code, 'DURATION_LIMIT')

    def test_native_timing_is_not_silently_changed_at_encoding(self):
        for model in ('minimax-h3', 'ltx-2b'):
            with self.assertRaises(runtime.RuntimeFailure) as ctx:
                runtime.normalize_request({**self.request, 'model': model, 'fps': 60})
            self.assertEqual(ctx.exception.code, 'UNSUPPORTED_FPS')

    def test_invalid_dimensions_are_rejected_not_silently_resized(self):
        with self.assertRaises(runtime.RuntimeFailure) as ctx:
            runtime.normalize_request({**self.request, 'height': 432})
        self.assertEqual(ctx.exception.code, 'INVALID_DIMENSIONS')

    def test_existing_output_is_preserved(self):
        output = Path(self.request['outputPath']); output.write_bytes(b'original')
        with self.assertRaises(runtime.RuntimeFailure) as ctx:
            runtime.normalize_request(self.request)
        self.assertEqual(ctx.exception.code, 'OUTPUT_EXISTS')
        self.assertEqual(output.read_bytes(), b'original')

    def test_prompt_is_one_argument_without_shell_interpretation(self):
        normalized = runtime.normalize_request({**self.request, 'prompt': '$(touch /tmp/never); `danger`'})
        command = runtime.h3_command(normalized, 'output.mp4')
        self.assertEqual(command[command.index('-p') + 1], '$(touch /tmp/never); `danger`')
        self.assertIn('--ssd-streaming', command)
        self.assertNotIn('--show', command)

    def test_reference_modes_cannot_mix(self):
        with self.assertRaises(runtime.RuntimeFailure) as ctx:
            runtime.normalize_request({**self.request, 'inputImage': 'a.png', 'references': [{'type': 'image', 'path': 'b.png'}]})
        self.assertEqual(ctx.exception.code, 'INCOMPATIBLE_REFERENCES')

    def test_ltx_does_not_claim_identity_references(self):
        with self.assertRaises(runtime.RuntimeFailure) as ctx:
            runtime.normalize_request({**self.request, 'model': 'ltx-2b', 'references': [{'type': 'image', 'path': 'b.png'}]})
        self.assertEqual(ctx.exception.code, 'UNSUPPORTED_CAPABILITY')

    def test_shared_h3_view_keeps_links_off_external_model_volume(self):
        source = self.root / 'external-model'
        ((source / 'FL2VA' / 'text_encoder').resolve()).mkdir(parents=True)
        with patch.object(runtime, 'RUNTIME', self.root / 'runtime'):
            view = Path(runtime.prepare_h3_view(source))
            self.assertEqual((view / 'Ref2VA' / 'text_encoder').resolve(), (source / 'FL2VA' / 'text_encoder').resolve())
            self.assertFalse((source / 'Ref2VA').exists())
            self.assertEqual(runtime.prepare_h3_view(source), str(view))

    def test_generation_lock_prevents_two_gpu_workers(self):
        with patch.object(runtime, 'RUNTIME', self.root):
            with runtime.exclusive_lock('generation'):
                with self.assertRaises(runtime.RuntimeFailure) as ctx:
                    with runtime.exclusive_lock('generation'):
                        pass
        self.assertEqual(ctx.exception.code, 'RUNTIME_BUSY')

    def test_negative_prompt_limit_is_visible(self):
        normalized = runtime.normalize_request({**self.request, 'negativePrompt': 'blur'})
        self.assertIn('canal negativo independiente', normalized['warnings'][0])
        self.assertEqual(normalized['negativePrompt'], 'blur')

    def test_manifest_has_pinned_revisions_and_correct_large_file_hashes(self):
        for model in runtime.CATALOG['models'].values():
            self.assertEqual(len(model['revision']), 40)
            self.assertEqual(len(model['runtime']['revision']), 40)
            for file in model['files']:
                self.assertFalse(Path(file['path']).is_absolute())
                self.assertNotIn('..', Path(file['path']).parts)
                if file['size'] > 100_000_000:
                    self.assertEqual(len(file['sha256']), 64)

    def test_disk_plan_accounts_for_resume_and_reserve(self):
        fake = [{'path': 'weight.bin', 'size': 100, 'optional': False}]
        (self.root / 'weight.bin.part').write_bytes(b'x' * 40)
        with patch.object(runtime, 'selected_files', return_value=fake):
            plan = runtime.download_plan('ltx-2b', self.root)
        self.assertEqual(plan['downloadBytes'], 60)
        self.assertEqual(plan['reserveBytes'], 20 * 1024**3)

    def test_no_generation_without_weights(self):
        with patch.object(runtime, 'RUNTIME', self.root), patch.object(runtime, 'executable', return_value=Path(sys.executable)), patch.object(runtime, 'engine_working_directory', return_value=self.root), patch.object(runtime, 'model_dir', return_value=self.root), patch.object(runtime, 'hardware', return_value={'appleSilicon': True}):
            with self.assertRaises(runtime.RuntimeFailure) as ctx:
                runtime.generate(self.request)
        self.assertEqual(ctx.exception.code, 'MODEL_NOT_INSTALLED')
        self.assertFalse(Path(self.request['outputPath']).exists())

    def test_unmounted_external_volume_never_falls_back_to_internal_disk(self):
        with patch.object(runtime, 'RUNTIME', self.root), patch.object(runtime.os.path, 'ismount', return_value=False):
            plan = runtime.download_plan('ltx-2b', '/Volumes/Filmma-unmounted-test/models')
            self.assertFalse(plan['volumeMounted'])
            self.assertFalse(plan['fits'])
            self.assertEqual(plan['freeBytes'], 0)
            with self.assertRaises(runtime.RuntimeFailure) as ctx:
                runtime.download('ltx-2b', '/Volumes/Filmma-unmounted-test/models', accepted=True)
            self.assertEqual(ctx.exception.code, 'VOLUME_NOT_MOUNTED')

    def test_nan_and_boolean_request_values_rejected(self):
        for value in (float('nan'), True, '24'):
            with self.assertRaises(runtime.RuntimeFailure):
                runtime.normalize_request({**self.request, 'fps': value})

    def test_diagnostic_evidence_never_applies_to_another_model_revision(self):
        normalized = runtime.normalize_request(self.request)
        entry = runtime.CATALOG['models']['minimax-h3']
        with patch.object(runtime, 'RUNTIME', self.root):
            self.assertIsNone(runtime.last_validation('minimax-h3'))
            runtime.save_validation(normalized, {'modelRevision': 'outdated', 'runtimeRevision': entry['runtime']['revision']}, {'chip': 'Test chip', 'memoryGB': 36})
            self.assertIsNone(runtime.last_validation('minimax-h3'))
            runtime.save_validation(normalized, {'modelRevision': entry['revision'], 'runtimeRevision': entry['runtime']['revision']}, {'chip': 'Test chip', 'memoryGB': 36})
            evidence = runtime.last_validation('minimax-h3')
            self.assertEqual(evidence['status'], 'media-verified')
            self.assertFalse(evidence['outputAvailable'])

    def test_native_validation_retains_prior_long_evidence_by_configuration(self):
        entry = runtime.CATALOG['models']['minimax-h3']
        metadata = {'modelRevision': entry['revision'], 'runtimeRevision': entry['runtime']['revision']}
        long = runtime.normalize_request({**self.request, 'memoryProfile': 'h3-long-ssd', 'numFrames': 345})
        native = runtime.normalize_request({**self.request, 'memoryProfile': 'h3-native-ssd', 'width': 1024, 'height': 576, 'numFrames': 22})
        hw = {'chip': 'Test chip', 'memoryGB': 36}
        with patch.object(runtime, 'RUNTIME', self.root):
            runtime.save_validation(long, metadata, hw)
            previous = (self.root / 'validation/last-minimax-h3.json').read_text()
            runtime.save_validation(native, metadata, hw)
            self.assertEqual(runtime.last_validation('minimax-h3')['parameters']['memoryProfile'], 'h3-native-ssd')
            records = [p.read_text() for p in (self.root / 'validation/history').glob('*.json')]
            self.assertIn(previous, records)
            profiles = {json.loads(record)['parameters']['memoryProfile'] for record in records}
            self.assertEqual(profiles, {'h3-long-ssd', 'h3-native-ssd'})

    def test_validation_history_is_compact_exact_and_filtered_by_current_revisions(self):
        entry = runtime.CATALOG['models']['minimax-h3']
        metadata = {'modelRevision': entry['revision'], 'runtimeRevision': entry['runtime']['revision'], 'largeDiagnostic': 'not part of doctor history'}
        long = runtime.normalize_request({**self.request, 'memoryProfile': 'h3-long-ssd', 'numFrames': 345})
        native = runtime.normalize_request({**self.request, 'memoryProfile': 'h3-native-ssd', 'width': 1024, 'height': 576, 'numFrames': 22})
        hw = {'chip': 'Test chip', 'memoryGB': 36}
        with patch.object(runtime, 'RUNTIME', self.root):
            runtime.save_validation(long, metadata, hw)
            runtime.save_validation({**long, 'seed': 7}, metadata, hw)
            runtime.save_validation(native, metadata, hw)
            latest = runtime.last_validation('minimax-h3')
            directory = self.root / 'validation/history'
            for name, altered in [('old-model', {'modelRevision': 'old'}), ('old-runtime', {'runtimeRevision': 'old'}), ('failed', {'status': 'failed'}), ('wrong-model', {'model': 'ltx-2b'}), ('bad-parameters', {'parameters': []}), ('bad-mode', {'mode': []})]:
                (directory / ('minimax-h3-' + name + '.json')).write_text(json.dumps({**latest, **altered}))
            (directory / 'minimax-h3-invalid.json').write_text('{broken')
            (directory / 'minimax-h3-list.json').write_text('[]')
            history = runtime.validation_history('minimax-h3', latest)
            self.assertEqual(len(history), 2)
            self.assertEqual(history[0]['parameters']['memoryProfile'], 'h3-native-ssd')
            self.assertEqual(history[1]['parameters']['numFrames'], 345)
            self.assertEqual(history[1]['parameters']['seed'], 7)
            for record in history:
                self.assertNotIn('metadata', record)
                self.assertNotIn('outputPath', record)
                self.assertFalse(record['outputAvailable'])
            # Existing latest evidence remains visible before any historical
            # files existed, and the backward-compatible pointer still works.
            self.assertEqual(runtime.validation_history('minimax-h3', latest)[0], history[0])
            self.assertEqual(runtime.last_validation('minimax-h3')['parameters']['numFrames'], 22)

    def test_download_token_stays_on_huggingface_origin(self):
        request = runtime.urllib.request.Request('https://huggingface.co/model/file', headers={'Authorization': 'Bearer test-value', 'Range': 'bytes=4-'})
        handler = runtime.ModelRedirectHandler()
        redirected = handler.redirect_request(request, None, 302, 'Found', {}, 'https://cdn.example/signed-file')
        self.assertIsNone(redirected.get_header('Authorization'))
        self.assertEqual(redirected.get_header('Range'), 'bytes=4-')
        same_origin = handler.redirect_request(request, None, 302, 'Found', {}, 'https://huggingface.co/another-file')
        self.assertEqual(same_origin.get_header('Authorization'), 'Bearer test-value')

    def test_full_download_progress_does_not_disable_complete_base(self):
        def inspected(model, directory=None, references=False):
            return {'complete': not references, 'totalBytes': 210 if references else 144, 'progress': 80}
        hw = {'appleSilicon': True, 'ffmpeg': '/ffmpeg', 'ffprobe': '/ffprobe'}
        with patch.object(runtime, 'hardware', return_value=hw), patch.object(runtime, 'inspect_files', side_effect=inspected), patch.object(runtime, 'executable', return_value=Path(sys.executable)), patch.object(runtime, 'engine_working_directory', return_value=self.root), patch.object(runtime, 'run_read', return_value='ok'), patch.object(runtime, 'config', return_value={'models': {'minimax-h3': {'withReferences': True}}}), patch.object(runtime, 'operation_active', return_value=True), patch.object(runtime, 'download_plan', return_value={}), patch.object(runtime, 'last_validation', return_value=None):
            h3 = runtime.doctor()['models'][0]
        self.assertTrue(h3['available'])
        self.assertEqual(h3['status'], 'downloading')
        self.assertEqual(h3['weights']['totalBytes'], 210)
        self.assertTrue(h3['weights']['withReferences'])
        self.assertFalse(h3['capabilities']['referencesInstalled'])

    @unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg required for real image preparation')
    def test_real_anchor_preparation_preserves_geometry_and_original(self):
        source = self.root / 'wide.ppm'
        source.write_bytes(b'P6\n128 64\n255\n' + b'\xff\xff\xff' * 128 * 64)
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        destination = self.root / 'anchor.png'
        runtime.prepare_anchor(str(source), destination, 256, 256)
        pixels = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(destination), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
        self.assertEqual(len(pixels), 256 * 256 * 3)
        row = 256 * 3
        self.assertEqual(pixels[:64 * row], b'\x00' * 64 * row)
        self.assertEqual(pixels[64 * row:192 * row], b'\xff' * 128 * row)
        self.assertEqual(pixels[192 * row:], b'\x00' * 64 * row)
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)


if __name__ == '__main__':
    unittest.main()

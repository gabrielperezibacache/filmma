import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
sys.path.insert(0, str(ROOT / 'runtime/lipsync'))
import filmma_lipsync as launcher
import worker


def face(x=.2):
 return {'confidence':.99, 'box':{'x':x,'y':.2,'width':.3,'height':.4},
 'lips':[{'x':x+.15,'y':.5}]*4,'nose':[{'x':x+.15,'y':.35},{'x':x+.15,'y':.4}],
 'contour':[{'x':x,'y':.6}]}


class LipSyncGuards(unittest.TestCase):
 def setUp(self):
  self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
  self.folder = Path(self.temp.name)
  (self.folder/'source.mp4').write_bytes(b'original-video')
  (self.folder/'dialogue.wav').write_bytes(b'original-dialogue')
  self.request = {'sourcePath':str(self.folder/'source.mp4'),'audioPath':str(self.folder/'dialogue.wav'),'outputPath':str(self.folder/'copy.mp4')}

 def test_never_overwrites_original_or_existing_copy(self):
  for path in ['source.mp4','dialogue.wav']:
   with self.assertRaisesRegex(ValueError,'no se sobrescriben'): launcher.validate_request(dict(self.request,outputPath=str(self.folder/path)))
  (self.folder/'copy.mp4').write_bytes(b'existing')
  with self.assertRaises(ValueError): launcher.validate_request(self.request)
  self.assertEqual((self.folder/'source.mp4').read_bytes(),b'original-video')

 def test_existing_sidecar_is_not_overwritten(self):
  (self.folder/'copy.lipsync.json').write_text('{}')
  with self.assertRaises(ValueError): launcher.validate_request(self.request)

 def test_rejects_nonfinite_overlong_and_invalid_regions(self):
  for options in [{'duration':15.1},{'duration':float('nan')},{'speed':True},{'speed':0},{'faceROI':{'x':.9,'y':0,'width':.2,'height':.5}}]:
   with self.assertRaises(ValueError): launcher.validate_request(dict(self.request,**options))

 def test_no_face_is_explicit_error(self):
  with self.assertRaisesRegex(ValueError,'No se ve un rostro'): worker.select_face([])

 def test_multiple_faces_never_use_first(self):
  with self.assertRaisesRegex(ValueError,'varios rostros'): worker.select_face([face(),face(.65)])

 def test_roi_disambiguates_one_actor_only(self):
  selected = worker.select_face([face(),face(.65)],{'x':.1,'y':.1,'width':.5,'height':.6})
  self.assertEqual(selected['box']['x'],.2)
  with self.assertRaisesRegex(ValueError,'varios rostros'): worker.select_face([face(),face(.65)],{'x':0,'y':0,'width':1,'height':1})

 def test_missing_landmarks_do_not_hide_other_faces(self):
  second = face(.65); second['lips'] = []
  with self.assertRaisesRegex(ValueError,'varios rostros'): worker.select_face([face(),second])
  with self.assertRaisesRegex(ValueError,'suficiente claridad'): worker.select_face([second])

 def test_scene_cut_rejected_but_small_motion_accepted(self):
  with self.assertRaisesRegex(ValueError,'corte'): worker.select_face([face(.65)],previous=face(.1))
  self.assertEqual(worker.select_face([face(.21)],previous=face(.2))['box']['x'],.21)

 def test_strong_profile_rejected(self):
  with self.assertRaisesRegex(ValueError,'perfil'): worker.select_face([dict(face(),yaw=1.4)])

 def test_small_face_rejected(self):
  with self.assertRaisesRegex(ValueError,'80 píxeles'): worker.face_crop(face(),100,100)

 def probe(self, video_duration=10, audio_duration=2):
  return [{'format':{'duration':str(video_duration)},'streams':[{'codec_type':'video','duration':str(video_duration),'width':704,'height':1216}]},
          {'format':{'duration':str(audio_duration)},'streams':[{'codec_type':'audio','duration':str(audio_duration)}]}]

 def test_audio_never_truncated_to_timeline_duration(self):
  with patch.object(worker,'probe',side_effect=self.probe(audio_duration=3)):
   with self.assertRaisesRegex(ValueError,'no se truncará'): worker.prepare_request(dict(self.request,duration=2))

 def test_source_trim_and_speed_need_real_video_coverage(self):
  with patch.object(worker,'probe',side_effect=self.probe(video_duration=5,audio_duration=2)):
   with self.assertRaisesRegex(ValueError,'No hay vídeo suficiente'): worker.prepare_request(dict(self.request,trimStart=2,speed=2,duration=2))

 def test_duration_rounds_up_at_25fps_without_truncating_audio(self):
  with patch.object(worker,'probe',side_effect=self.probe(audio_duration=2.01)):
   request, frames, duration, audio = worker.prepare_request(self.request)
  self.assertEqual(frames,51); self.assertEqual(duration,2.04); self.assertGreaterEqual(duration,audio)

 def test_preparation_handles_short_audio_padding_without_loop(self):
  with patch.object(worker,'probe',side_effect=self.probe(video_duration=10,audio_duration=1.1)):
   _,frames,duration,audio = worker.prepare_request(dict(self.request,duration=3,trimStart=1,speed=1.5))
  self.assertEqual((frames,duration,audio),(75,3,1.1))

 def test_hdr_and_non_square_pixels_require_explicit_conversion(self):
  for fields in [{'color_transfer':'smpte2084'},{'pix_fmt':'yuv420p10le'},{'sample_aspect_ratio':'2:1'},{'side_data_list':[{'rotation':90}]}]:
   info = self.probe(); info[0]['streams'][0].update(fields)
   with patch.object(worker,'probe',side_effect=info):
    with self.assertRaises(ValueError): worker.prepare_request(self.request)

 def test_uhd_portrait_and_square_keep_dimensions(self):
  for width,height in [(2160,3840),(2160,2160),(3840,2160)]:
   info=self.probe(); info[0]['streams'][0].update(width=width,height=height)
   with patch.object(worker,'probe',side_effect=info):
    self.assertEqual(worker.prepare_request(self.request)[1],50)

 def test_model_integrity_stat_changes_invalidate_ready_state(self):
  with tempfile.TemporaryDirectory() as folder:
   base=Path(folder); model=base/'models'; model.mkdir(); (model/'fake').write_bytes(b'weights')
   sha=launcher.digest(model/'fake')
   (base/'verified.json').write_text(json.dumps({'revision':launcher.REVISION,'files':{'fake':{'sha256':sha,'mtimeNs':(model/'fake').stat().st_mtime_ns}}}))
   with patch.object(launcher,'BASE',base), patch.object(launcher,'MODELS',model), patch.object(launcher,'MODEL_FILES',{'fake':(7,sha)}):
    self.assertTrue(launcher.manifest_current())
    (model/'fake').write_bytes(b'changed')
    self.assertFalse(launcher.manifest_current())

if __name__ == '__main__': unittest.main()

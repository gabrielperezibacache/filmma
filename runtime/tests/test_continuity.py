"""Real CPU Apple Vision checks; no GPU, downloads, generated video, or original writes."""
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "runtime" / "filmma_continuity.py"
SOURCE = ROOT / "public" / "demo" / "scene-04.png"
FULL = {"x": 0, "y": 0, "width": 1, "height": 1}


@unittest.skipUnless(platform.system() == "Darwin", "Apple Vision requires macOS")
class ContinuityVisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.storage = tempfile.TemporaryDirectory(prefix="filmma-continuity-test-")
        cls.directory = Path(cls.storage.name)
        cls.before_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
        portrait = Image.open(SOURCE).convert("RGB").resize((1024, 576))
        cls.portrait = cls.directory / "portrait.png"
        portrait.save(cls.portrait)
        cls.double = cls.directory / "two-faces.png"
        double = Image.new("RGB", (2048, 576))
        double.paste(portrait, (0, 0))
        double.paste(portrait, (1024, 0))
        double.save(cls.double)
        cls.flat = cls.directory / "empty.png"
        Image.new("RGB", (512, 512), (80, 80, 80)).save(cls.flat)

    @classmethod
    def tearDownClass(cls):
        assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == cls.before_hash
        cls.storage.cleanup()

    def compare(self, **request):
        payload = {"leftPath": str(self.portrait), "rightPath": str(self.portrait), **request}
        request_file = self.directory / "request.json"
        request_file.write_text(json.dumps(payload))
        result = subprocess.run([sys.executable, str(WORKER), "--input", str(request_file)],
                                capture_output=True, text=True, timeout=150)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        return json.loads(result.stdout)

    def test_identical_face_and_torso_use_single_face_with_zero_distance(self):
        result = self.compare(categories=["face", "wardrobe"])
        self.assertEqual(len(result["faces"]["left"]), 1)
        self.assertEqual(result["engine"], "apple-vision-cpu")
        self.assertEqual(result["featureRevision"], 2)
        for check in result["checks"]:
            self.assertEqual(check["status"], "no-obvious-change", check)
            self.assertEqual(check["origin"], "single-face")
            self.assertLess(check["distance"], 0.0001)

    def test_multiple_faces_and_disabled_auto_need_explicit_regions(self):
        result = self.compare(leftPath=str(self.double), rightPath=str(self.double))
        self.assertEqual(len(result["faces"]["left"]), 2)
        self.assertTrue(all(check["status"] == "insufficient" for check in result["checks"]))
        blocked = self.compare(allowAutomatic=False)
        self.assertTrue(all(check["status"] == "insufficient" for check in blocked["checks"]))
        region = {"x": .30, "y": .15, "width": .15, "height": .32}
        manual = self.compare(allowAutomatic=False, categories=["face"],
                              regions={"face": {"left": region, "right": region}})
        self.assertEqual(manual["checks"][0]["status"], "no-obvious-change")

    def test_invalid_tiny_and_detail_free_regions_are_not_success(self):
        bad = {"x": .9, "y": 0, "width": .4, "height": 1}
        result = self.compare(regions={"face": {"left": bad, "right": FULL}}, categories=["face"])
        self.assertEqual(result["checks"][0]["status"], "insufficient")
        tiny = {"x": 0, "y": 0, "width": .01, "height": .01}
        result = self.compare(regions={"object": {"left": tiny, "right": tiny}}, categories=["object"])
        self.assertEqual(result["checks"][0]["status"], "insufficient")
        result = self.compare(leftPath=str(self.flat), rightPath=str(self.flat),
                              regions={"object": {"left": FULL, "right": FULL}}, categories=["object"])
        self.assertEqual(result["checks"][0]["status"], "insufficient")

    def test_one_manual_side_never_uses_an_automatic_region_on_the_other(self):
        for category in ("face", "wardrobe", "object"):
            for side in ("left", "right"):
                result = self.compare(categories=[category], regions={category: {side: FULL}})
                check = result["checks"][0]
                self.assertEqual(check["status"], "insufficient")
                self.assertEqual(check["origin"], "unavailable")
                self.assertNotIn("distance", check)
                self.assertNotIn("regions", check)
                self.assertIn("necesita zonas en ambos planos", check["message"])

    def test_object_region_difference_is_flagged_without_semantic_object_claim(self):
        result = self.compare(rightPath=str(ROOT / "public" / "demo" / "scene-01.png"),
                              regions={"object": {"left": FULL, "right": FULL}}, categories=["object"])
        check = result["checks"][0]
        self.assertEqual(check["status"], "possible-change")
        self.assertGreaterEqual(check["distance"], check["threshold"])
        self.assertEqual(check["origin"], "manual")
        self.assertIn("no se detecta semánticamente", " ".join(result["limitations"]))

    def test_top_left_roi_and_exif_orientation_are_consistent(self):
        original = Image.open(self.portrait)
        jpeg = self.directory / "portrait.jpg"
        original.save(jpeg, quality=100, subsampling=0)
        # Orientation 6 rotates the stored raster clockwise back to the upright image.
        rotated = self.directory / "rotated.jpg"
        exif = Image.Exif()
        exif[274] = 6
        original.transpose(Image.Transpose.ROTATE_90).save(rotated, quality=100, subsampling=0, exif=exif)
        region = {"x": .25, "y": .1, "width": .3, "height": .5}
        result = self.compare(leftPath=str(jpeg), rightPath=str(rotated), categories=["object"],
                              regions={"object": {"left": region, "right": region}})
        check = result["checks"][0]
        self.assertEqual(result["imageSizes"]["left"], result["imageSizes"]["right"])
        self.assertEqual(check["status"], "no-obvious-change")
        self.assertLess(check["distance"], .03)
        self.assertLess(check["colorDelta"], .005)

    def test_wardrobe_color_difference_measures_a_selected_area(self):
        original = Image.open(self.portrait)
        changed = self.directory / "wardrobe-blue.png"
        region = {"x": .18, "y": .55, "width": .35, "height": .3}
        rectangle = (184, 316, 543, 490)
        crop = original.crop(rectangle)
        red, green, blue = crop.split()
        crop = Image.merge("RGB", (blue.point(lambda v: min(255, v + 30)), green, red.point(lambda v: min(255, v + 180))))
        original.paste(crop, rectangle)
        original.save(changed)
        result = self.compare(rightPath=str(changed), categories=["wardrobe"],
                              regions={"wardrobe": {"left": region, "right": region}})
        check = result["checks"][0]
        self.assertEqual(check["status"], "possible-change", check)
        self.assertGreater(check["colorDelta"], .18)

    def test_crops_use_top_left_not_vision_bottom_left_coordinates(self):
        original = Image.open(self.portrait)
        changed = self.directory / "bottom-changed.png"
        bottom = (0, 288, 1024, 576)
        original.paste(ImageOps.invert(original.crop(bottom)), bottom)
        original.save(changed)
        top_region = {"x": 0, "y": 0, "width": 1, "height": .4}
        bottom_region = {"x": 0, "y": .6, "width": 1, "height": .4}
        result = self.compare(rightPath=str(changed), categories=["object"],
                              regions={"object": {"left": top_region, "right": top_region}})
        self.assertEqual(result["checks"][0]["status"], "no-obvious-change")
        result = self.compare(rightPath=str(changed), categories=["object"],
                              regions={"object": {"left": bottom_region, "right": bottom_region}})
        self.assertEqual(result["checks"][0]["status"], "possible-change")


if __name__ == "__main__":
    unittest.main()

"""Synthetic acceptance checks for music and A/V sync commands."""
import json
import subprocess
import unittest
from pathlib import Path
from scipy.signal import butter, sosfiltfilt

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[3]
MUSIC = ROOT / "tools/edit/music.py"
SYNC = ROOT / "tools/edit/avsync.py"
SR = 44100


def invoke(script, *args, ok=True):
    result = subprocess.run(["python", "-I", str(script), *map(str, args)], cwd=ROOT, capture_output=True, text=True, timeout=180)
    if ok and result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    return result


def click_track(path, bpm=120, length=40, loud_after=20):
    y = np.zeros(round(length * SR), np.float32)
    beat = 60 / bpm
    for i, t in enumerate(np.arange(0, length, beat)):
        if 12 <= t < 20: continue
        n = int(t * SR); size = min(int(.055 * SR), len(y) - n)
        amp = .6 if t >= loud_after else .3
        tone = np.sin(2 * np.pi * 80 * np.arange(size) / SR) * np.exp(-np.arange(size) / (SR * .012))
        y[n:n+size] += amp * tone
        y[n:n+size] += (.8 if i % 4 == 0 else .35) * np.sin(2 * np.pi * 1200 * np.arange(size) / SR) * np.exp(-np.arange(size) / (SR * .004))
    sf.write(path, np.clip(y, -.99, .99), SR)


class MusicSyncAcceptance(unittest.TestCase):
    def setUp(self):
        self.d = ROOT / "tmp" / "music_sync_acceptance"; self.d.mkdir(parents=True, exist_ok=True)
        for child in self.d.iterdir():
            if child.is_file(): child.unlink()
        click_track(self.d / "a.wav"); click_track(self.d / "b.wav", 126, 40, 20)

    def test_analysis_fit_blend_duck_cuts(self):
        analysis = self.d / "analysis.json"
        invoke(MUSIC, "analyze", self.d / "a.wav", "-o", analysis, "--no-cache")
        a = json.loads(analysis.read_text())
        self.assertLess(abs(a["tempo"] - 120) / 120, .005)
        truth = np.arange(0, 40, 2); self.assertGreaterEqual(np.mean([np.min(abs(np.asarray(a["downbeats"]) - t)) < .025 for t in truth]), .9)
        self.assertTrue(any(abs(d["t"] - 20) < 2 for d in a["drops"]))
        for length in (25, 61.3):
            out = self.d / f"fit{length}.wav"; report = self.d / f"fit{length}.json"
            try:
                invoke(MUSIC, "fit", self.d / "a.wav", "--length", length, "-o", out, "--drop-at", "8", "--report", report)
            except AssertionError as exc:
                self.fail(f"synthetic fit at {length}s: {exc}")
            y, sr = sf.read(out); self.assertEqual(len(y), round(length * sr)); self.assertLessEqual(max([0.0] + [abs(float(y[int(j["time"] * sr)] - y[int(j["time"] * sr) - 1])) for j in json.loads(report.read_text())["joins"] if int(j["time"] * sr) > 0]), .5)
        no_drop = self.d / "fit_no_drop.wav"
        invoke(MUSIC, "fit", self.d / "a.wav", "--length", 25, "-o", no_drop)
        self.assertEqual(len(sf.read(no_drop)[0]), round(25 * SR))
        mix, rep = self.d / "blend.wav", self.d / "blend.json"
        invoke(MUSIC, "blend", self.d / "a.wav", self.d / "b.wav", "-o", mix, "--bars", 4, "--report", rep)
        y, _ = sf.read(mix); self.assertLessEqual(20 * np.log10(np.max(np.abs(y))), -1.0 + .01)
        self.assertLess(json.loads(rep.read_text())["misalignment_ms"], 8)
        r = json.loads(rep.read_text()); at = int((r["blend_start"] + (r["blend_end"] - r["blend_start"]) / 2) * SR)
        low = butter(2, 200, fs=SR, output="sos")
        mix_energy = np.mean(sosfiltfilt(low, y[max(0, at-SR//10):at+SR//10]) ** 2)
        source_energies = [np.mean(sosfiltfilt(low, sf.read(p)[0][max(0, at-SR//10):at+SR//10]) ** 2) for p in (self.d / "a.wav", self.d / "b.wav")]
        self.assertLessEqual(10 * np.log10(max(mix_energy, 1e-12) / max(max(source_energies), 1e-12)), 3.1)
        voice = np.zeros(10 * SR, np.float32)
        for t in (2, 5, 8):
            n = int(t * SR); voice[n:n + SR // 2] = .4 * np.sin(2 * np.pi * 1000 * np.arange(SR // 2) / SR)
        sf.write(self.d / "voice.wav", voice, SR); sf.write(self.d / "music.wav", np.ones_like(voice) * .2, SR)
        invoke(MUSIC, "duck", self.d / "voice.wav", self.d / "music.wav", "-o", self.d / "duck.wav", "--under", 20)
        duck, _ = sf.read(self.d / "duck.wav"); self.assertLess(np.sqrt(np.mean(duck[2*SR:2*SR+SR//4]**2)), .2 * 10**(-17/20))
        self.assertLess(np.sqrt(np.mean(duck[2*SR-1000:2*SR]**2)), .2)
        self.assertLess(abs(np.sqrt(np.mean(duck[3*SR:4*SR]**2)) / .2 - 1), .1)
        cuts = self.d / "cuts.json"; invoke(MUSIC, "cuts", self.d / "a.wav", "--length", 30, "--fps", 30, "--style", "build", "-o", cuts)
        c = json.loads(cuts.read_text())["cuts"]; self.assertTrue(all(x["t"] == x["frame"] / 30 for x in c)); self.assertGreaterEqual(np.mean([x["on"] in ("beat", "downbeat") for x in c]), .7); self.assertGreater(len(set(x["shot_beats"] for x in c)), 1)
        self.assertTrue(json.loads(cuts.read_text())["drop"])

    def test_legacy_commands_and_edl_snap(self):
        # The project asset must stay callable through all original interfaces.
        asset = ROOT / "assets/library/music/music-funky-house.mp3"
        if not asset.is_file(): self.skipTest("legacy music asset is absent")
        result = self.d / "legacy.json"
        invoke(MUSIC, "analyze", asset, "-o", result)
        legacy = json.loads(result.read_text()); self.assertTrue(125 <= legacy["tempo"] <= 135); self.assertTrue(30 <= len(legacy["downbeats"]) <= 45)
        self.assertIn("rms_0_5s", legacy); self.assertIn("sections", legacy)
        self.assertIn("start", json.loads(invoke(MUSIC, "window", asset, "--length", 8).stdout))
        sf.write(self.d / "v.wav", np.zeros(SR), SR)
        invoke(MUSIC, "duck", self.d / "v.wav", asset, "-o", self.d / "legacy_duck.wav")
        edl = self.d / "edl.json"; edl.write_text(json.dumps({"ranges": [{"start": 1.0, "end": 2.0}]}))
        invoke(ROOT / "tools/edit/beats_to_cuts.py", result, "--edl", edl, "--snap", .08, "--fps", 30)
        self.assertTrue(edl.with_name("edl.snapped.json").exists())

    def test_avsync_offset(self):
        # Generate white flashes and coincident beeps, then delay audio by 100 ms.
        raw = self.d / "raw.mp4"; video = self.d / "delayed.mp4"; fixed = self.d / "fixed.mp4"; clean = self.d / "clean.mp4"; wav = self.d / "beeps.wav"
        vf = "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(t,1),0.08)'"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=320x180:r=30:d=15", "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", str(raw)], check=True)
        audio = np.zeros(15 * SR, np.float32)
        for t in range(15):
            n = t * SR; count = int(.04 * SR); audio[n:n+count] = .8 * np.sin(2 * np.pi * 2000 * np.arange(count) / SR)
        sf.write(wav, audio, SR)
        for delay, target in ((100, video), (0, clean)):
            filt = f"adelay={delay}:all=1" if delay else "anull"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-i", str(wav), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", filt, "-c:a", "aac", "-shortest", str(target)], check=True)
        # Static-video-offset command exercises the repair path.
        report = self.d / "sync.json"; failed = invoke(SYNC, "check", video, "--report", report, ok=False); self.assertEqual(failed.returncode, 1)
        measured = json.loads(report.read_text())["median_offset_ms"]; self.assertIsNotNone(measured); self.assertLess(abs(measured - 100), 17)
        invoke(SYNC, "check", clean, "--report", self.d / "clean.json")
        self.assertEqual(json.loads((self.d / "clean.json").read_text())["verdict"], "PASS")
        invoke(SYNC, "offset", video, "--ms", -100, "-o", fixed)
        invoke(SYNC, "check", fixed, "--report", self.d / "fixed.json")
        self.assertEqual(json.loads((self.d / "fixed.json").read_text())["verdict"], "PASS")


class CamelotMappingTests(unittest.TestCase):
    def test_all_24_key_codes(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("music", MUSIC)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        major = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"]
        minor = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"]
        self.assertEqual([module.camelot_code(key, "major") for key in module.TONICS], major)
        self.assertEqual([module.camelot_code(key, "minor") for key in module.TONICS], minor)


class RealMusicFitAcceptance(unittest.TestCase):
    TRACKS = [
        "music-funky-house.mp3", "music-energetic-jazz-funk.mp3",
        "music-lofi-chill-loop.mp3", "music-happy-clap-17s.mp3",
    ]

    @classmethod
    def setUpClass(cls):
        cls.paths = [ROOT / "assets/library/music" / name for name in cls.TRACKS]
        if not all(path.is_file() for path in cls.paths): raise unittest.SkipTest("Round-2 real music assets are absent")
        cls.d = ROOT / "tmp" / "music_round2_real"; cls.d.mkdir(parents=True, exist_ok=True)

    def test_real_track_fit_matrix(self):
        for track in self.paths:
            analysis_path = self.d / f"{track.stem}.json"
            invoke(MUSIC, "analyze", track, "-o", analysis_path)
            analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
            adjacent = np.linalg.norm(np.diff(np.asarray(analysis["bar_features"]), axis=0), axis=1)
            baseline = float(np.median(adjacent)) if len(adjacent) else 0.0
            for length, ending in ((15, "bar"), (30, "ring"), (45, "bar")):
                output = self.d / f"{track.stem}_{length}.wav"; report_path = self.d / f"{track.stem}_{length}.json"
                try:
                    invoke(MUSIC, "fit", track, "--analysis", analysis_path, "--length", length, "--drop-at", 6, "--ending", ending, "-o", output, "--report", report_path)
                except AssertionError as exc:
                    self.fail(f"{track.name} at {length}s: {exc}")
                report = json.loads(report_path.read_text(encoding="utf-8")); rendered, sr = sf.read(output)
                self.assertEqual(len(rendered), round(length * sr))
                for join in report["joins"]:
                    self.assertLessEqual(join["feature_distance"], 1.5 * max(baseline, 1e-6))
                    at = int(join["time"] * sr)
                    peak = np.max(np.abs(rendered[max(0, at-sr//10):min(len(rendered), at+sr//10)]))
                    jump = abs(float(rendered[at] - rendered[at-1])) if 0 < at < len(rendered) else 0
                    self.assertLess(jump, .5 * max(float(peak), 1e-6))
                if report["drop_residual_ms"] is not None and abs(report["drop_residual_ms"]) < 40:
                    self.assertLess(abs(report["drop_at_actual"] - 6), .04)
                else:
                    self.assertTrue(report["warnings"])
                if ending in ("ring", "bar"):
                    self.assertLessEqual(report["ending_downbeat_error_ms"], 30)
                    self.assertIn(report["ending_hit_source_bar"], range(len(analysis["bar_starts"])))


if __name__ == "__main__":
    unittest.main()

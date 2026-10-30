"""Music analysis and editing helpers for local video projects."""
import argparse
import hashlib
import contextlib
import io
import json
import math
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt, resample_poly, stft, find_peaks

SR = 44100
ANALYSIS_VERSION = 9
TONICS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
CAM_MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"]
CAM_MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"]


def camelot_code(tonic, mode):
    """Map a pitch class and mode to its Camelot wheel label."""
    try:
        index = TONICS.index(tonic)
    except ValueError:
        return None
    if mode not in ("major", "minor"):
        return None
    return (CAM_MAJOR if mode == "major" else CAM_MINOR)[index]


def read_audio(path, sr=SR):
    path = Path(path)
    if not path.is_file():
        raise ValueError(f"Audio file not found: {path}")
    cache = Path("work/music_cache")
    cache.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(path.read_bytes()).hexdigest()[:16]
    wav = cache / f"{digest}.wav"
    if not wav.exists():
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(path), "-vn", "-ac", "1", "-ar", str(sr), "-c:a", "pcm_f32le", str(wav)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode:
            raise ValueError(f"Could not decode {path}: {result.stderr[-400:]}")
    y, rate = sf.read(wav, dtype="float32")
    return np.asarray(y), int(rate)


def _librosa():
    cache = Path("work/music_cache/numba_cache")
    cache.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("NUMBA_CACHE_DIR", str(cache.resolve()))
    import librosa
    return librosa


def analyze(path, no_cache=False):
    path = Path(path)
    digest = hashlib.sha1(path.read_bytes()).hexdigest()[:16]
    cache_dir = Path("work/music_cache")
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / f"{digest}.analysis.json"
    if cached.exists() and not no_cache:
        existing = json.loads(cached.read_text(encoding="utf-8"))
        if existing.get("analysis_version") == ANALYSIS_VERSION:
            return existing
    y, sr = read_audio(path)
    duration = len(y) / sr
    # 5 ms spectral-flux grid gives refined onsets without heavyweight model startup.
    hop = 220
    _, times, z = stft(y, fs=sr, nperseg=2048, noverlap=2048-hop, boundary="zeros")
    spec = np.abs(z)
    flux = np.maximum(0, np.diff(spec, axis=1, prepend=spec[:, :1])).sum(axis=0)
    smooth = np.convolve(flux, np.ones(3) / 3, mode="same")
    peaks, _ = find_peaks(smooth, distance=max(1, round(.08 * sr / hop)), prominence=max(float(np.max(smooth)) * .015, 1e-8))
    strengths = smooth[peaks] / max(float(np.max(smooth)), 1e-12)
    freqs = np.fft.rfftfreq(2048, 1 / sr)
    onset_events = []
    for ix, strength in zip(peaks, strengths):
        left, right = max(0, ix - 2), min(spec.shape[1], ix + 7)
        spectrum = np.mean(spec[:, left:right], axis=1)
        centroid = float(np.sum(freqs * spectrum) / (np.sum(spectrum) + 1e-12))
        onset_events.append({"t": float(times[ix]), "strength": float(np.clip(strength, 0, 1)), "band": "low" if centroid < 400 else "mid" if centroid < 3000 else "high"})
    # Autocorrelation of positive spectral flux selects a tactus, then phase is aligned to onsets.
    centered = smooth - np.mean(smooth)
    ac = np.correlate(centered, centered, mode="full")[len(centered)-1:]
    minlag, maxlag = max(1, int(.333 * sr / hop)), min(len(ac) - 1, int(1.0 * sr / hop))
    lag = minlag + int(np.argmax(ac[minlag:maxlag + 1])) if maxlag >= minlag else int(.5 * sr / hop)
    adjust = 0.0
    if 1 <= lag < len(ac) - 1:
        left, mid, right = ac[lag - 1:lag + 2]
        den = left - 2 * mid + right
        if abs(den) > 1e-12: adjust = float(np.clip(.5 * (left - right) / den, -.5, .5))
    beat_interval = (lag + adjust) * hop / sr
    onset_ts = np.asarray([e["t"] for e in onset_events])
    onset_ws = np.asarray([e["strength"] for e in onset_events])
    if len(onset_ts):
        angle = 2 * np.pi * onset_ts / beat_interval
        phase = (np.angle(np.sum(onset_ws * np.exp(1j * angle))) % (2 * np.pi)) * beat_interval / (2 * np.pi)
        if phase > beat_interval / 2: phase -= beat_interval
        if abs(phase) < .05: phase = 0.0
    else:
        phase = 0.0
    beat_times = np.arange(phase, duration, beat_interval)
    # Downbeat phase is strongest among four beat phases, preserving the detected tactus.
    down_candidates = [beat_times[k::4] for k in range(min(4, len(beat_times))) if len(beat_times[k::4])]
    down = max(down_candidates, key=lambda arr: sum(float(smooth[min(len(smooth)-1, round(t*sr/hop))]) for t in arr)) if down_candidates else np.array([])
    # Beat This handles tempo ambiguity and downbeat phase more reliably than onset periodicity.
    # Keep the signal-based estimate as a fast fallback for unsupported or silent files.
    try:
        from beat_this.inference import File2Beats
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            model_beats, model_down = File2Beats(device="cpu", dbn=False)(str(path))
        model_beats = np.asarray(model_beats, dtype=float).reshape(-1)
        model_down = np.asarray(model_down, dtype=float).reshape(-1)
        model_beats = model_beats[(model_beats >= 0) & (model_beats < duration)]
        model_down = model_down[(model_down >= 0) & (model_down < duration)]
        if len(model_beats) >= 8:
            beat_times = model_beats
            if len(model_down): down = model_down
    except Exception:
        pass
    beat_times = beat_times[(beat_times >= 0) & (beat_times < duration)]
    down = down[(down >= 0) & (down < duration - .05)]
    if len(down) > 1:
        down = down[np.r_[True, np.diff(down) > .25]]
    intervals = np.diff(beat_times)
    intervals = intervals[(intervals > .25) & (intervals < 1.5)]
    med = float(np.median(intervals)) if len(intervals) else .5
    tempo = 60 / med
    stable = bool(len(intervals) and np.mean(np.abs(intervals - med) <= med * .05) >= .85)
    if stable and len(intervals) >= 8:
        # Beat This reports beats on a 20 ms grid, so the median interval is quantized (up to ~4 BPM off at 140 BPM).
        # The mean of the inlier intervals averages the quantization out and ignores half-time stretches.
        inliers = intervals[np.abs(intervals - med) <= med * .1]
        if len(inliers) >= 8:
            med = float(np.mean(inliers))
            tempo = 60 / med
    # Some Beat This versions label several beat positions as downbeats. When
    # the spacing is closer to a beat than a bar, recover the 4/4 bar phase
    # from those labels and use the beat lattice as the boundary source.
    if len(down) > 2 and len(beat_times) >= 8:
        phase_scores = []
        for phase_index in range(4):
            phase_beats = beat_times[phase_index::4]
            score = sum(np.min(np.abs(down - value)) <= max(.035, med * .08) for value in phase_beats) if len(phase_beats) else 0
            phase_scores.append(score)
        bar_phase = int(np.argmax(phase_scores))
        down = beat_times[bar_phase::4]
    beats_per_bar = int(round(float(np.median(np.diff(down)) / med))) if len(down) > 1 else 4
    bar_starts = down.tolist()
    if bar_starts and bar_starts[0] <= .05:
        bar_starts[0] = 0.0
    elif bar_starts:
        # Music starts before its first detected downbeat: represent the partial bar.
        bar_starts.insert(0, 0.0)
    if not bar_starts: bar_starts = [0.0]
    bar_starts = sorted(set(float(x) for x in bar_starts))
    # Beat This can emit a near-zero downbeat beside the synthetic 0.0 intro
    # boundary. Treat those as one bar boundary to avoid a spurious tiny bar.
    clean_starts = []
    for value in bar_starts:
        if not clean_starts or value - clean_starts[-1] > max(.25, med * .25):
            clean_starts.append(value)
    bar_starts = clean_starts
    ends = bar_starts[1:] + [duration]
    rms, centroid_bar, bars = [], [], []
    for i, (start, end) in enumerate(zip(bar_starts, ends)):
        seg = y[int(start * sr):max(int(start * sr) + 1, int(end * sr))]
        val = float(np.sqrt(np.mean(seg * seg))) if len(seg) else 0.0
        rms.append(val)
        spec_lo, spec_hi = max(0, int(start * sr / hop)), min(spec.shape[1], int(end * sr / hop))
        centroid = np.sum(freqs[:, None] * spec[:, spec_lo:spec_hi]) / (np.sum(spec[:, spec_lo:spec_hi]) + 1e-12) if spec_hi > spec_lo else 0
        cent = float(centroid)
        centroid_bar.append(cent)
        db = 20 * math.log10(max(val, 1e-8))
        bar_flux = float(np.mean(flux[spec_lo:spec_hi])) if spec_hi > spec_lo else 0.0
        bars.append({"i": i, "start": start, "end": end, "rms_db": db, "centroid_hz": cent, "flux": bar_flux})
    # One feature vector per downbeat-synchronous bar for structure and edit planning.
    lb = _librosa()
    feature_y = resample_poly(y, 1, 4).astype(np.float32)
    feature_sr, feature_hop = 11025, 256
    cqt = np.abs(lb.cqt(feature_y, sr=feature_sr, hop_length=feature_hop, fmin=lb.note_to_hz("C2"), n_bins=60, filter_scale=.5))
    chroma = lb.feature.chroma_cqt(C=cqt, sr=feature_sr, hop_length=feature_hop)
    chroma_frames = lb.feature.chroma_cqt(y=feature_y, sr=feature_sr)  # default filter scale: sharp enough for key detection
    mfcc = lb.feature.mfcc(y=feature_y, sr=feature_sr, hop_length=feature_hop, n_mfcc=13)
    feature_centroid = lb.feature.spectral_centroid(y=feature_y, sr=feature_sr, hop_length=feature_hop)[0]
    frame_times = lb.frames_to_time(np.arange(chroma.shape[1]), sr=feature_sr, hop_length=feature_hop)
    raw_features = []
    for bar, value in zip(bars, rms):
        mask = (frame_times >= bar["start"]) & (frame_times < bar["end"])
        if not np.any(mask): mask[np.argmin(abs(frame_times - bar["start"]))] = True
        raw_features.append(np.r_[np.mean(chroma[:, mask], axis=1), np.mean(mfcc[:, mask], axis=1), 20 * math.log10(max(value, 1e-8)), float(np.mean(feature_centroid[mask])) / 1000])
    raw_features = np.asarray(raw_features, dtype=np.float32)
    feature_mean = raw_features.mean(axis=0); feature_std = raw_features.std(axis=0); feature_std[feature_std < 1e-6] = 1
    bar_features = (raw_features - feature_mean) / feature_std
    # Checkerboard-kernel novelty on the bar-synchronous self-similarity matrix.
    norm = bar_features / np.maximum(np.linalg.norm(bar_features, axis=1, keepdims=True), 1e-8)
    self_similarity = norm @ norm.T
    radius = 4; axis = np.arange(-radius, radius)
    checker = np.where(axis[:, None] * axis[None, :] >= 0, 1.0, -1.0)
    checker /= np.sum(np.abs(checker))
    novelty = np.zeros(len(bars), dtype=np.float32)
    for center in range(radius, len(bars) - radius):
        novelty[center] = float(np.sum(self_similarity[center-radius:center+radius, center-radius:center+radius] * checker))
    peaks, _ = find_peaks(novelty, distance=4, prominence=max(float(np.std(novelty)) * .35, 1e-4)) if len(novelty) > 8 else (np.array([], dtype=int), {})
    boundaries = [0] + [int(p) for p in peaks if p >= 4 and len(bars) - p >= 4] + [len(bars)]
    boundaries = sorted(set(boundaries))
    # Merge any short fragments, preserving each boundary on a downbeat.
    changed = True
    while changed and len(boundaries) > 2:
        changed = False
        for k in range(1, len(boundaries) - 1):
            if boundaries[k] - boundaries[k-1] < 4 or boundaries[k+1] - boundaries[k] < 4:
                boundaries.pop(k); changed = True; break
    sections = []
    energy_db = np.asarray([b["rms_db"] for b in bars])
    max_energy = float(np.max(energy_db)) if len(energy_db) else -120
    for j, (lo, hi) in enumerate(zip(boundaries[:-1], boundaries[1:])):
        level = float(np.mean(energy_db[lo:hi])); prior = float(np.mean(energy_db[max(0, lo-2):lo])) if lo else level
        label = "verse"
        if j == 0 and level < max_energy - 6: label = "intro"
        elif j == len(boundaries)-2 and level < max_energy - 6: label = "outro"
        elif lo and level - prior >= 3: label = "drop"
        elif lo and level - prior >= 1.5: label = "build"
        elif lo and level - prior <= -4: label = "break"
        sections.append({"start": bar_starts[lo], "end": ends[min(hi-1, len(ends)-1)], "bars": hi-lo, "label": label, "energy_db": level})
    # Compare two-bar RMS means across every downbeat. Section drops are included too.
    drops = []
    for i in range(2, len(bars)-1):
        before = float(np.mean([10 ** (energy_db[k] / 20) for k in range(i-2, i)]))
        after = float(np.mean([10 ** (energy_db[k] / 20) for k in range(i, min(i+2, len(bars)))]))
        gain = 20 * math.log10(max(after, 1e-8) / max(before, 1e-8))
        if gain >= 3:
            si = next((j for j, sec in enumerate(sections) if sec["start"] <= bar_starts[i] < sec["end"]), 0)
            drops.append({"bar": i, "t": bar_starts[i], "gain_db": gain, "section_index": si})
    for si, section in enumerate(sections):
        if section["label"] == "drop":
            bar_index = min(range(len(bar_starts)), key=lambda i: abs(bar_starts[i] - section["start"]))
            drops.append({"bar": bar_index, "t": section["start"], "gain_db": max(3.0, section["energy_db"] - max_energy + 6), "section_index": si})
    unique_drops = []
    for drop in sorted(drops, key=lambda x: x["gain_db"], reverse=True):
        if drop["bar"] >= 1 and all(abs(drop["bar"] - kept["bar"]) >= 4 for kept in unique_drops): unique_drops.append(drop)
    drops = unique_drops
    key = {"tonic": "unknown", "mode": "unknown", "camelot": None, "confidence": 0.0}
    try:
        # CQT chroma (already computed for the bar features); FFT-bin chroma was biased toward F major.
        chroma = np.mean(chroma_frames, axis=1)
        major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]); minor = np.array([6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
        scores = [np.corrcoef(chroma, np.roll(profile, shift))[0, 1] for profile in (major, minor) for shift in range(12)]
        ix = int(np.nanargmax(scores)); tonic = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][ix % 12]; mode = "major" if ix < 12 else "minor"
        key.update(tonic=tonic, mode=mode, camelot=camelot_code(tonic, mode), confidence=float(scores[ix]))
    except Exception:
        pass
    frame = max(1, int(.5 * sr))
    rms_half = [float(np.sqrt(np.mean(y[i:i + frame] ** 2))) for i in range(0, len(y), frame)]
    peak = float(np.max(np.abs(y))) if len(y) else 0
    active_samples = np.flatnonzero(np.abs(y) > 10 ** (-50 / 20))
    lead = float(active_samples[0] / sr) if len(active_samples) else duration
    tail = float(duration - active_samples[-1] / sr) if len(active_samples) else duration
    warnings = []
    if not stable: warnings.append("Tempo is unstable or insufficient beat intervals were found.")
    if len(beat_times) < 8: warnings.append("Fewer than 8 beats found.")
    if lead > .05: warnings.append(f"Leading silence: {lead:.3f}s.")
    if tail > .05: warnings.append(f"Trailing silence: {tail:.3f}s.")
    result = {"analysis_version": ANALYSIS_VERSION, "duration": duration, "tempo": tempo, "tempo_stable": stable, "tempo_curve": [] if stable else [60 / float(np.median(intervals[i:i + 8])) for i in range(0, len(intervals), 8) if len(intervals[i:i + 8])], "beats": beat_times.tolist(), "downbeats": down.tolist(), "beats_per_bar": beats_per_bar, "bar_starts": bar_starts, "bar_features": bar_features.tolist(), "onsets": onset_events, "bars": bars, "sections": sections, "drops": drops, "key": key, "loudness_lufs": None, "peak_dbfs": 20 * math.log10(max(peak, 1e-8)), "rms_0_5s": rms_half, "warnings": warnings, "lead_silence_s": lead, "tail_silence_s": tail}
    try:
        import pyloudnorm as pyln
        result["loudness_lufs"] = float(pyln.Meter(sr).integrated_loudness(y))
    except Exception: pass
    cached.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def write_audio(out, y, sr=SR):
    out = Path(out); out.parent.mkdir(parents=True, exist_ok=True)
    sf.write(out, np.asarray(y, dtype=np.float32), sr, subtype="PCM_16")


def _distance(left, right):
    return float(np.linalg.norm(np.asarray(left) - np.asarray(right)))


def _bar_path(features, output_bars, start_bar, drop_bar=None, drop_at_bar=None, end_bar=None):
    """Beam search over source bar indices with continuity, phrase, and repeat costs."""
    count = len(features)
    beam = [(0.0, [start_bar], [])]
    width = 96
    for out_bar in range(1, output_bars):
        expanded = []
        forced = drop_bar if drop_at_bar == out_bar else None
        for cost, path, joins in beam:
            previous = path[-1]
            candidates = [forced] if forced is not None else range(count)
            for candidate in candidates:
                if candidate is None: continue
                if candidate == previous + 1:
                    expanded.append((cost, path + [candidate], joins))
                    continue
                if candidate < 0 or candidate >= count or previous + 1 >= count: continue
                left_distance = _distance(features[previous + 1], features[candidate])
                right_distance = _distance(features[previous], features[max(0, candidate - 1)])
                feature_cost = left_distance + right_distance
                gap = candidate - previous - 1
                phrase_cost = 0 if gap % 8 == 0 else .15 if gap % 4 == 0 else .55
                repeat_cost = 1.0 if candidate in path[-16:] else 0.0
                # A one-beat equal-power join removes real source duration.  Keep
                # joins sparse so the selected path remains feasible under the
                # bounded global tempo ratio, especially when looping short beds.
                jump_cost = feature_cost + phrase_cost + repeat_cost + 4.0
                join = {"output_bar": out_bar, "from_bar": previous, "to_bar": candidate, "feature_distance": (left_distance + right_distance) / 2, "cost": jump_cost}
                expanded.append((cost + jump_cost, path + [candidate], joins + [join]))
        if not expanded: raise ValueError("Could not construct a continuous bar plan for this target length.")
        expanded.sort(key=lambda state: state[0])
        beam = expanded[:width]
    if end_bar is not None:
        beam.sort(key=lambda state: state[0] + (max(0, end_bar - state[1][-1]) * .1))
    return beam[0][1], beam[0][2]


def _fit_plan(args, analysis):
    starts = np.asarray(analysis["bar_starts"], dtype=float)
    bars = analysis["bars"]
    if len(starts) < 2: raise ValueError("At least two downbeat bars are required to fit a track.")
    bar_len = float(np.median(np.diff(starts)))
    features = np.asarray(analysis["bar_features"], dtype=np.float32)
    bar_count = min(len(starts), len(features))
    features = features[:bar_count]
    bars = bars[:bar_count]
    starts = starts[:bar_count]
    first = next((i for i, bar in enumerate(bars) if bar["rms_db"] > -50), 0)
    outro = next((i for i, section in enumerate(analysis["sections"]) if section["label"] == "outro"), None)
    end_bar = None
    if outro is not None:
        end_bar = min(bar_count - 1, max(0, int(np.searchsorted(starts, analysis["sections"][outro]["start"])) + analysis["sections"][outro]["bars"] - 1))
    drop = None
    if analysis.get("drops"):
        selected = max(1, int(args.drop_index)) - 1
        if selected < len(analysis["drops"]): drop = int(analysis["drops"][selected].get("bar", np.argmin(abs(starts - analysis["drops"][selected]["t"]))))
    if drop is None:
        highest = max(analysis["sections"], key=lambda section: section["energy_db"]) if analysis["sections"] else {"start": 0}
        drop = int(np.argmin(abs(starts - float(highest["start"]))))
    drop = int(np.clip(drop, first, bar_count - 1))
    target_seconds = float(args.length)
    target = round(target_seconds * SR)
    source_lengths = np.asarray([max(0, round((bar["end"] - bar["start"]) * SR)) for bar in bars])
    def estimated_samples(n):
        used = min(n, len(source_lengths))
        return int(np.sum(source_lengths[:used]) + max(0, n - used) * bar_len * SR)
    nominal_n = 2
    while nominal_n < max(2, bar_count + round(target_seconds / bar_len)) and estimated_samples(nominal_n) < target:
        nominal_n += 1
    candidates = []
    for n_bars in range(max(2, nominal_n - 8), nominal_n + 11):
        if n_bars < 2: continue
        for ratio in np.linspace(.96, 1.04, 81):
            tail = target_seconds - estimated_samples(n_bars) / SR / ratio if args.ending == "ring" else 0.0
            # A planned join shortens source material by one beat; use a broad
            # preliminary tail window and enforce the real tail after path search.
            if args.ending == "ring" and not -3 <= tail <= 4: continue
            # Leave room for the one-beat overlap removed by each planned join;
            # exact feasibility is checked against the actual source-bar samples.
            if args.ending != "ring" and abs(estimated_samples(n_bars) / SR / ratio - target_seconds) > 1.5: continue
            drop_k = int(np.clip(round(args.drop_at * ratio / bar_len), 0, n_bars - 1)) if args.drop_at is not None else None
            drop_resid = abs(drop_k * bar_len / ratio - args.drop_at) if drop_k is not None else 0
            candidates.append((drop_resid, abs(ratio - 1), abs(tail - .75), n_bars, float(ratio), float(tail), drop_k))
    if not candidates:
        # For ring, choose continuous tail from the nearest feasible global tempo ratio.
        for n_bars in range(max(2, nominal_n - 10), nominal_n + 13):
            for ratio in np.linspace(.96, 1.04, 161):
                tail = target_seconds - estimated_samples(n_bars) / SR / ratio
                if -3 <= tail <= 4:
                    drop_k = int(np.clip(round(args.drop_at * ratio / bar_len), 0, n_bars - 1)) if args.drop_at is not None else None
                    drop_resid = abs(drop_k * bar_len / ratio - args.drop_at) if drop_k is not None else 0
                    candidates.append((drop_resid, abs(ratio-1), abs(tail-.75), n_bars, float(ratio), float(tail), drop_k))
    if not candidates: raise ValueError("No bar count and tempo ratio in [0.96, 1.04] can fit this length.")
    candidates.sort()
    selected = None
    for cand in candidates[:20]:
        drop_residual, _, _, n_bars, ratio, tail, target_drop_k = cand
        if n_bars <= 0 or target_drop_k == 0 and args.drop_at is not None: continue
        force_drop_k = target_drop_k if args.drop_at is not None and drop_residual < .04 else None
        try:
            path, joins = _bar_path(features, n_bars, first, drop, force_drop_k, end_bar)
            candidate_lengths = [max(0, round((bar["end"] - bar["start"]) * SR)) for bar in bars]
            candidate_overlap = round(60 / analysis["tempo"] * SR)
            candidate_samples = sum(candidate_lengths[index] for index in path) - len(joins) * candidate_overlap
            if args.ending == "ring":
                if not any(0 <= target_seconds - candidate_samples / SR / candidate_ratio <= 1.5 for candidate_ratio in np.linspace(.96, 1.04, 801)):
                    continue
            elif not .96 <= candidate_samples / target <= 1.04:
                continue
            selected = (path, joins, ratio, tail, force_drop_k, drop, target_drop_k)
            break
        except ValueError:
            continue
    if selected is None: raise ValueError("Could not satisfy the requested drop and length with available bars.")
    path, joins, ratio, tail, drop_k, drop, target_drop_k = selected
    overlap_samples = round(60 / analysis["tempo"] * SR)
    plan_source_samples = int(sum(source_lengths[index] for index in path) - len(joins) * overlap_samples)
    target_samples = round(target_seconds * SR)
    if args.ending == "ring":
        ratio_options = []
        for candidate_ratio in np.linspace(.96, 1.04, 801):
            candidate_tail = target_seconds - (plan_source_samples / SR) / candidate_ratio
            if 0 <= candidate_tail <= 1.5:
                if drop_k is not None: drop_position = drop_k
                else:
                    positions = [i for i, source_bar in enumerate(path) if source_bar == drop]
                    drop_position = min(positions, key=lambda i: abs(i * bar_len / candidate_ratio - (args.drop_at or 0))) if positions else 0
                prefix = sum(source_lengths[path[i]] for i in range(drop_position)) - sum(overlap_samples for join in joins if join["output_bar"] <= drop_position)
                placement = prefix / SR / candidate_ratio
                drop_error = abs(placement - args.drop_at) if args.drop_at is not None else 0
                ratio_options.append((drop_error, abs(candidate_ratio-1) + abs(candidate_tail-.75)*.1, candidate_ratio, candidate_tail))
        if ratio_options:
            _, _, ratio, tail = min(ratio_options)
        else:
            raise ValueError("Ring ending cannot fit this bar plan with a ratio in [0.96, 1.04].")
    else:
        ratio = plan_source_samples / target_samples
        if .958 <= ratio < .96:
            ratio = .96
        elif 1.04 < ratio <= 1.042:
            ratio = 1.04
        if not .96 <= ratio <= 1.04:
            raise ValueError(f"Exact bar fit needs tempo ratio {ratio:.4f}, outside [0.96, 1.04].")
    return starts, bars, path, joins, ratio, tail, drop_k, drop, target_drop_k


def fit_track(args):
    y, sr = read_audio(args.track)
    target = round(args.length * sr)
    analysis = json.loads(Path(args.analysis).read_text(encoding="utf-8")) if args.analysis else analyze(args.track)
    requested_drop, dropped_constraint = args.drop_at, False
    try:
        starts, bars, path, joins, ratio, tail, drop_k, drop_bar, target_drop_k = _fit_plan(args, analysis)
    except ValueError:
        if requested_drop is None: raise
        # Short or uniform sources may not allow the drop to be pinned; keep the exact length and say so.
        args.drop_at, dropped_constraint = None, True
        starts, bars, path, joins, ratio, tail, drop_k, drop_bar, target_drop_k = _fit_plan(args, analysis)
    source_end = int(round(analysis["duration"] * sr))
    audio_bars = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else analysis["duration"]
        audio_bars.append(y[int(round(start * sr)):min(source_end, int(round(end * sr)))])
    assembled = audio_bars[path[0]].copy()
    join_by_output = {join["output_bar"]: join for join in joins}
    for out_index, source_index in enumerate(path[1:], 1):
        next_bar = audio_bars[source_index]
        if out_index in join_by_output:
            length = min(round(60 / analysis["tempo"] * sr), len(assembled), len(next_bar))
            if length > 1:
                phase = np.linspace(0, np.pi / 2, length, endpoint=True)
                assembled[-length:] = assembled[-length:] * np.cos(phase) + next_bar[:length] * np.sin(phase)
                next_bar = next_bar[length:]
            join_by_output[out_index]["time"] = max(0.0, (len(assembled) - length / 2) / sr / ratio)
        assembled = np.r_[assembled, next_bar]
    warnings = []
    if abs(ratio - 1) > 1e-4:
        assembled = _run_filter(assembled, sr, f"rubberband=tempo={ratio:.8f}:pitch=1:formant=preserved")
    tail_samples = round(tail * sr)
    if args.ending == "ring" and tail_samples > 0 and len(assembled):
        source_tail = assembled[-min(len(assembled), max(1, round(.25 * sr))):]
        low = sosfiltfilt(butter(4, 180, fs=sr, output="sos"), source_tail) if len(source_tail) > 20 else source_tail
        extension = np.resize(low, tail_samples) * np.exp(-np.linspace(0, 6, tail_samples))
        assembled = np.r_[assembled, extension]
    if args.ending == "bar":
        fade = min(len(assembled), round(.012 * sr)); assembled[-fade:] *= np.linspace(1, 0, fade)
    elif args.ending == "fade":
        fade = min(len(assembled), round(2 * 4 * 60 / analysis["tempo"] * sr / ratio)); assembled[-fade:] *= np.linspace(1, 0, fade)
    if len(assembled) < target: assembled = np.pad(assembled, (0, target - len(assembled)))
    assembled = assembled[:target]
    requested = requested_drop
    actual = None
    if dropped_constraint: warnings.append(f"Requested drop at {requested_drop:.3f}s could not be pinned with this source; length is exact, drop not placed.")
    if requested is not None:
        if drop_k is not None:
            output_drop_bar = drop_k
        else:
            positions = [i for i, source_bar in enumerate(path) if source_bar == drop_bar]
            output_drop_bar = min(positions, key=lambda i: abs(i * float(np.median(np.diff(starts)))/ratio - requested)) if positions else None
        if output_drop_bar is not None:
            beat_samples = 60 / analysis["tempo"] * sr
            prefix_samples = sum(len(audio_bars[path[i]]) for i in range(output_drop_bar))
            prefix_samples -= sum(beat_samples for join in joins if join["output_bar"] <= output_drop_bar)
            actual = max(0.0, prefix_samples / sr / ratio)
    residual_ms = (actual - requested) * 1000 if requested is not None and actual is not None else None
    if residual_ms is not None and abs(residual_ms) >= 40:
        warnings.append(f"Requested drop at {requested:.3f}s; closest planned placement is {actual:.3f}s ({residual_ms:+.1f} ms residual).")
    last_bar_prefix = sum(len(audio_bars[path[i]]) for i in range(max(0, len(path)-1)))
    last_bar_prefix -= sum(round(60 / analysis["tempo"] * sr) for join in joins if join["output_bar"] <= len(path)-1)
    strong_hit_time = max(0.0, last_bar_prefix / sr / ratio)
    report = {"source_bar_indices": path, "joins": joins, "r": ratio, "drop_at_requested": requested, "drop_at_actual": actual, "drop_residual_ms": residual_ms, "ending_hit_time": strong_hit_time, "ending_hit_source_bar": path[-1], "ending_downbeat_error_ms": 0.0, "tail_seconds": tail, "length_samples": len(assembled), "warnings": warnings}
    write_audio(args.output, assembled, sr)
    if args.report: Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")


def _run_filter(y, sr, filt):
    td = Path("work/music_cache/scratch"); td.mkdir(parents=True, exist_ok=True)
    src, dst = td / "in.wav", td / "out.wav"
    sf.write(src, y, sr)
    p = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", filt, str(dst)], capture_output=True, text=True)
    if p.returncode: raise ValueError(p.stderr[-300:])
    out, _ = sf.read(dst, dtype="float32"); return out


def _onset_envelope(y, sr, frame_ms=5):
    """Short-frame RMS rise, suitable for measuring beat-phase alignment."""
    hop = max(1, round(sr * frame_ms / 1000))
    count = len(y) // hop
    if count < 4: return np.zeros(0, dtype=np.float32), hop / sr
    frames = np.asarray(y[:count * hop], dtype=np.float32).reshape(count, hop)
    rms = np.sqrt(np.mean(frames * frames, axis=1) + 1e-12)
    onset = np.maximum(0, np.diff(np.r_[rms[0], rms]))
    onset -= np.mean(onset)
    onset /= max(float(np.linalg.norm(onset)), 1e-8)
    return onset, hop / sr


def _measure_onset_offset(reference, candidate, sr, limit_s=.18):
    """Return the candidate source offset that best aligns overlap onset envelopes."""
    ref, step = _onset_envelope(reference, sr)
    cand, _ = _onset_envelope(candidate, sr)
    if min(len(ref), len(cand)) < 8: return 0.0
    max_lag = min(round(limit_s / step), len(ref) // 3)
    scores = []
    for lag in range(-max_lag, max_lag + 1):
        # Positive lag selects later source audio, moving its events earlier in
        # the assembled timeline. Compare only the shared valid interval.
        lo, hi = max(0, -lag), min(len(ref), len(cand) - lag)
        if hi - lo < 8: scores.append(-1.0); continue
        scores.append(float(np.dot(ref[lo:hi], cand[lo + lag:hi + lag])))
    best = int(np.argmax(scores)); fraction = 0.0
    if 0 < best < len(scores) - 1:
        left, center, right = scores[best - 1:best + 2]
        denom = left - 2 * center + right
        if abs(denom) > 1e-9: fraction = float(np.clip(.5 * (left - right) / denom, -.5, .5))
    return (best - max_lag + fraction) * step


def _grid_offset(candidate, sr, period, limit_s=.18):
    """Offset (s) of the candidate's onset envelope relative to a regular beat grid starting at 0.

    Positive means the candidate's beats fall later than the grid, so starting it later aligns them.
    """
    env, step = _onset_envelope(candidate, sr)
    if len(env) < 8 or period <= 0: return 0.0
    count = len(env)
    pulses = np.zeros(count)
    width = max(1, round(.012 / step))
    kernel = np.exp(-.5 * (np.arange(-3 * width, 3 * width + 1) / width) ** 2)
    for k in range(int(count * step / period) + 1):
        ix = round(k * period / step)
        if ix < count: pulses[ix] = 1.0
    pulses = np.convolve(pulses, kernel, mode="same")
    max_lag = min(round(limit_s / step), count // 3)
    scores = []
    for lag in range(-max_lag, max_lag + 1):
        lo, hi = max(0, -lag), min(count, count - lag)
        scores.append(float(np.dot(pulses[lo:hi], env[lo + lag:hi + lag])) if hi - lo >= 8 else -1.0)
    best = int(np.argmax(scores)); fraction = 0.0
    if 0 < best < len(scores) - 1:
        left, center, right = scores[best - 1:best + 2]
        denom = left - 2 * center + right
        if abs(denom) > 1e-9: fraction = float(np.clip(.5 * (left - right) / denom, -.5, .5))
    return (best - max_lag + fraction) * step


def _local_period(beats, lo, hi):
    """Beat period from a straight-line fit of beat index against time in [lo, hi]."""
    sel = np.asarray([b for b in beats if lo <= b <= hi])
    if len(sel) < 5: return None
    return float(np.polyfit(np.arange(len(sel)), sel, 1)[0])


def blend(args):
    ya, sr = read_audio(args.track_a); yb, _ = read_audio(args.track_b)
    aa, ab = analyze(args.track_a), analyze(args.track_b)
    ta = float(args.a_out if args.a_out is not None else aa["duration"] - min(20, aa["duration"] * .15))
    tb = float(args.b_in if args.b_in is not None else next((s["start"] for s in ab["sections"] if s["label"] != "intro"), 0))
    da = np.asarray(aa["downbeats"]); db = np.asarray(ab["downbeats"])
    if len(da): ta = float(da[np.argmin(abs(da - ta))])
    if len(db): tb = float(db[np.argmin(abs(db - tb))])
    tempo_a, tempo_b = aa["tempo"], ab["tempo"]
    ratio = tempo_a / tempo_b
    if not .92 <= ratio <= 1.08:
        if .92 <= ratio * 2 <= 1.08: ratio *= 2
        elif .92 <= ratio / 2 <= 1.08: ratio /= 2
        else: raise ValueError("Tempo mismatch exceeds 8%; use a cut/fade transition.")
    nominal = tempo_a / tempo_b
    window_s = max(1, args.bars) * 4 * 60 / tempo_a
    pa = _local_period(aa["beats"], ta - window_s, ta)
    pb = _local_period(ab["beats"], tb, tb + window_s)
    if pa and pb:
        refined = pb / pa * (ratio / nominal)
        if abs(refined / ratio - 1) < .01: ratio = refined
    yb_orig, tb_src = yb, tb
    def stretched(r):
        return _run_filter(yb_orig, sr, f"rubberband=tempo={r:.8f}:pitch=1") if abs(r - 1) > 1e-5 else yb_orig
    yb = stretched(ratio)
    tb = tb_src / ratio
    ka, kb = aa["key"]["camelot"], ab["key"]["camelot"]
    semitones = 0; key_warning = None
    def camelot_compatible(left, right):
        if not left or not right: return True
        ln, ll = int(left[:-1]), left[-1]; rn, rl = int(right[:-1]), right[-1]
        return (ll == rl and min((ln-rn) % 12, (rn-ln) % 12) <= 1) or (ln == rn and ll != rl)
    if not camelot_compatible(ka, kb) and args.key_shift == "auto":
        tonic_idx = {name: i for i, name in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}
        btonic = ab["key"]["tonic"]
        shifts = sorted(range(-2, 3), key=abs)
        for shift in shifts:
            if btonic not in tonic_idx: break
            candidate = (tonic_idx[btonic] + shift) % 12
            profile = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"] if ab["key"]["mode"] == "major" else ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"]
            candidate_key = profile[candidate]
            if camelot_compatible(ka, candidate_key):
                semitones = shift; kb = candidate_key
                if shift:
                    yb = _run_filter(yb, sr, f"rubberband=pitch={2 ** (shift / 12):.8f}")
                break
        if not semitones: key_warning = "No Camelot-compatible key shift within ±2 semitones."
    elif not camelot_compatible(ka, kb):
        key_warning = "Track keys are not Camelot-compatible."
    if args.key_shift != "auto":
        try:
            semitones = int(args.key_shift)
        except ValueError:
            raise ValueError("--key-shift must be auto or an integer semitone count.")
        if abs(semitones) > 12:
            raise ValueError("--key-shift numeric value must be between -12 and 12.")
        if semitones:
            yb = _run_filter(yb, sr, f"rubberband=pitch={2 ** (semitones / 12):.8f}")
    nbar = max(1, args.bars); beat = 60 / tempo_a; dur = nbar * 4 * beat; n = int(dur * sr)
    start_a = int(ta * sr); start_b = int(tb * sr)
    beat_period = pa or beat
    def offsets(signal, begin):
        seg = signal[begin:begin + n]
        if len(seg) < n: seg = np.pad(seg, (0, n - len(seg)))
        half = n // 2
        return _grid_offset(seg, sr, beat_period), _grid_offset(seg[:half], sr, beat_period), _grid_offset(seg[half:], sr, beat_period)
    whole, first, second = offsets(yb, start_b)
    drift = second - first
    if abs(drift) > .004:
        # Residual tempo error: B's beats walk across the grid. Re-stretch once; keep it only if it helps.
        trial_ratio = ratio * (1 + drift / (n / 2 / sr))
        if abs(trial_ratio / ratio - 1) < .01:
            trial = stretched(trial_ratio)
            if semitones: trial = _run_filter(trial, sr, f"rubberband=pitch={2 ** (semitones / 12):.8f}")
            trial_start = int(tb_src / trial_ratio * sr)
            t_whole, t_first, t_second = offsets(trial, trial_start)
            if abs(t_second - t_first) < abs(drift):
                ratio, yb, start_b, whole, first, second = trial_ratio, trial, trial_start, t_whole, t_first, t_second
    measured_offset = whole
    offset_samples = round(measured_offset * sr)
    if offset_samples >= 0:
        start_b = int(np.clip(start_b + offset_samples, 0, max(0, len(yb) - 1)))
    else:
        yb = np.pad(yb, (-offset_samples, 0))
        start_b = max(0, start_b)
    tb = start_b / sr
    xa = ya[max(0, start_a - n):start_a]; xb = yb[start_b:start_b + n]
    if len(xa) < n: xa = np.pad(xa, (n - len(xa), 0))
    if len(xb) < n: xb = np.pad(xb, (0, n - len(xb)))
    # Split bass and high band with LR4 filters.
    sos_low = butter(2, 200, fs=sr, output="sos")
    al = sosfiltfilt(sos_low, xa); bl = sosfiltfilt(sos_low, xb)
    ah, bh = xa - al, xb - bl
    phase = np.linspace(0, np.pi / 2, n)
    high = ah * np.cos(phase) + bh * np.sin(phase)
    swap = n // 2; width = max(1, int(beat * sr / 2))
    bass = np.r_[al[:max(0, swap - width // 2)], np.linspace(1, 0, width) * al[max(0, swap - width // 2):max(0, swap - width // 2) + width] + np.linspace(0, 1, width) * bl[max(0, swap - width // 2):max(0, swap - width // 2) + width], bl[max(0, swap - width // 2) + width:]]
    lead_in, lead_out = ya[:max(0, start_a - n)], yb[min(len(yb), start_b + n):]
    if not args.full:
        # Default: ~20 s of A before and ~20 s of B after the blend (the editor places it, not the whole songs).
        lead_in, lead_out = lead_in[-20 * sr:], lead_out[:20 * sr]
    mix = np.r_[lead_in, (high + bass)[:n], lead_out]
    peak = float(np.max(np.abs(mix))) or 1
    gain = min(1.0, 10 ** (-1 / 20) / peak)
    mix *= gain
    write_audio(args.output, mix, sr)
    _, res_first, res_second = offsets(yb, start_b)
    misalignment_ms = max(abs(res_first), abs(res_second)) * 1000
    report = {"blend_start": len(lead_in) / sr, "blend_end": (len(lead_in) + n) / sr, "source_blend_start": (start_a - n) / sr, "a_out": ta, "b_in": tb, "tempo_ratio": ratio, "semitones": semitones, "camelot_a": ka, "camelot_b": kb, "misalignment_ms": misalignment_ms, "beat_offset_ms": [res_first * 1000, res_second * 1000], "period_a": pa, "period_b": pb, "final_ratio": ratio, "measured_offset_ms": measured_offset * 1000, "peak_gain_db": 20 * math.log10(gain)}
    if key_warning: report["warning"] = key_warning
    if args.report: Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")


def duck(args):
    voice, sr = read_audio(args.voice); music, _ = read_audio(args.music)
    target = len(voice); music = np.pad(music, (0, max(0, target - len(music))))[:target]
    frame = max(1, int(sr * .01)); rms = np.sqrt(np.maximum(0, np.convolve(voice * voice, np.ones(frame) / frame, mode="same")))
    floor = float(np.percentile(rms, 20)); peak = float(np.percentile(rms, 95)); threshold = max(floor * 2.5, peak * .08, 1e-5)
    active = rms > threshold
    look = max(0, int(sr * args.lookahead_ms / 1000)); active = np.r_[active[look:], np.zeros(min(look, len(active)), dtype=bool)][:len(active)]
    # Smooth activity with attack/release envelopes.
    gain = np.ones(len(music), dtype=np.float32); target_gain = 10 ** (-args.under / 20)
    attack = max(1, int(sr * args.attack_ms / 1000)); release = max(1, int(sr * args.release_ms / 1000))
    cur = 1.0
    for i, on in enumerate(active):
        dest = target_gain if on else 1.0
        cur += (dest - cur) / (attack if dest < cur else release)
        gain[i] = cur
    # Mid carve follows the same speech envelope.
    mid = sosfiltfilt(butter(2, [1400, 2800], fs=sr, btype="bandpass", output="sos"), music)
    carve = 10 ** (-args.carve_db / 20)
    out = music * gain - mid * (1 - carve) * active.astype(np.float32)
    write_audio(args.output, out, sr)
    speech = active
    reduction = 20 * math.log10(max(float(np.mean(gain[speech])) if np.any(speech) else 1, 1e-8))
    print(f"OK music duck {args.output}; average speech reduction {reduction:.2f} dB")


def cuts(args):
    data = json.loads(Path(args.analysis).read_text(encoding="utf-8")) if args.analysis else analyze(args.track)
    fit_segments = []
    if args.fit_report:
        try: fit_segments = json.loads(Path(args.fit_report).read_text(encoding="utf-8")).get("segments", [])
        except Exception: fit_segments = []
    if fit_segments:
        def map_source_time(source_time):
            for segment in fit_segments:
                if segment["src_start"] <= source_time <= segment["src_end"]:
                    return segment["out_start"] + source_time - segment["src_start"]
            return None
        data = dict(data)
        data["beats"] = [mapped for t in data.get("beats", []) if (mapped := map_source_time(float(t))) is not None]
        data["downbeats"] = [mapped for t in data.get("downbeats", []) if (mapped := map_source_time(float(t))) is not None]
        data["onsets"] = [{**event, "t": mapped} for event in data.get("onsets", []) if (mapped := map_source_time(float(event["t"]))) is not None]
        mapped_sections = []
        for section in data.get("sections", []):
            start = map_source_time(float(section["start"]))
            end = map_source_time(float(section["end"]))
            if start is not None: mapped_sections.append({**section, "start": start, "end": end if end is not None else start})
        data["sections"] = mapped_sections
        mapped_drops = []
        for drop in data.get("drops", []):
            mapped = map_source_time(float(drop["t"]))
            if mapped is not None: mapped_drops.append({**drop, "t": mapped})
        data["drops"] = mapped_drops
    beats, downs = data["beats"], data["downbeats"]
    sections, events = data["sections"], data["onsets"]
    duration = min(args.length, data["duration"])
    candidates = sorted(set([float(t) for t in beats if t <= duration] + [float(e["t"]) for e in events if e["band"] == "low" and e["strength"] > .4 and e["t"] <= duration]))
    out, t, prior, run = [], 0.0, None, 0
    while t < duration - args.min_shot:
        sec = next((s for s in sections if s["start"] <= t < s["end"]), {})
        energy = 0.0 if not sec else sec.get("energy_db", -30)
        if args.style == "energetic" or sec.get("label") == "drop": beats_n = 1 if energy > -10 else 2
        elif args.style == "build": beats_n = max(1, 8 >> min(run // 3, 3))
        else: beats_n = 4 if energy > -8 else 8
        shot = beats_n * 60 / data["tempo"]
        shot = min(args.max_shot, max(args.min_shot, shot))
        if beats_n == prior: run += 1
        else: run = 0
        if run >= 3: beats_n = 2 if beats_n != 2 else 4; shot = min(args.max_shot, max(args.min_shot, beats_n * 60 / data["tempo"])); run = 0
        target = min(duration, t + shot)
        near = [x for x in candidates if abs(x - target) <= min(.2, shot * .2)]
        event = min(near, key=lambda x: abs(x - target)) if near else target
        frame = round(event * args.fps); exact = frame / args.fps
        typ = "downbeat" if any(abs(event - x) < .03 for x in downs) else "beat" if any(abs(event - x) < .03 for x in beats) else "onset"
        out.append({"t": exact, "frame": frame, "on": typ, "strength": 1.0 if typ == "downbeat" else .7, "section": sec.get("label", "verse"), "shot_beats": beats_n})
        t = max(t + args.min_shot, event); prior = beats_n
    markers = [{"t": d["t"], "frame": round(d["t"] * args.fps)} for d in data["drops"]]
    Path(args.output).write_text(json.dumps({"cuts": out, "drop": markers}, indent=2), encoding="utf-8")


def main():
    p = argparse.ArgumentParser(); sp = p.add_subparsers(dest="cmd", required=True)
    x = sp.add_parser("analyze"); x.add_argument("track", type=Path); x.add_argument("-o", "--output", required=True, type=Path); x.add_argument("--no-cache", action="store_true")
    x = sp.add_parser("window"); x.add_argument("track", type=Path); x.add_argument("--length", type=float, required=True); x.add_argument("--peak-at", type=float, default=.7)
    x = sp.add_parser("duck"); x.add_argument("voice", type=Path); x.add_argument("music", type=Path); x.add_argument("-o", "--output", required=True, type=Path); x.add_argument("--under", type=float, default=20); x.add_argument("--attack-ms", type=float, default=15); x.add_argument("--release-ms", type=float, default=350); x.add_argument("--lookahead-ms", type=float, default=80); x.add_argument("--carve-db", type=float, default=3)
    x = sp.add_parser("fit"); x.add_argument("track", type=Path); x.add_argument("--length", type=float, required=True); x.add_argument("-o", "--output", required=True, type=Path); x.add_argument("--drop-at", type=float); x.add_argument("--drop-index", type=int, default=1, help="1-based rank in the strongest-first drop list"); x.add_argument("--ending", choices=["ring", "bar", "fade"], default="ring"); x.add_argument("--analysis"); x.add_argument("--report")
    x = sp.add_parser("blend"); x.add_argument("track_a", type=Path); x.add_argument("track_b", type=Path); x.add_argument("-o", "--output", required=True, type=Path); x.add_argument("--bars", type=int, default=8); x.add_argument("--a-out", type=float); x.add_argument("--b-in", type=float); x.add_argument("--key-shift", default="auto"); x.add_argument("--report"); x.add_argument("--full", action="store_true")
    x = sp.add_parser("cuts"); x.add_argument("track", type=Path); x.add_argument("--length", type=float, required=True); x.add_argument("--fps", type=float, default=30); x.add_argument("--style", choices=["steady", "build", "energetic"], default="steady"); x.add_argument("--min-shot", type=float, default=.45); x.add_argument("--max-shot", type=float, default=4); x.add_argument("--analysis"); x.add_argument("--fit-report"); x.add_argument("-o", "--output", required=True, type=Path)
    a = p.parse_args()
    try:
        if a.cmd == "analyze":
            result = analyze(a.track, a.no_cache); a.output.parent.mkdir(parents=True, exist_ok=True); a.output.write_text(json.dumps(result, indent=2), encoding="utf-8"); print(f"OK music analyze tempo={result['tempo']:.2f} BPM")
        elif a.cmd == "window":
            y, sr = read_audio(a.track); hop = sr // 2; energy = [float(np.sqrt(np.mean(y[i:i + hop] ** 2))) for i in range(0, len(y), hop)]; n = max(1, round(a.length * 2)); best = max(range(max(1, len(energy) - n + 1)), key=lambda i: max(energy[i:i+n], default=0)); peak = best + int(np.argmax(energy[best:best+n])); print(json.dumps({"start": max(0, peak / 2 - a.length * a.peak_at), "peak_time": peak / 2, "length": a.length}))
        elif a.cmd == "duck": duck(a)
        elif a.cmd == "fit": fit_track(a)
        elif a.cmd == "blend": blend(a)
        elif a.cmd == "cuts": cuts(a)
    except (ValueError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr); return 2


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main() or 0)

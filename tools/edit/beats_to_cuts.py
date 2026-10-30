"""Snap EDL boundaries to musical events while respecting transcript words."""
import argparse
import json
import sys
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("music", type=Path); ap.add_argument("--edl", required=True, type=Path); ap.add_argument("--snap", type=float, default=.08); ap.add_argument("--fps", type=float); ap.add_argument("--lead-ms", type=float, default=0)
    args = ap.parse_args(); music = json.loads(args.music.read_text(encoding="utf-8-sig")); edl = json.loads(args.edl.read_text(encoding="utf-8-sig"))
    items = edl if isinstance(edl, list) else edl.get("ranges", edl.get("clips", edl.get("segments", [])))
    words = []
    for tp in list(args.edl.parent.glob("transcripts/*.json")) + list(args.edl.parent.parent.glob("transcripts/*.json")):
        try:
            def walk(obj):
                if isinstance(obj, dict):
                    if any(k in obj for k in ("start", "start_time")) and any(k in obj for k in ("end", "end_time")):
                        words.append((float(obj.get("start", obj.get("start_time"))), float(obj.get("end", obj.get("end_time")))))
                    for value in obj.values(): walk(value)
                elif isinstance(obj, list):
                    for value in obj: walk(value)
            walk(json.loads(tp.read_text(encoding="utf-8-sig")))
        except Exception: pass
    events = [(float(t), "beat") for t in music.get("beats", [])]
    events += [(float(e.get("t", 0)), "onset") for e in music.get("onsets", []) if e.get("strength", 0) > .4]
    events += [(float(t), "downbeat") for t in music.get("downbeats", [])]
    report = []
    for item in items:
        for key in ("start", "end", "overlay_start"):
            if key not in item: continue
            old = float(item[key]); candidates = []
            if args.fps:
                candidates.extend((round(old * args.fps) + i) / args.fps for i in range(-2, 3))
            candidates.extend(t for t, _ in events if abs(t - old) <= args.snap)
            candidates.append(old)
            candidates = [t for t in candidates if t >= 0 and not any(lo < t < hi for lo, hi in words)]
            if not candidates: continue
            def score(t):
                event_dist = min((abs(t - e) for e, _ in events), default=args.snap)
                return event_dist + abs(t - old) * .15
            chosen = min(candidates, key=score)
            shift = min(args.lead_ms / 1000, 2 / args.fps if args.fps else args.snap)
            new = chosen - shift
            if args.fps: new = round(new * args.fps) / args.fps
            new = max(0, new)
            event = min(events, key=lambda e: abs(e[0] - chosen)) if events else (None, "none")
            item[key] = new
            report.append({"field": key, "old": old, "new": new, "delta_frames": (new - old) * (args.fps or 1), "event": event[1], "event_time": event[0]})
    out = args.edl.with_name(args.edl.stem + ".snapped.json"); out.write_text(json.dumps(edl, indent=2), encoding="utf-8")
    md = "# Beat snap report\n\n" + ("\n".join(f"- {x['field']}: {x['old']:.3f}s → {x['new']:.3f}s ({x['delta_frames']:+.2f} frames), {x['event']} at {x['event_time']:.3f}s" for x in report) or "No changes within tolerance.") + "\n"
    out.with_suffix(".report.md").write_text(md, encoding="utf-8"); print(f"OK beats_to_cuts {len(report)} boundaries; {out}")


if __name__ == "__main__": sys.stdout.reconfigure(encoding="utf-8"); main()

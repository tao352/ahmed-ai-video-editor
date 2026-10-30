"""Pace check: find stretches where nothing new happens on screen.

Plan mode reads edit.json (+ edl.json for cut points) before any render; it is the gate to use.
Render mode measures an MP4 (any video, ours or a reference): a card that covers <15% of the frame
counts as a small change there, so render mode reports more big-change gaps than plan mode.
Big changes = cuts, layout switches, graphics in/out, zooms, transitions. Any change = big + caption swaps.
Targets come from a reference style.json (reference.py) or the flags. Exit code 1 when a gap fails.

  python tools/edit/pace.py projects/x/edit/edit.json [--edl projects/x/edit/edl.json] [--target work/refs/y/style.json]
  python tools/edit/pace.py projects/x/edit/final.mp4 [--target ...] [--max-gap 4 --max-gap-any 1.8] [--json out.json]
"""
import argparse, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _visual import gaps, _dedupe

# Long-lived layers that never read as "something new": texture, grade, caption tracks, logo bugs, trackers.
PERSISTENT = ("FilmGrain", "ColorGrade", "LightLeak", "Letterbox", "LogoBug", "BrandBackground", "Captions", "Tracker")


def edl_cuts(edl):
    """Output times where the EDL jumps (a new range that is not contiguous with the previous one)."""
    out, t, prev = [], 0.0, None
    for r in edl.get("ranges", []):
        if prev and not (r.get("source") == prev.get("source") and abs(r["start"] - prev["end"]) < .05):
            out.append(round(t, 2))
        t += r["end"] - r["start"]; prev = r
    return out


def inner_times(props):
    """Absolute-second timing props inside a clip: any key 'at' or ending in 'At', at any depth."""
    out = []
    def walk(v, key=""):
        if isinstance(v, dict):
            for k, x in v.items():
                walk(x, k)
        elif isinstance(v, list):
            for x in v:
                walk(x, key)
        elif isinstance(v, (int, float)) and not isinstance(v, bool) and (key == "at" or key.endswith("At")):
            out.append(float(v))
    walk(props)
    return out


def caption_swaps(words, max_words=3, gap_break=.25):
    """Approximate caption chunk starts: a new chunk after max_words words or a pause."""
    out, n, last_end = [], 0, None
    for s, e, _ in words:
        if n == 0 or n >= max_words or (last_end is not None and s - last_end > gap_break):
            out.append(round(s, 2)); n = 0
        n += 1; last_end = e
    return out


def plan_events(edit, edl=None):
    dur = edit["settings"]["duration"]
    big, why = [], {}
    def add(t, label):
        if 0 < t < dur - .05:
            big.append(round(t, 2)); why.setdefault(round(t, 2), label)
    for b in edit.get("base", [])[1:]:
        add(b.get("start", 0), "base clip")
    for t in edl_cuts(edl or {}):
        add(t, "cut")
    beats = edit.get("layout", {}).get("beats", [])
    for a, b in zip(beats, beats[1:]):
        if a.get("mode") != b.get("mode"):
            add(b["from"], f"layout {b.get('mode')}")
    for c in edit.get("clips", []):
        name = c["component"]
        if any(p in name for p in PERSISTENT) or c["to"] - c["from"] > .5 * dur:
            continue
        add(c["from"], f"{name} in")
        # an exit only counts if nothing replaces it right away (the next entrance covers that case)
        add(c["to"], f"{name} out")
        for k in (c.get("props") or {}).get("events", []) or []:  # optional internal beats a component declares
            if isinstance(k, (int, float)):
                add(c["from"] + k, f"{name} beat")
        for t in inner_times(c.get("props") or {}):  # absolute timing props: steps[].at, plates[].at, doseAt, strikeAt...
            if c["from"] + .25 < t < c["to"] - .1:
                add(t, f"{name} beat")
    for z in edit.get("zooms", []):
        if z["type"] == "punch":
            add(z["t"], "zoom punch")
        elif z["type"] == "ratchet":
            for t, _ in z["steps"]:
                add(t, "zoom step")
        elif z["type"] == "kenburns":
            add(z["t0"], "ken burns")
    for x in edit.get("transitions", []):
        add(x["at"], f"transition {x['type']}")
    for s in edit.get("big", []) + edit.get("phrases", []):
        add(s["from"], "big text")
    cap = edit.get("captions", {})
    st = cap.get("style", {}) or {}
    has_caps = cap.get("enabled", True) and (st.get("preset") != "none" or any("Caption" in c["component"] for c in edit.get("clips", [])))
    small = caption_swaps(cap.get("words", []), st.get("maxWords", 3), st.get("gapBreak", .25)) if has_caps else []
    big = _dedupe(sorted(set(big)), .3)
    return dur, big, small, why


def render_events(video):
    from _visual import analyze
    v = analyze(video)
    why = {t: ("cut" if t in v["cuts"] else "visual change") for t in v["events"]}
    why.update({p["t"]: "zoom punch" for p in v["punches"]})
    big = _dedupe(sorted(set(v["events"] + [p["t"] for p in v["punches"]])), .3)
    return v["duration"], big, v["small"], why


def words_between(edit, a, b):
    return " ".join(w for s, _, w in (edit or {}).get("captions", {}).get("words", []) if a <= s < b)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path, help="edit.json (plan) or a video file (render)")
    ap.add_argument("--edl", type=Path)
    ap.add_argument("--target", type=Path, help="style.json from reference.py")
    ap.add_argument("--max-gap", type=float)
    ap.add_argument("--max-gap-any", type=float)
    ap.add_argument("--skip-end", type=float, default=0, help="ignore the last N s (end card)")
    ap.add_argument("--json", type=Path)
    a = ap.parse_args()
    tg = json.loads(a.target.read_text(encoding="utf-8")).get("targets", {}) if a.target else {}
    max_gap = a.max_gap or tg.get("max_gap") or 4.0
    max_any = a.max_gap_any or tg.get("max_gap_any") or 1.8
    edit = None
    if a.input.suffix.lower() == ".json":
        edit = json.loads(a.input.read_text(encoding="utf-8"))
        edl = json.loads(a.edl.read_text(encoding="utf-8")) if a.edl else None
        dur, big, small, why = plan_events(edit, edl); mode = "plan"
    else:
        dur, big, small, why = render_events(a.input); mode = "render"
    end = dur - a.skip_end
    gb = [g for g in gaps(big, end) if g[2] > max_gap]
    ga = [g for g in gaps(sorted(set(big + small)), end) if g[2] > max_any]
    every = round(end / max(1, len([t for t in big if t < end]) + 1), 2)
    print(f"Pace ({mode}) {a.input.name}: {dur:.1f} s, {len(big)} big changes (one every {every} s), {len(small)} caption/small changes")
    print(f"Targets: big change every <= {max_gap} s, any change every <= {max_any} s" + (f" (from {a.target})" if a.target else ""))
    for label, items, limit in (("Big-change gaps", gb, max_gap), ("Dead screen (nothing changes)", ga, max_any)):
        print(f"\n{label} over {limit} s: {len(items)}")
        for s, e, L in sorted(items)[:25]:
            prev = max([t for t in big if t <= s] or [0]); text = words_between(edit, s, e)
            print(f"  {s:7.2f}-{e:7.2f}  {L:5.2f} s  after: {why.get(prev, 'start')}" + (f"  | \"{text[:90]}\"" if text else ""))
    if gb or ga:
        print("\nFix ideas: zoom punch on the key word, a graphic/b-roll for the claim, a layout switch, a jump cut, or split the long card into steps (props.events).")
    report = {"mode": mode, "duration": dur, "max_gap": max_gap, "max_gap_any": max_any, "big": big, "small": small,
              "big_every": every, "fail_big": gb, "fail_any": ga, "pass": not gb and not ga}
    if a.json:
        a.json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\nPASS" if report["pass"] else "\nFAIL")
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError) as exc:
        sys.exit(str(exc))

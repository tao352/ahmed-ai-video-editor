"""HyperFrames overlay lane: graphics from assets/library/graphics rendered by HyperFrames as a
transparent layer, then composited onto a finished video with FFmpeg. Heavy motion graphics go here
instead of the Remotion Edit render (HyperFrames renders ~5x faster on this machine). Items with
"behind": true go in a second layer placed under the speaker, using a mask from matte.py --mask.

  python tools/edit/hf_overlay.py list
  python tools/edit/hf_overlay.py build  SPEC.json -o DIR          # writes DIR/front[/behind]/index.html
  python tools/edit/hf_overlay.py render DIR                       # DIR/*/overlay.mov (ProRes 4444, cached)
  python tools/edit/hf_overlay.py compose BASE.mp4 DIR -o OUT.mp4 [--mask mask.mp4]
  python tools/edit/hf_overlay.py all SPEC.json BASE.mp4 -o OUT.mp4 [--mask mask.mp4]

SPEC: {"width":1080,"height":1920,"fps":30,"duration":12,
       "items":[{"asset":"callout-box","at":1.2,"duration":3,"vars":{"--gfx-x":"80px","--gfx-y":"300px"},
                 "text":{"gfx-title":"Rest days","gfx-text":"2 per week"},"options":{},"behind":false}]}
`text` keys are class names inside the snippet; the first element with that class gets the new text.
`css` is extra CSS for one item, "&" stands for the item (e.g. "& .gfx-body{justify-content:flex-start;padding:260px 80px}").
Most snippets were laid out for 16:9: on 9:16 set --gfx-x/--gfx-y or css, then check a frame.
"""
import argparse, hashlib, html, json, re, shutil, subprocess, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _media import probe

ROOT = Path(__file__).resolve().parents[2]
LIB = ROOT / "assets" / "library" / "graphics"
GSAP = ROOT / ".claude" / "skills" / "music-to-video" / "references" / "motion-primitives" / "assets" / "gsap.min.js"
GSAP_CDN = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"


def catalog():
    return {a["id"]: a for a in json.loads((LIB / "catalog.json").read_text(encoding="utf-8"))["assets"]}


def split_snippet(text):
    styles = "\n".join(re.findall(r"<style>.*?</style>", text, re.S))
    scripts = "\n".join(re.findall(r"<script>.*?</script>", text, re.S))
    body = re.sub(r"<style>.*?</style>|<script>.*?</script>|<!--.*?-->", "", text, flags=re.S).strip()
    return styles, scripts, body


def set_text(body, cls, value):
    pat = re.compile(r'(<(\w+)[^>]*class="[^"]*\b' + re.escape(cls) + r'\b[^"]*"[^>]*>)(.*?)(</\2>)', re.S)
    if not pat.search(body):
        print(f"  warning: class {cls} not found in snippet")
    return pat.sub(lambda m: m.group(1) + html.escape(str(value)) + m.group(4), body, count=1)


def build_layer(spec, items, out, cat):
    W, H, fps, dur = spec["width"], spec["height"], spec.get("fps", 30), spec["duration"]
    out.mkdir(parents=True, exist_ok=True)
    if GSAP.exists():
        shutil.copy2(GSAP, out / "gsap.min.js"); gsap = "gsap.min.js"
    else:
        gsap = GSAP_CDN
    heads, clips, calls, seen = [], [], [], set()
    for i, it in enumerate(items, 1):
        a = cat.get(it["asset"])
        if not a:
            raise ValueError(f"Unknown asset {it['asset']}; run: hf_overlay.py list")
        styles, scripts, body = split_snippet((LIB / next(f for f in a["files"] if f.endswith(".html"))).read_text(encoding="utf-8"))
        if a["id"] not in seen:
            heads.append(styles + "\n" + scripts); seen.add(a["id"])
        el = it.get("id") or f"o{i}-{a['id']}"
        at, d = float(it["at"]), float(it.get("duration", a.get("default_duration_s", 3)))
        body = re.sub(r'id="[^"]+"', f'id="{el}"', body, count=1)
        body = re.sub(r'data-start="[^"]*"', f'data-start="{at}"', body, count=1)
        body = re.sub(r'data-duration="[^"]*"', f'data-duration="{d}"', body, count=1)
        body = re.sub(r'data-track-index="[^"]*"', f'data-track-index="{i}"', body, count=1)
        if it.get("vars"):
            style = ";".join(f"{k}:{v}" for k, v in it["vars"].items())
            body = re.sub(r'(<div class="clip[^"]*")', lambda m: f'{m.group(1)} style="{html.escape(style)}"', body, count=1)
        for cls, value in (it.get("text") or {}).items():
            body = set_text(body, cls, value)
        if it.get("css"):  # per-item layout fixes (e.g. portrait placement); "&" = this item
            heads.append(f"<style>{it['css'].replace('&', '#' + el)}</style>")
        clips.append(body)
        fn = a["call"].split("(")[0]
        calls.append(f'  {fn}(tl, document.getElementById("{el}"), {json.dumps({"at": at, "duration": d, **(it.get("options") or {})})});')
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width={W}, height={H}" />
<title>overlay</title>
<script src="{gsap}"></script>
<style>html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:transparent}}</style>
{chr(10).join(heads)}
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{dur}" data-width="{W}" data-height="{H}" data-fps="{fps}">
{chr(10).join(clips)}
</div>
<script>
  window.__timelines = window.__timelines || {{}};
  const tl = gsap.timeline({{ paused: true }});
{chr(10).join(calls)}
  window.__timelines["main"] = tl;
</script>
</body>
</html>
"""
    (out / "index.html").write_text(page, encoding="utf-8")
    return out


def build(spec_path, out):
    spec = json.loads(Path(spec_path).read_text(encoding="utf-8")); cat = catalog()
    if out.exists():
        for layer in ("front", "behind"):
            shutil.rmtree(out / layer, ignore_errors=True)
    front = [i for i in spec["items"] if not i.get("behind")]
    behind = [i for i in spec["items"] if i.get("behind")]
    made = [build_layer(spec, front, out / "front", cat)] if front else []
    if behind:
        made.append(build_layer(spec, behind, out / "behind", cat))
    (out / "spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding="utf-8")
    print("Built " + ", ".join(str(m / "index.html") for m in made))
    return made


def render(out):
    for layer in ("behind", "front"):
        d = out / layer
        if not (d / "index.html").exists():
            continue
        key = hashlib.sha1((d / "index.html").read_bytes()).hexdigest()
        mov, stamp = d / "overlay.mov", d / "overlay.hash"
        if mov.exists() and stamp.exists() and stamp.read_text() == key:
            print(f"Cached: {mov}"); continue
        t0 = time.time()
        r = subprocess.run(f'npx --prefix "{ROOT / "hf"}" hyperframes render "{d}" --format mov -o "{mov}" --quiet',
                           shell=True, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode or not mov.exists():
            raise ValueError(f"HyperFrames render failed for {d}:\n{(r.stdout + r.stderr)[-2000:]}")
        stamp.write_text(key)
        print(f"Rendered {mov} in {time.time() - t0:.1f} s")


def compose(base, out, target, mask=None):
    front, behind = out / "front" / "overlay.mov", out / "behind" / "overlay.mov"
    if behind.exists() and not mask:
        raise ValueError("Behind items need --mask (python tools/edit/matte.py BASE --mask mask.mp4)")
    info = probe(base)
    args, graph, cur, n = ["-i", str(base)], [], "[0:v]", 1
    if behind.exists():
        args += ["-i", str(behind), "-i", str(mask)]
        graph += [f"[{n}:v]format=rgba[bh]", f"{cur}[bh]overlay=0:0:eof_action=pass:format=auto[v1]",
                  f"[{n + 1}:v]scale={info['width']}:{info['height']},format=gray[m]", "[0:v]format=rgba[p0]", "[p0][m]alphamerge[person]",
                  "[v1][person]overlay=0:0:format=auto[v2]"]
        cur, n = "[v2]", n + 2
    if front.exists():
        args += ["-i", str(front)]
        graph += [f"[{n}:v]format=rgba[fr]", f"{cur}[fr]overlay=0:0:eof_action=pass:format=auto[v3]"]
        cur = "[v3]"
    if cur == "[0:v]":
        raise ValueError(f"No rendered overlay in {out}")
    graph.append(f"{cur}format=yuv420p[out]")
    t0 = time.time()
    subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-y", *args, "-filter_complex", ";".join(graph), "-map", "[out]", "-map", "0:a?",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "copy", "-movflags", "+faststart", str(target)], check=True)
    print(f"Composited {target} in {time.time() - t0:.1f} s")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    b = sub.add_parser("build"); b.add_argument("spec"); b.add_argument("-o", "--out", type=Path, required=True)
    r = sub.add_parser("render"); r.add_argument("dir", type=Path)
    c = sub.add_parser("compose"); c.add_argument("base", type=Path); c.add_argument("dir", type=Path); c.add_argument("-o", "--output", type=Path, required=True); c.add_argument("--mask", type=Path)
    al = sub.add_parser("all"); al.add_argument("spec"); al.add_argument("base", type=Path); al.add_argument("-o", "--output", type=Path, required=True)
    al.add_argument("--mask", type=Path); al.add_argument("--dir", type=Path)
    a = ap.parse_args()
    if a.cmd == "list":
        for k, v in catalog().items():
            print(f"{k:22} {v['default_duration_s']:>4}s  {v['description'][:80]}\n{'':29}vars: {' '.join(v.get('themable_vars', []))}")
    elif a.cmd == "build":
        build(a.spec, a.out)
    elif a.cmd == "render":
        render(a.dir)
    elif a.cmd == "compose":
        compose(a.base, a.dir, a.output, a.mask)
    else:
        d = a.dir or a.output.with_suffix("").parent / (a.output.stem + "_overlay")
        build(a.spec, d); render(d); compose(a.base, d, a.output, a.mask)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as exc:
        sys.exit(str(exc))

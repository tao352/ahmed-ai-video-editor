# Ported from browser-use/video-use helpers/pack_transcripts.py (MIT)
"""Pack local word transcripts into compact, time-addressable Markdown."""
import argparse
import json
from pathlib import Path
import sys


def group_into_phrases(words, silence_threshold=0.5):
    phrases, current = [], []
    for word in words:
        if not word.get("w", "").strip():
            continue
        if current and (word["s"] - current[-1]["e"] >= silence_threshold or
                        word.get("speaker_id") != current[-1].get("speaker_id")):
            phrases.append(current)
            current = []
        current.append(word)
    if current:
        phrases.append(current)
    return phrases


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--edit-dir", type=Path, required=True)
    ap.add_argument("--silence-threshold", type=float, default=0.5)
    a = ap.parse_args()
    if a.silence_threshold < 0:
        ap.error("silence threshold must be nonnegative")
    files = sorted((a.edit_dir / "transcripts").glob("*.json"))
    if not files:
        ap.error("no transcripts/*.json found")
    lines, count = ["# Packed transcripts", ""], 0
    for file in files:
        data = json.loads(file.read_text(encoding="utf-8-sig"))
        phrases = group_into_phrases(data["words"], a.silence_threshold)
        lines.append(f"## {file.stem}  (duration: {data['duration']:.1f}s, {len(phrases)} phrases)")
        for phrase in phrases:
            text = " ".join(w["w"].strip() for w in phrase)
            lines.append(f"  [{phrase[0]['s']:06.2f}-{phrase[-1]['e']:06.2f}] {text}")
        if not phrases:
            lines.append("  _no speech detected_")
        lines.append("")
        count += len(phrases)
    target = a.edit_dir / "takes_packed.md"
    target.write_text("\n".join(lines), encoding="utf-8")
    print(f"Packed {len(files)} transcripts, {count} phrases: {target}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()

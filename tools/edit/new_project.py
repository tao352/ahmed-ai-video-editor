"""Create a project and copy or hard-link sources without moving originals."""
import argparse
from datetime import date
from pathlib import Path
import shutil
import sys


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("name")
    ap.add_argument("--source", action="append", nargs="+", default=[])
    ap.add_argument("--projects-dir", type=Path, default=Path(__file__).resolve().parents[2]/"projects",
                    help="Alternate project root, e.g. tmp/edit_smoke/projects for self-tests")
    a = ap.parse_args()
    if Path(a.name).name != a.name or a.name in {".",".."} or any(c in a.name for c in '/\\:'):
        ap.error("name must be a single folder name")
    root = a.projects_dir.resolve()/a.name
    if root.exists():
        ap.error(f"Project already exists: {root}")
    files = []
    for group in a.source:
        for value in group:
            source = Path(value).resolve()
            if not source.exists():
                ap.error(f"Missing source: {source}")
            files.extend([p for p in source.iterdir() if p.is_file()] if source.is_dir() else [source])
    if len({p.name.lower() for p in files}) != len(files):
        ap.error("Source basenames collide; choose distinct filenames")
    src, edit = root/"source", root/"edit"
    src.mkdir(parents=True)
    edit.mkdir()
    for source in files:
        target = src/source.name
        try:
            target.hardlink_to(source)
        except OSError:
            shutil.copy2(source,target)
    for name in ("transcripts","cache","storyboard","verify","animations"):
        (edit/name).mkdir()
    (edit/"project.md").write_text(
        f"# {a.name}\n\nTitle: {a.name}\nGenre: \nRatio: \nBrand: \n\n"
        f"## Session 1 — {date.today().isoformat()}\n\n"
        "**Strategy:**\n\n**Decisions:**\n\n**Reasoning log:**\n\n**Outstanding:**\n",
        encoding="utf-8")
    (edit/"approval.json").write_text('{"plan":"pending","storyboard":"pending"}\n',encoding="utf-8")
    (edit/"LICENSES.md").write_text("| Asset | Source | License | Notes |\n|---|---|---|---|\n",encoding="utf-8")
    print(root)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()

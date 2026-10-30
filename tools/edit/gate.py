"""Record plan/storyboard approval next to the EDL."""
import argparse
import json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("edit_dir", type=Path)
    ap.add_argument("action", nargs="?", choices=["approve", "reset", "status"], default="status")
    ap.add_argument("target", nargs="?", choices=["plan", "storyboard"])
    a = ap.parse_args()
    if (a.action == "approve") != (a.target is not None):
        ap.error("use: approve plan | approve storyboard | reset | status")
    path = a.edit_dir / "approval.json"
    state = json.loads(path.read_text(encoding="utf-8-sig")) if path.exists() else {"plan":"pending","storyboard":"pending"}
    if a.action == "approve":
        state[a.target] = "approved"
    elif a.action == "reset":
        state = {"plan":"pending","storyboard":"pending"}
    if a.action != "status":
        path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(json.dumps(state,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(state))


if __name__ == "__main__":
    main()

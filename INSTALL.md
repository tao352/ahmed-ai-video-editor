# Install

Written so a person or an AI assistant (Claude, ChatGPT, Gemini...) can set the editor up on a new computer
by following it top to bottom. Every step says how to check it worked.

## 1. Programs

| Program | Needed for | Windows | macOS |
|---|---|---|---|
| Node.js 20+ (LTS) | the editor and the renderer | `winget install OpenJS.NodeJS.LTS` | `brew install node` |
| ffmpeg | previews, audio tools, rendering | `winget install Gyan.FFmpeg` | `brew install ffmpeg` |
| Python 3.12 | media tools, tracking | `winget install Python.Python.3.12` | `brew install python@3.12` |
| Chrome or Edge | opens the editor as its own window (any browser works) | usually there | usually there |

Check: `node --version`, `ffmpeg -version`, `python --version` each print a version (open a new terminal
after installing).

## 2. The editor

Windows: double-click **`Ahmed AI Video Editor.cmd`**. The first run installs the packages (a few minutes,
about 750 MB), puts a shortcut with the icon on the desktop, and opens the editor. Later runs open in seconds.

macOS / Linux: `./launcher/start.sh`.

By hand (any system):
```
npm --prefix reel ci
npm --prefix editor ci
npm --prefix editor run app      # optimised build on http://localhost:5411
```
Check: `npm --prefix editor run check` ends with all tests passing; http://localhost:5411 shows the editor
with the example projects.

## 3. Media tools (Python)

```
python -m pip install -r requirements.txt
```
Used for LUTs, voice clean-up, loudness, beats, previews and Claude's editing tools in `tools/edit/`.

Or everything at once on Windows: `powershell -ExecutionPolicy Bypass -File setup.ps1`.

## 4. Tracking (optional)

Tracking and stabilize (`tools/track/track.py`) need PyTorch, SAM2 and two model files.

- **PyTorch**: with an NVIDIA card, install the CUDA build that fits the driver (`nvidia-smi` shows the driver
  version): driver 580+ -> `--index-url https://download.pytorch.org/whl/cu130`, 570+ -> `cu128`, older ->
  `cu126`. Without a card: `--index-url https://download.pytorch.org/whl/cpu` (works, slower).
  `python -m pip install torch torchvision --index-url <one of those>`
- **SAM2**: `python -m pip install sam2`
- **Models** (not in git; about 185 MB): `python tools/track/get_models.py`
  - `sam2.1_hiera_small.pt` (Meta SAM2: outlines and object tracking)
  - `blaze_face_short_range.tflite` (MediaPipe: face tracking)

On Windows `setup.ps1 -Tracking` does all of this and picks the right PyTorch build.

Check: `python tools/track/get_models.py --check` says ok twice, and
`python -c "import torch, sam2; print(torch.cuda.is_available())"` runs (True with a GPU).

## 5. Sounds and music

The Audio tab lists what is in `assets/`. `assets/library` ships with 128 CC0 sounds (no attribution needed).
Add more from sources whose license allows use in videos, and record each one in `assets/library/LICENSES.md`
and `catalog.json`. See `assets/README.md`.

## Where things are

- Projects: `projects/<name>/edit/edit.json` plus `edit/public/` for its media. New projects go there.
- Settings and presets you save in the editor: `editor/user/` (not in git).
- The editor's own guide: `editor/README.md`; the edit.json fields: `reel/src/edit/LOOK.md`.

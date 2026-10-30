# Ahmed AI Video Editor

A CapCut-style video editor for `edit.json` projects, shared with Claude: Claude writes the edit, you fix it
by hand here, and both work on the same file.

- `editor/` the app (Vite + React): library, player, properties, timeline, and a small server that saves,
  syncs with Claude, renders and runs the media tools.
- `reel/` the render engine (Remotion): the `Edit` composition draws the preview and the final MP4.
- `tools/edit/editor_tools.py` media jobs (LUT, voice clean-up, loudness, beats, proxies, filmstrips).
- `tools/track/` tracking and stabilization (SAM2, OpenCV, MediaPipe); see its README.
- `assets/` the sound library shown in the Audio tab.
- `projects/` your projects, one folder each with `edit/edit.json`; `_examples` are small starters.

## Open it

Windows: double-click **`Ahmed AI Video Editor.cmd`** (the first run installs everything it needs and adds a
desktop shortcut). macOS / Linux: `./launcher/start.sh`. It only needs Node.js and ffmpeg.

Full setup (Python tools, tracking models) and checks: **[INSTALL.md](INSTALL.md)**. Notes for AI assistants:
**[AGENTS.md](AGENTS.md)**.

# Notes for AI assistants

This is Ahmed AI Video Editor: a CapCut-style editor where an AI assistant writes the edit (`edit.json`) and
the owner fixes it by hand in the editor. Both edit the same file.

## Setting it up on a new computer
Follow `INSTALL.md` top to bottom; on Windows `setup.ps1` (add `-Tracking` for tracking) does it all.
Do not commit `node_modules`, `tools/track/models/`, project media or `assets/music_*` (see `.gitignore`).

## Making an edit
- A project is `projects/<name>/edit/edit.json`; its media lives in `projects/<name>/edit/public/`.
  Start from one in `projects/_examples/`.
- Every field is documented in `reel/src/edit/LOOK.md`; components are listed in `reel/src/edit/registry.ts`.
- Before changing an edit.json the owner touched, read `edit/human_changes.md`, its notes and `lanes`
  (a locked lane is hands off).
- Render: `node reel/scripts/render_edit.mjs projects/<name>/edit/edit.json out.mp4 [--scale 0.5] [--frames a-b]`.
- Tracking: `tools/track/README.md` (pick a target with `segment`, track it, follow it with `clip.follow`).
- Editing tools (transcribe, cut, grade, music, loudness): `tools/edit/README.md`.

## Changing the editor
- Read `editor/README.md` first ("Adding a feature without breaking the rest").
- Document changes are pure functions in `editor/src/model/ops.ts` with a test; keys live in `keymap.ts`;
  new edit.json fields go in `reel/src/edit/schema.ts` and `LOOK.md`.
- Run `npm --prefix editor run check` (typecheck + tests) before committing.
- The UI is English; the owner speaks Egyptian Arabic.

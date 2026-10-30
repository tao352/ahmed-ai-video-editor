# Core editing loop

Run from the repository root; quote paths containing spaces.

1. Create: `python tools/edit/new_project.py demo --source "input.mp4"` (keeps originals). Use `--projects-dir tmp/edit_smoke/projects` for scratch projects.
2. Inventory: `python tools/edit/transcribe.py input.mp4 --edit-dir edit --model medium --lang ar`, or `python tools/edit/transcribe_batch.py footage --edit-dir edit` (2 workers). Engines: `--engine local` (cached faster-whisper, offline), `--engine groq` (Groq Whisper API, models `groq-large-v3` default / `groq-turbo`), or `auto` (default: Groq when `GROQ_API_KEY` is set in the environment or in the gitignored `.env`, else local). Groq free tier: 20 requests/min, 7200 audio s/hour; audio is uploaded to Groq.
3. Pack: `python tools/edit/pack_transcripts.py --edit-dir edit --silence-threshold 0.5`.
4. Inspect: `python tools/edit/contact_sheet.py input.mp4 -o sheet.jpg --every 5` (also `--times "1.2,3.4"` or `--scenes`); `python tools/edit/timeline_view.py input.mp4 0 5 --words edit/transcripts/input.json --frames 8 -o timeline.png`.
5. Record approval: `python tools/edit/gate.py edit approve plan`, then `approve storyboard`. Also `status` and `reset`.
6. Grade: `python tools/edit/grade.py --list-presets`; `python tools/edit/grade.py input.mp4 -o graded.mp4 --preset house` (or `--filter "eq=contrast=1.05"`).
7. Preview: `python tools/edit/render.py edit/edl.json -o edit/preview.mp4 --draft --build-subtitles`. Full: omit `--draft`. Both approvals required for full; `--force-unapproved` explicitly overrides with a warning. `--preview` aliases `--draft`; `--no-loudnorm` skips normalization.
8. Verify: `python tools/edit/loudness.py edit/final.mp4 --sections "0-2,2-4"`. Append decisions to project.md.

EDL sources accept a path string or `{"path":"../source/input.mp4","mirror":true,"stabilize":true}` (`file` aliases `path`). Relative files resolve against the EDL folder, then its project parent. Use source stems for `transcripts/<stem>.json`. Cut ranges must already respect word boundaries and editorial padding. Stabilization assumes a constant source frame rate; cached full-source ASCII transforms are sliced to align each seek.

`output: {"width":1080,"height":1920,"fps":30}` controls full delivery; absent fields match the first source. Draft/preview is 720p landscape or 720x1280 portrait, veryfast/CRF 28. Segments use H.264 + PCM in Matroska, lossless copy concat, overlays with shifted PTS, captions last, and two-pass loudnorm; final MP4 is H.264/yuv420p + AAC/48k. Source size/mtime and render settings invalidate caches.

Smoke: `python -I tools/edit/tests/smoke.py` (synthetic footage and fake transcripts; all artifacts under `tmp/edit_smoke/`).
# Phase 3 tools

Attribution: `reframe.py` adapts OpenMontage `tools/video/auto_reframe.py` and `tools/analysis/face_tracker.py`; `export.py` and `profiles.json` adapt `lib/media_profiles.py`; `music.py` adapts local music analysis concepts from `tools/audio/music_library.py`; `critic.py` adapts `skills/meta/reviewer.md`; `distill.py` adapts the capsule/memory format in cheap-claude-video `references/workflow-state-artifacts.md`. The critic quality dimensions and A/B/C/D grades are adapted from director-skills `seedance-motion-studio/references/quality-gates.md`.

- `reframe.py IN -o OUT [--ratio 9:16|1:1|4:5] [--track face|center|manual] [--keys keys.json] [--smooth 0.85] [--preview-png]` writes `<out>.path.json`; requires local OpenCV, FFmpeg and optionally PySceneDetect. Haar cascade detection is offline through OpenCV data.
- `export.py IN --profile NAME -o OUT [--reframe] [--safe-overlay PNG]` uses `profiles.json`, fits/pads the target frame, and applies -14 LUFS loudness normalization.
- `music.py analyze TRACK -o JSON`, `music.py window TRACK --length SECONDS [--peak-at FRACTION]`, and `music.py duck VOICE MUSIC -o BED [--under DB]` require local librosa and soundfile.
- `beats_to_cuts.py MUSIC_JSON --edl EDL.json [--snap SECONDS]` writes `.snapped.json` and `.report.md` siblings.

## Music & sync

`music.py analyze TRACK -o analysis.json` caches decoded 44.1 kHz audio and beat/section analysis under `work/music_cache/`. Use `fit TRACK --length S -o bed.wav [--drop-at T] [--ending ring|bar|fade] --report fit.json` to fit a bed, `blend A B -o mix.wav --bars 8 --report blend.json` for a tempo-matched transition, `cuts TRACK --length S --fps 30 -o cuts.json` for frame-aligned montage points, and `duck VOICE MUSIC -o bed.wav` to duck and carve the bed under speech. `beats_to_cuts.py analysis.json --edl edit/edl.json --fps 30 --lead-ms 20` snaps EDL boundaries while avoiding transcript words. `avsync.py check final.mp4 [--analysis analysis.json] [--cuts cuts.json] --report sync.json` checks stream timing and cut alignment; `avsync.py offset final.mp4 --ms -50 -o corrected.mp4` shifts the audio.
- `storyboard_mp4.py VIDEO --moments JSON -o DIR [--auto --edl EDL.json]` writes half-scale stills, optional clips, a contact sheet and RTL HTML.
- `critic.py VIDEO --edl EDL.json --recipe NAME -o BRIEF.md [--send-gemini]` creates a measured reviewer prompt; Gemini launch is optional.
- `distill.py PROJECT_DIR` persists an approved edit summary in repo-root `recipes_learned/`.
- Smoke: `python -I tools/edit/tests/smoke3.py`; outputs stay in `tools/edit/tests/tmp3/`.

Some platform duration caps can change. Check the destination platform before delivery.

## Face model for reframe.py (not in git)
`reframe.py --track face` uses OpenCV YuNet at `work/models/face_detection_yunet_2023mar.onnx` (falls back to a Haar cascade, then center). Re-download if missing:
`curl -L -o work/models/face_detection_yunet_2023mar.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx`
Verified 2026-10-22: a face moving across a 16:9 frame stays centered in the 9:16 output from the first frame; path is written to `<out>.path.json`, manual overrides via `--keys`.

# Pro layer (2026-10-23)

- `reference.py URL_OR_FILE [-o work/refs/NAME] [--no-transcribe] [--lang auto|ar|en]` downloads with yt-dlp (cached) and writes `style.json`, `style.md`, `sheet.jpg`; `reference.py --compare A/style.json B/style.json` prints a table. Shared analysis in `_visual.py`: 10 fps at 192 px wide, an 8x6 grid of cells; cut = most cells change at once (or a big HSV histogram jump), big event = at least 15% of cells (graphics, layout, punch zooms), small event = a few cells (caption swaps); zooms are measured from tracked corners (LK + RANSAC similarity). Verified on Jeff Nippard 5RtVbWCX5y0: 9 cuts and 4 graphic pop-ins, matching the contact sheet.
- `pace.py EDIT.json [--edl EDL.json] [--target style.json] [--max-gap S --max-gap-any S] [--skip-end S] [--json OUT]` (plan mode, the gate) or `pace.py VIDEO.mp4 ...` (render mode). Exit 1 on FAIL.
- `matte.py VIDEO [-o matte.webm] [--mask mask.mp4] [--preview p.jpg] [--start --duration] [--keep-all]` MediaPipe selfie-multiclass (`work/models/selfie_multiclass.tflite`) with temporal smoothing reset on cuts, largest body, holes filled; writes a `.json` sidecar with `head_top` for captions preset `behind`.
- `hf_overlay.py list|build|render|compose|all` builds a transparent HyperFrames page from `assets/library/graphics` snippets (spec: asset, at, duration, vars, text, css, options, behind), renders ProRes 4444 with `npx --prefix hf hyperframes` (cached by page hash), composites with FFmpeg; behind items are placed under the speaker with `alphamerge` of the matte mask. 6 s at 1080x1920: ~22 s per layer, composite 5 s.

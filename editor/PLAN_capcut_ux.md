# Plan: CapCut layout and timeline behaviour in the Studio Editor

Status (2026-10-30): approved; the user chose: always CapCut's layout, main track always magnetic, and asked
for Replace and a polish pass on every tool.
Done (commit 774af2b): four-pane CapCut desk with resizable side panels, icon-tab library (Media, Audio,
Stickers from assets/library, Text, Effects, Transition, Captions, Filters, Notes), CapCut toolbar order,
Replace (hold media over a video/picture/sound block, drop to swap; edits.replaceMedia + test).
Done 2026-10-30 (all six timeline steps): main-track reorder (9b74faf); Text with system fonts + CapCut text
animations, presets-only Effects/Text library, Stickers removed (5a0f925); 20 CapCut cut transitions (65b82aa);
clip colours by kind with name + length (8240933); track headers with icons + Cover, zooms/transitions on the
main track, notes as ruler markers (cf8a9c4); CapCut properties tab names (a0920dc); footage In/Out/Loop
animations (a40dadd); performance (552c11d) and layout fixes for laptop/tablet (749dbf1).
Measured in headless Chrome: playback runs real time with no long tasks; a clip drag step is ~26 ms median
(software paint), the document work in it is under 1 ms.
Tracking + stabilize done 2026-10-30 (tools/track/track.py: SAM2 outlines, surface / object / face tracks, stabilize;
reel tracking.ts; Highlight + Callout; Tracking tab on footage and clips). Desk follows the frame: wide for 16:9,
tall for 9:16, sizes kept per shape; softer theme for long sessions.
Still open from the CapCut map: audio speed + pitch, voice changer, HSL, text-to-speech, 3D camera solve.

Goal: someone who knows CapCut desktop finds every panel where CapCut has it and the timeline reacts
the way CapCut's does, while edit.json, Claude's side and every existing feature keep working.
We copy CapCut's layout and behaviour, not its art: our own icons, colours from our theme.

## What already matches CapCut (keep)
Split at playhead (S), ripple trim of the footage, alt-drag copy, snap with a guide line, drag between
tracks (above the top one makes a new track), lock/hide/mute per track, footage filmstrip, waveforms,
ctrl+wheel zoom around the cursor, auto-scroll near the edges, skim, inspector tabs, freeze frame.

## Phase 1: the CapCut desk (layout)
One fixed four-pane layout for every size (the Auto/Wide/Tall switch goes away):
- **Top bar**: project menu and name on the left, You/Claude/Saved in the middle, **Export** on the right.
- **Top-left, Library**: a row of icon tabs on top, like CapCut: Media, Audio, Text, Stickers, Effects,
  Transitions, Captions, Filters. Each tab has a category list on its left and a grid of tiles; drag a tile
  onto the timeline or press + to add it at the playhead. Content comes from what we already have:
  Media = MediaBin; Audio = assets/library music + sfx (new server listing); Text = text components
  (BigType, KineticText, LowerThird...); Stickers = assets/library/graphics; Effects = clip fx;
  Transitions = transitionTypes; Captions = the captions panel; Filters = saved colour looks.
  A tab with nothing to show is hidden.
- **Top-centre, Player**: the video always in the middle, also for 9:16. CapCut's chrome: current/total
  time bottom-left, size menu and full screen bottom-right, safe-zone toggle.
- **Top-right, Properties**: CapCut's tab row for the selected item: Video (Basic / Mask / Background),
  Animation (In / Out / Combo), Speed, Adjust (colour), Audio. The existing inspector parts move under
  these tabs; nothing is lost.
- **Bottom, Timeline**: full width.
- Draggable dividers between all four panes; sizes are remembered.

## Phase 2: the CapCut timeline (behaviour)
- **Toolbar, left**: Select / Split mode, Undo, Redo, Split (Ctrl+B, S), Delete left (Q), Delete right (W),
  Delete, Freeze, Mirror, Rotate, Crop. **Right**: Main-track magnet, Auto snap, Linkage, Preview axis
  (skim), zoom slider, Fit (Shift+Z).
- **Track headers** on the left: a type icon, lock, hide, mute; the main track shows a Cover thumbnail.
- **Free tracks in CapCut order**: overlays and text above the main track, audio below. Dropping on a
  busy spot, or above the top track, makes a new track; an empty track disappears. Today's fixed lanes
  (Zoom, words, notes, transitions) become: zooms as keyframe marks on the footage, captions as a text
  track, notes as timeline markers, transitions as icons on the cuts.
- **Main track magnet**: drag a footage piece left/right to reorder it; the rest closes up (still no black gaps).
- **Clip look**: colours by type (video with filmstrip, audio green with waveform, text amber, stickers and
  graphics purple, effects/filters thin bars), name and length on the clip, keyframe diamonds, speed badge,
  fade handles on audio corners, white outline when selected.
- **Gestures**: rubber-band select in empty space, wheel scrolls sideways, Shift+wheel scrolls tracks,
  playhead with a top handle, click the ruler to jump, arrows step a frame, Home/End, Space plays.
- **Transitions**: drag one from the Library onto a cut on the main track; drawn as an icon on the cut.

## CapCut feature map (read from CapCut 9.7 itself, 2026-10-30)
Source: `D:\lone00\CapCut\9.7.0.4153`. CapCut is Qt/QML on ByteDance's own effect engine (Lua + xshader
bundles), so nothing of it runs in our browser editor: we rebuild each feature in our own code.
How it was read (rerun after a CapCut update): `Resources/po/en.po` holds all 17.7k UI strings; 1,717 QML
views sit inside `VECreator.dll` (plain and zlib Qt resources). The scripts are `po.py`, `qml.py`,
`qrcz.py` and `keys.py` (QML file -> its strings and icons); keep them in `tools/capcut_study/`.

Properties tabs per selected item (CapCut's `DraftInspector*` views), with what we have today:
| Item | CapCut tabs | We have | Missing |
|---|---|---|---|
| Video / picture | Video (Basic: transform, blend, stabilize, noise reduction, flicker; Mask; Canvas/background; Chroma key; Auto cutout; Retouch; Enhance), Animation (In/Out/Combo), Adjust, Audio, Speed, Tracking, AI | transform, blend, mask, chroma, canvas, crop, mirror, reverse, freeze, speed + curve, grade | stabilize, Animation In/Out/Combo for footage, Tracking, retouch |
| Text | Basic (font, style, stroke, background, shadow, bubble, effects), Animation, Captions, Highlight, Tracking, Text to speech, Template | text components, captions | bubble/effects presets, per-word highlight style tab, TTS |
| Sticker | Basic, Animation, Tracking | graphics clips | Animation tab, tracking |
| Audio | Basic (volume, fade, normalize loudness, noise reduction, enhance voice), Voice changer, Speed (pitch) | volume, fades, duck, voice chain | voice changer, speed + pitch, normalize |
| Effect / filter | Properties (intensity + effect params) | clip fx, looks | intensity per effect bar |
| Transition | Duration, apply to all | transitions | apply to all |
| Adjust | Basic (LUT, temp, tint, sat, exposure, contrast, highlights, shadows, whites, blacks, brightness, sharpen, clarity, fade, vignette, grain), HSL, Curves, Color wheels (primary, log) | grade, LUTs, vignette, grain, curves, wheels (partial) | HSL |
Blend modes (`Resources/MixMode`): Normal, Screen, Darken, Lighten, Overlay, Hard light, Soft light, Linear burn,
Color burn, Color dodge, Multiply.
Timeline behaviour seen in the timeline QML: box select by dragging empty space, Ctrl+wheel zoom
(`adjustAccuracyByWheel`), preview axis follows horizontal mouse moves, click seeks, pinch zoom,
snap ("adsorb") with track headers that change state, freeze shown as a badge on the clip,
replaceable clips show a lock/unlock icon.
These gaps join the polish pass after the six timeline steps, biggest first: Animation In/Out/Combo for
footage and stickers, audio speed + pitch and voice changer, HSL, stabilize.

## Phase 3: polish and proof
- Design pass with taste-skill + impeccable (craft floor, `impeccable detect` on the editor), checked at
  desktop and tablet widths.
- Every document change is a pure op in `src/model/ops.ts` with a test (reorder footage, delete
  left/right, new/empty tracks); keys are rows in `keymap.ts`; new fields go in the schema + LOOK.md.
- `npm --prefix editor run check` and the probe on `_editor_test` (never a real project), a commit per
  piece, push to GitHub.

## Order and size
Phase 1 first (the user sees CapCut's desk at once), then Phase 2 in small commits (toolbar, headers,
free tracks, magnet reorder, clip look, gestures), then Phase 3. This is several sessions of work.

## Questions for the user
1. Drop the Auto/Wide/Tall switch and always use CapCut's layout? (recommended: yes)
2. Main track: always magnetic (never a black gap), or a magnet you can switch off like CapCut?
3. Anything in CapCut you use a lot that is missing from this list?

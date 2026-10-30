# Studio Editor

Local editor for the `edit.json` files Claude produces. The preview is the real Remotion `Edit` composition, so what you see is what renders. Plan and phases: [PLAN.md](PLAN.md).

## Open it like an app

Double-click `editor/launch/Studio Editor.cmd`. It starts the editor server in the background if needed and opens the editor in its own Chrome window (app mode: no tabs or address bar, its own profile).

The launcher serves the optimised production build on port 5311 (`npm run app`), which is several times faster than the dev server. It rebuilds first whenever the editor or renderer source is newer than the last build; if the server is already running from an older build, stop it (below) and open again.

To put a "Studio Editor" icon on the desktop:

```bash
powershell -ExecutionPolicy Bypass -File editor/launch/make-shortcut.ps1
```

To stop the background server:

```bash
powershell -ExecutionPolicy Bypass -File editor/launch/StudioEditor.ps1 -Stop
```

## Run

```bash
npm --prefix editor install --legacy-peer-deps
```

```bash
npm --prefix editor run dev
```

Then open http://localhost:5310 (or `preview_start` with name `editor` from Claude; `editor-app` runs the production build on 5311). `?project=drfit3%2Fedit%2Fedit.json` opens a project directly.

React, Remotion and zod are taken from `reel/node_modules` (run `npm install` in `reel/` first). `--legacy-peer-deps` keeps npm from installing a second React into `editor/`.

## How it shares the file with Claude

- Autosave 1 s after your last change, with a revision check (`meta.rev`). Every save is also copied to `<edit dir>/history/edit.<rev>.json`.
- Your changes are summarised in `<edit dir>/human_changes.md`; notes (key `M`) go to `notes[]` in edit.json. Claude reads both before editing.
- When Claude writes the file, the editor reloads it live, lights the Claude tally and flashes what changed. If you had unsaved edits, a banner asks which version to keep.

## Move things inside the video

Click anything drawn in the preview (a card, a title, the captions) to select it, drag it to move it, and pull the white corner to resize it. The position is saved as `box` on the clip (`captions.box` for captions) and the render uses it too. The inspector shows the numbers and a reset key.

## Retype any text, right-click anything

- Double-click any word you see in the preview (a caption word, a title, text inside a motion graphic) to retype it. The editor finds the prop or caption word that produced it and writes your text there; if a word is baked inside a component and not stored as a prop, it says so.
- Right-click any item on the timeline or in the preview for: cut at playhead, duplicate, go to start, note here, reset position, hide in this size, delete.

## Workspace shape

The switch at the top (تلقائي / عرضي / طولي) picks the layout. Auto follows the size on the monitor: wide (YouTube) puts the monitor in the middle with slimmer side panels; tall (reels) gives the monitor its own full-height column on the side, like CapCut's vertical mode, with the panels and the timeline next to it.

## More than one size

The size keys next to the clock switch the monitor between the master edit and extra formats (`+` adds 9:16, 16:9, 1:1 or 4:5). Everything you drag on screen while a format is shown is saved only for that format in `formats.<id>` (box, hide, footage fill and focus, caption size); the timeline and the content stay shared. The render key renders the format you are looking at.

## Cut the footage (CapCut style)

Put the playhead where you want and press S (or right-click the video lane, "قص عند المؤشر"). With nothing selected, or the video lane selected, the footage itself is split; the piece after the cut is selected, so Delete removes that stretch from the whole video and everything after it moves back (captions, cards, zooms, sounds, notes). With clips selected, S splits those clips instead. The footage has no trim handles on purpose: split and delete never leave a black gap.

## Cut by text

In the captions tab, click a word and Shift+click another to select the words between them, then press "شيله من الفيديو" (or Shift+Delete). That stretch is removed from the whole video: footage and voice become segments of their files (`base[].sourceIn`, `audio.voice.segments`), and every word, card, zoom, sound and note after it moves back. Undo brings it back.

## Look, motion and sound (ideas from CapCut)

The field reference for all of these is in [reel/src/edit/LOOK.md](../reel/src/edit/LOOK.md).

- **Colour**: the project panel's colour tab grades all the footage, a footage piece can override it, and any clip has its own colour tab.
  - The sliders are exposure, contrast, highlights, shadows, saturation, temperature, tint, fade, vignette, grain and sharpen.
  - There are built-in looks and you can save your own.
  - "Match a picture" sets the colours from a screenshot of a reference.
  - A footage piece can get a `.cube` LUT from `public/luts/` (baked by ffmpeg into a copy).
  - The chart key next to the size keys opens a waveform and vectorscope of the current frame.
- **Guides**: G or the grid key shows the platform safe zone (it follows the size), thirds and centre lines.
- **Clips**: the inspector has tabs.
  - Motion holds the place on screen, keyframes and in/out/loop animation.
  - Look holds opacity, blend, rounded corners, shadow, outline, glow, "behind the speaker", and a shape mask (rectangle, circle, line, band; soft edge, invert).
  - Colour grades the clip.
  - Shift+K or ◆ adds a keyframe at the playhead. After that, dragging the clip on the monitor edits the keyframe at the playhead, and diamonds show on the timeline.
- **Around the speaker**: in the project's colour tab, outline or glow around the person (needs the matte).
- **Footage**: a speed slider on any footage piece (the rest of the edit moves; the voice is not sped up), and F freezes the frame under the playhead for a second.
- **Sound**:
  - Drag the dots at the top corners of music and sound blocks to fade them in or out.
  - The music can drop under speech (ducking, in dB).
  - The project's sound tab has a one-click voice cleaner (light / pro / strong: denoise, EQ, compressor, de-esser, levelled to -14 LUFS). It makes a new file and lets you compare before and after, and there is a loudness meter.
- **Tight cuts**: the captions tab's "شيل السكتات والحشو" finds silences and filler words. Untick any you want to keep, and one click removes the rest from the whole video.

## Zoom and motion on the footage (CapCut style)

- Select a footage piece. Its panel has "الحركة والزوم": zoom, left/right, up/down and tilt.
  - Put the playhead where you want and change a value: a keyframe ◆ is set there. The ◆ next to each row adds or removes that value's keyframe.
  - ‹ › jump between keyframes.
  - The ease menu shapes the move into the ◆ under the playhead.
- One-click moves:
  - زوم سريع: punch in over 0.3 s.
  - زوم بطيء: slow push to the end of the piece.
  - زوم للخارج: pull back out.
  - You can adjust them afterwards like any other keyframe.
- The keyframes show as diamonds on the video lane. Drag one to retime it (it snaps), or right-click it for ease or delete. Shift+K keys the piece under the playhead.
- The preview uses light proxy copies of the footage and matte (`public/.proxy/`, made automatically in the background, like CapCut's proxy media), so playback and the speaker cut-out stay smooth. Renders always use the originals.

## More CapCut tools

- **Smooth zoom (in, hold, back out)**: in the footage panel, "زوم يدخل ويطلع بالراحة".
  - Set the strength, the time in, the hold and the time out, and the shape: smooth, fast-then-settle, or linear.
  - Press "حطه هنا" to apply it from the playhead, or right-click the footage. The last settings are remembered.
- **Volume over time**: music and sound panels have "العلو على مدار الوقت".
  - Put the playhead, set the level, and a ◆ is placed there.
  - The level curve shows on the block, and the ◆ can be dragged.
- **Crop**: trim each edge of a clip (Look tab) or a footage piece.
- **Reverse**: the footage panel's "اعكسه" writes that stretch backwards (and its matte) to a new file. Press it again to go back.
- **Markers**:
  - Notes can be coloured.
  - Shift+↑ / ↓ jumps between them.
- **Preview zoom**: the menu next to the size keys (fill, 150%, 200%, 300%), or Ctrl+wheel over the picture.

## Timeline tools

- The eye key (P): the monitor shows the frame under the mouse while the playhead stays put.
- Drag the playhead by its red cap, or anywhere on the ruler; held near either edge, the timeline scrolls with you. The bar under the picture scrubs too.
- Click the voice lane to select the voice (volume, clean-up, loudness). Music and sound blocks show their waveform.
- The blade (C, back to select with V or Esc): click a clip or the footage to cut it where you clicked.
- [ and ]: select everything before or after the playhead, then drag to slide the rest of the edit.
- Clip tracks are named by what they hold (نصوص، مؤثرات، فيديو وصور، كروت وجرافيك، لوجو ونهاية), with the layer number on a small plate: a higher number draws on top. Point at the name to see the components inside; double-click it (or right-click, "سمّي الطبقة دي") to give it your own name.
- Each lane's head has hide, mute and lock switches (right-click for the same). A locked lane cannot be moved or deleted, and Claude leaves it alone too.
- Right-click the music lane, "حلّل الإيقاع", to mark the music's beats. B adds a beat at the playhead, Shift+B removes the nearest, and dragging snaps to beats.

## Keys (CapCut's layout)

Press ? in the editor for the full list. The main ones:

| Key | What it does |
|---|---|
| Space | Play / pause |
| J / K / L | Back, stop, forward; press again to go faster |
| ← / → | One frame; with Shift, 10 frames |
| ↑ / ↓ | Previous / next cut (Shift: previous / next marker) |
| Ctrl+B | Split at the playhead |
| Q / W | Delete left / right of the playhead (ripple on the footage, trim on clips) |
| Delete | Delete the selection; Shift+Delete removes the selected words from the video |
| Ctrl+C / X / V | Copy / cut / paste at the playhead |
| Ctrl+D | Duplicate |
| V | Switch a clip off or on (it stays on the timeline) |
| A / B | Select tool / blade |
| S | Preview follows the mouse |
| N | Snapping |
| Shift+Z | Fit the whole video in the timeline |
| Ctrl+= / - | Timeline zoom |
| Shift+K | Keyframe |
| F | Freeze frame |
| M | Note for Claude |
| Alt+B | Beat (Alt+Shift+B removes one) |
| G | Guides |
| Ctrl+Shift+F | Full-screen preview |

Importing your own media: the **Media** tab (first tab on the left) has an Import button; you can also drop files from the computer onto the Media tab, the timeline (they land where you drop them) or the player (at the playhead). Files are copied into the project's `public/media/`. Click + on a card or drag it onto the timeline. Videos come in with their sound off; short sounds become sound effects, long ones the music.

With the mouse:

- Drag a clip up or down to change its track; two clips never overlap on one track.
- Alt+drag drags a copy.
- On the picture: drag any corner to resize, the round knob under the box to rotate (snaps straight, Shift for 15° steps), and **Crop** on the box to crop with eight handles (Enter or Esc closes it). Clicking the picture where no clip is drawn picks the main video under the playhead, with its own **Crop video** button.
- On the picture, a dragged layer snaps its edges and centre to the frame's edges and centre and to the other layers, with magenta guide lines (solid: the frame, dashed: another layer). Hold Alt to move it freely.
- Drag on empty timeline to box-select; a plain click there moves the playhead.
- Drag the line inside a sound or music block to set its volume.
- Drag a footage piece's edge to trim it; the rest of the video closes up (ripple).
- Hover a cut in the footage and press + to add a transition.
- The rows key in the timeline toolbar changes the track height.

## Checks

```bash
npm --prefix editor run check
```

That runs the typecheck and every test, including one that opens every real project in `projects/` (read-only) and checks it still passes the render schema in every format.

## Adding a feature without breaking the rest

Each kind of change has one home. Put it there and the rest of the editor picks it up.

- **A change to the document** is a pure function in `src/model/ops.ts` that takes a `Doc` and returns a new one, with a test in `ops.test.ts`. Panels and keys call it through `commit()`; never mutate the document in place.
- **A new edit.json field** goes into the zod schema under `reel/src/edit/` (render side) and gets a line in `reel/src/edit/LOOK.md`, so Claude knows it. Keep it optional so old projects still open; `projects.test.ts` checks that they do.
- **A keyboard shortcut** is one row in `src/ui/keymap.ts`. The shortcuts sheet (?) reads the same table, and `keymap.test.ts` fails if two rows answer the same key.
- **A command** shared by a key, a button and a menu goes in `src/ui/actions.ts`.
- **A timeline lane** is added in `buildLanes` (`src/ui/Timeline.tsx`). Rows are memoised by content, so a lane only redraws when its own items change.
- **A component prop label**: readable names for cryptic keys live in `src/ui/labels.ts`; the JSON key stays in the tooltip. The UI is English.
- **A panel** that crashes shows its error in place (`src/ui/Boundary.tsx`); the rest of the desk and the file keep working.

Performance rules the editor relies on:
- `commit()` shares unchanged parts of the document with the previous version (`model/share.ts`). Memoise views on the objects they read, not on the whole document.
- The playhead lives in its own store, so playback never re-renders the panels. Mouse moves over the timeline and drag steps are applied once per frame, and the monitor takes edits at low priority (`useDeferredValue`).
- The timeline only draws what is near the visible stretch.
- A drag says where it happens (`startGesture('monitor' | 'timeline' | 'panel')`, `endGesture()` on release). Views read the document through `useDoc(area)` and keep their body in a `React.memo`: the dragged area renders every frame, the others catch up in the background.
- A drag on the picture moves the layer's DOM with a CSS `translate`/`scale` and commits once on release; the composition never re-renders mid-drag.
- The composition (`reel/src/edit/Edit.tsx`) caches each clip's body by content, so changing one clip does not re-render the others.
- Measure in the production build (`npm run app`, port 5311): the dev server's React is several times slower.

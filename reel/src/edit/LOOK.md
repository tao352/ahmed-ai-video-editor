# edit.json: look, motion, audio and timeline fields

Everything here is optional. Leave a field out and nothing changes. The Studio Editor (`editor/`) writes these same fields, so a value you find may be the user's hand work: keep it unless they ask you to change it, and check `human_changes.md` first.

The schemas live in `grade.ts`, `clipfx.ts`, `lanes.ts`, `audioMix.ts` and `schema.ts`. Rendering is CSS/SVG inside `Edit.tsx`, so the editor preview and the render match.

## Colour: `grade`

```json
"grade": {"exposure": 0.1, "contrast": 0.12, "highlights": -0.15, "shadows": 0.1, "saturation": -0.05,
          "temperature": 0.1, "tint": 0, "fade": 0.2, "vignette": 0.3, "grain": 0.25, "sharpen": 0.2, "preset": "film"}
```

- `exposure` is in stops (-2..2). `fade`, `vignette`, `grain` and `sharpen` run 0..1. Everything else runs -1..1, and 0 means untouched.
- Where it goes:
  - top-level `grade` covers all the footage, with vignette and grain over the whole frame;
  - `base[i].grade` overrides it key by key for one footage piece;
  - `clips[].grade` grades one clip (B-roll, image).
- Built-in looks are listed in `GRADE_PRESETS` (natural, punch, warm, cool, film, moody, bright, bw). The user's saved looks are in `editor/user/presets/grades.json`.
- Keep a grade gentle: contrast and saturation within about ±0.3, and fade under 0.4. The editor has scopes (waveform, vectorscope) the user can check.
- LUT: `base[i].lut = {file, from}` means the footage file was baked with a `.cube` by `python -I tools/edit/editor_tools.py lut <public> <video> <cube>`, and `src` now points at the baked copy. To undo, set `src` back to `from` and drop `lut`.

## Any clip: `style`, `mask`, `anim`, `keys`, `behind`

```json
{"id": "card", "component": "...", "from": 4, "to": 7,
 "style": {"opacity": 1, "blend": "screen", "radius": 40,
           "shadow": {"color": "#000000", "blur": 30, "y": 12, "opacity": 0.5},
           "outline": {"color": "#ffffff", "width": 6}, "glow": {"color": "#07BFF1", "size": 24}},
 "mask": {"shape": "circle", "x": 0.5, "y": 0.45, "w": 0.6, "h": 0.4, "rotate": 0, "feather": 0.05, "radius": 0, "invert": false},
 "anim": {"in": "pop", "out": "fade", "loop": "float", "inDur": 0.35, "outDur": 0.3, "loopSpeed": 1},
 "keys": [{"t": 0, "x": 0, "y": 0.1, "scale": 0.8}, {"t": 1.2, "y": 0, "scale": 1, "ease": "out"}],
 "behind": true}
```

- `style`:
  - shadow, outline and glow follow the drawn shape (CSS `drop-shadow`), not a box;
  - `radius` rounds the clip's full-frame layer, so it is for media clips, usually combined with `box.scale` < 1 to make a PIP.
- `mask`:
  - shapes are `rect`, `circle`, `linear` (keeps everything below `y`) and `mirror` (a band of height `h` around `y`);
  - all numbers are fractions of the frame;
  - `invert` cuts a hole instead.
- `anim`:
  - `in` and `out` take one of fade, pop, slide-up, slide-down, slide-left, slide-right, zoom-in, zoom-out, blur, spin, drop, rise, swing, bounce, rotate;
  - `loop` takes one of float, pulse, wiggle, sway, breathe, shake, spin, heartbeat;
  - on a `Text` clip, `in`/`out` also take the text animations typewriter, letter-fade, blur-letters, word-pop, word-rise, word-drop, word-fade, wipe, stretch, and `loop` takes wave, letters-bounce, jelly, flicker, glow-pulse. They play per word or letter inside the text (Arabic always per word, so letters stay joined);
  - the motion is added on top of the component's own animation, so use it on components that do not already animate in.
- `keys`:
  - keyframes on the on-screen box: `t` is seconds from the clip's start, and any field left out follows `box`;
  - `ease` (linear, in, out, inOut, hold) shapes the move into that key;
  - in the editor, dragging the clip on the monitor edits the key at the playhead.
- `behind: true` draws the clip between the footage and the speaker cut-out, so text appears behind the person. This needs `base[].matte` from `tools/edit/matte.py`.

## Cover: `cover`
`{"t": 4.2}` picks the frame used as the video's cover (CapCut's Cover box at the start of the main track; click it
in the editor to use the frame at the playhead). A full render also writes it next to the video as `<name>.cover.jpg`.

## Text: the `Text` component
CapCut's text. `props`:
- `text` (new lines allowed) and `font`, a font family installed on this machine (the editor lists them from `/api/fonts`; empty = the theme font);
- `size` (px at the frame size), `color`, `weight` (100-900), `italic`, `underline`, `caps` (none, upper, lower), `align` (left, center, right);
- `spacing` (letter spacing, px), `lineHeight`, `wrap` (wrap width as a fraction of the frame);
- `stroke` {color, width}, `background` {color, opacity, radius, padX, padY}, `shadow` {color, opacity, blur, x, y}.
Place it with `box`, animate it with `anim` (above). Saved looks live in `editor/user/presets/clips.json` (right-click a clip, Save as preset)
and show in the editor's Text and Effects library tabs.

## Speaker cut-out: `subject`

`"subject": {"outline": {"color": "#ffffff", "width": 8}, "glow": {"color": "#07BFF1", "size": 30}}`

This draws an outline or glow around the person. It needs `base[].matte`.

## Footage pieces: `keys` (zoom, pan, rotate), `speed`, `freeze`
`base[].anim` takes the same `in` / `out` / `loop` animations as a clip (see `anim` above; the text-only ones do nothing
here). It moves the piece and its speaker cut-out together, like CapCut's video animations on the main track.

- `base[i].keys` is how zoom is done now, the CapCut way: keyframes on the footage piece itself, the same shape as `clips[].keys`.
  - Example: `[{"t": 1.2, "scale": 1}, {"t": 1.5, "scale": 1.15, "ease": "out"}]`.
  - `t` is seconds from the piece's `start`.
  - `scale` is the zoom (1 = none).
  - `x` / `y` pan as fractions of the frame (move toward a face).
  - `rotate` is in degrees.
  - `ease` (linear, in, out, inOut, hold) shapes the move into that key.
  - The matte follows automatically.
- CapCut drafts on this machine use two patterns:
  - a slow push over a whole piece, e.g. 1.00 -> 1.075 (`ease` linear);
  - a fast punch-in of ~0.35 s to ~1.15-1.17 with `ease` out, often with a small pan.
- Prefer `base[].keys` for new zooms. `zooms[]` still renders and multiplies with it, so do not stack both on the same moment.
- Splits, text cuts, trims, freezes and speed changes in the editor carry the keys along (`ops.windowKeys`).



- `base[i].speed`:
  - plays that piece faster or slower, and its `duration` is the timeline length;
  - the voice is NOT retimed, so use it only on shots without talking;
  - in the editor, `ops.setBaseSpeed` ripples the rest of the edit for you.
- `base[i].freeze: true` holds the frame at `sourceIn` for `duration`. The editor's F key inserts a 1 s freeze and ripples everything after it (`ops.insertFreeze`).

## Audio

- `audio.music`:
  - `fadeIn` and `fadeOut` are in seconds;
  - `duck: {db, attack, release}` lowers the music by `db` under speech, using the caption words as the speech map, and replaces the `gapBoost` step;
  - `beats: [s, ...]` holds the music's beat times (detect them with `editor_tools.py beats` / `music.py analyze`); the editor snaps to them.
- `audio.sfx[].fadeIn` / `fadeOut` are in seconds.
- `audio.voice.chain`:
  - the voice was cleaned by `python -I tools/edit/editor_tools.py voice <public> <audio> --preset light|pro|strong` (denoise, EQ, compressor, de-esser, then levelled to -14 LUFS with a -1.5 dB ceiling);
  - `src` is the cleaned file and `original` is the raw one;
  - `chain.bypass: true` plays the original for A/B listening; never leave it on when you deliver;
  - `chain.before` / `chain.after` hold the LUFS readings.

## More CapCut fields

- **Smooth zoom** is ordinary `base[].keys`, laid out as four keys:
  - rest, then peak after `inDur` (`ease` inOut), held for `hold`, then rest again after `outDur` (`ease` inOut).
  - Example: `[{"t":3,"scale":1},{"t":3.6,"scale":1.15,"ease":"inOut"},{"t":5.1,"scale":1.15},{"t":5.7,"scale":1,"ease":"inOut"}]`.
  - The editor builds it with `edits.smoothZoom`.
- **Volume keyframes**: `audio.music.keys` and `audio.sfx[].keys` are `[{t, volume, ease}]`.
  - `volume` multiplies the sound's level at item time `t` (1 = unchanged, 0 = silent).
  - The render uses `audioMix.volumeAt`.
- **Crop**: `clips[].crop` and `base[].crop` are `{l, t, r, b}`, each a fraction cut off that edge (0..0.95). The matte follows.
- **Reverse**: `base[].reversed = {src, sourceIn, matte}` means the piece now points at a reversed copy made by `editor_tools.py reverse`; `reversed` records the original so the editor can turn it back.
- **Marker colour**: `notes[].color` is one of red, green, blue, violet or grey (amber when absent). It is only a visual tag for the owner.

## Media the owner imports

The editor's Media tab copies files into the project's `public/media/videos/`, `public/media/images/` and `public/media/audio/` (ASCII names). Dropped on the timeline they become:
- a video: a `VideoLayer` clip `{src: "media/videos/x.mp4", volume: 0, whip: false}` as long as the file (sound off by default);
- a photo (.jpg): an `ImageLayer` clip with a light push-in; an element (.png/.gif/.svg/.webp): an `ImageLayer` with `fit: "contain"` and `box.scale: 0.45`, centred;
- a sound up to 15 s: an `audio.sfx[]` entry with `duration`; a longer one: `audio.music` (volume 0.25) when there is none yet, otherwise a long sfx at volume 0.5.

Treat these files as the owner's choices: reuse them, don't delete or rename them.

## Finished footage and transparent layers

- `layout.drift: false` turns off the faint handheld drift on the footage, for footage that is already finished (it would otherwise move a few pixels).
- `VideoLayer` takes `transparent: true` for a webm with alpha (cut-outs, animation layers rendered from HyperFrames).

## Switched off: `disabled`

`clips[].disabled` / `audio.sfx[].disabled: true`: the user switched that item off in the editor (CapCut's V). It stays in the file and on the timeline but does not render. Leave it off unless asked.

## Timeline switches: `lanes`

`"lanes": {"track-3": {"hidden": true}, "music": {"muted": true}, "base": {"locked": true}}`

- The keys are `track-<n>`, `words`, `base`, `voice`, `music`, `sfx`, `zoom`, `transitions` and `notes`.
- `hidden` and `muted` change the render: a hidden `words` lane hides the captions.
- `name` is the user's own label for a clip track (`track-<n>`) in the editor; it changes nothing in the render. Without it the editor names a track by what it holds (نصوص، مؤثرات، فيديو وصور...). Keep the user's names.
- `locked` means the user does not want that lane touched: **do not move, retime or delete anything in a locked lane** unless they ask in so many words.

## Tight cuts from the transcript

The editor's captions tab ("شيل السكتات والحشو") runs `ops.findCuts(doc, minGap, keep)`. It finds silences longer than `minGap` (default 0.35 s, minus `keep` = 0.08 s of air on each side) and filler words (`ops.FILLERS`), then ripple-deletes the ones the user ticks. If you do the same by hand, cut the footage, the voice segments and every timed item together. `ops.rippleDelete` is the reference.

## Tracking and stabilize: `clips[].follow`, `base[].stabilize`

CapCut's Tracking and Stabilize. The tracking runs offline with `tools/track/track.py` (see its README); it writes a
track file under `public/tracks/`, and the render reads it (`tracking.ts`), so the editor preview and the MP4 match.

- `"follow": {"track": "tracks/x.json", "mode": "perspective" | "transform" | "position", "point": [x, y]}` on any clip:
  the clip rides on the tracked thing. Place it over the frame the target was picked on (the track's `anchor`).
  `perspective` pins it on a surface with its perspective (outlines, a logo on a wall, a video in a screen);
  `transform` moves, scales and turns with it but stays flat; `position` only moves (labels stay upright and the
  same size). `point` is the pivot in composition px (default: the shape's centre at the anchor).
- `Highlight` draws an outline (`points`, fractions of the frame; `smooth` for curved roofs and land), and
  `Callout` a pin, line and label (`point`, `text`, `sub`). Both are made for `follow`.
- `"stabilize": {"track": "tracks/stab-x.json", "level": "light" | "normal" | "max" | "lock"}` on a footage piece
  steadies it (the track holds the correction and the zoom that hides the moved edges). Clips that follow a track
  on that piece stay on their target.
- A track file is a list of homographies per source frame from its anchor frame; `conf` < 0.15 means lost
  (the overlay holds still there). Check `<track>.preview.mp4` before you deliver: it shows the outline on the footage.

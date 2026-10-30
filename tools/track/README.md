# Tracking and stabilization

`track.py` is the Studio Editor's tracking engine (CapCut's Tracking and Stabilize), and Claude can run it
directly. Everything is offline and local: OpenCV (KLT + SIFT homography), SAM2 (outlines and object masks,
CUDA when there is a GPU) and MediaPipe (faces). Models live in `tools/track/models/` (gitignored):
`sam2.1_hiera_small.pt` and `blaze_face_short_range.tflite`.

Points are fractions of the source video frame (0..1). Every command prints `PROGRESS p text` lines and ends
with `RESULT {json}`; `--preview` also writes `<track>.preview.mp4` with the tracked shape drawn on the footage.

```
python -I tools/track/track.py segment   <public> <video> --at 7 --box 0.40,0.37,0.60,0.47     # outline of what is in the box
python -I tools/track/track.py plane     <public> <video> --at 7 --shape x,y,x,y,... --preview   # roof, land, wall, screen
python -I tools/track/track.py object    <public> <video> --at 7 --box x0,y0,x1,y1 --preview     # person, car, product
python -I tools/track/track.py face      <public> <video> [--point x,y] --preview                # a face
python -I tools/track/track.py stabilize <public> <video> --strength 0.6 [--lock tracks/x.json]
```

How Claude uses it on an edit:
1. Pull a frame (`ffmpeg -ss T -i video -frames:v 1`), find the target, and run `segment` with a box around it
   to get its exact outline.
2. Run `plane` (flat or far things: buildings from a drone, land, signs) or `object` (things that move or
   change shape) with that outline, `--preview`, and look at a few frames of the preview video.
3. Add a `Highlight` (points = the outline mapped to the frame) and a `Callout` with `follow` on the track;
   see `reel/src/edit/LOOK.md`. Render a few frames to check.

Speed on this machine (RTX 2050): plane 20 s of 4K in ~22 s, object ~4 frames/s, face ~30 frames/s,
stabilize 20 s in ~6 s, segment ~10 s (most of it loading SAM2).

# Sounds and music

The editor's Audio tab lists the files here.

- `library/` 128 CC0 sounds and music tracks (Kenney, OpenGameArt, made here), in git. CC0 means they can go
  in commercial and monetized videos with no credit. Every file is listed in `library/catalog.json` with
  its origin, and its license is in `library/LICENSES.md`.
- `music_*` folders (for example `music_mixkit/`) are kept on your computer only (not in git): their
  licenses allow use in videos but not sharing the files themselves.

## Adding sounds
Good sources, from easiest to check:
- **Mixkit** (mixkit.co): free for videos and ads, no credit; download by hand; keep out of git.
- **Pixabay** (pixabay.com/sound-effects, /music): free for videos, no credit; download by hand; keep out of git.
- **Openverse** (openverse.org, also an API): Creative Commons search; only take CC0 or CC BY (CC BY needs
  the author's name in the video description); never NC for ads.
- **Kenney**, **OpenGameArt** (CC0 items): can go in `library/`.

For each new file in `library/`, add a line to `LICENSES.md` and an entry to `catalog.json`
(`node assets/library/verify.mjs` checks the catalog).

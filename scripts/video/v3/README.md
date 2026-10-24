# SeaPulse trailer V3

Cinematic cut. The previous explainer is unchanged:

- Source backup: `scripts/video/v2/`
- Media backup: `video-output/v2/seapulse-datathon-demo.mp4`

The original files in `scripts/video/` and `video-output/seapulse-datathon-demo.mp4` are still there.

This cut is internal review. The picture includes the running app and derived August connections, so the MP4 stays in gitignored `video-output/`. Do not copy it into `public/`.

## Regenerate

From the repository root, on `idea2`, with the local August day files and `data/derived/connectivity-august-2025.json`:

```bash
node scripts/video/v3/render.mjs
```

`--skip-capture` reuses `video-output/v3-capture/` and only rebuilds frames, audio, and the MP4.
`--sample` writes a few composition stills and does not encode.

Output:

- `video-output/seapulse-trailer-v3.mp4`
- `video-output/seapulse-trailer-v3.srt`
- `scripts/video/v3/seapulse-trailer-v3.srt`
- `video-output/v3-review/`
- `video-output/v3-qa.md`

Requires Google Chrome, FFmpeg, and `edge-tts` (`en-US-AndrewNeural`, then Jenny, then the Windows voice). Music is generated in FFmpeg. It is an original score, not a commercial song.

Narration is `narration.txt`. Picture timing and on-screen lines are `timeline.json`. The capture drives the real Explore and Network screens. It does not change the application.

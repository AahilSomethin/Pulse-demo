# SeaPulse datathon explainer

Internal-review video. It is not cleared for public distribution.

The August connectivity file stores activity-cell centres from the private FollowMe extract. Redistribution of those locations was not confirmed (`LIMITATIONS.md`). The finished MP4, frames, and `story.json` stay in `video-output/`, which is gitignored. Do not copy the video into `public/` or commit it.

The picture is a scripted composition in SeaPulse colours. It draws the public OpenStreetMap island polygons already shipped with the app, then the activity cells and two connections chosen from `data/derived/connectivity-august-2025.json` by the same indicator and opportunity code the Network page uses. It does not replay individual GPS trails or device identifiers.

## What the cut shows

| Time | Picture |
| --- | --- |
| 0–11s | Maldives-wide map, then a move toward the central atolls |
| 11–21s | Busiest stop cells and the August counts |
| 21–34s | One repeated connection with steadier tracking |
| 34–48s | The flagged connection with the most credible journeys, and the opposite direction |
| 48–60s | Future vision, labelled as not in this prototype, then the end card |

The last twelve seconds name authorised live tracking, official ferry schedules, passenger demand, and predictive planning as later steps. They are not described as features of the current prototype.

Headline counts are shown only when `src/data/followme-quality.json` matches the summary’s kept rows and device total.

Scene 3 keeps a connection only when the evidence is enough to compare, fewer than 10% of passages were left out of the times, the tracked path is under 1.2× the separation, and the separation is at least 20 km. The busiest match is used.

Scene 4 uses the flagged adequate connection with the most credible journeys, provided that sample is at least 30 journeys and the reverse direction is in the file. Rules, the question, and the caveat are the ones `findOpportunities` returns.

## Regenerate

From the repository root, with the local August summary already built:

```bash
node scripts/video/render.mjs --sample
node scripts/video/render.mjs
```

`--sample` writes stills to `video-output/review/` and does not encode. The full command writes:

- `video-output/seapulse-datathon-demo.mp4`
- `video-output/seapulse-datathon-demo.srt`
- `scripts/video/seapulse-datathon-demo.srt`
- `video-output/narration.wav`

Requirements:

- Google Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`
- Node, and the repository’s existing `tsx` (the script calls `npx tsx`)
- FFmpeg on `PATH`, or `video-output/tools/ffmpeg.zip` from the essentials build, which the script unpacks
- Narration uses `edge-tts` (`en-US-JennyNeural`) when that command is installed. It does not need an API key. If it is missing or offline, the script uses the installed Windows voice `Microsoft Zira Desktop`.

Spoken words are `scripts/video/seapulse-narration.txt`. Subtitle cues use the measured length of each line, starting 0.6 seconds into its scene.

No background music is mixed in. A generated tone would compete with the narration, and no licensed music file is configured.

## Checks

After a full render, `ffprobe` should report 1920×1080, H.264, AAC, about 60 seconds, and an audio stream. Review stills are written to `video-output/review/`.

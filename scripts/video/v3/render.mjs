import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { captureJourney } from "./capture-journey.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = join(root, "video-output");
const frameDir = join(outDir, "v3-frames");
const audioDir = join(outDir, "v3-audio");
const reviewDir = join(outDir, "v3-review");
const captureRoot = join(outDir, "v3-capture");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const timeline = JSON.parse(readFileSync(join(root, "scripts", "video", "v3", "timeline.json"), "utf8"));
const FPS = timeline.fps;
const DURATION = timeline.duration;
const FRAMES = DURATION * FPS;
const sample = process.argv.includes("--sample");
const skipCapture = process.argv.includes("--skip-capture");

function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stderr.slice(-4000)}`));
    });
  });
}

function findBinary(name) {
  const local = join(outDir, "tools");
  const candidates = [];
  const scan = (dir, depth) => {
    if (depth > 4 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry.toLowerCase() === `${name}.exe`) candidates.push(full);
      else if (statSync(full).isDirectory()) scan(full, depth + 1);
    }
  };
  scan(local, 0);
  return candidates[0] ?? null;
}

async function ensureFfmpeg() {
  const onPath = await run("where", ["ffmpeg"]).then((result) => result.stdout.trim().split(/\r?\n/)[0]).catch(() => "");
  if (onPath && existsSync(onPath)) return { ffmpeg: onPath, ffprobe: onPath.replace(/ffmpeg\.exe$/i, "ffprobe.exe") };
  const ffmpeg = findBinary("ffmpeg");
  const ffprobe = findBinary("ffprobe");
  if (!ffmpeg || !ffprobe) throw new Error("FFmpeg is not installed and was not found under video-output/tools.");
  return { ffmpeg, ffprobe };
}

function narrationCues() {
  const text = readFileSync(join(root, "scripts", "video", "v3", "narration.txt"), "utf8");
  const cues = [];
  let start = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const timed = line.match(/^#\s+(\d+(?:\.\d+)?)$/);
    if (timed) {
      start = Number(timed[1]);
      continue;
    }
    if (line.startsWith("#")) continue;
    if (start == null) throw new Error(`Narration line has no timing: ${line}`);
    cues.push({ start, text: line });
    start = null;
  }
  if (cues.length !== timeline.narration.length) {
    throw new Error(`Narration has ${cues.length} lines; timeline has ${timeline.narration.length}.`);
  }
  return cues;
}

function srtTime(seconds) {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const whole = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function probeDuration(ffprobe, file) {
  return run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).then((result) => {
    const duration = Number(result.stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`No duration for ${file}`);
    return duration;
  });
}

async function synthesize(line, index, ffprobe) {
  const file = join(audioDir, `line-${index}.mp3`);
  const marker = join(audioDir, `line-${index}.txt`);
  if (existsSync(file) && existsSync(marker) && readFileSync(marker, "utf8") === line) return { file, voice: "cached" };
  const edge = join(process.env.APPDATA ?? "", "Python", "Python311", "Scripts", "edge-tts.exe");
  try {
    if (!existsSync(edge)) throw new Error("edge-tts missing");
    await run(edge, ["--voice", "en-US-AndrewNeural", "--rate=-2%", `--text=${line}`, `--write-media=${file}`]);
    await writeFile(marker, line);
    await probeDuration(ffprobe, file);
    return { file, voice: "en-US-AndrewNeural" };
  } catch (error) {
    console.warn(`Andrew voice unavailable (${error instanceof Error ? error.message : error}). Trying Jenny.`);
    try {
      if (!existsSync(edge)) throw new Error("edge-tts missing");
      await run(edge, ["--voice", "en-US-JennyNeural", "--rate=-2%", `--text=${line}`, `--write-media=${file}`]);
      await writeFile(marker, line);
      await probeDuration(ffprobe, file);
      return { file, voice: "en-US-JennyNeural" };
    } catch (jenny) {
      console.warn(`Jenny unavailable (${jenny instanceof Error ? jenny.message : jenny}). Using Microsoft Zira.`);
      const wav = join(audioDir, `line-${index}.wav`);
      const script = join(audioDir, "speak.ps1");
      await writeFile(marker, line);
      await writeFile(script, [
        "Add-Type -AssemblyName System.Speech",
        "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
        "$synth.SelectVoice('Microsoft Zira Desktop')",
        "$synth.Rate = 0",
        `$synth.SetOutputToWaveFile('${wav.replaceAll("'", "''")}')`,
        `$synth.Speak((Get-Content -Raw -Encoding UTF8 '${marker.replaceAll("'", "''")}'))`,
        "$synth.Dispose()",
      ].join("\n"));
      await run("powershell", ["-NoProfile", "-File", script]);
      return { file: wav, voice: "Microsoft Zira Desktop" };
    }
  }
}

async function buildNarration(ffmpeg, ffprobe, cues) {
  await mkdir(audioDir, { recursive: true });
  const placed = [];
  let voice = "none";
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    const next = cues[index + 1]?.start ?? DURATION - 0.15;
    const budget = Math.max(0.8, next - cue.start - 0.28);
    const spoken = await synthesize(cue.text, index + 1, ffprobe);
    voice = spoken.voice;
    const rawDuration = await probeDuration(ffprobe, spoken.file);
    const tempo = rawDuration > budget ? Math.min(1.18, rawDuration / budget) : 1;
    const wav = join(audioDir, `placed-${index + 1}.wav`);
    const fadeOut = Math.max(0.05, rawDuration / tempo - 0.08);
    await run(ffmpeg, ["-y", "-i", spoken.file, "-af", `atempo=${tempo.toFixed(4)},afade=t=in:st=0:d=0.04,afade=t=out:st=${fadeOut.toFixed(3)}:d=0.08`, "-ar", "48000", "-ac", "2", wav]);
    const duration = await probeDuration(ffprobe, wav);
    placed.push({ wav, start: cue.start, end: cue.start + duration, text: cue.text, voice, tempo });
    console.log(`line ${index + 1}: ${duration.toFixed(2)}s at ${cue.start}s tempo ${tempo.toFixed(2)} (${voice})`);
  }
  const srt = placed.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join("\n");
  await writeFile(join(outDir, "seapulse-trailer-v3.srt"), srt);
  await writeFile(join(root, "scripts", "video", "v3", "seapulse-trailer-v3.srt"), srt);
  const args = ["-y", "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"];
  for (const item of placed) args.push("-i", item.wav);
  const delays = placed.map((item, index) => `[${index + 1}:a]adelay=${Math.round(item.start * 1000)}|${Math.round(item.start * 1000)}[a${index}]`);
  const mix = `[0:a]atrim=0:${DURATION},asetpts=PTS-STARTPTS[base];${delays.join(";")};[base]${placed.map((_, index) => `[a${index}]`).join("")}amix=inputs=${placed.length + 1}:duration=first:dropout_transition=0:normalize=0[out]`;
  const narration = join(audioDir, "narration.wav");
  await run(ffmpeg, [...args, "-filter_complex", mix, "-map", "[out]", "-t", String(DURATION), "-c:a", "pcm_s16le", narration]);
  return { narration, placed, voice };
}

function duckExpression(cues) {
  let expression = "1";
  for (const cue of cues) {
    const start = Math.max(0, cue.start - 0.15).toFixed(2);
    const end = (cue.end + 0.2).toFixed(2);
    expression = `if(between(t\\,${start}\\,${end})\\,0.32\\,${expression})`;
  }
  return expression;
}

async function buildMusic(ffmpeg, cues) {
  const bed = join(audioDir, "bed.wav");
  const whoosh = join(audioDir, "whoosh.wav");
  const tick = join(audioDir, "tick.wav");
  const chord = join(audioDir, "chord.wav");
  await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "anoisesrc=color=white:sample_rate=48000:duration=0.42:amplitude=0.4", "-af", "highpass=f=700,lowpass=f=4200,afade=t=in:st=0:d=0.04,afade=t=out:st=0.1:d=0.32,volume=0.45", whoosh]);
  await run(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=1600:sample_rate=48000:duration=0.07", "-af", "afade=t=out:st=0.012:d=0.055,volume=0.35", tick]);
  await run(ffmpeg, [
    "-y",
    "-f", "lavfi", "-i", "sine=frequency=196:sample_rate=48000:duration=2.4",
    "-f", "lavfi", "-i", "sine=frequency=247:sample_rate=48000:duration=2.4",
    "-f", "lavfi", "-i", "sine=frequency=392:sample_rate=48000:duration=2.4",
    "-filter_complex", "[0:a][1:a][2:a]amix=inputs=3:normalize=0,afade=t=in:st=0:d=0.05,afade=t=out:st=1.1:d=1.2,volume=0.22[out]",
    "-map", "[out]",
    chord,
  ]);
  const endFade = (DURATION - 5).toFixed(2);
  await run(ffmpeg, [
    "-y",
    "-f", "lavfi", "-t", String(DURATION), "-i", "anoisesrc=color=brown:sample_rate=48000:amplitude=0.22",
    "-f", "lavfi", "-t", String(DURATION), "-i", "sine=frequency=55:sample_rate=48000",
    "-f", "lavfi", "-t", String(DURATION), "-i", "sine=frequency=82.5:sample_rate=48000",
    "-f", "lavfi", "-t", String(DURATION), "-i", "sine=frequency=110:sample_rate=48000",
    "-f", "lavfi", "-t", String(DURATION), "-i", "sine=frequency=220:sample_rate=48000",
    "-f", "lavfi", "-t", String(DURATION), "-i", "sine=frequency=261.63:sample_rate=48000",
    "-f", "lavfi", "-t", String(DURATION), "-i", "sine=frequency=329.63:sample_rate=48000",
    "-filter_complex", [
      "[0:a]lowpass=f=420,afade=t=in:st=0:d=0.8,afade=t=out:st=8:d=3,volume=0.7[ocean]",
      "[1:a][2:a]amix=inputs=2:normalize=0,volume=0.14,afade=t=in:st=3.5:d=2.4,afade=t=out:st=" + endFade + ":d=4[drone]",
      "[3:a]tremolo=f=1.35:d=0.72,volume=0.055,afade=t=in:st=6:d=1.4,afade=t=out:st=" + endFade + ":d=3[pulse]",
      "[4:a][5:a][6:a]amix=inputs=3:normalize=0,lowpass=f=1200,volume=0.04,afade=t=in:st=12:d=3,afade=t=out:st=" + endFade + ":d=3.2[pad]",
      "[ocean][drone][pulse][pad]amix=inputs=4:normalize=0:dropout_transition=0[bed]",
    ].join(";"),
    "-map", "[bed]",
    "-ac", "2",
    bed,
  ]);
  const hits = [6.2, 10.2, 70.6, 77.8];
  const ticks = [10.2, 24.6, 34.2, 48.2, 57.2, 65.4];
  const args = ["-y", "-i", bed, "-i", whoosh, "-i", tick, "-i", chord];
  const parts = ["[0:a]volume=0.9[bed]"];
  let inputIndex = 4;
  const delayed = ["[bed]"];
  for (const time of hits) {
    args.push("-i", whoosh);
    parts.push(`[${inputIndex}:a]adelay=${Math.round(time * 1000)}|${Math.round(time * 1000)}[h${inputIndex}]`);
    delayed.push(`[h${inputIndex}]`);
    inputIndex += 1;
  }
  for (const time of ticks) {
    args.push("-i", tick);
    parts.push(`[${inputIndex}:a]adelay=${Math.round(time * 1000)}|${Math.round(time * 1000)}[k${inputIndex}]`);
    delayed.push(`[k${inputIndex}]`);
    inputIndex += 1;
  }
  args.push("-i", chord);
  parts.push(`[${inputIndex}:a]adelay=77800|77800[logo]`);
  delayed.push("[logo]");
  const duck = duckExpression(cues);
  parts.push(`${delayed.join("")}amix=inputs=${delayed.length}:normalize=0:dropout_transition=0,volume='${duck}'[out]`);
  const music = join(audioDir, "music.wav");
  await run(ffmpeg, [...args, "-filter_complex", parts.join(";"), "-map", "[out]", "-t", String(DURATION), "-ac", "2", music]);
  return music;
}

async function mixAudio(ffmpeg, narration, music) {
  const mixed = join(audioDir, "mix.wav");
  await run(ffmpeg, [
    "-y",
    "-i", narration,
    "-i", music,
    "-filter_complex", "[0:a]volume=1.35[voice];[1:a]volume=0.9[bed];[voice][bed]amix=inputs=2:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11[out]",
    "-map", "[out]",
    "-t", String(DURATION),
    "-ar", "48000",
    "-ac", "2",
    mixed,
  ]);
  return mixed;
}

function contentType(pathname) {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".geojson")) return "application/geo+json; charset=utf-8";
  if (pathname.endsWith(".jpg")) return "image/jpeg";
  return "application/octet-stream";
}

function startServer() {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    let file = null;
    if (pathname === "/compose") file = join(root, "scripts", "video", "v3", "compose.html");
    else if (pathname === "/timeline.json") file = join(root, "scripts", "video", "v3", "timeline.json");
    else if (pathname === "/story.json") file = join(outDir, "story.json");
    else if (pathname === "/manifest.json") file = join(captureRoot, "manifest.json");
    else if (pathname === "/islands.geojson") file = join(root, "public", "reference", "osm-islands.geojson");
    else {
      const match = pathname.match(/^\/capture\/([a-z]+)\/(f_\d{5}\.jpg)$/);
      if (match) file = join(captureRoot, match[1], match[2]);
    }
    if (!file || !existsSync(file)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": contentType(file), "Cache-Control": "no-store" });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Server did not bind.");
      resolve({ server, port: address.port });
    });
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      if (!message.id || !this.pending.has(message.id)) return;
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.next;
    this.next += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function launchChrome(port, profile) {
  mkdirSync(profile, { recursive: true });
  const child = spawn(chromePath, [
    "--headless=new",
    "--hide-scrollbars",
    "--mute-audio",
    "--disable-extensions",
    "--no-first-run",
    "--force-device-scale-factor=1",
    "--window-size=1920,1080",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return child;
    } catch {
      await delay(250);
    }
  }
  child.kill();
  throw new Error("Chrome did not open a debugging port.");
}

async function connectPage(port, url) {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const page = list.find((item) => item.type === "page") ?? list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await cdp.send("Runtime.evaluate", {
      expression: "({ ready: window.__ready === true, error: window.__error || '' })",
      returnByValue: true,
    });
    const value = state.result?.value;
    if (value?.error) throw new Error(value.error);
    if (value?.ready) return cdp;
    await delay(250);
  }
  throw new Error("The composition did not become ready.");
}

async function shoot(cdp, frame) {
  const rendered = await cdp.send("Runtime.evaluate", {
    expression: `window.renderFrame(${frame})`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (rendered.exceptionDetails) throw new Error(JSON.stringify(rendered.exceptionDetails).slice(0, 800));
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 92,
    clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
    captureBeyondViewport: false,
  });
  return Buffer.from(shot.data, "base64");
}

async function captureFrames(port, url) {
  const cdp = await connectPage(port, url);
  const times = sample ? [3, 9, 16, 28, 37, 45, 53, 60, 67, 74] : null;
  await mkdir(sample ? reviewDir : frameDir, { recursive: true });
  if (sample) {
    for (const time of times) {
      const jpeg = await shoot(cdp, Math.round(time * FPS));
      const file = join(reviewDir, `sample_${String(time).replace(".", "_")}.jpg`);
      await writeFile(file, jpeg);
      console.log(`sample ${file} ${jpeg.length} bytes`);
    }
    return;
  }
  await rm(frameDir, { recursive: true, force: true });
  await mkdir(frameDir, { recursive: true });
  for (let frame = 0; frame < FRAMES; frame += 1) {
    const jpeg = await shoot(cdp, frame);
    await writeFile(join(frameDir, `f_${String(frame + 1).padStart(5, "0")}.jpg`), jpeg);
    if (frame % 120 === 0) console.log(`frame ${frame + 1}/${FRAMES}`);
  }
}

async function encode(ffmpeg, audio) {
  const video = join(outDir, "seapulse-trailer-v3.mp4");
  await run(ffmpeg, [
    "-y",
    "-framerate", String(FPS),
    "-i", join(frameDir, "f_%05d.jpg"),
    "-i", audio,
    "-t", String(DURATION),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "medium",
    "-crf", "18",
    "-r", String(FPS),
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    video,
  ]);
  return video;
}

async function verify(ffmpeg, ffprobe, video, voice) {
  const probed = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,width,height,avg_frame_rate,channels", "-of", "json", video]);
  console.log(probed.stdout);
  await mkdir(reviewDir, { recursive: true });
  const times = [2, 5, 8, 12, 16, 21, 26, 31, 36, 42, 47, 50, 55, 59, 63, 67, 72, 76, 80];
  for (const time of times) {
    await run(ffmpeg, ["-y", "-ss", String(time), "-i", video, "-frames:v", "1", join(reviewDir, `t${String(time).replace(".", "_")}.jpg`)]);
  }
  const levels = await run(ffmpeg, ["-i", video, "-af", "volumedetect", "-f", "null", "-"]).catch((error) => ({ stderr: String(error) }));
  const levelText = `${levels.stderr ?? ""}\n${levels.stdout ?? ""}`;
  const report = [
    "# SeaPulse trailer V3 QA",
    "",
    `Rendered: ${new Date().toISOString()}`,
    `File: video-output/seapulse-trailer-v3.mp4`,
    `Voice: ${voice}`,
    "Music: original generated score (ocean noise, drone, pulse, soft pad, logo chord). No commercial recording.",
    "Subtitles: video-output/seapulse-trailer-v3.srt and scripts/video/v3/seapulse-trailer-v3.srt",
    "End card: SEAPULSE / Every Movement Tells a Story. / EXPLORE THE DEMO. No public URL was found.",
    "V2 preserved: scripts/video/v2 and video-output/v2/seapulse-datathon-demo.mp4. The original MP4 was not overwritten.",
    "App code was not modified. Branch stayed on idea2.",
    "",
    "## ffprobe",
    "",
    "```",
    probed.stdout.trim(),
    "```",
    "",
    "## levels",
    "",
    "```",
    levelText.slice(-1500),
    "```",
    "",
    "Review stills: video-output/v3-review/",
  ].join("\n");
  await writeFile(join(outDir, "v3-qa.md"), report);
  await writeFile(join(root, "scripts", "video", "v3", "QA.md"), [
    "# SeaPulse trailer V3",
    "",
    "Internal-review render. The MP4 stays in gitignored `video-output/` because the picture includes derived August connections.",
    "",
    `- Duration target: ${DURATION} seconds, 1920×1080, 30 fps, H.264, AAC.`,
    `- Voice: ${voice}.`,
    "- Music is an original generated score, not a commercial track.",
    "- No public demo URL is configured. The end card says EXPLORE THE DEMO.",
    "- Future scenes are labelled planned and are not app screenshots.",
    "- V2 sources and the previous MP4 were copied, not replaced.",
    "",
    "See `video-output/v3-qa.md` after a local render for the probe and stills.",
  ].join("\n"));
}

async function main() {
  const branch = (await run("git", ["branch", "--show-current"])).stdout.trim();
  if (branch !== "idea2") throw new Error(`Refusing to render on ${branch}. Stay on idea2.`);
  if (!existsSync(join(outDir, "v2", "seapulse-datathon-demo.mp4"))) {
    throw new Error("V2 backup MP4 is missing. Refusing to continue.");
  }
  console.log("Reading the August summary…");
  await run("npx", ["tsx", "scripts/video/extract-story.ts"], { shell: true });
  if (!skipCapture) {
    console.log("Capturing the live journey…");
    await captureJourney();
  } else if (!existsSync(join(captureRoot, "manifest.json"))) {
    throw new Error("No capture manifest. Run without --skip-capture.");
  }
  const { ffmpeg, ffprobe } = await ensureFfmpeg();
  console.log("Preparing narration and music…");
  const cues = narrationCues();
  const spoken = await buildNarration(ffmpeg, ffprobe, cues);
  const music = await buildMusic(ffmpeg, spoken.placed);
  const audio = await mixAudio(ffmpeg, spoken.narration, music);
  const { server, port } = await startServer();
  const debugPort = 9355;
  const profile = join(outDir, "v3-chrome");
  await rm(profile, { recursive: true, force: true });
  const chrome = await launchChrome(debugPort, profile);
  try {
    console.log(sample ? "Capturing sample frames…" : `Capturing ${FRAMES} frames…`);
    await captureFrames(debugPort, `http://127.0.0.1:${port}/compose`);
    if (!sample) {
      console.log("Encoding…");
      const video = await encode(ffmpeg, audio);
      await verify(ffmpeg, ffprobe, video, spoken.voice);
      await rm(frameDir, { recursive: true, force: true });
      console.log(video);
    }
  } finally {
    chrome.kill();
    server.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});

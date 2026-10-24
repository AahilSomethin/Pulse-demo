import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(root, "video-output");
const frameDir = join(outDir, "frames");
const audioDir = join(outDir, "audio");
const reviewDir = join(outDir, "review");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const FPS = 30;
const FRAMES = 60 * FPS;
const SCENE_STARTS = [0, 11, 21, 34, 48];
const SCENE_LENGTHS = [11, 10, 13, 14, 12];
const LEAD_IN = 0.6;

const sample = process.argv.includes("--sample");
const sampleTimes = [6, 16, 28, 42, 51, 57];

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
      if (code === 0) resolve(stdout);
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
  const onPath = await run("where", ["ffmpeg"]).then((text) => text.trim().split(/\r?\n/)[0]).catch(() => "");
  if (onPath && existsSync(onPath)) return { ffmpeg: onPath, ffprobe: onPath.replace(/ffmpeg\.exe$/i, "ffprobe.exe") };
  let ffmpeg = findBinary("ffmpeg");
  let ffprobe = findBinary("ffprobe");
  if (!ffmpeg) {
    const zip = join(outDir, "tools", "ffmpeg.zip");
    if (!existsSync(zip)) throw new Error("FFmpeg is not installed and video-output/tools/ffmpeg.zip is missing.");
    console.log("Unpacking FFmpeg…");
    await run("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path '${zip}' -DestinationPath '${join(outDir, "tools", "ffmpeg")}' -Force`]);
    ffmpeg = findBinary("ffmpeg");
    ffprobe = findBinary("ffprobe");
  }
  if (!ffmpeg || !ffprobe) throw new Error("FFmpeg binaries were not found after unpacking.");
  return { ffmpeg, ffprobe };
}

function narrationLines() {
  const text = readFileSync(join(root, "scripts/video/seapulse-narration.txt"), "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length !== 5) throw new Error(`Narration file must contain 5 spoken lines, found ${lines.length}.`);
  return lines;
}

async function synthesize(line, index, ffprobe) {
  const file = join(audioDir, `line-${index}.mp3`);
  const marker = join(audioDir, `line-${index}.txt`);
  if (existsSync(file) && existsSync(marker) && readFileSync(marker, "utf8") === line) return file;
  const edge = join(process.env.APPDATA ?? "", "Python", "Python311", "Scripts", "edge-tts.exe");
  try {
    if (!existsSync(edge)) throw new Error("edge-tts missing");
    await run(edge, ["--voice", "en-US-JennyNeural", "--rate=-4%", `--text=${line}`, `--write-media=${file}`]);
    await writeFile(marker, line);
    await probeDuration(ffprobe, file);
    return file;
  } catch (error) {
    console.warn(`Neural voice unavailable (${error instanceof Error ? error.message : error}). Using the installed Windows voice.`);
    const wav = join(audioDir, `line-${index}.wav`);
    const script = join(audioDir, "speak.ps1");
    await writeFile(marker, line);
    await writeFile(script, [
      "Add-Type -AssemblyName System.Speech",
      "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      "$synth.SelectVoice('Microsoft Zira Desktop')",
      "$synth.Rate = -1",
      `$synth.SetOutputToWaveFile('${wav.replaceAll("'", "''")}')`,
      `$synth.Speak((Get-Content -Raw -Encoding UTF8 '${marker.replaceAll("'", "''")}'))`,
      "$synth.Dispose()",
    ].join("\n"));
    await run("powershell", ["-NoProfile", "-File", script]);
    return wav;
  }
}

function probeDuration(ffprobe, file) {
  return run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).then((text) => {
    const duration = Number(text.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`No duration for ${file}`);
    return duration;
  });
}

function srtTime(seconds) {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const whole = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

async function buildAudio(ffmpeg, ffprobe, lines) {
  await mkdir(audioDir, { recursive: true });
  const cues = [];
  const prepared = [];
  for (let index = 0; index < lines.length; index += 1) {
    const source = await synthesize(lines[index], index + 1, ffprobe);
    const rawDuration = await probeDuration(ffprobe, source);
    const budget = SCENE_LENGTHS[index] - LEAD_IN - 0.45;
    const tempo = rawDuration > budget ? Math.min(1.15, rawDuration / budget) : 1;
    const wav = join(audioDir, `placed-${index + 1}.wav`);
    const fadeOut = Math.max(0.05, rawDuration / tempo - 0.08);
    const filters = [`atempo=${tempo.toFixed(4)}`, "afade=t=in:st=0:d=0.04", `afade=t=out:st=${fadeOut.toFixed(3)}:d=0.07`];
    await run(ffmpeg, ["-y", "-i", source, "-af", filters.join(","), "-ar", "48000", "-ac", "2", wav]);
    const duration = await probeDuration(ffprobe, wav);
    const start = SCENE_STARTS[index] + LEAD_IN;
    cues.push({ start, end: start + duration, text: lines[index] });
    prepared.push({ wav, start });
  }
  const srt = cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join("\n");
  await writeFile(join(outDir, "seapulse-datathon-demo.srt"), srt);
  await writeFile(join(root, "scripts/video/seapulse-datathon-demo.srt"), srt);
  await writeFile(join(outDir, "cues.json"), JSON.stringify({ cues }));
  const args = ["-y", "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"];
  for (const item of prepared) args.push("-i", item.wav);
  const delays = prepared.map((item, index) => `[${index + 1}:a]adelay=${Math.round(item.start * 1000)}|${Math.round(item.start * 1000)}[a${index}]`);
  const mix = `[0:a]atrim=0:60,asetpts=PTS-STARTPTS[base];${delays.join(";")};[base]${prepared.map((_, index) => `[a${index}]`).join("")}amix=inputs=${prepared.length + 1}:duration=first:dropout_transition=0:normalize=0[out]`;
  const narration = join(outDir, "narration.wav");
  await run(ffmpeg, [...args, "-filter_complex", mix, "-map", "[out]", "-t", "60", "-c:a", "pcm_s16le", narration]);
  return narration;
}

function contentType(pathname) {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".geojson")) return "application/geo+json; charset=utf-8";
  return "application/octet-stream";
}

function startServer() {
  const routes = new Map([
    ["/compose", join(root, "scripts/video/compose.html")],
    ["/story.json", join(outDir, "story.json")],
    ["/cues.json", join(outDir, "cues.json")],
    ["/islands.geojson", join(root, "public/reference/osm-islands.geojson")],
  ]);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const file = routes.get(pathname);
    if (!file) {
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
      const message = JSON.parse(event.data);
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
    const state = await cdp.send("Runtime.evaluate", { expression: "({ ready: window.__ready === true, error: window.__error || '' })", returnByValue: true });
    const value = state.result?.value;
    if (value?.error) throw new Error(value.error);
    if (value?.ready) return cdp;
    await delay(250);
  }
  throw new Error("The composition did not become ready.");
}

async function shoot(cdp, frame) {
  await cdp.send("Runtime.evaluate", { expression: `window.renderFrame(${frame})` });
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 94,
    clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
    captureBeyondViewport: false,
  });
  return Buffer.from(shot.data, "base64");
}

async function capture(port, url) {
  const cdp = await connectPage(port, url);
  if (sample) {
    await mkdir(reviewDir, { recursive: true });
    for (const time of sampleTimes) {
      const jpeg = await shoot(cdp, Math.round(time * FPS));
      const file = join(reviewDir, `t${String(time).replace(".", "_")}.jpg`);
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
    if (frame % 150 === 0) console.log(`frame ${frame + 1}/${FRAMES}`);
  }
}

async function encode(ffmpeg, narration) {
  const video = join(outDir, "seapulse-datathon-demo.mp4");
  await run(ffmpeg, [
    "-y",
    "-framerate", "30",
    "-i", join(frameDir, "f_%05d.jpg"),
    "-i", narration,
    "-t", "60",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-preset", "medium",
    "-crf", "18",
    "-r", "30",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    video,
  ]);
  return video;
}

async function verify(ffmpeg, ffprobe, video) {
  const streams = await run(ffprobe, ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,width,height,avg_frame_rate,channels", "-of", "json", video]);
  console.log(streams);
  await mkdir(reviewDir, { recursive: true });
  for (const time of [6, 16, 28, 42, 51, 57]) {
    await run(ffmpeg, ["-y", "-ss", String(time), "-i", video, "-frames:v", "1", join(reviewDir, `video_${time}.jpg`)]);
  }
  const black = await run(ffmpeg, ["-i", video, "-vf", "blackframe=amount=98:threshold=32", "-f", "null", "-"]);
  if (/blackframe/.test(black)) console.warn(black);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  console.log("Reading the August summary…");
  await run("npx", ["tsx", "scripts/video/extract-story.ts"], { shell: true });
  const { ffmpeg, ffprobe } = await ensureFfmpeg();
  console.log("Preparing narration…");
  const narration = await buildAudio(ffmpeg, ffprobe, narrationLines());
  const { server, port } = await startServer();
  const debugPort = 9333;
  const profile = join(outDir, "chrome-profile");
  await rm(profile, { recursive: true, force: true });
  const chrome = await launchChrome(debugPort, profile);
  try {
    console.log(sample ? "Capturing sample frames…" : "Capturing 1800 frames…");
    await capture(debugPort, `http://127.0.0.1:${port}/compose`);
    if (!sample) {
      console.log("Encoding…");
      const video = await encode(ffmpeg, narration);
      await verify(ffmpeg, ffprobe, video);
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

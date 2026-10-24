import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const captureRoot = join(root, "video-output", "v3-capture");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function run(command, args, options = {}) {
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
      else reject(new Error(`${command} exited ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.handler = null;
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      if (message.id && this.pending.has(message.id)) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
        else waiter.resolve(message.result);
        return;
      }
      if (message.method && this.handler) this.handler(message.method, message.params ?? {});
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
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
    "--window-size=1920,1080",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { windowsHide: true, stdio: "ignore" });
  for (let attempt = 0; attempt < 50; attempt += 1) {
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

async function connect(port) {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const page = list.find((item) => item.type === "page") ?? list[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return { cdp, ws };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails).slice(0, 600));
  }
  return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs, label) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(cdp, expression);
    if (value === true) return;
    last = typeof value === "string" ? value : JSON.stringify(value);
    if (typeof last === "string" && /could not/i.test(last)) {
      throw new Error(`${label}: ${last}`);
    }
    if ((Date.now() - started) % 10000 < 500) console.log(`${label}: ${last || "waiting"}`);
    await delay(500);
  }
  throw new Error(`${label} timed out. Last status: ${last}`);
}

const cursor = { x: 960, y: 540 };

async function moveTo(cdp, x, y, ms = 450) {
  const steps = Math.max(8, Math.round(ms / 16));
  const startX = cursor.x;
  const startY = cursor.y;
  for (let step = 1; step <= steps; step += 1) {
    const u = step / steps;
    const ease = u * u * (3 - 2 * u);
    const px = startX + (x - startX) * ease;
    const py = startY + (y - startY) * ease;
    cursor.x = px;
    cursor.y = py;
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px, y: py });
    await evaluate(cdp, `window.__trailerCursor(${px}, ${py})`);
    await delay(16);
  }
}

async function clickAt(cdp, x, y) {
  await moveTo(cdp, x, y, 380);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await delay(50);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await evaluate(cdp, `window.__trailerClick(${x}, ${y})`);
  await delay(180);
}

async function pointOf(cdp, finder) {
  const point = await evaluate(cdp, `(() => { ${finder} })()`);
  if (!point || typeof point.x !== "number") throw new Error(`No target for finder: ${finder.slice(0, 140)}`);
  return point;
}

async function clickFinder(cdp, finder) {
  const point = await pointOf(cdp, finder);
  await clickAt(cdp, point.x, point.y);
  return point;
}

function installCursorSource() {
  return `(() => {
    if (window.__trailerReady) return true;
    const cursor = document.createElement("div");
    cursor.id = "trailer-cursor";
    cursor.style.cssText = "position:fixed;left:0;top:0;z-index:2147483646;width:28px;height:28px;pointer-events:none;filter:drop-shadow(0 2px 2px rgba(0,0,0,.45));";
    cursor.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.2 1.4L11.2 19z" fill="#f4fafc" stroke="#0b1c28" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cursor);
    window.__trailerCursor = (x, y) => { cursor.style.transform = "translate(" + x + "px," + y + "px)"; };
    window.__trailerClick = (x, y) => {
      const ring = document.createElement("div");
      ring.style.cssText = "position:fixed;z-index:2147483645;width:64px;height:64px;margin:-32px 0 0 -32px;border:3px solid #3dcec0;border-radius:999px;box-shadow:0 0 0 8px rgba(61,206,192,.28);pointer-events:none;left:" + x + "px;top:" + y + "px;";
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), 1400);
    };
    window.__trailerCursor(960, 540);
    window.__trailerReady = true;
    return true;
  })()`;
}

function rectFinder(selectorScript) {
  return `
    const el = (${selectorScript});
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = el.getBoundingClientRect();
    const x = rect.width > 520 ? rect.x + rect.width * 0.58 : rect.x + rect.width / 2;
    return { x, y: rect.y + rect.height / 2, w: rect.width, h: rect.height };
  `;
}

async function ensureServer() {
  const probe = async () => {
    try {
      const response = await fetch("http://localhost:3000/explore", { signal: AbortSignal.timeout(8000) });
      return response.ok;
    } catch {
      return false;
    }
  };
  if (await probe()) return { child: null };
  console.log("Starting next dev…");
  await mkdir(captureRoot, { recursive: true });
  const logPath = join(captureRoot, "next-dev.log");
  const log = createWriteStream(logPath);
  const child = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", "3000"], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (await probe()) return { child };
    if (exited) break;
    await delay(1000);
  }
  child.kill();
  const tail = existsSync(logPath) ? readFileSync(logPath, "utf8").slice(-1500) : "";
  throw new Error(`next dev did not become ready on port 3000.\n${tail}`);
}

async function recordBeat(cdp, id, seconds, action) {
  const dir = join(captureRoot, id);
  await mkdir(dir, { recursive: true });
  let count = 0;
  let chain = Promise.resolve();
  cdp.handler = (method, params) => {
    if (method !== "Page.screencastFrame") return;
    count += 1;
    const index = count;
    const data = Buffer.from(params.data, "base64");
    chain = chain.then(() => writeFile(join(dir, `f_${String(index).padStart(5, "0")}.jpg`), data));
    void cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
  };
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 74,
    maxWidth: 1920,
    maxHeight: 1080,
    everyNthFrame: 1,
  });
  await delay(200);
  const started = Date.now();
  try {
    await action();
    const remain = seconds * 1000 - (Date.now() - started);
    if (remain > 0) await delay(remain);
  } finally {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await delay(200);
    cdp.handler = null;
    await chain;
  }
  const elapsed = (Date.now() - started) / 1000;
  console.log(`beat ${id}: ${count} frames in ${elapsed.toFixed(1)}s`);
  if (count < 8) throw new Error(`Beat ${id} captured only ${count} frames.`);
  return { id, frames: count, seconds: elapsed };
}

function placeWord(story) {
  const title = story?.steady?.destination?.title ?? "";
  const word = title.split(/\s+/).find((part) => /^[A-Za-z][A-Za-z'-]{3,}$/.test(part));
  if (!word) throw new Error("The steady connection has no searchable place name.");
  return word;
}

function selectSetter(value) {
  return `(() => {
    const select = [...document.querySelectorAll("select")].find((node) => [...node.options].some((option) => option.value === ${JSON.stringify(value)}));
    if (!select) return "missing";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(select, ${JSON.stringify(value)});
    const key = Object.getOwnPropertyNames(select).find((name) => name.startsWith("__reactProps"));
    const onChange = key ? select[key].onChange : null;
    if (typeof onChange === "function") onChange({ target: select, currentTarget: select });
    else select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.options[select.selectedIndex]?.textContent?.trim() || select.value;
  })()`;
}

function islandOptionFinder(title, word) {
  return `(() => {
    const titleOf = (node) => (node.querySelector("span")?.textContent || "").trim();
    const options = [...document.querySelectorAll("[role=option]")];
    return options.find((node) => titleOf(node) === ${JSON.stringify(title)})
      || options.find((node) => titleOf(node) === ${JSON.stringify(word)})
      || null;
  })()`;
}

function connectionFinder(place, journeys) {
  return `[...document.querySelectorAll("button")].find((button) => button.innerText.includes(${JSON.stringify(place)}) && button.innerText.includes(${JSON.stringify(`${journeys} journeys`)}))`;
}

export async function captureJourney() {
  const storyFile = JSON.parse(await readFile(join(root, "video-output", "story.json"), "utf8"));
  const place = placeWord(storyFile);
  const placeTitle = storyFile.steady.destination.title;
  const journeys = storyFile.steady.stats.journeys;
  console.log(`Capture target: ${placeTitle}, ${journeys} journeys`);

  const server = await ensureServer();
  const debugPort = 9341;
  const profile = join(captureRoot, "chrome-profile");
  const chrome = await launchChrome(debugPort, profile);
  const beats = [];
  try {
    const { cdp } = await connect(debugPort);
    await cdp.send("Page.navigate", { url: "http://localhost:3000/explore" });
    await waitFor(cdp, `(() => {
      const button = [...document.querySelectorAll("button")].find((item) => item.innerText.includes("Load local August"));
      if (!button) return "no button";
      return Object.getOwnPropertyNames(button).some((key) => key.startsWith("__reactProps")) ? true : "hydrating";
    })()`, 120000, "explore");
    await delay(800);
    await evaluate(cdp, installCursorSource());
    await evaluate(cdp, `document.documentElement.dataset.theme = "dark"; document.documentElement.style.colorScheme = "dark"; true`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const state = await evaluate(cdp, `(() => {
        const text = document.body?.innerText || "";
        if (text.includes("Pings kept")) return "ready";
        if (text.includes("Reading")) return "reading";
        const button = [...document.querySelectorAll("button")].find((item) => item.innerText.includes("Load local August"));
        button?.click();
        return button ? "clicked" : "no-button";
      })()`);
      console.log(`load ${attempt}: ${state}`);
      if (state === "reading" || state === "ready") break;
      await delay(500);
    }
    const notes = [];
    cdp.handler = (method, params) => {
      if (method === "Runtime.exceptionThrown") notes.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "exception");
      if (method === "Runtime.consoleAPICalled" && (params.type === "error" || params.type === "warning")) {
        const line = (params.args ?? []).map((arg) => arg.value || arg.description || "").join(" ");
        if (line) notes.push(line.slice(0, 300));
      }
    };
    const dayStarted = Date.now();
    let lastDayClick = Date.now();
    let dayStatus = "";
    while (Date.now() - dayStarted < 480000) {
      dayStatus = await evaluate(cdp, `(() => {
        const text = (document.body?.innerText || "").replace(/\\s+/g, " ").trim();
        if (/could not/i.test(text)) return "ERROR " + text.slice(0, 400);
        const play = document.querySelector("button[aria-keyshortcuts=Space]");
        const loaded = /devices · \\d+\\.csv/.test(text) || text.includes("Pings kept");
        if (loaded && play && !play.disabled) return "READY";
        const busy = text.match(/(Reading|Indexing)[^.]{0,90}/);
        if (busy) return "BUSY " + busy[0];
        if (loaded) return "LOADED " + (play ? "play disabled" : "no play button");
        const button = [...document.querySelectorAll("button")].find((item) => (item.textContent || "").includes("Load local August"));
        return (button ? "IDLE" : "OTHER") + " " + text.slice(0, 220);
      })()`);
      if (dayStatus === "READY") break;
      if (typeof dayStatus === "string" && dayStatus.startsWith("ERROR")) throw new Error(`august day: ${dayStatus}`);
      if (typeof dayStatus === "string" && dayStatus.startsWith("IDLE") && Date.now() - lastDayClick > 20000) {
        await evaluate(cdp, `(() => {
          const button = [...document.querySelectorAll("button")].find((item) => item.innerText.includes("Load local August"));
          button?.click();
          return true;
        })()`);
        lastDayClick = Date.now();
        console.log(`august day retry: ${dayStatus}`);
      } else if ((Date.now() - dayStarted) % 10000 < 700) {
        console.log(`august day: ${dayStatus}`);
        if (notes.length) console.log(`page notes: ${notes.slice(-3).join(" | ")}`);
      }
      await delay(500);
    }
    cdp.handler = null;
    if (dayStatus !== "READY") throw new Error(`august day timed out. Last status: ${dayStatus}`);
    await evaluate(cdp, `(() => {
      const select = [...document.querySelectorAll("select")].find((node) => [...node.options].some((option) => option.value === "4"));
      if (!select) return "no speed select";
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(select, "4");
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.value;
    })()`);
    await delay(400);

    const timeline = JSON.parse(await readFile(join(root, "scripts", "video", "v3", "timeline.json"), "utf8"));
    const length = (id) => {
      const scene = timeline.scenes.find((item) => item.id === id);
      return scene.end - scene.start;
    };

    beats.push(await recordBeat(cdp, "explore", length("explore"), async () => {
      const collapsed = await evaluate(cdp, `[...document.querySelectorAll("button")].some((button) => button.getAttribute("aria-label") === "Expand panel")`);
      if (collapsed) {
        await clickFinder(cdp, rectFinder(`[...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Expand panel")`));
        await delay(1400);
      }
      await clickFinder(cdp, rectFinder(`[...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Collapse panel")`));
      await delay(500);
      await clickFinder(cdp, rectFinder(`[...document.querySelectorAll("button")].find((button) => (button.innerText || "").includes("Play"))`));
      const map = await pointOf(cdp, rectFinder(`document.querySelector("[data-tour=map]")`));
      await moveTo(cdp, map.x, map.y, 500);
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: map.x, y: map.y, button: "left", clickCount: 1 });
      await moveTo(cdp, map.x - 220, map.y - 40, 900);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cursor.x, y: cursor.y, button: "left", clickCount: 1 });
      await delay(700);
      for (let step = 0; step < 4; step += 1) {
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: cursor.x, y: cursor.y, deltaX: 0, deltaY: -140 });
        await delay(280);
      }
    }));

    beats.push(await recordBeat(cdp, "search", length("search"), async () => {
      await clickFinder(cdp, rectFinder(`document.getElementById("global-search")`));
      await evaluate(cdp, `document.getElementById("global-search")?.focus(); true`);
      await delay(200);
      for (const character of place) {
        await cdp.send("Input.insertText", { text: character });
        await delay(170);
      }
      const typed = await evaluate(cdp, `document.getElementById("global-search")?.value || ""`);
      if (typed !== place) {
        await evaluate(cdp, `(() => {
          const input = document.getElementById("global-search");
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          setter.call(input, "");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()`);
        for (const character of place) {
          await evaluate(cdp, `(() => {
            const input = document.getElementById("global-search");
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
            setter.call(input, input.value + ${JSON.stringify(character)});
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return input.value;
          })()`);
          await delay(170);
        }
      }
      await delay(700);
      const choice = await evaluate(cdp, `(() => {
        const option = ${islandOptionFinder(placeTitle, place)};
        return option?.querySelector("span")?.textContent?.trim() || "missing";
      })()`);
      console.log(`search choice: ${choice}`);
      if (choice === "missing") throw new Error(`Search did not offer ${placeTitle}.`);
      await clickFinder(cdp, rectFinder(islandOptionFinder(placeTitle, place)));
      await delay(900);
    }));

    beats.push(await recordBeat(cdp, "connections", length("connections"), async () => {
      await clickFinder(cdp, rectFinder(`document.querySelector("[data-tour=nav-network]")`));
      await waitFor(cdp, `[...document.querySelectorAll("h1")].some((node) => node.textContent.trim() === "Network") ? true : "opening network"`, 30000, "network");
      await delay(450);
      const collapsed = await evaluate(cdp, `[...document.querySelectorAll("button")].some((button) => button.getAttribute("aria-label") === "Expand panel")`);
      if (collapsed) {
        await clickFinder(cdp, rectFinder(`[...document.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "Expand panel")`));
        await delay(450);
      }
      const scope = await pointOf(cdp, rectFinder(`[...document.querySelectorAll("select")].find((node) => [...node.options].some((option) => option.value === "month"))`));
      await clickAt(cdp, scope.x, scope.y);
      const selected = await evaluate(cdp, selectSetter("month"));
      console.log(`scope: ${selected}`);
      if (selected === "missing") throw new Error("The observation window select was not on the page.");
      await waitFor(
        cdp,
        `(() => {
          const text = document.body.innerText;
          if (/not in data\\/derived|Could not/i.test(text)) return text.slice(0, 240);
          if (${connectionFinder(place, journeys)}) return true;
          if (/Reading the August/i.test(text)) return "reading summary";
          const heading = [...document.querySelectorAll("h1")].some((node) => node.textContent.trim() === "Network");
          return heading ? "waiting for connections" : "still on another page";
        })()`,
        90000,
        "month summary",
      );
      await delay(700);
      await clickFinder(cdp, rectFinder(connectionFinder(place, journeys)));
    }));

    beats.push(await recordBeat(cdp, "frequency", length("frequency"), async () => {
      await clickFinder(cdp, rectFinder(`[...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "Frequency")`));
      await delay(900);
      await evaluate(cdp, `document.querySelector("[data-tour=network-report] h2")?.scrollIntoView({ block: "start" }); true`);
      await delay(1200);
      await clickFinder(cdp, rectFinder(`[...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "Export CSV")`));
    }));

    beats.push(await recordBeat(cdp, "patterns", length("patterns"), async () => {
      await clickFinder(cdp, rectFinder(`[...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "Find opportunities")`));
      await delay(800);
      await clickFinder(cdp, rectFinder(`(() => {
        const cards = [...document.querySelectorAll("button")].filter((button) => /journeys/.test(button.innerText) && button.innerText.includes("→"));
        return cards.find((button) => !/vihamanaafushi|funadhoo/i.test(button.innerText) && /[A-Za-z]{5,}/.test(button.innerText))
          || cards.find((button) => !/vihamanaafushi|funadhoo/i.test(button.innerText))
          || null;
      })()`));
    }));

    const manifest = {
      place,
      journeys,
      beats,
      capturedAt: new Date().toISOString(),
    };
    await writeFile(join(captureRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify(manifest, null, 2));
    return manifest;
  } finally {
    chrome.kill();
    if (server.child) server.child.kill();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  captureJourney().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}

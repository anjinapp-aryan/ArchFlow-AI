import {
  exportVideo,
  pickCodec,
  recordRealtime,
  webCodecsAvailable,
  type VideoFormat,
} from "./export.ts";
import {
  callPairs,
  detectKind,
  eventTimes,
  prepare,
  type Issue,
  type Prepared,
  type SourceKind,
  type UserScenarioOptions,
} from "./pipeline.ts";
import { Player } from "./player.ts";
import { SAMPLES } from "./samples.ts";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const HINTS: Record<SourceKind, string> = {
  text: "One link per line: “User -> API Gateway -> Orders : POST /orders”. Use “,” for fan-out, “..>” for async, “fail: A -> B timeout retries 1”. Plain sentences work too.",
  mermaid: "Paste a Mermaid flowchart (graph/flowchart) or sequenceDiagram.",
  drawio: "Paste draw.io XML or open a .drawio file (compressed files are fine).",
  plantuml: "Paste a PlantUML component/deployment or sequence diagram (@startuml … @enduml).",
  json: "An ArchFlow canonical document (archflow/canonical@1).",
};

const ui = {
  source: $<HTMLTextAreaElement>("source"),
  hint: $<HTMLParagraphElement>("hint"),
  drop: $<HTMLDivElement>("drop"),
  examples: $<HTMLSelectElement>("examples"),
  animate: $<HTMLButtonElement>("animate"),
  file: $<HTMLInputElement>("file"),
  origin: $<HTMLParagraphElement>("origin"),
  scenario: $<HTMLDivElement>("scenario-controls"),
  entry: $<HTMLSelectElement>("entry"),
  failPair: $<HTMLSelectElement>("fail-pair"),
  failMode: $<HTMLSelectElement>("fail-mode"),
  failRetries: $<HTMLInputElement>("fail-retries"),
  regenerate: $<HTMLInputElement>("regenerate"),
  apply: $<HTMLButtonElement>("apply"),
  issues: $<HTMLUListElement>("issues"),
  issueCount: $<HTMLSpanElement>("issue-count"),
  canvas: $<HTMLCanvasElement>("canvas"),
  placeholder: $<HTMLParagraphElement>("placeholder"),
  prev: $<HTMLButtonElement>("prev"),
  back: $<HTMLButtonElement>("back"),
  play: $<HTMLButtonElement>("play"),
  fwd: $<HTMLButtonElement>("fwd"),
  next: $<HTMLButtonElement>("next"),
  seek: $<HTMLInputElement>("seek"),
  time: $<HTMLSpanElement>("time"),
  speed: $<HTMLSelectElement>("speed"),
  loop: $<HTMLInputElement>("loop"),
  format: $<HTMLSelectElement>("format"),
  size: $<HTMLSelectElement>("size"),
  fps: $<HTMLSelectElement>("fps"),
  export: $<HTMLButtonElement>("export"),
  cancel: $<HTMLButtonElement>("cancel"),
  downloadJson: $<HTMLButtonElement>("download-json"),
  progress: $<HTMLProgressElement>("progress"),
  exportMsg: $<HTMLParagraphElement>("export-msg"),
};

let kind: SourceKind = "text";
let current: Prepared | undefined;
let times: number[] = [0];
let player: Player | undefined;
let exporting: AbortController | undefined;

function setKind(k: SourceKind): void {
  kind = k;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tabs button"))
    b.setAttribute("aria-selected", String(b.dataset["kind"] === k));
  ui.hint.textContent = HINTS[k];
}

function showIssues(issues: Issue[]): void {
  ui.issues.replaceChildren(
    ...issues.map((i) => {
      const li = document.createElement("li");
      li.className = i.level;
      const code = document.createElement("code");
      code.textContent = ` ${i.code}${i.source ? ` · ${i.source}` : ""}`;
      li.append(document.createTextNode(i.message), code);
      return li;
    }),
  );
  const errors = issues.filter((i) => i.level === "error").length;
  ui.issueCount.textContent = issues.length
    ? `${errors} error(s), ${issues.length - errors} note(s)`
    : "none";
}

function fillScenarioControls(p: Prepared, keep?: UserScenarioOptions): void {
  const nodes = p.diagram.diagram.nodes;
  ui.entry.replaceChildren(
    new Option("automatic", ""),
    ...nodes.map((n) => new Option(n.label, n.id)),
  );
  ui.failPair.replaceChildren(
    new Option("no failure", ""),
    ...callPairs(p.diagram).map((c) => new Option(c.label, `${c.from}>${c.to}`)),
  );
  ui.entry.value = keep?.entry ?? "";
  const f = keep?.failure ?? p.sourceOptions.failures?.[0];
  if (f) {
    const id = (ref: string) =>
      nodes.find((n) => n.id === ref || n.label.toLowerCase() === ref.toLowerCase())?.id ?? ref;
    ui.failPair.value = `${id(f.from)}>${id(f.to)}`;
    ui.failMode.value = f.mode ?? "timeout";
    ui.failRetries.value = String(f.retries ?? 1);
  }
  ui.scenario.hidden = false;
  ui.regenerate.parentElement!.hidden = !(p.diagram.scenario?.events.length ?? 0);
  ui.origin.textContent =
    p.scenarioOrigin === "generated"
      ? `Scenario generated from the diagram: ${p.document.scenario!.events.length} events, ${(p.document.scenario!.durationMs / 1000).toFixed(1)} s.`
      : `Scenario taken from the source: ${p.document.scenario!.events.length} events, ${(p.document.scenario!.durationMs / 1000).toFixed(1)} s.`;
}

function userOptions(): UserScenarioOptions {
  const o: UserScenarioOptions = {};
  if (ui.entry.value) o.entry = ui.entry.value;
  if (ui.failPair.value) {
    const [from, to] = ui.failPair.value.split(">") as [string, string];
    o.failure = {
      from,
      to,
      mode: ui.failMode.value as "timeout" | "error",
      retries: Math.max(1, Math.min(9, Number(ui.failRetries.value) || 1)),
    };
  }
  if (ui.regenerate.checked) o.regenerate = true;
  return o;
}

async function run(options: UserScenarioOptions | undefined, keepControls: boolean): Promise<void> {
  if (!player) return;
  ui.animate.disabled = true;
  try {
    const r = await prepare(kind, ui.source.value, options ?? {});
    showIssues(r.issues);
    if (!r.ok) {
      ui.origin.textContent = "Fix the errors below, then animate again.";
      return;
    }
    const loaded = player.load(r.engineJson);
    if (!loaded.ok) {
      showIssues([...r.issues, { level: "error", code: "engine.load", message: loaded.error }]);
      return;
    }
    current = r;
    times = eventTimes(r.document);
    ui.placeholder.hidden = true;
    fillScenarioControls(r, keepControls ? options : (options ?? undefined));
    ui.seek.max = String(player.durationMs);
    player.loop = ui.loop.checked;
    player.speed = Number(ui.speed.value);
    player.play();
  } finally {
    ui.animate.disabled = false;
  }
}

function updateTransport(): void {
  if (!player) return;
  const t = player.time;
  if (document.activeElement !== ui.seek) ui.seek.value = String(t);
  ui.time.textContent = `${(t / 1000).toFixed(1)} / ${(player.durationMs / 1000).toFixed(1)} s`;
  ui.play.textContent = player.isPlaying ? "⏸" : "▶";
  ui.play.setAttribute("aria-label", player.isPlaying ? "Pause" : "Play");
}

function jumpEvent(dir: 1 | -1): void {
  if (!player) return;
  const t = player.time;
  const target =
    dir > 0 ? times.find((x) => x > t + 1) : [...times].reverse().find((x) => x < t - 1);
  player.pause();
  player.seek(target ?? (dir > 0 ? player.durationMs : 0));
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const fileBase = (): string =>
  (current?.document.diagram.name ?? "archflow")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "archflow";

async function doExport(): Promise<void> {
  if (!player || !current) {
    ui.exportMsg.textContent = "Animate a diagram first.";
    return;
  }
  const [w, h] = ui.size.value.split("x").map(Number) as [number, number];
  const fps = Number(ui.fps.value);
  const format = ui.format.value as VideoFormat;
  exporting = new AbortController();
  ui.export.disabled = true;
  ui.cancel.hidden = false;
  ui.progress.hidden = false;
  ui.progress.value = 0;
  const wasPlaying = player.isPlaying;
  player.pause();
  const t0 = performance.now();
  try {
    let blob: Blob;
    if (webCodecsAvailable()) {
      ui.exportMsg.textContent = "Rendering…";
      blob = await exportVideo({
        engine: player.engine,
        text: player.text,
        format,
        width: w,
        height: h,
        fps,
        signal: exporting.signal,
        onProgress: (d, n) => {
          ui.progress.value = d / n;
          ui.exportMsg.textContent = `Rendering frame ${d} of ${n}…`;
        },
      });
    } else {
      ui.exportMsg.textContent =
        "This browser has no video encoder; recording in real time (WebM)…";
      blob = await recordRealtime(
        ui.canvas,
        player.durationMs,
        () => {
          player!.loop = false;
          player!.seek(0);
          player!.play();
        },
        exporting.signal,
      );
    }
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    download(blob, `${fileBase()}.${ext}`);
    ui.exportMsg.textContent = `Saved ${fileBase()}.${ext} (${(blob.size / 1_048_576).toFixed(1)} MB) in ${((performance.now() - t0) / 1000).toFixed(1)} s.`;
  } catch (e) {
    ui.exportMsg.textContent =
      (e as Error).name === "AbortError"
        ? "Export cancelled."
        : `Export failed: ${(e as Error).message}`;
  } finally {
    exporting = undefined;
    ui.export.disabled = false;
    ui.cancel.hidden = true;
    ui.progress.hidden = true;
    player.loop = ui.loop.checked;
    if (wasPlaying) player.play();
  }
}

async function refreshFormats(): Promise<void> {
  const [w, h] = ui.size.value.split("x").map(Number) as [number, number];
  const fps = Number(ui.fps.value);
  for (const opt of ui.format.options) {
    const ok = webCodecsAvailable()
      ? (await pickCodec(opt.value as VideoFormat, w, h, fps)) !== undefined
      : opt.value === "webm";
    opt.disabled = !ok;
    opt.textContent =
      opt.textContent!.replace(/ — not supported here$/, "") + (ok ? "" : " — not supported here");
  }
  if (ui.format.selectedOptions[0]?.disabled) ui.format.value = "webm";
}

function wire(): void {
  for (const s of SAMPLES) ui.examples.append(new Option(s.title, s.id));
  ui.examples.addEventListener("change", () => {
    const s = SAMPLES.find((x) => x.id === ui.examples.value);
    if (!s) return;
    setKind(s.kind);
    ui.source.value = s.text;
    ui.regenerate.checked = false;
    void run(s.options, false);
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tabs button"))
    b.addEventListener("click", () => setKind(b.dataset["kind"] as SourceKind));
  ui.animate.addEventListener("click", () => void run(undefined, false));
  ui.apply.addEventListener("click", () => void run(userOptions(), true));
  const loadFile = async (f: File): Promise<void> => {
    if (f.size > 4_000_000) {
      showIssues([
        { level: "error", code: "file.too_large", message: "Files above 4 MB are not accepted." },
      ]);
      return;
    }
    const text = await f.text();
    ui.source.value = text;
    setKind(detectKind(text, f.name));
    await run(undefined, false);
  };
  ui.file.addEventListener("change", () => {
    const f = ui.file.files?.[0];
    if (f) void loadFile(f);
    ui.file.value = "";
  });
  ui.drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    ui.drop.classList.add("over");
  });
  ui.drop.addEventListener("dragleave", () => ui.drop.classList.remove("over"));
  ui.drop.addEventListener("drop", (e) => {
    e.preventDefault();
    ui.drop.classList.remove("over");
    const f = e.dataTransfer?.files[0];
    if (f) void loadFile(f);
  });
  ui.source.addEventListener("paste", () =>
    setTimeout(() => {
      const k = detectKind(ui.source.value);
      if (k !== "text") setKind(k);
    }, 0),
  );

  ui.play.addEventListener("click", () => player?.toggle());
  ui.back.addEventListener("click", () => player?.step(-1000 / 30));
  ui.fwd.addEventListener("click", () => player?.step(1000 / 30));
  ui.prev.addEventListener("click", () => jumpEvent(-1));
  ui.next.addEventListener("click", () => jumpEvent(1));
  ui.seek.addEventListener("input", () => {
    player?.pause();
    player?.seek(Number(ui.seek.value));
  });
  ui.speed.addEventListener("change", () => player && (player.speed = Number(ui.speed.value)));
  ui.loop.addEventListener("change", () => player && (player.loop = ui.loop.checked));
  ui.canvas.addEventListener("click", () => player?.toggle());
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (!player || target.closest("textarea, input, select") || e.ctrlKey || e.metaKey || e.altKey)
      return;
    let handled = true;
    switch (e.key) {
      case " ":
        player.toggle();
        break;
      case "ArrowRight":
        if (e.shiftKey) jumpEvent(1);
        else player.step(1000);
        break;
      case "ArrowLeft":
        if (e.shiftKey) jumpEvent(-1);
        else player.step(-1000);
        break;
      case ".":
        player.step(1000 / 30);
        break;
      case ",":
        player.step(-1000 / 30);
        break;
      case "Home":
        player.pause();
        player.seek(0);
        break;
      case "End":
        player.pause();
        player.seek(player.durationMs);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  });

  ui.export.addEventListener("click", () => void doExport());
  ui.cancel.addEventListener("click", () => exporting?.abort());
  ui.size.addEventListener("change", () => void refreshFormats());
  ui.fps.addEventListener("change", () => void refreshFormats());
  ui.downloadJson.addEventListener("click", () => {
    if (!current) return;
    download(
      new Blob([JSON.stringify(current.document, null, 2) + "\n"], { type: "application/json" }),
      `${fileBase()}.archflow.json`,
    );
  });
}

async function main(): Promise<void> {
  setKind("text");
  wire();
  try {
    player = await Player.create(ui.canvas);
    player.onChange = updateTransport;
  } catch (e) {
    showIssues([{ level: "error", code: "app.engine", message: (e as Error).message }]);
    ui.animate.disabled = true;
    return;
  }
  void refreshFormats();
  // start with the benchmark so the page is never empty
  const first = SAMPLES[0]!;
  ui.examples.value = first.id;
  ui.source.value = first.text;
  setKind(first.kind);
  await run(first.options, false);
  player.pause();
  player.seek(0);
}

void main();

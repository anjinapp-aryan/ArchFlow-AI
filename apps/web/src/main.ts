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
  restyled,
  type RenderStyle,
  type Issue,
  type Prepared,
  type SourceKind,
  type UserScenarioOptions,
} from "./pipeline.ts";
import { edgePath, isThemeId, type CameraPlan, type ThemeId } from "@archflow/renderer-adapter";
import { describeIssue, summarizeIssues } from "./diagnostics.ts";
import { locateIssue, type IssueLocation } from "./locate.ts";
import type { CanonicalDocument } from "@archflow/canonical-model";
import { Player } from "./player.ts";
import { SAMPLES, type Sample } from "./samples.ts";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const HINTS: Record<SourceKind, string> = {
  text: "One link per line: “User -> API Gateway -> Orders : POST /orders”. Use “,” for fan-out, “..>” for async, “fail: A -> B timeout retries 1”, “monitor: LB -> Service : GET /health” for health checks, “request: GET /api/orders” for the request a router matches. Plain sentences work too.",
  mermaid: "Paste a Mermaid flowchart (graph/flowchart) or sequenceDiagram.",
  drawio: "Paste draw.io XML or open a .drawio file (compressed files are fine).",
  plantuml: "Paste a PlantUML component/deployment or sequence diagram (@startuml … @enduml).",
  json: "An ArchFlow canonical document (archflow/canonical@1).",
};
const KIND_NAME: Record<SourceKind, string> = {
  text: "Description",
  mermaid: "Mermaid",
  drawio: "draw.io",
  plantuml: "PlantUML",
  json: "ArchFlow JSON",
};

const ui = {
  source: $<HTMLTextAreaElement>("source"),
  hint: $<HTMLParagraphElement>("hint"),
  drop: $<HTMLDivElement>("drop"),
  examples: $<HTMLSelectElement>("examples"),
  animate: $<HTMLButtonElement>("animate"),
  file: $<HTMLInputElement>("file"),
  validity: $<HTMLSpanElement>("validity"),
  origin: $<HTMLParagraphElement>("origin"),
  scenario: $<HTMLDivElement>("scenario-controls"),
  entry: $<HTMLSelectElement>("entry"),
  failPair: $<HTMLSelectElement>("fail-pair"),
  failMode: $<HTMLSelectElement>("fail-mode"),
  failRetries: $<HTMLInputElement>("fail-retries"),
  regenerate: $<HTMLInputElement>("regenerate"),
  apply: $<HTMLButtonElement>("apply"),
  issues: $<HTMLUListElement>("issues"),
  issueCount: $<HTMLParagraphElement>("issue-count"),
  diagBadge: $<HTMLSpanElement>("diag-badge"),
  stage: $<HTMLElement>("stage"),
  canvas: $<HTMLCanvasElement>("canvas"),
  viewChip: $<HTMLDivElement>("view-chip"),
  backOverview: $<HTMLButtonElement>("back-overview"),
  gutter: $<HTMLDivElement>("gutter"),
  bands: $<HTMLDivElement>("bands"),
  presentTitle: $<HTMLDivElement>("present-title"),
  zoomIn: $<HTMLButtonElement>("zoom-in"),
  zoomOut: $<HTMLButtonElement>("zoom-out"),
  zoomFit: $<HTMLButtonElement>("zoom-fit"),
  autoCamera: $<HTMLInputElement>("auto-camera"),
  viewMenu: $<HTMLButtonElement>("view-menu"),
  viewAnnounce: $<HTMLDivElement>("view-announce"),
  viewPop: $<HTMLDivElement>("view-pop"),
  theme: $<HTMLSelectElement>("theme"),
  dim: $<HTMLInputElement>("dim"),
  fullscreen: $<HTMLButtonElement>("fullscreen"),
  present: $<HTMLButtonElement>("present"),
  exitPresent: $<HTMLButtonElement>("exit-present"),
  placeholder: $<HTMLDivElement>("placeholder"),
  placeholderText: $<HTMLSpanElement>("placeholder-text"),
  busy: $<HTMLDivElement>("busy"),
  start: $<HTMLButtonElement>("start"),
  prev: $<HTMLButtonElement>("prev"),
  back: $<HTMLButtonElement>("back"),
  play: $<HTMLButtonElement>("play"),
  playIcon: document.getElementById("play-icon") as unknown as SVGUseElement,
  fwd: $<HTMLButtonElement>("fwd"),
  next: $<HTMLButtonElement>("next"),
  end: $<HTMLButtonElement>("end"),
  seek: $<HTMLInputElement>("seek"),
  ticks: $<HTMLDivElement>("ticks"),
  time: $<HTMLSpanElement>("time"),
  speed: $<HTMLSelectElement>("speed"),
  loop: $<HTMLInputElement>("loop"),
  openExport: $<HTMLButtonElement>("open-export"),
  openExportLabel: $<HTMLSpanElement>("open-export-label"),
  exportDialog: $<HTMLDialogElement>("export-dialog"),
  exportInfo: $<HTMLDListElement>("export-info"),
  format: $<HTMLSelectElement>("format"),
  size: $<HTMLSelectElement>("size"),
  fps: $<HTMLSelectElement>("fps"),
  export: $<HTMLButtonElement>("export"),
  cancel: $<HTMLButtonElement>("cancel"),
  downloadJson: $<HTMLButtonElement>("download-json"),
  progress: $<HTMLProgressElement>("progress"),
  exportMsg: $<HTMLParagraphElement>("export-msg"),
  docTitle: $<HTMLSpanElement>("doc-title"),
  docMeta: $<HTMLSpanElement>("doc-meta"),
  toggleSidebar: $<HTMLButtonElement>("toggle-sidebar"),
  resizer: $<HTMLDivElement>("resizer"),
  sidebar: $<HTMLElement>("sidebar"),
  workspaceTheme: $<HTMLButtonElement>("workspace-theme"),
  workspaceThemeLabel: $<HTMLSpanElement>("workspace-theme-label"),
  openShortcuts: $<HTMLButtonElement>("open-shortcuts"),
  shortcuts: $<HTMLDialogElement>("shortcuts-dialog"),
  openExamples: $<HTMLButtonElement>("open-examples"),
  welcome: $<HTMLDivElement>("welcome"),
  welcomeStart: $<HTMLDivElement>("welcome-start"),
  welcomeGallery: $<HTMLDivElement>("welcome-gallery"),
  welcomeClose: $<HTMLButtonElement>("welcome-close"),
  welcomeWatch: $<HTMLButtonElement>("welcome-watch"),
  gallery: $<HTMLUListElement>("gallery"),
  startDescribe: $<HTMLButtonElement>("start-describe"),
  startImport: $<HTMLButtonElement>("start-import"),
  startExamples: $<HTMLButtonElement>("start-examples"),
};

let kind: SourceKind = "text";
let current: Prepared | undefined;
let times: number[] = [0];
let player: Player | undefined;
let exporting: AbortController | undefined;
let lastVideoUrl: string | undefined;

// --- small helpers --------------------------------------------------------------------------

/** Per-viewer preferences; storage can be unavailable (private windows): never required. */
const prefs = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`archflow.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`archflow.${key}`, value);
    } catch {
      /* not persisted */
    }
  },
};

const SVG = "http://www.w3.org/2000/svg";
function icon(name: string): SVGSVGElement {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("class", "i");
  s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS(SVG, "use");
  u.setAttribute("href", `#i-${name}`);
  s.append(u);
  return s;
}
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}`;

// --- source format and sidebar tabs ---------------------------------------------------------

function setKind(k: SourceKind): void {
  kind = k;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".seg button"))
    b.setAttribute("aria-pressed", String(b.dataset["kind"] === k));
  ui.hint.textContent = HINTS[k];
}

type SideTab = "diagram" | "scenario" | "diagnostics";
function selectSideTab(name: SideTab, focus = false): void {
  for (const t of ["diagram", "scenario", "diagnostics"] as const) {
    const tab = $<HTMLButtonElement>(`side-tab-${t}`);
    const on = t === name;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`pane-${t}`).hidden = !on;
    if (on && focus) tab.focus();
  }
  if (document.body.classList.contains("side-collapsed")) setSidebar(true);
}

/** Arrow keys move between the tabs of a tablist (WAI-ARIA tabs pattern). */
function rovingTabs(list: HTMLElement, activate: (tab: HTMLButtonElement) => void): void {
  list.addEventListener("keydown", (e) => {
    const tabs = [...list.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const j =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    tabs[j]!.focus();
    activate(tabs[j]!);
  });
}

// --- diagnostics ----------------------------------------------------------------------------

/**
 * Show diagnostics. `doc` is the document the messages are about (when it was animated): its
 * components and connectors can then be highlighted on the canvas.
 */
function showIssues(issues: Issue[], doc?: CanonicalDocument): void {
  const lines = new Map<number, Issue["level"]>();
  ui.issues.replaceChildren(
    ...issues.map((i) => {
      const d = describeIssue(i);
      const loc = locateIssue(i, doc, ui.source.value);
      if (loc.line && (i.level !== "info" || !lines.has(loc.line)))
        lines.set(loc.line, lines.get(loc.line) === "error" ? "error" : i.level);
      const li = el("li", i.level);
      li.append(icon(i.level === "error" ? "error" : i.level === "warning" ? "warning" : "info"));
      const head = el("div", "issue-head");
      head.append(el("span", "sev", d.severity), el("span", "issue-title", d.title));
      const body = el("p", "issue-body", d.body);
      const acts = el("div", "issue-actions");
      if (doc && (loc.nodes.length || loc.edges.length)) {
        const b = el("button", "link", "Show on diagram");
        b.type = "button";
        b.dataset["action"] = "show";
        b.addEventListener("click", () => focusIssue(loc, doc, d.title));
        acts.append(b);
      }
      if (loc.line) {
        const b = el("button", "link", `Go to line ${loc.line}`);
        b.type = "button";
        b.dataset["action"] = "line";
        b.addEventListener("click", () => goToLine(loc.line!));
        acts.append(b);
      }
      if (!acts.childElementCount && loc.reason && doc)
        acts.append(el("span", "issue-nomap", loc.reason));
      const det = el("details");
      det.append(el("summary", undefined, "Technical details"), el("code", undefined, d.technical));
      li.append(head, body, ...(acts.childElementCount ? [acts] : []), det);
      return li;
    }),
  );
  markLines(lines);
  const s = summarizeIssues(issues);
  ui.issueCount.replaceChildren(
    icon(s.status === "error" ? "error" : s.status === "warning" ? "warning" : "ok"),
    document.createTextNode(s.text),
  );
  ui.issueCount.className = `diag-status ${s.status}`;
  const n = s.errors + s.warnings;
  ui.diagBadge.hidden = issues.length === 0;
  ui.diagBadge.textContent = String(n || issues.length);
  ui.diagBadge.className = `count ${s.errors ? "error" : s.warnings ? "warning" : ""}`;
  ui.diagBadge.title = s.text;
  // the same status under the editor, with a way to the details
  const first = issues.find((i) => i.level === "error");
  const label = first ? `Cannot animate: ${describeIssue(first).title}` : s.text;
  const link = el("button", "link", issues.length ? "Details" : "");
  link.type = "button";
  link.addEventListener("click", () => selectSideTab("diagnostics", true));
  ui.validity.replaceChildren(
    icon(s.status === "error" ? "error" : s.status === "warning" ? "warning" : "ok"),
    el("span", undefined, label),
    ...(issues.length ? [link] : []),
  );
  ui.validity.className = `validity ${s.status}`;
}

// --- scenario -------------------------------------------------------------------------------

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
  syncFailureFields();
  ui.scenario.hidden = false;
  ui.regenerate.parentElement!.hidden = !(p.diagram.scenario?.events.length ?? 0);
  const ev = p.document.scenario!.events.length;
  const dur = secs(p.document.scenario!.durationMs);
  ui.origin.textContent =
    p.scenarioOrigin === "generated"
      ? `Generated from the diagram: ${ev} events, ${dur} s. Change the start or inject a failure, then apply.`
      : `Taken from the source: ${ev} events, ${dur} s. Tick “Generate from the diagram” to replace it.`;
}

function syncFailureFields(): void {
  const off = !ui.failPair.value;
  ui.failMode.disabled = off;
  ui.failRetries.disabled = off;
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

// --- running the pipeline -------------------------------------------------------------------

async function run(options: UserScenarioOptions | undefined, keepControls: boolean): Promise<void> {
  if (!player) return;
  ui.animate.disabled = true;
  ui.apply.disabled = true;
  const busy = setTimeout(() => (ui.busy.hidden = false), 150);
  try {
    const r = await prepare(kind, ui.source.value, options ?? {}, player.measureTitle, style());
    showIssues(r.issues, r.ok ? r.document : undefined);
    if (!r.ok) {
      ui.origin.textContent = "Fix the errors in Diagnostics, then animate again.";
      setStale(true);
      return;
    }
    const loaded = player.load(r.engineJson);
    if (loaded.ok) player.setCameraDocument(r.document);
    updateZoom();
    if (!loaded.ok) {
      showIssues([...r.issues, { level: "error", code: "engine.load", message: loaded.error }]);
      setStale(true);
      return;
    }
    setStale(false);
    clearFocus(false);
    current = r;
    times = eventTimes(r.document);
    ui.placeholder.hidden = true;
    fillScenarioControls(r, keepControls ? options : (options ?? undefined));
    ui.seek.max = String(player.durationMs);
    drawTicks(r);
    showDocument(r);
    updateExportInfo();
    player.loop = ui.loop.checked;
    player.speed = Number(ui.speed.value);
    // with "reduce motion" the animation waits for the play button instead of starting itself
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) player.play();
  } finally {
    clearTimeout(busy);
    ui.busy.hidden = true;
    ui.animate.disabled = false;
    ui.apply.disabled = false;
  }
}

function showDocument(r: Prepared): void {
  const d = r.document;
  const name = d.diagram.name?.trim() || "Untitled architecture";
  ui.docTitle.textContent = name;
  ui.docTitle.title = name;
  ui.presentTitle.textContent = name;
  document.title = `${name} — ArchFlow AI`;
  ui.docMeta.textContent = `${d.diagram.nodes.length} components · ${secs(d.scenario!.durationMs)} s · ${KIND_NAME[kind]}`;
}

/** Event marks on the timeline; failures in the error colour (and with a title for the reason). */
function drawTicks(r: Prepared): void {
  const dur = r.document.scenario!.durationMs || 1;
  const marks = new Map<number, string | undefined>();
  for (const e of r.document.scenario!.events) {
    const state = String((e as { state?: string }).state);
    const fail =
      e.type === "timeout"
        ? "Timeout"
        : e.type === "node_state" && /down|error|fail/.test(state)
          ? `State: ${state}`
          : undefined;
    marks.set(e.t, marks.get(e.t) ?? fail);
  }
  ui.ticks.replaceChildren(
    ...[...marks].map(([t, fail]) => {
      const s = el("span", fail ? "fail" : undefined);
      s.style.left = `${(t / dur) * 100}%`;
      if (fail) s.title = `${fail} at ${(t / 1000).toFixed(1)} s`;
      return s;
    }),
  );
}

const style = (): RenderStyle => ({
  theme: isThemeId(ui.theme.value) ? (ui.theme.value as ThemeId) : "default",
  dimInactive: ui.dim.checked,
});

/** Switch theme or dimming of the current animation, keeping its position and play state. */
function applyStyle(): void {
  if (!player || !current) return;
  const r = restyled(current.document, style(), player.measureTitle);
  if (!r.ok) {
    showIssues([...current.issues, ...r.issues], current.document);
    return;
  }
  const at = player.time;
  const playing = player.isPlaying;
  const loaded = player.load(r.engineJson);
  if (!loaded.ok) {
    showIssues(
      [...current.issues, { level: "error", code: "engine.load", message: loaded.error }],
      current.document,
    );
    return;
  }
  player.setCameraDocument(current.document);
  if (focused) player.setHighlight(focused.highlight);
  player.seek(at);
  if (playing) player.play();
  updateZoom();
}

// --- diagnostic navigation: canvas highlight and source lines ------------------------------

let focused:
  { title: string; highlight: NonNullable<Player["highlight"]>; autoBefore: boolean } | undefined;

/** Highlight what a diagnostic refers to and frame it; "Back to overview" undoes it. */
function focusIssue(loc: IssueLocation, doc: CanonicalDocument, title: string): void {
  if (!player || current?.document !== doc) return;
  const rects = loc.nodes
    .map((id) => doc.diagram.nodes.find((n) => n.id === id))
    .filter((n) => n !== undefined)
    .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  const paths = loc.edges
    .map((id) => doc.diagram.edges.find((e) => e.id === id))
    .filter((e) => e !== undefined)
    .map((e) => edgePath(doc, e).pts);
  const xs = [...rects.flatMap((r) => [r.x, r.x + r.w]), ...paths.flat().map((p) => p.x)];
  const ys = [...rects.flatMap((r) => [r.y, r.y + r.h]), ...paths.flat().map((p) => p.y)];
  if (!xs.length) return;
  const label = (ref: string): string => doc.diagram.nodes.find((x) => x.id === ref)?.label ?? ref;
  const names = [
    ...loc.nodes.map(label),
    ...loc.edges.map((id) => {
      const e = doc.diagram.edges.find((x) => x.id === id)!;
      return `${label(e.from)} → ${label(e.to)}`;
    }),
  ];
  const shown =
    names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
  focused = {
    title: shown || title,
    highlight: { rects, paths },
    autoBefore: focused?.autoBefore ?? player.autoCamera,
  };
  player.setHighlight(focused.highlight);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  player.focusOn({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
  ui.autoCamera.checked = player.autoCamera;
  updateZoom();
  updateExportInfo();
  ui.backOverview.focus({ preventScroll: true });
}

/** Leave the highlighted view: whole diagram, and the automatic camera as it was before. */
function clearFocus(restoreView = true): void {
  if (!focused) return;
  const auto = focused.autoBefore;
  focused = undefined;
  player?.setHighlight(undefined);
  if (restoreView && player) {
    player.resetView();
    setAutoCamera(auto);
  }
  updateZoom();
}

const LINE_PX = 19;
const EDITOR_PAD = 10;
/** Line numbers beside the editor, kept in step with its scroll position. */
function updateGutter(): void {
  // count lines without building an array, and add or remove only the difference
  const v = ui.source.value;
  let n = 1;
  for (let i = v.indexOf("\n"); i !== -1; i = v.indexOf("\n", i + 1)) n++;
  const have = ui.gutter.childElementCount;
  if (have < n) {
    const frag = document.createDocumentFragment();
    for (let i = have + 1; i <= n; i++) frag.append(el("span", undefined, String(i)));
    ui.gutter.append(frag);
  } else while (ui.gutter.childElementCount > n) ui.gutter.lastElementChild!.remove();
  ui.gutter.scrollTop = ui.source.scrollTop;
  ui.bands.style.transform = `translateY(${-ui.source.scrollTop}px)`;
}

/** Marks behind the source lines that diagnostics refer to. */
function markLines(lines: Map<number, Issue["level"]>): void {
  updateGutter();
  ui.bands.replaceChildren(
    ...[...lines].map(([line, level]) => {
      const b = el("span", `band ${level}`);
      b.style.top = `${EDITOR_PAD + (line - 1) * LINE_PX}px`;
      return b;
    }),
  );
  for (const g of ui.gutter.children) g.className = "";
  for (const [line, level] of lines) {
    const g = ui.gutter.children[line - 1];
    if (g) g.className = level;
  }
}

/** Select a source line in the editor and scroll it into view. */
function goToLine(line: number): void {
  selectSideTab("diagram");
  const text = ui.source.value;
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const a = starts[line - 1] ?? text.length;
  const b = (starts[line] ?? text.length + 1) - 1;
  ui.source.focus({ preventScroll: true });
  ui.source.setSelectionRange(a, Math.max(a, b));
  ui.source.scrollTop = Math.max(0, EDITOR_PAD + (line - 1) * LINE_PX - ui.source.clientHeight / 3);
  updateGutter();
}

// --- transport and view ---------------------------------------------------------------------

let lastPlaying: boolean | undefined;
let lastTimeText = "";
/** Called on every animation frame: writes to the DOM only what changed (no layout reads). */
function updateTransport(): void {
  if (!player) return;
  const t = player.time;
  if (document.activeElement !== ui.seek) ui.seek.value = String(t);
  const shown = `${secs(t)} / ${secs(player.durationMs)} s`;
  if (shown !== lastTimeText) {
    lastTimeText = shown;
    ui.time.textContent = shown;
    ui.seek.setAttribute("aria-valuetext", `${secs(t)} of ${secs(player.durationMs)} seconds`);
  }
  if (lastPlaying !== player.isPlaying) {
    lastPlaying = player.isPlaying;
    ui.playIcon.setAttribute("href", player.isPlaying ? "#i-pause" : "#i-play");
    ui.play.setAttribute("aria-label", player.isPlaying ? "Pause" : "Play");
    document.body.classList.toggle("playing", player.isPlaying);
  }
}

/** Canvas size in CSS px, kept by a ResizeObserver (no layout read per frame). */
const canvasSize = { w: 16, h: 9 };
let stale = false;
/** After a failed animate, the canvas still shows the last valid animation: say so. */
function setStale(on: boolean): void {
  stale = on && current !== undefined;
  document.body.classList.toggle("stale", stale);
  ui.source.setAttribute("aria-invalid", String(on));
  updateChip();
}

let chipKey = "";
/**
 * Which view the canvas shows. The automatic camera is the normal state (its switch is in the
 * toolbar), so the chip appears only for the other states: a manual view, the whole diagram,
 * or an animation that is not the current source any more.
 */
function updateChip(): void {
  if (!player?.engine.loaded) return;
  const z = player.zoomLevel;
  let mode: string;
  let text: string;
  if (focused && !stale) {
    mode = "focus";
    text = `Highlighted: ${focused.title}`;
  } else if (stale) {
    mode = "stale";
    text = "Showing the last valid animation · fix the errors to update it";
  } else if (z > 1.001) {
    mode = "manual";
    text = `Manual view · ${Math.round(z * 100)}% · press 0 to fit`;
  } else if (player.autoCamera) {
    const planned = player.cameraPlanFor(canvasSize.w, canvasSize.h);
    mode = "auto";
    text = planned?.enabled ? "" : "Whole diagram · small enough for no camera moves";
  } else {
    mode = "off";
    text = "Whole diagram · auto camera off";
  }
  const key = `${mode}|${text}`;
  if (key === chipKey) return;
  // screen readers hear mode changes only, not every zoom step
  const prevMode = chipKey.split("|")[0];
  chipKey = key;
  if (mode !== prevMode) ui.viewAnnounce.textContent = mode === "manual" ? "Manual view" : text;
  ui.viewChip.className = `view-chip ${mode}`;
  if (text) ui.viewChip.replaceChildren(el("span", "dot"), document.createTextNode(text));
  else ui.viewChip.replaceChildren();
  ui.backOverview.hidden = !focused || stale;
}

function updateZoom(): void {
  const z = player?.zoomLevel ?? 1;
  ui.zoomFit.textContent = z > 1.001 ? `${Math.round(z * 100)}%` : "Fit";
  ui.zoomOut.disabled = z <= 1.001;
  updateChip();
}

function jumpEvent(dir: 1 | -1): void {
  if (!player) return;
  const t = player.time;
  const target =
    dir > 0 ? times.find((x) => x > t + 1) : [...times].reverse().find((x) => x < t - 1);
  player.pause();
  player.seek(target ?? (dir > 0 ? player.durationMs : 0));
}

function toEdge(end: boolean): void {
  if (!player) return;
  player.pause();
  player.seek(end ? player.durationMs : 0);
}

function setAutoCamera(on: boolean): void {
  ui.autoCamera.checked = on;
  if (player) player.autoCamera = on;
  updateZoom();
  updateExportInfo();
}

// --- export ---------------------------------------------------------------------------------

function download(blob: Blob, name: string): string {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  return url;
}

const fileBase = (): string =>
  (current?.document.diagram.name ?? "archflow")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "archflow";

/** Close-ups the automatic camera makes (holds that do not show the overview). */
const zoomStops = (p: CameraPlan): number =>
  p.segments.filter((s) => s.kind !== "move" && !s.overview).length;

function updateExportInfo(): void {
  if (!player || !current) {
    ui.exportInfo.replaceChildren(
      el("dt", undefined, "Animation"),
      el("dd", undefined, "none yet"),
    );
    return;
  }
  const [w, h] = ui.size.value.split("x").map(Number) as [number, number];
  const fps = Number(ui.fps.value);
  const frames = Math.ceil((player.durationMs / 1000) * fps) + 1;
  const plan = player.autoCamera ? player.cameraPlanFor(w, h) : undefined;
  const camera = !player.autoCamera
    ? "Whole diagram (auto camera off; a manual zoom is not exported)"
    : plan?.enabled
      ? `Automatic, as in playback${zoomStops(plan) ? ` (${zoomStops(plan)} close-up${zoomStops(plan) === 1 ? "" : "s"})` : " (stays on the whole diagram)"}`
      : "Whole diagram (small enough for no camera moves)";
  const rows: [string, string][] = [
    ["Duration", `${secs(player.durationMs)} s · ${frames} frames`],
    ["Camera", camera],
    [
      "Style",
      `${ui.theme.selectedOptions[0]?.textContent?.trim() ?? "Default"} theme${ui.dim.checked ? ", inactive components dimmed" : ""}`,
    ],
    [
      "Encoder",
      webCodecsAvailable()
        ? "This browser (WebCodecs), faster than real time"
        : "Real-time recording, WebM only (no WebCodecs here)",
    ],
    ...(ui.format.value === "mp4"
      ? ([
          [
            "Note",
            "MP4 depends on this browser's H.264 encoder; WebM (VP9) is the dependable default.",
          ],
        ] as [string, string][])
      : []),
    ["File", `${fileBase()}.${ui.format.value === "mp4" ? "mp4" : "webm"}`],
  ];
  ui.exportInfo.replaceChildren(
    ...rows.flatMap(([k, v]) => [el("dt", undefined, k), el("dd", undefined, v)]),
  );
}

function openExport(): void {
  updateExportInfo();
  if (!ui.exportDialog.open) ui.exportDialog.showModal();
}

function setExportMsg(
  text: string,
  state: "" | "ok" | "error" = "",
  link?: { href: string; name: string },
): void {
  ui.exportMsg.className = `export-msg ${state}`;
  ui.exportMsg.replaceChildren(document.createTextNode(text));
  if (link) {
    const a = el("a", undefined, "Download again");
    a.href = link.href;
    a.download = link.name;
    ui.exportMsg.append(" ", a);
  }
}

async function doExport(): Promise<void> {
  if (!player || !current) {
    setExportMsg("Animate a diagram first.", "error");
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
  if (lastVideoUrl) URL.revokeObjectURL(lastVideoUrl);
  lastVideoUrl = undefined;
  try {
    let blob: Blob;
    if (webCodecsAvailable()) {
      setExportMsg("Rendering…");
      const camera = player.autoCamera ? player.cameraPlanFor(w, h) : undefined;
      blob = await exportVideo({
        engine: player.engine,
        text: player.text,
        hiddenMarkers: player.hiddenMarkers,
        ...(camera ? { camera } : {}),
        ...(player.summary ? { summary: player.summary } : {}),
        labels: player.labels,
        format,
        width: w,
        height: h,
        fps,
        signal: exporting.signal,
        onProgress: (d, n) => {
          ui.progress.value = d / n;
          setExportMsg(`Rendering frame ${d} of ${n}…`);
          ui.openExportLabel.textContent = `Exporting ${Math.round((d / n) * 100)}%`;
        },
      });
    } else {
      setExportMsg("This browser has no video encoder; recording in real time (WebM)…");
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
    const name = `${fileBase()}.${ext}`;
    lastVideoUrl = download(blob, name);
    setExportMsg(
      `Saved ${name} (${(blob.size / 1_048_576).toFixed(1)} MB, ${w}×${h}, ${fps} fps) in ${((performance.now() - t0) / 1000).toFixed(1)} s.`,
      "ok",
      { href: lastVideoUrl, name },
    );
  } catch (e) {
    if ((e as Error).name === "AbortError") setExportMsg("Export cancelled.");
    else setExportMsg(`Export failed: ${(e as Error).message}`, "error");
  } finally {
    exporting = undefined;
    ui.export.disabled = false;
    ui.cancel.hidden = true;
    ui.progress.hidden = true;
    ui.openExportLabel.textContent = "Export";
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
      opt.textContent!.replace(/ — not supported in this browser$/, "") +
      (ok ? "" : " — not supported in this browser");
  }
  if (ui.format.selectedOptions[0]?.disabled) ui.format.value = "webm";
  updateExportInfo();
}

// --- workspace: sidebar, theme, presentation, welcome ---------------------------------------

const SIDE_MIN = 280;
const SIDE_MAX = 640;
let pendingWidth = 0;
let widthFrame = 0;
function setSidebarWidth(px: number, save = true): void {
  const w = Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, px)));
  // while dragging, one style change per animation frame
  pendingWidth = w;
  if (!save) {
    widthFrame ||= requestAnimationFrame(() => {
      widthFrame = 0;
      document.documentElement.style.setProperty("--side-w", `${pendingWidth}px`);
    });
  } else {
    cancelAnimationFrame(widthFrame);
    widthFrame = 0;
    document.documentElement.style.setProperty("--side-w", `${w}px`);
    prefs.set("sidebarWidth", String(w));
  }
  ui.resizer.setAttribute("aria-valuenow", String(w));
}

function setSidebar(open: boolean): void {
  document.body.classList.toggle("side-collapsed", !open);
  ui.toggleSidebar.setAttribute("aria-expanded", String(open));
  ui.toggleSidebar.title = open ? "Hide the editing panel ([)" : "Show the editing panel ([)";
  prefs.set("sidebar", open ? "open" : "closed");
}

type WorkspaceTheme = "system" | "light" | "dark";
function setWorkspaceTheme(t: WorkspaceTheme): void {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset["theme"] = t;
  const label = `Workspace theme: ${t} (click to change)`;
  ui.workspaceTheme.title = label;
  ui.workspaceThemeLabel.textContent = label;
  ui.workspaceTheme
    .querySelector("use")!
    .setAttribute("href", t === "light" ? "#i-sun" : t === "dark" ? "#i-moon" : "#i-auto");
  prefs.set("workspaceTheme", t);
}

let presentFullscreen = false;
let idleTimer = 0;
const presenting = (): boolean => document.body.classList.contains("presenting");
function wake(): void {
  document.body.classList.remove("idle");
  clearTimeout(idleTimer);
  if (presenting())
    idleTimer = window.setTimeout(() => {
      if (!ui.viewPop.hidden || document.activeElement?.closest(".transport")) return;
      document.body.classList.add("idle");
    }, 2500);
}
async function enterPresentation(): Promise<void> {
  if (presenting()) return;
  closeViewMenu();
  hideWelcome();
  document.body.classList.add("presenting");
  ui.canvas.focus({ preventScroll: true });
  presentFullscreen = false;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
      presentFullscreen = true;
    }
  } catch {
    /* full screen refused (iframe, browser setting): the full-window layout still applies */
  }
  wake();
}
function exitPresentation(): void {
  if (!presenting()) return;
  document.body.classList.remove("presenting", "idle");
  clearTimeout(idleTimer);
  if (presentFullscreen && document.fullscreenElement)
    void document.exitFullscreen().catch(() => {});
  presentFullscreen = false;
  ui.present.focus({ preventScroll: true });
}
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void ui.stage.requestFullscreen?.().catch(() => {});
}

function closeViewMenu(): void {
  ui.viewPop.hidden = true;
  ui.viewMenu.setAttribute("aria-expanded", "false");
}

const welcomeOpen = (): boolean => !ui.welcome.hidden;
let welcomeOpener: HTMLElement | undefined;
function showWelcome(gallery: boolean): void {
  if (ui.welcome.hidden && document.activeElement instanceof HTMLElement)
    welcomeOpener = document.activeElement === document.body ? undefined : document.activeElement;
  ui.welcome.hidden = false;
  ui.welcomeStart.hidden = gallery;
  ui.welcomeGallery.hidden = !gallery;
  ui.welcome
    .querySelector(".welcome-card")!
    .setAttribute("aria-labelledby", gallery ? "gallery-h" : "welcome-h");
  (gallery ? ui.gallery.querySelector("button") : ui.startDescribe)?.focus();
}
function hideWelcome(): void {
  if (ui.welcome.hidden) return;
  const hadFocus = ui.welcome.contains(document.activeElement);
  ui.welcome.hidden = true;
  // return focus to the control that opened the overlay, else to the canvas
  const back =
    welcomeOpener?.isConnected && !welcomeOpener.closest("[hidden]") ? welcomeOpener : ui.canvas;
  welcomeOpener = undefined;
  if (hadFocus) back.focus({ preventScroll: true });
  prefs.set("welcomed", "1");
}

function loadSample(s: Sample): void {
  hideWelcome();
  ui.examples.value = s.id;
  setKind(s.kind);
  ui.source.value = s.text;
  ui.regenerate.checked = false;
  void run(s.options, false);
}

function buildGallery(): void {
  ui.gallery.replaceChildren(
    ...SAMPLES.map((s) => {
      const li = el("li");
      const b = el("button");
      b.type = "button";
      b.dataset["sample"] = s.id;
      b.append(
        el("span", "g-kind", KIND_NAME[s.kind]),
        el("span", "g-title", s.title.replace(/ — [^—]+$/, "")),
        el("span", "g-text", s.blurb),
      );
      b.addEventListener("click", () => loadSample(s));
      li.append(b);
      return li;
    }),
  );
}

// --- wiring ---------------------------------------------------------------------------------

function wire(): void {
  for (const s of SAMPLES) ui.examples.append(new Option(s.title, s.id));
  buildGallery();
  ui.examples.addEventListener("change", () => {
    const s = SAMPLES.find((x) => x.id === ui.examples.value);
    if (s) loadSample(s);
  });
  const seg = document.querySelector<HTMLElement>(".seg")!;
  for (const b of seg.querySelectorAll<HTMLButtonElement>("button"))
    b.addEventListener("click", () => setKind(b.dataset["kind"] as SourceKind));
  const sideTabs = document.querySelector<HTMLElement>(".side-tabs")!;
  for (const t of ["diagram", "scenario", "diagnostics"] as const)
    $(`side-tab-${t}`).addEventListener("click", () => selectSideTab(t));
  rovingTabs(sideTabs, (b) => selectSideTab(b.id.replace("side-tab-", "") as SideTab));

  ui.animate.addEventListener("click", () => {
    hideWelcome();
    void run(undefined, false);
  });
  // editing moves lines: the marks of the last check no longer apply
  ui.source.addEventListener("input", () => {
    if (ui.bands.childElementCount) markLines(new Map());
    else updateGutter();
  });
  ui.source.addEventListener("scroll", updateGutter, { passive: true });
  ui.backOverview.addEventListener("click", () => {
    clearFocus();
    ui.canvas.focus({ preventScroll: true });
  });
  ui.source.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ui.animate.click();
    }
  });
  ui.apply.addEventListener("click", () => void run(userOptions(), true));
  ui.failPair.addEventListener("change", syncFailureFields);
  const loadFile = async (f: File): Promise<void> => {
    hideWelcome();
    if (f.size > 4_000_000) {
      showIssues([
        { level: "error", code: "file.too_large", message: "Files above 4 MB are not accepted." },
      ]);
      return;
    }
    const text = await f.text();
    ui.source.value = text;
    ui.examples.value = "";
    setKind(detectKind(text, f.name));
    selectSideTab("diagram");
    await run(undefined, false);
  };
  ui.file.addEventListener("change", () => {
    const f = ui.file.files?.[0];
    if (f) void loadFile(f);
    ui.file.value = "";
  });
  // a file can be dropped on the editor or anywhere on the canvas
  // (enter/leave fire for every child element: count them so the highlight does not flicker)
  let dragDepth = 0;
  for (const zone of [ui.drop, ui.stage]) {
    zone.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      dragDepth++;
      ui.drop.classList.add("over");
    });
    zone.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    });
    zone.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) ui.drop.classList.remove("over");
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      ui.drop.classList.remove("over");
      const f = e.dataTransfer?.files[0];
      if (f) void loadFile(f);
    });
  }
  ui.source.addEventListener("paste", () =>
    setTimeout(() => {
      const k = detectKind(ui.source.value);
      if (k !== "text") setKind(k);
    }, 0),
  );

  // playback
  ui.play.addEventListener("click", () => player?.toggle());
  ui.back.addEventListener("click", () => player?.step(-1000 / 30));
  ui.fwd.addEventListener("click", () => player?.step(1000 / 30));
  ui.prev.addEventListener("click", () => jumpEvent(-1));
  ui.next.addEventListener("click", () => jumpEvent(1));
  ui.start.addEventListener("click", () => toEdge(false));
  ui.end.addEventListener("click", () => toEdge(true));
  ui.seek.addEventListener("input", () => {
    player?.pause();
    player?.seek(Number(ui.seek.value));
  });
  ui.speed.addEventListener("change", () => player && (player.speed = Number(ui.speed.value)));
  ui.loop.addEventListener("change", () => player && (player.loop = ui.loop.checked));

  // view: zoom (wheel, buttons, + - 0 keys) and pan (drag); a click still plays/pauses
  let drag: { x: number; y: number; moved: boolean } | undefined;
  let suppressClick = false;
  ui.canvas.addEventListener(
    "wheel",
    (e) => {
      if (!player?.engine.loaded) return;
      e.preventDefault();
      player.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.offsetX, e.offsetY);
      updateZoom();
    },
    { passive: false },
  );
  ui.canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    ui.canvas.setPointerCapture(e.pointerId);
  });
  ui.canvas.addEventListener("pointermove", (e) => {
    if (!drag || !player || player.zoomLevel <= 1) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    player.panBy(dx, dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  ui.canvas.addEventListener("pointerup", () => {
    suppressClick = drag?.moved ?? false;
    drag = undefined;
  });
  ui.canvas.addEventListener("dblclick", () => {
    player?.resetView();
    updateZoom();
  });
  ui.zoomIn.addEventListener("click", () => {
    player?.zoomBy(1.4);
    updateZoom();
  });
  ui.zoomOut.addEventListener("click", () => {
    player?.zoomBy(1 / 1.4);
    updateZoom();
  });
  ui.zoomFit.addEventListener("click", () => {
    player?.resetView();
    updateZoom();
  });
  ui.autoCamera.addEventListener("change", () => setAutoCamera(ui.autoCamera.checked));
  ui.theme.addEventListener("change", () => {
    applyStyle();
    updateExportInfo();
  });
  ui.dim.addEventListener("change", () => {
    applyStyle();
    updateExportInfo();
  });
  ui.viewMenu.addEventListener("click", () => {
    const open = ui.viewPop.hidden;
    ui.viewPop.hidden = !open;
    ui.viewMenu.setAttribute("aria-expanded", String(open));
    if (open) ui.theme.focus();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!ui.viewPop.hidden && !(e.target as Element).closest(".menu-wrap")) closeViewMenu();
  });
  ui.viewMenu.closest(".menu-wrap")!.addEventListener("focusout", (e) => {
    const to = (e as FocusEvent).relatedTarget as Node | null;
    if (!ui.viewPop.hidden && to && !ui.viewMenu.closest(".menu-wrap")!.contains(to))
      closeViewMenu();
  });
  ui.canvas.addEventListener("click", () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    player?.toggle();
  });
  ui.fullscreen.addEventListener("click", toggleFullscreen);
  ui.present.addEventListener("click", () => void enterPresentation());
  ui.exitPresent.addEventListener("click", exitPresentation);
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && presenting() && presentFullscreen) exitPresentation();
  });
  for (const ev of ["pointermove", "pointerdown", "keydown"] as const)
    document.addEventListener(ev, () => presenting() && wake(), { passive: true });

  // workspace
  ui.toggleSidebar.addEventListener("click", () =>
    setSidebar(document.body.classList.contains("side-collapsed")),
  );
  ui.resizer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ui.resizer.setPointerCapture(e.pointerId);
    ui.resizer.classList.add("dragging");
    const left = ui.sidebar.getBoundingClientRect().left;
    const move = (m: PointerEvent): void => setSidebarWidth(m.clientX - left, false);
    const up = (u: PointerEvent): void => {
      ui.resizer.classList.remove("dragging");
      ui.resizer.removeEventListener("pointermove", move);
      ui.resizer.removeEventListener("pointerup", up);
      setSidebarWidth(u.clientX - left);
    };
    ui.resizer.addEventListener("pointermove", move);
    ui.resizer.addEventListener("pointerup", up);
  });
  ui.resizer.addEventListener("keydown", (e) => {
    const now = ui.sidebar.getBoundingClientRect().width;
    const to =
      e.key === "ArrowLeft"
        ? now - 20
        : e.key === "ArrowRight"
          ? now + 20
          : e.key === "Home"
            ? SIDE_MIN
            : e.key === "End"
              ? SIDE_MAX
              : undefined;
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    setSidebarWidth(to);
  });
  ui.workspaceTheme.addEventListener("click", () => {
    const order: WorkspaceTheme[] = ["system", "light", "dark"];
    const now = (document.documentElement.dataset["theme"] as WorkspaceTheme) ?? "system";
    setWorkspaceTheme(order[(order.indexOf(now) + 1) % order.length]!);
  });
  ui.openShortcuts.addEventListener("click", () => ui.shortcuts.showModal());

  // first-time experience
  ui.welcomeClose.addEventListener("click", hideWelcome);
  ui.welcomeWatch.addEventListener("click", () => {
    hideWelcome();
    player?.play();
  });
  ui.openExamples.addEventListener("click", () => showWelcome(true));
  ui.startExamples.addEventListener("click", () => showWelcome(true));
  ui.startDescribe.addEventListener("click", () => {
    hideWelcome();
    selectSideTab("diagram");
    setKind("text");
    ui.examples.value = "";
    ui.source.focus();
    ui.source.select();
  });
  ui.startImport.addEventListener("click", () => {
    hideWelcome();
    selectSideTab("diagram");
    ui.file.click();
  });

  // export
  ui.openExport.addEventListener("click", openExport);
  // the exported video is kept in memory only while its "Download again" link is on screen
  ui.exportDialog.addEventListener("close", () => {
    if (!lastVideoUrl || exporting) return;
    URL.revokeObjectURL(lastVideoUrl);
    lastVideoUrl = undefined;
    ui.exportMsg.querySelector("a")?.remove();
  });
  ui.export.addEventListener("click", () => void doExport());
  ui.cancel.addEventListener("click", () => exporting?.abort());
  ui.size.addEventListener("change", () => void refreshFormats());
  ui.fps.addEventListener("change", () => void refreshFormats());
  ui.format.addEventListener("change", updateExportInfo);
  ui.downloadJson.addEventListener("click", () => {
    if (!current) return;
    const url = download(
      new Blob([JSON.stringify(current.document, null, 2) + "\n"], { type: "application/json" }),
      `${fileBase()}.archflow.json`,
    );
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });

  document.addEventListener("keydown", onKey);
}

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector("dialog[open]")) return; // dialogs handle their own keys (Esc)
  const target = e.target as HTMLElement;
  if (e.key === "Escape") {
    if (!ui.viewPop.hidden) {
      closeViewMenu();
      ui.viewMenu.focus();
    } else if (welcomeOpen()) hideWelcome();
    else if (presenting()) exitPresentation();
    else return;
    e.preventDefault();
    return;
  }
  if (target.closest("textarea, input, select")) return;
  // Space and Enter activate a focused button natively
  if ((e.key === " " || e.key === "Enter") && target.closest("button, a, summary, label")) return;
  if (!player) return;
  let handled = true;
  switch (e.key) {
    case " ":
      player.toggle();
      break;
    case "+":
    case "=":
      player.zoomBy(1.4);
      updateZoom();
      break;
    case "-":
      player.zoomBy(1 / 1.4);
      updateZoom();
      break;
    case "0":
      player.resetView();
      updateZoom();
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
      toEdge(false);
      break;
    case "End":
      toEdge(true);
      break;
    case "c":
    case "C":
      setAutoCamera(!ui.autoCamera.checked);
      break;
    case "l":
    case "L":
      ui.loop.checked = !ui.loop.checked;
      player.loop = ui.loop.checked;
      break;
    case "p":
    case "P":
      if (presenting()) exitPresentation();
      else void enterPresentation();
      break;
    case "f":
    case "F":
      toggleFullscreen();
      break;
    case "[":
      setSidebar(document.body.classList.contains("side-collapsed"));
      break;
    case "?":
      ui.shortcuts.showModal();
      break;
    default:
      handled = false;
  }
  if (handled) e.preventDefault();
}

function restorePrefs(): void {
  const t = prefs.get("workspaceTheme");
  setWorkspaceTheme(t === "light" || t === "dark" ? t : "system");
  const w = Number(prefs.get("sidebarWidth"));
  if (w) setSidebarWidth(w, false);
  if (prefs.get("sidebar") === "closed") setSidebar(false);
}

async function main(): Promise<void> {
  restorePrefs();
  setKind("text");
  wire();
  try {
    player = await Player.create(ui.canvas);
    player.onChange = updateTransport;
    new ResizeObserver(([e]) => {
      if (!e) return;
      canvasSize.w = e.contentRect.width || 16;
      canvasSize.h = e.contentRect.height || 9;
      updateChip();
    }).observe(ui.canvas);
    player.onCameraChange = (on) => {
      ui.autoCamera.checked = on;
      updateZoom();
      updateExportInfo();
    };
  } catch (e) {
    showIssues([{ level: "error", code: "app.engine", message: (e as Error).message }]);
    ui.placeholder.classList.add("failed");
    ui.placeholderText.textContent = `The animation engine could not start: ${(e as Error).message}`;
    ui.animate.disabled = true;
    return;
  }
  void refreshFormats();
  // start with the benchmark so the canvas is never empty; first visit: show how to start
  const first = SAMPLES[0]!;
  ui.examples.value = first.id;
  ui.source.value = first.text;
  setKind(first.kind);
  await run(first.options, false);
  player.pause();
  player.seek(0);
  if (!prefs.get("welcomed")) showWelcome(false);
}

void main();

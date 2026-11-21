"use strict";

const $ = (id) => document.getElementById(id);
const palette = [
  "#58e2bf",
  "#f4aa83",
  "#8fb7ff",
  "#e9a3dd",
  "#c9da7d",
  "#c5affb",
  "#7ddbe8",
  "#f790a3",
  "#9ac0a4",
  "#edbc62",
  "#aab3ff",
  "#eb9fa6",
];
const roleFields = { a: "roleA", b: "roleB", functional: "roleFunctional" };
const custom = { a: "", b: "", functional: "" };
const state = {
  structure: null,
  residues: new Map(),
  atomIds: new Map(),
  chainGroups: new Map(),
  pockets: [],
  pocketScan: null,
  trackedPocket: null,
  pocketPreview: null,
  visible: new Set(),
  highlighted: new Set(),
  selected: null,
  analyzed: null,
  communication: false,
  viewerPanel: "pockets",
  viewerColors: { pockets: "chain", communication: "chain", conformations: "chain", perturbation: "chain" },
  inspected: null,
  updateDiagnostics: null,
  route: [],
  source: "",
  token: "",
  available: false,
  nativePdb: false,
  busy: false,
};
let viewer, protein, surface, cameraHome, emptyView;
let surfaceReady = null;
let displayedPdb = null;
let displayedBackground = "#111e23";
let surfaceColorSource = null;
let shapes = [],
  labels = [];
const point = ([x, y, z]) => ({ x, y, z });
const color = (id) => palette[(id - 1) % palette.length];
const number = (value, digits = 3) =>
  value == null || !Number.isFinite(Number(value)) ? "—" : Number(value) !== 0 && Math.abs(Number(value)) < 10 ** (-digits) ? Number(value).toExponential(2) : Number(value).toFixed(digits);
const resid = (r) => {
  const group = r.chain || r.segid;
  return `${group ? group + ":" : ""}${r.resid}${r.icode}`;
};
const label = (r) => `${r.name} ${resid(r)}`;
const atomKey = (chain, segid, resi, icode) =>
  JSON.stringify([chain.trim(), (segid || "").trim(), Number(resi), icode.trim()]);
const pdbAtomKey = (line) => atomKey(line[21], line.slice(72, 76), line.slice(22, 26), line[26]);
const nodeOfPdbLine = (line) => line.startsWith("HETATM") ? undefined : state.atomIds.get(pdbAtomKey(line));
const nodeOf = (atom) => nodeOfPdbLine(atom.pdbline);

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function notice(message = "", error = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
  $("notice").hidden = !message;
}

async function api(url, body) {
  const options =
    body === undefined
      ? {}
      : { method: "POST", headers: { "X-Explorer-Token": state.token } };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const stages = { "/api/communication": "Computing ensemble coupling and network paths", "/api/conformations": "Computing projection and clustering", "/api/pockets": "Running pocket detection", "/api/pockets/track": "Scanning sampled frames for pockets", "/api/perturbation": "Solving elastic-network perturbation responses", "/api/conformations/observable": "Computing trajectory observable", "/api/conformations/associations": "Ranking residue–observable associations", "/api/conformations/contact-changes": "Comparing state contact occupancies", "/api/browse-files": "Reading server directory" };
  if (state.busy && stages[url]) $("notice").textContent = stages[url];
  let job = null;
  if (body !== undefined) {
    job = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    options.headers["X-Explorer-Job"] = job;
    state.activeJob = job;
  }
  let response;
  try { response = await fetch(url, options); }
  finally { if (job && state.activeJob === job) state.activeJob = null; }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      `The server returned an unexpected response (HTTP ${response.status}) for ${url}. Reload the app and try again.`,
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

async function task(message, operation) {
  if (state.busy) return;
  state.busy = true;
  notice(message);
  controls();
  const started = performance.now();
  const feedback = $("taskProgress");
  feedback.hidden = false;
  const tick = () => { $("taskElapsed").textContent = `Elapsed ${Math.floor((performance.now() - started) / 1000)} s · waiting for analysis/server`; };
  tick();
  let polling = false;
  const poll = async () => {
    tick();
    const job = state.activeJob;
    if (!job || polling) return;
    polling = true;
    try {
      const response = await fetch(`/api/progress/${job}`, { headers: { "X-Explorer-Token": state.token }, cache: "no-store" });
      if (!response.ok) return;
      const progress = await response.json();
      if (!state.busy || state.activeJob !== job || progress.status === "waiting") return;
      const count = Number.isFinite(progress.completed) && progress.total > 0 ? ` · ${progress.completed}/${progress.total}` : "";
      $("notice").textContent = progress.stage + count;
    } catch { /* Progress must never interrupt the analysis request. */ }
    finally { polling = false; }
  };
  const timer = setInterval(poll, 1000);
  try {
    await operation();
    notice();
  } catch (error) {
    notice(error.message, true);
  } finally {
    clearInterval(timer);
    state.activeJob = null;
    feedback.hidden = true;
    state.busy = false;
    controls();
  }
}

function requestedCpuWorkers() {
  const workers = $("cpuWorkers").valueAsNumber;
  if (!Number.isInteger(workers) || workers < 1 || workers > 100)
    throw new Error("CPU workers must be a whole number from 1 to 100.");
  return workers;
}

function controls() {
  $("cpuWorkers").disabled = state.busy;
  $("upload").disabled = $("clearWorkspace").disabled = state.busy || !state.token;
  $("uploadLabel").disabled = $("upload").disabled;
  $("uploadLocal").disabled = $("upload").disabled;
  $("detect").disabled = !state.structure || state.busy || Boolean(state.pocketPreview);
  $("detect").title = state.pocketPreview
    ? "Use Run pocket detection on frame for the previewed structure."
    : state.available ? "" : "Install fpocket in the app environment to detect new pockets.";
  $("pocketForm").querySelectorAll("input, select").forEach((field) => {
    field.disabled = !state.structure || state.busy;
  });
  $("pocketTrackingForm").querySelectorAll("input, button").forEach((field) => {
    field.disabled = !state.pocketScan || state.busy || !state.token;
  });
  updatePocketTrackingControls();
  const trackedPocketChoice = $("trackedPocketChoice");
  if (trackedPocketChoice) trackedPocketChoice.disabled = state.busy;
  const trackedFrameAction = $("scanTrackedFrame");
  if (trackedFrameAction) {
    trackedFrameAction.disabled = state.busy || !trackedFrameAction.dataset.frame;
    $("trackedPocketFrame").disabled = state.busy;
  }
  $("commForm")
    .querySelectorAll("input, select, [data-browse]")
    .forEach((field) => {
      field.disabled =
        state.busy ||
        (field.closest("#sasaSettings") && $("sasaSettings").hidden);
    });
  $("analyze").disabled = !state.structure || state.busy;
  conformationControls();
  mechanismControls();
  $("showAll").disabled = $("hideAll").disabled = !(activePocketPreview()?.pockets.size ?? state.pockets.length);
  for (const id of [
    "style",
    "viewerColor",
    "showStructuralIons",
    "ionLabels",
    "pickAction",
    "appendPick",
    "viewerBackground",
    "pocketLining",
    "negativeCorrelationLimit",
    "positiveCorrelationLimit",
    "resetCorrelationScale",
    "prsResponseLimit",
    "resetPrsScale",
    "pocketBeads",
    "pocketResidueLabels",
    "residueLabels",
    "showReferenceLining",
    "reset",
    "highlights",
    "applyHighlight",
    "clearHighlight",
  ]) {
    $(id).disabled = !state.structure;
  }
  const showSurface = hasMolecularSurface($("style").value);
  $("surfaceTransparencyControl").hidden = !showSurface;
  $("surfaceTransparency").disabled = !state.structure || !showSurface;
  $("exportSceneVmd").disabled = $("exportScenePymol").disabled = !state.structure || state.busy;
  $("exportScenePng").disabled = !viewer || !protein || state.busy;
}

function browseServerFile(kind, start) {
  const dialog = $("serverFileDialog");
  const folder = $("serverFolder");
  const up = $("serverFolderUp");
  const entries = $("serverFileEntries");
  const status = $("serverFileStatus");
  let request = 0;
  let selected = null;
  let parent = null;
  const title = { structure: "PDB structure", topology: "topology file", trajectory: "trajectory file", csv: "observable CSV" };
  $("serverFileTitle").textContent = `Choose a ${title[kind]} on the server`;
  async function navigate(path) {
    const current = ++request;
    status.textContent = "Reading server directory…";
    entries.replaceChildren();
    up.disabled = true;
    try {
      const listing = await api("/api/browse-files", { kind, path });
      if (current !== request || !dialog.open) return;
      folder.value = listing.path;
      parent = listing.parent;
      up.disabled = parent === listing.path;
      const prefix = listing.path.endsWith(listing.separator) ? listing.path : listing.path + listing.separator;
      for (const [names, isFolder] of [[listing.folders, true], [listing.files, false]]) {
        for (const name of names) {
          const entry = element("button", isFolder ? name + "/" : name);
          entry.type = "button";
          entry.onclick = () => {
            if (isFolder) navigate(prefix + name);
            else {
              selected = prefix + name;
              dialog.close();
            }
          };
          entries.append(entry);
        }
      }
      status.textContent = listing.files.length ? "" : "No matching files in this directory.";
    } catch (error) {
      if (current !== request || !dialog.open) return;
      status.textContent = error.message;
      up.disabled = !parent;
    }
  }
  $("serverFolderForm").onsubmit = (event) => {
    event.preventDefault();
    navigate(folder.value);
  };
  up.onclick = () => navigate(parent);
  folder.value = start;
  dialog.showModal();
  navigate(start);
  return new Promise((resolve) => dialog.addEventListener("close", () => {
    request++;
    resolve(selected);
  }, { once: true }));
}

for (const button of document.querySelectorAll("[data-browse]")) {
  button.addEventListener("click", () => {
    const field = $(button.dataset.browse);
    const kind = button.dataset.fileType || button.dataset.browse;
    const other = button.dataset.other || (kind === "topology" ? "trajectory" : "topology");
    const start = field.value || $(other).value;
    task("Choose a file…", async () => {
      const path = state.nativePdb
        ? (await api("/api/pick-file", { kind, start })).path
        : await browseServerFile(kind, start);
      if (path !== null && path !== field.value) {
        field.value = path;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  });
}

function addFieldHelp() {
  for (const caption of document.querySelectorAll("[data-help]")) {
    const heading = element("div", null, "field-heading");
    caption.before(heading);
    heading.append(caption, ...helpControl(`${caption.htmlFor}-help`,
      `About ${caption.textContent.trim()}`, caption.dataset.help));
  }
  document.addEventListener("click", (event) => {
    for (const trigger of document.querySelectorAll(
      ".help-trigger[aria-expanded=true]",
    )) {
      if (trigger !== event.target)
        trigger.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const trigger of document.querySelectorAll(".help-trigger")) {
      trigger.setAttribute("aria-expanded", "false");
      if (document.activeElement === trigger) trigger.blur();
    }
  });
}

function helpControl(id, label, description, text = "?") {
  const trigger = element("button", text, "help-trigger");
  const tip = element("span", description, "field-tip");
  tip.id = id;
  tip.setAttribute("role", "tooltip");
  trigger.type = "button";
  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("aria-describedby", id);
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", () => {
    const open = trigger.getAttribute("aria-expanded") === "true";
    trigger.setAttribute("aria-expanded", String(!open));
  });
  return [trigger, tip];
}

const trajectorySampling = new Map();

function watchTrajectorySampling(topologyId, trajectoryId, strideId, limitId, statusId) {
  const fields = [topologyId, trajectoryId, strideId, limitId].map($);
  const [topology, trajectory, stride, limit] = fields;
  const status = $(statusId);
  let requested = "";
  let generation = 0;
  let total = null;
  let timer;

  function refresh() {
    const paths = { topology: topology.value.trim(), trajectory: trajectory.value.trim() };
    const key = paths.topology && paths.trajectory ? JSON.stringify(paths) : "";
    if (key && !state.token) return;
    if (key !== requested) {
      requested = key;
      const request = ++generation;
      clearTimeout(timer);
      total = null;
      status.textContent = key ? "Reading trajectory frame count…" : "Select a topology and trajectory to see the frame count.";
      if (key) timer = setTimeout(async () => {
        try {
          const result = await api("/api/trajectory-info", paths);
          if (request !== generation) return;
          total = result.frames;
          refresh();
        } catch (error) {
          if (request === generation) status.textContent = `Frame count unavailable. ${error.message}`;
        }
      }, 300);
    }
    if (total === null) return;
    const cluster = trajectoryId === "trajectory" ? conformationState.transferred : null;
    const label = `${total.toLocaleString()} trajectory frames`;
    if (cluster) {
      status.textContent = `${label} · ${cluster.frames.length.toLocaleString()} explicit cluster frames will be used.`;
    } else if (stride.validity.valid && limit.validity.valid) {
      const strided = Math.ceil(total / Number(stride.value));
      const retained = Math.min(strided, Number(limit.value));
      const minimum = trajectoryId === "pocketTrackTrajectory" ? 1 : 20;
      status.textContent = `${label} · ${strided.toLocaleString()} after stride · ${retained.toLocaleString()} to analyze${retained < minimum ? ` (at least ${minimum} required)` : ""}.`;
    } else {
      status.textContent = label;
    }
  }

  trajectorySampling.set(trajectoryId, refresh);
  for (const field of fields) {
    field.addEventListener("input", refresh);
    field.addEventListener("change", refresh);
  }
}

function setPanel(mode) {
  const communication = mode === true;
  const conformation = mode === "conformations";
  const perturbation = mode === "perturbation";
  state.viewerPanel = communication ? "communication" : conformation ? "conformations" : perturbation ? "perturbation" : "pockets";
  state.perturbation = perturbation;
  $("prsResults").hidden = !perturbation || !$("prsResults").childElementCount;
  state.communication = communication;
  $("results").hidden = !communication || !state.analyzed;
  $("pocketPanel").hidden = communication || conformation || perturbation;
  $("pocketTrackingResults").hidden = $("pocketPanel").hidden || !$("pocketTrackingResults").childElementCount;
  $("perturbationPanel").hidden = !perturbation;
  if (perturbation) updatePrsSources();
  $("conformationPanel").hidden = !conformation;
  $("conformationResults").hidden = !conformation || !conformationState.run;
  $("commPanel").hidden = !communication;
  draw();
  if (conformation && conformationState.run) {
    updateContactGroups();
    renderObservableInputs();
  }
  else conformationControls();
  for (const [id, active] of [
    ["pocketTab", !communication && !conformation && !perturbation],
    ["perturbationTab", perturbation],
    ["commTab", communication],
    ["conformationTab", conformation],
  ]) {
    $(id).classList.toggle("active", active);
    if (active) $(id).setAttribute("aria-current", "step");
    else $(id).removeAttribute("aria-current");
  }
  document.dispatchEvent(new CustomEvent("allosteric:panel-change", { detail: { panel: state.viewerPanel } }));
}

function selection(text) {
  if (/\b(segid|chain|resid|resname|protein|all|and|or|not)\b|[()]/i.test(text))
    return expressionSelection(text, state.residues.values(), legacySelection);
  return legacySelection(text);
}

function legacySelection(text) {
  const ids = new Set();
  const unknown = [];
  const tokens = text
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\s*:\s*/g, ":")
    .replace(/(\d[A-Za-z]?)\s*-\s*(?=-?\d)/g, "$1-")
    .split(/[,;\s]+/)
    .filter(Boolean);
  for (const token of tokens) {
    const range = /^([^:]+:)?(-?\d+)([A-Za-z]?)(?:-(-?\d+)([A-Za-z]?))?$/.exec(
      token,
    );
    if (!range)
      throw new Error(
        `Invalid residue ID “${token}”. Try 40, A:158, or A:174-184.`,
      );
    const [, chain, start, startCode, end, endCode] = range;
    if (end != null && (startCode || endCode || Number(end) < Number(start))) {
      throw new Error(
        `Invalid range “${token}”. Use ascending residue numbers without insertion codes in ranges.`,
      );
    }
    let matched = false;
    for (const r of state.residues.values()) {
      if (chain && ![r.chain || "_", r.segid, `${r.chain}/${r.segid}`].includes(chain.slice(0, -1))) continue;
      if (
        end == null &&
        (r.resid !== Number(start) ||
          (startCode && startCode.toUpperCase() !== r.icode))
      )
        continue;
      if (end != null && (r.resid < Number(start) || r.resid > Number(end)))
        continue;
      ids.add(r.id);
      matched = true;
    }
    if (!matched) unknown.push(token);
  }
  return { ids, unknown };
}

function applyHighlight() {
  const status = $("highlightStatus");
  try {
    const { ids, unknown } = selection($("highlights").value);
    state.highlighted = ids;
    status.textContent = [
      ids.size ? `${ids.size} highlighted` : "",
      unknown.length ? `No match for ${unknown.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    draw();
  } catch (error) {
    status.textContent = error.message;
  }
}

function legendRow(key, name, shade) {
  const line = element("span", null, "key-row");
  const swatch = element("i", null, "swatch");
  swatch.style.background = shade;
  line.append(swatch, document.createTextNode(name));
  key.append(line);
}

function chainLegend(key) {
  if (state.chainGroups.size < 2) return;
  const groups = [...state.chainGroups.values()];
  for (const { name, shade } of groups.slice(0, 8)) legendRow(key, name, shade);
  if (groups.length > 8) {
    key.append(element("span", `+${groups.length - 8} more`, "key-row"));
  }
}

function legend() {
  const key = $("viewKey");
  key.replaceChildren();
  const row = (name, shade) => legendRow(key, name, shade);
  const coloring = $("viewerColor").value;
  if (coloring === "chain") chainLegend(key);
  if ($("showStructuralIons").checked && state.structure && pdbIons(activePocketPreview()?.pdb || (state.perturbation && mechanism.prsPdb) || state.structure.pdb).length) row("Retained ions", "#c7acd9");
  if (coloring === "coupling") {
    const scale = correlationColorScale();
    row(`Mean signed r to Region A · ≤ −${scale.negative.toFixed(2)}`, "#3261a2");
    row("0 · no net signed correlation", "#f6f7f6");
    row(`≥ +${scale.positive.toFixed(2)}`, "#b13743");
  }
  if (coloring === "response") {
    const { percent, maximum } = prsColorScale();
    row("RMS response · 0", "#f6f7f6");
    row(`≥ ${maximum.toPrecision(3)} model units · ${percent}% of max`, "#b13743");
  }
  if (state.perturbation && $("prsResults").childElementCount) {
    if (mechanism.prsTargets.length) row("Monitored region", "#179dbd");
    if (mechanism.prsPick !== null) row("Source of displayed push", "#ee94df");
    else if (mechanism.prsSources.length) row("Scanned sources", "#ee94df");
    if (mechanism.prsReceiver) row("Inspected responder", "#ffcf6e");
  }
  const preview = activePocketPreview();
  const visible = preview?.visible ?? state.visible;
  const prefix = preview ? "Reference pocket" : "Pocket";
  const beadsVisible = $("pocketBeads").checked && (!preview || preview.frame === -1)
    && !(state.perturbation && mechanism.prsPdb);
  if ($("pocketLining").checked || $("pocketResidueLabels").checked || beadsVisible) {
    if (visible.size > 6) row(`${visible.size} visible ${prefix.toLowerCase()}s`, "#d7e5df");
    else for (const id of visible) row(`${prefix} ${id}`, color(id));
  }
  const tracked = visibleReferenceLining();
  if (tracked) row(`Tracked Pocket ${tracked.id} · reference lining Cα`, trackedLiningColor);
  if (state.communication && state.analyzed) {
    for (const site of analysisSites().slice(0, 3)) {
      if (site.ids.size) row(site.name, site.color);
    }
    if (state.inspected != null) row("Inspected residue", communicationMarkColor());
  }
  if (state.highlighted.size) row("Highlighted residues", "#ffcf6e");
  if (state.communication && state.route.length > 1)
    row("Communication path", communicationMarkColor());
}

function activePocketPreview() {
  return $("pocketPanel").hidden ? null : state.pocketPreview;
}

function visibleReferenceLining() {
  if ($("pocketPanel").hidden || !$("showReferenceLining").checked) return null;
  const preview = state.pocketPreview;
  return preview ? (preview.visible.has(preview.id) ? preview : null) : state.trackedPocket;
}

function restoreViewerColor() {
  const colorMenu = $("viewerColor");
  for (const option of colorMenu.options) {
    if (option.value === "chain") continue;
    const available = option.value === "coupling" ? state.communication && state.analyzed
      : state.perturbation && mechanism.response.length;
    option.disabled = option.hidden = !available;
  }
  const preferred = state.viewerColors[state.viewerPanel];
  colorMenu.value = [...colorMenu.options].some((option) => option.value === preferred && !option.disabled)
    ? preferred : "chain";
}

function draw() {
  const preview = activePocketPreview();
  $("referenceLiningControl").hidden = $("pocketPanel").hidden || (!preview && !state.trackedPocket);
  $("structureName").textContent = preview ? `${preview.name} · preview` : state.structure?.name || "Structure";
  $("pocketPreviewStatus").hidden = !preview;
  $("pocketPreviewStatus").textContent = preview
    ? `${preview.name} · ${preview.frame === -1 ? "Original pockets from the reference scan." : "Reference lining residues shown on this frame. Run pocket detection on frame to see its cavities."}`
    : "";
  $("pocketVisibilityLabel").textContent = preview ? "Reference pocket visibility" : "Visibility";
  $("previewPocketList").hidden = !preview;
  $("pocketList").hidden = $("pocketDetail").hidden = Boolean(preview);
  restoreViewerColor();
  const colorMenu = $("viewerColor");
  $("correlationScaleControls").hidden = colorMenu.value !== "coupling";
  $("prsScaleControls").hidden = colorMenu.value !== "response";
  updatePrsScaleReadout();
  updateWorkspaceStatus();
  legend();
  state.updateDiagnostics?.();
  if (!viewer || !protein) return;
  const view = viewer.getView();
  const scene = mainScene();
  shapes.forEach((shape) => viewer.removeShape(shape));
  labels.forEach((mark) => viewer.removeLabel(mark));
  shapes = [];
  labels = [];
  if (scene.background !== displayedBackground) {
    viewer.setBackgroundColor(scene.background);
    displayedBackground = scene.background;
  }
  const modelChanged = scene.pdb !== displayedPdb;
  if (modelChanged) {
    viewer.removeModel(protein);
    protein = viewer.addModel(scene.pdb, "pdb", { keepH: false });
    displayedPdb = scene.pdb;
  }
  if (modelChanged || hasMolecularSurface(scene.mode) !== (surface != null)) {
    rebuildSurface(scene);
  }
  const colors = activeColorSource();
  if (surface != null && surfaceColorSource !== colors) {
    surfaceColorSource = colors;
    viewer.setSurfaceMaterialStyle(surface, surfaceStyle(scene));
  }
  protein.setClickable({ atom: "CA" }, Boolean(state.perturbation && mechanism.inspectReceiver),
    (atom) => mechanism.inspectReceiver?.(nodeOf(atom)));
  const rendered = drawScene(viewer, protein, scene);
  shapes = rendered.objects;
  labels = rendered.marks;
  viewer.setView(view);
  viewer.render();
}

function activeColorSource() {
  if ($("viewerColor").value === "coupling") return state.analyzed?.profile;
  if ($("viewerColor").value === "response") return mechanism.response;
  return null;
}

function surfaceStyle(scene) {
  return {
    opacity: scene.surfaceOpacity,
    colorfunc: (atom) => scene.baseColors.get(nodeOf(atom)) || "#a7c7bf",
  };
}

function updateSurfaceTransparency() {
  const input = $("surfaceTransparency");
  $("surfaceTransparencyValue").textContent = `${input.value}%`;
  input.setAttribute("aria-valuetext", `${input.value}% transparent`);
  if (surface != null) {
    viewer.setSurfaceMaterialStyle(surface, surfaceStyle(mainScene()));
    viewer.render();
  }
}

function rebuildSurface(scene) {
  if (!viewer || !protein) return;
  surfaceReady = null;
  if (surface != null) {
    viewer.removeSurface(surface);
    surface = null;
  }
  if (hasMolecularSurface(scene.mode)) {
    const pending = viewer.addSurface(
      $3Dmol.SurfaceType.MS,
      surfaceStyle(scene),
      { model: protein, hetflag: false },
    );
    surface = pending.surfid;
    surfaceReady = pending;
    surfaceColorSource = activeColorSource();
    pending.catch((error) => notice(error.message, true));
  }
}

async function saveScenePng(filename) {
  if (!viewer || !protein || state.busy) return;
  const status = $("sceneExportStatus");
  const dpi = pngExportDpi();
  status.hidden = true;
  try {
    let pending;
    do {
      pending = surfaceReady;
      if (pending) await pending;
    } while (pending !== surfaceReady);
    if (!protein || state.busy) return;
    await savePng(captureScenePng(dpi), filename, dpi);
  } catch (error) {
    status.textContent = error.message;
    status.hidden = false;
  }
}

function captureScenePng(dpi) {
  const { offsetWidth: width, offsetHeight: height } = $("molecule");
  if (!width || !height) throw new Error("Open the 3D viewer before saving a PNG.");
  const view = viewer.getView();
  const renderer = viewer.getRenderer();
  const scale = dpi / (96 * renderer.devicePixelRatio);
  const labelStyles = labels.map((mark) => [mark, mark.getStyle()]);
  try {
    viewer.setWidth(width * scale);
    viewer.setHeight(height * scale);
    viewer.setView(view);
    for (const [mark, style] of labelStyles) {
      viewer.setLabelStyle(mark, { ...style, fontSize: style.fontSize * scale, padding: style.padding * scale });
    }
    const gl = renderer.getContext();
    const canvas = viewer.getCanvas();
    if (!gl || gl.drawingBufferWidth !== canvas.width || gl.drawingBufferHeight !== canvas.height)
      throw new Error("The selected DPI exceeds the 3D viewer’s render size. Choose a lower PNG export DPI.");
    viewer.render();
    const prefix = "data:image/png;base64,";
    const png = viewer.pngURI();
    if (!png.startsWith(prefix)) throw new Error("The 3D viewer could not create a PNG.");
    const bytes = Uint8Array.from(atob(png.slice(prefix.length)), (value) => value.charCodeAt(0));
    return new Blob([bytes], { type: "image/png" });
  } finally {
    viewer.resize();
    for (const [mark, style] of labelStyles) viewer.setLabelStyle(mark, style);
    viewer.setView(view);
    viewer.render();
  }
}

function clearPocketTracking() {
  const results = $("pocketTrackingResults");
  results.replaceChildren();
  results.hidden = true;
  $("previewPocketList").replaceChildren();
  if (state.pocketPreview || state.trackedPocket) {
    state.pocketPreview = null;
    state.trackedPocket = null;
    controls();
    renderDetail();
    draw();
  }
}

function setStructure(structure, { keepPocketTracking = false } = {}) {
  const highlights = keepPocketTracking ? $("highlights").value : "";
  resetMechanism();
  state.pocketScan = null;
  state.trackedPocket = null;
  state.pocketPreview = null;
  $("pocketTrackingForm").hidden = true;
  if (!keepPocketTracking) {
    $("showReferenceLining").checked = true;
    clearPocketTracking();
  }
  conformationState.transferredResidues = null;
  $("sceneExportStatus").hidden = true;
  clearResults();
  const residues = structure?.residues || [];
  state.structure = structure;
  state.residues = new Map(residues.map((r) => [r.id, r]));
  state.atomIds = new Map(
    residues.map((r) => [atomKey(r.chain, r.segid, r.resid, r.icode), r.id]),
  );
  state.chainGroups = structureChainGroups(residues);
  state.pockets = [];
  state.visible = new Set();
  state.selected = null;
  state.source = structure ? "fpocket cavity predictions" : "";
  for (const role of Object.keys(roleFields)) {
    custom[role] = "";
    $(roleFields[role]).replaceChildren();
  }
  resetConformations();
  for (const side of ["A", "B"]) {
    $(`contactScope${side}`).value = "all";
    $(`contactGroup${side}`).value = "";
  }
  conformationState.highlighted = null;
  $("frameHighlights").value = "";
  $("frameHighlightStatus").textContent = "";
  setCommunicationFrames(null);
  $("emptyScene").hidden = Boolean(structure) || !$("viewError").hidden;
  $("structureName").textContent = structure?.name || "Structure";
  const chains = [...new Set(residues.map((r) => r.chain))];
  const chainCount = chains.length;
  const chainSelect = $("pocketChain");
  chainSelect.replaceChildren(
    new Option("All chains together", "all"),
    ...chains.map((chain) => new Option(chain ? `Chain ${chain}` : "Blank chain ID", chain)),
  );
  $("structureMeta").textContent = structure
    ? `${residues.length} residues · ${chainCount} ${chainCount === 1 ? "chain" : "chains"}`
    : "Open a PDB to get started";
  $("highlights").value = highlights;
  if (!keepPocketTracking) {
    $("style").value = "cartoon";
    protein = null;
    displayedPdb = null;
    cameraHome = null;
    if (viewer) {
      viewer.clear();
      viewer.setView(emptyView);
      shapes = [];
      labels = [];
      surface = null;
      surfaceReady = null;
      if (structure) {
        protein = viewer.addModel(structure.pdb, "pdb", { keepH: false });
        displayedPdb = structure.pdb;
        drawScene(viewer, protein, newScene(structure.pdb, "cartoon"));
        viewer.zoomTo({ model: protein });
        viewer.rotate(22, "y");
        cameraHome = viewer.getView();
      }
      viewer.render();
    }
  }
  applyHighlight();
  renderPockets();
  renderRoles();
  setPanel(false);
}

function renderPockets() {
  updatePocketTrackingControls();
  $("pocketCount").textContent = state.pockets.length;
  $("pocketSource").textContent = state.source;
  const list = $("pocketList");
  list.replaceChildren();
  if (!state.pockets.length) {
    const message = !state.structure
      ? "Open a structure to detect pockets."
      : state.source.startsWith("fpocket ·")
        ? "fpocket reported no pockets for this scan."
        : "Run fpocket to populate the pocket list.";
    list.append(element("div", message, "empty"));
    renderDetail();
    return;
  }
  const head = element("div", null, "pocket-row head");
  for (const text of ["", "Pocket", "Score", "Druggability"])
    head.append(element("span", text));
  list.append(head);
  for (const pocket of state.pockets) {
    const row = element("div", null, "pocket-row");
    row.dataset.pocket = pocket.id;
    row.classList.toggle("selected", state.selected === pocket.id);
    const toggle = element("input");
    toggle.type = "checkbox";
    toggle.checked = state.visible.has(pocket.id);
    toggle.setAttribute("aria-label", `Show pocket ${pocket.id}`);
    toggle.addEventListener("change", () => {
      if (toggle.checked) state.visible.add(pocket.id);
      else state.visible.delete(pocket.id);
      updatePocketTrackingControls();
      draw();
    });
    const button = element("button", null, "pocket-name");
    button.type = "button";
    const swatch = element("i", null, "swatch");
    swatch.style.background = color(pocket.id);
    button.append(swatch, document.createTextNode(`Pocket ${pocket.id}`));
    button.addEventListener("click", () => {
      if (state.busy) return;
      state.selected = pocket.id;
      list.querySelectorAll("[data-pocket]").forEach((line) => {
        line.classList.toggle(
          "selected",
          Number(line.dataset.pocket) === pocket.id,
        );
      });
      renderDetail();
    });
    row.append(
      toggle,
      button,
      element("span", number(pocket.score), "metrics"),
      element("span", number(pocket.druggability), "metrics"),
    );
    list.append(row);
  }
  renderDetail();
}

function renderPreviewPocketList(preview) {
  const list = $("previewPocketList");
  list.replaceChildren();
  for (const { id } of preview.pockets.values()) {
    const row = element("label", null, "pocket-row");
    const toggle = element("input");
    toggle.type = "checkbox";
    toggle.checked = preview.visible.has(id);
    toggle.onchange = () => {
      if (toggle.checked) preview.visible.add(id);
      else preview.visible.delete(id);
      draw();
    };
    const name = element("span", null, "pocket-name");
    const swatch = element("i", null, "swatch");
    swatch.style.background = color(id);
    name.append(swatch, document.createTextNode(`Pocket ${id}`));
    row.append(toggle, name);
    list.append(row);
  }
}

function setVisibility(visible) {
  const preview = activePocketPreview();
  if (preview) {
    preview.visible.clear();
    if (visible) for (const id of preview.pockets.keys()) preview.visible.add(id);
    $("previewPocketList").querySelectorAll("input").forEach((input) => { input.checked = visible; });
    draw();
    return;
  }
  state.visible = new Set(visible ? state.pockets.map((p) => p.id) : []);
  $("pocketList")
    .querySelectorAll("input")
    .forEach((input) => {
      input.checked = visible;
    });
  updatePocketTrackingControls();
  draw();
}

function updatePocketTrackingControls() {
  const count = state.visible.size;
  $("trackPocket").disabled = !count || !state.pocketScan || state.busy || !state.token;
  const scope = activePocketPreview() ? " on the current structure" : "";
  $("pocketTrackCount").textContent = count
    ? `${count} visible ${count === 1 ? "pocket" : "pockets"}${scope} will be tracked.`
    : "Show the pockets you want to track.";
}

function renderDetail() {
  const root = $("pocketDetail");
  root.replaceChildren();
  const tracked = state.trackedPocket;
  if (tracked?.frame != null) {
    const status = tracked.match == null
      ? `Tracked Pocket ${tracked.id}: no qualifying match in frame ${tracked.frame}.`
      : `Tracked Pocket ${tracked.id} matches Pocket ${tracked.match} in frame ${tracked.frame}.`;
    root.append(element("p", `${status} Best lining overlap ${number(100 * tracked.overlap, 1)}%.`, "tracking-match"));
  }
  const pocket = state.pockets.find((p) => p.id === state.selected);
  if (!pocket) return;
  const title = element("div", null, "detail-title");
  title.append(
    element(
      "span",
      `Pocket ${pocket.id} · ${pocket.residues.length} lining residues`,
    ),
    element(
      "small",
      pocket.volume == null ? "" : `${number(pocket.volume, 0)} Å³`,
    ),
  );
  const nearbyIons = pocketIonDistances(pocket);
  if (nearbyIons.length) root.append(element("p", "Nearby ions (within 5 Å of pocket beads): " + nearbyIons.map(ion => `${ion.name} ${ion.chain || ion.segid || "_"}:${ion.resid}${ion.icode} · ${number(ion.distance, 1)} Å`).join("; "), "ion-note"));
  root.append(element("small", "Pocket geometry is detected from protein atoms; retained ions are shown for context and are not communication/PRS nodes."));
  const lining = element("textarea", null, "detail-res");
  lining.id = "pocketLiningIds";
  lining.rows = 3;
  lining.readOnly = true;
  lining.spellcheck = false;
  lining.value = qualifiedResidues(pocket.residues);
  const liningLabel = element("label", "Lining residue IDs");
  liningLabel.htmlFor = lining.id;
  const copy = element("button", "Copy residue IDs");
  copy.type = "button";
  const copyStatus = element("small");
  copyStatus.setAttribute("role", "status");
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(lining.value);
      copyStatus.textContent = "Copied.";
    } catch {
      lining.focus();
      lining.select();
      copyStatus.textContent = "IDs selected. Use your system’s copy shortcut.";
    }
  };
  const actions = element("div", null, "detail-actions");
  actions.append(copy);
  for (const [key, text] of [
    ["a", "Region A"],
    ["b", "Region B"],
    ["functional", "Functional reference"],
  ]) {
    const button = element("button", `Use as ${text}`);
    button.type = "button";
    button.addEventListener("click", () => {
      if (state.busy) return;
      $(roleFields[key]).value = `p${pocket.id}`;
      renderCustom();
      clearResults();
      setPanel(true);
      $(roleFields[key]).focus();
    });
    actions.append(button);
  }
  root.append(title, liningLabel, lining, actions, copyStatus);
}

function renderRoles() {
  for (const [key, field] of Object.entries(roleFields)) {
    const select = $(field);
    const saved = select.value;
    select.replaceChildren(
      new Option(key === "a" ? "Choose residues" : "None", ""),
      new Option("Custom residues…", "custom"),
      ...state.pockets.map((p) => new Option(`Pocket ${p.id}`, `p${p.id}`)),
    );
    if ([...select.options].some((option) => option.value === saved))
      select.value = saved;
  }
  renderCustom();
}

function renderCustom() {
  const root = $("regionCustom");
  root.replaceChildren();
  $("functionalCustom").replaceChildren();
  for (const [key, field] of Object.entries(roleFields)) {
    if ($(field).value !== "custom") continue;
    const caption = {
      a: "Region A residues",
      b: "Region B residues",
      functional: "Functional reference residues",
    }[key];
    const fieldLabel = element("label", caption);
    const input = element("input");
    input.placeholder = "segid PROA and resid 40:60";
    input.title = selectionHelp;
    input.required = true;
    input.value = custom[key];
    input.addEventListener("input", () => {
      if (key === "a") conformationState.transferredResidues = null;
      custom[key] = input.value;
      clearResults();
    });
    fieldLabel.append(input);
    (key === "functional" ? $("functionalCustom") : root).append(fieldLabel);
  }
}

function role(key) {
  const value = $(roleFields[key]).value;
  if (!value) return [];
  if (value === "custom") {
    const transferred = conformationState.transferredResidues;
    if (key === "a" && transferred?.text === custom.a) return [...transferred.ids];
    const { ids, unknown } = selection(custom[key]);
    if (unknown.length || !ids.size)
      throw new Error(
        `No match for ${unknown.join(", ") || "custom residues"}.`,
      );
    return [...ids];
  }
  return state.pockets.find((p) => p.id === Number(value.slice(1))).residues;
}

function clearResults() {
  const hadResults = Boolean(state.analyzed);
  state.analyzed = null;
  $("results").hidden = true;
  state.updateDiagnostics = null;
  state.inspected = null;
  state.route = [];
  if (hadResults && state.communication) draw();
}

function analysisSites() {
  const { a, b, functional } = state.analyzed.settings;
  return [
    { name: "Region A", color: plotTheme.regionA, ids: new Set(a) },
    { name: "Region B", color: plotTheme.regionB, ids: new Set(b) },
    { name: "Functional", color: "#168258", ids: new Set(functional) },
    {
      name: "Predicted pockets",
      color: plotTheme.predicted,
      ids: new Set(state.pockets.flatMap((p) => p.residues)),
    },
    { name: "Highlighted", color: "#c98412", ids: state.highlighted },
  ];
}

function pocketMembership() {
  const membership = new Map();
  for (const { id, residues } of state.pockets) {
    for (const residue of residues) {
      if (!membership.has(residue)) membership.set(residue, []);
      membership.get(residue).push(id);
    }
  }
  return membership;
}

function residueSiteNames(id, sites, pocketIds) {
  return sites.flatMap((site) => {
    if (!site.ids.has(id)) return [];
    return site.name === "Predicted pockets"
      ? pocketIds.map((pocketId) => `Pocket ${pocketId}`)
      : [site.name];
  });
}

const nameOf = (id) => label(state.residues.get(id));

function exportCsv(lines, filename) {
  const escape = (value) =>
    '"' + String(value ?? "").replaceAll('"', '""') + '"';
  const parts = [];
  let chunk = [];
  for (const row of lines) {
    chunk.push(row.map(escape).join(",") + "\r\n");
    if (chunk.length === 1024) {
      parts.push(chunk.join(""));
      chunk = [];
    }
  }
  if (chunk.length) parts.push(chunk.join(""));
  saveBlob(new Blob(parts, { type: "text/csv;charset=utf-8" }), filename);
}

function downloadCsv() {
  const { rows, pockets, profile } = state.analyzed;
  const paths = new Map(rows.map((r) => [r.id, r]));
  const sites = analysisSites();
  const membership = pocketMembership();
  const lines = [
    [
      "type",
      "target",
      "mean_abs_coupling",
      "connected",
      "path_cost",
      "path",
      "lining_residues_used",
      "node_index",
      "mean_signed_correlation",
      "mean_SASA_A2",
      "mean_min_distance_to_A_A",
      "first_half_mean_abs",
      "second_half_mean_abs",
      "candidate",
      "sites",
      "pocket_membership",
    ],
  ];
  for (const [index, row] of profile.entries()) {
    const path = paths.get(row.id);
    const pocketIds = membership.get(row.id) || [];
    lines.push([
      "residue",
      nameOf(row.id),
      row.coupling,
      row.connected,
      path?.cost,
      path?.path.map(nameOf).join(" → "),
      "",
      index + 1,
      row.signed,
      row.sasa,
      row.distance,
      ...row.halves,
      row.eligible,
      residueSiteNames(row.id, sites, pocketIds).join("; "),
      pocketIds.join("; "),
    ]);
  }
  for (const pocket of pockets) {
    lines.push([
      "pocket",
      `Pocket ${pocket.id}`,
      pocket.coupling,
      "",
      "",
      "",
      pocket.residues,
    ]);
  }
  exportCsv(lines, "allosteric_communication.csv");
}

function resultsTable(headers) {
  const table = element("table");
  const head = table.createTHead().insertRow();
  for (const name of headers) {
    const cell = element("th", name);
    cell.scope = "col";
    head.append(cell);
  }
  const body = table.createTBody();
  enhanceResultsTable(table, headers);
  return { table, body };
}

function pocketParticipation(pockets, candidates, threshold = 0) {
  const connected = new Map(candidates
    .filter((row) => row.connected && Number.isFinite(row.coupling) && row.coupling >= threshold)
    .map(({ id, coupling }) => [id, coupling]));
  return pockets.map(({ id, residues }) => {
    const members = [...new Set(residues)].filter((node) => connected.has(node))
      .sort((a, b) => connected.get(b) - connected.get(a));
    const sum = members.reduce((total, node) => total + connected.get(node), 0);
    return { id, members, count: members.length, sum,
      strongest: members.length ? connected.get(members[0]) : null };
  });
}

function pocketResults(result, onResidue, candidates, layout = null) {
  const section = element("section", null, "pocket-analysis");
  const mode = element("select");
  mode.id = "communicationPocketRanking";
  mode.append(new Option("Summed coupling to Region A", "sum"),
    new Option("Participating residue count", "connected"),
    new Option("Mean |r| across lining residues", "mean"));
  mode.title = "Sum: total mean absolute coupling of reachable eligible lining residues to Region A. Count: number of those residues. Mean: average across mapped lining residues outside the reference. Larger pockets can accumulate larger sums; compare count and strongest-residue scores too.";
  const rankingLabel = element("label", "Rank pockets by");
  rankingLabel.htmlFor = mode.id;
  const threshold = element("input");
  threshold.id = "communicationPocketThreshold";
  threshold.type = "number";
  threshold.min = 0;
  threshold.max = 1;
  threshold.step = "any";
  threshold.value = 0;
  threshold.title = "Minimum residue mean absolute coupling to Region A for summed coupling and participating counts. Zero includes all reachable eligible candidates. Candidate distance, exposure, and region filters still apply. The full-lining mean uses its original reference and is unaffected.";
  const thresholdLabel = element("label", "Minimum mean |r| to Region A");
  thresholdLabel.htmlFor = threshold.id;
  const rankingControls = element("div", null, "result-buttons conformation-actions");
  rankingControls.append(rankingLabel, mode, thresholdLabel, threshold);
  const explanation = element("p", null, "muted");
  const figure = element("div");
  const rankingWrap = element("div", null, "rank-table");
  const means = new Map(result.pockets.map((row) => [row.id, row]));
  const profiles = new Map(result.profile.map((row) => [row.id, row]));
  const reference = result.settings.functional?.length ? "functional reference" : "Region A";
  const select = element("select");
  select.setAttribute("aria-label", "Pocket to inspect");
  const detail = element("div");
  let participation;
  function inspect(id) {
    select.value = id ?? "";
    detail.replaceChildren();
    if (!id) return;
    const byCount = mode.value !== "mean";
    const pocket = means.get(id);
    const members = byCount ? (participation.find((row) => row.id === id)?.members || []) : [];
    const records = byCount ? members.map((node) => {
      const row = profiles.get(node);
      return { id: node, coupling: row.coupling, signed: row.signed, blocks: row.halves };
    }) : pocket?.lining || [];
    detail.append(element("h4", `Pocket ${id} · ${byCount ? "participating residues" : "lining residues"}`));
    if (!records.length) {
      detail.append(element("p", byCount ? "No reachable eligible lining residues meet the scoring threshold." : "No mapped lining residues outside the correlation reference."));
      return;
    }
    const { table, body } = resultsTable([
      "Lining residue", "Mean |r|", "Signed mean r", "First half |r|", "Second half |r|",
    ]);
    for (const lining of records) {
      const row = body.insertRow();
      const button = element("button", nameOf(lining.id), "residue-link");
      button.type = "button";
      button.title = "Inspect this residue in the 3D viewer";
      button.onclick = () => {
        onResidue(lining.id);
        $("molecule").scrollIntoView({ block: "center" });
      };
      row.insertCell().append(button);
      for (const score of [lining.coupling, lining.signed, ...lining.blocks]) {
        row.insertCell().textContent = number(score);
      }
    }
    detail.append(table);
  }
  select.onchange = () => inspect(Number(select.value) || null);
  function refresh() {
    if (!threshold.checkValidity()) return;
    const selected = select.value;
    const minimum = Number(threshold.value);
    participation = pocketParticipation(state.pockets, candidates, minimum);
    const valueOf = (row) => mode.value === "sum" ? row.sum
      : mode.value === "connected" ? row.count : means.get(row.id)?.coupling;
    const rows = [...participation].sort((a, b) =>
      (valueOf(b) ?? -Infinity) - (valueOf(a) ?? -Infinity)
      || b.sum - a.sum || b.count - a.count || a.id - b.id);
    explanation.textContent = `Scores use all ${candidates.length} eligible candidates and require a network path from Region A. Minimum mean |r|: ${minimum}. Larger pockets can accumulate larger sums. Full-lining means use ${reference}.`;
    select.replaceChildren(new Option("Choose a pocket…", ""), ...rows.map(({ id }) => new Option(`Pocket ${id}`, id)));
    const ranking = resultsTable(["Pocket", "Sum mean |r| to A", "Participating residues",
      "Strongest mean |r| to A", `Full-lining mean |r| to ${reference}`, "Lining residues scored for mean"]);
    for (const { id, count, sum, strongest } of rows) {
      const row = ranking.body.insertRow();
      const mean = means.get(id);
      const button = element("button", `Pocket ${id}`, "residue-link");
      button.type = "button";
      button.onclick = () => inspect(id);
      row.insertCell().append(button);
      for (const value of [number(sum), count, number(strongest), number(mean?.coupling), mean?.residues ?? 0])
        row.insertCell().textContent = value;
    }
    rankingWrap.replaceChildren(ranking.table);
    const metric = mode.value === "sum" ? "Sum mean |r| to A"
      : mode.value === "connected" ? "Participating residues" : "Full-lining mean |r|";
    const plotted = rows.filter((row) => Number.isFinite(valueOf(row)))
      .map((row) => ({ ...row, score: valueOf(row) }));
    const upper = Math.max(mode.value === "mean" ? 1 : 0.01, ...plotted.map((row) => row.score));
    figure.replaceChildren(pocketScorePlot(state.pockets, plotted, {
      title: "Pocket participation from Region A", filename: "pocket_participation",
      metric, upper,
      ...(mode.value === "connected" ? { xTicks: [...new Set(ticks(0, upper).map(Math.round))] } : {}),
      description: mode.value === "mean" ? `Full-lining mean to ${reference}` : `All ${candidates.length} eligible candidates · minimum mean |r| ${minimum}`,
      caption: mode.value === "mean" ? `Legacy mean across mapped lining residues outside ${reference}.`
        : "Each reachable eligible lining residue contributes once per pocket. Sum and count are not divided by pocket size.",
      onPick: inspect, showCount: false,
      dataRows: () => [
        ["pocket", "plotted_metric", "plotted_score", "sum_mean_abs_coupling_to_A", "participating_residue_count",
          "strongest_mean_abs_coupling_to_A", "full_lining_mean_abs_coupling", "mean_reference", "lining_residues_scored_for_mean",
          "minimum_mean_abs_coupling_to_A", "eligible_candidate_count", "participating_residues"],
        ...rows.map((row) => [row.id, mode.value, valueOf(row) ?? "", row.sum, row.count, row.strongest ?? "",
          means.get(row.id)?.coupling ?? "", reference, means.get(row.id)?.residues ?? 0,
          minimum, candidates.length, row.members.map(nameOf).join("; ")]),
      ],
    }));
    inspect(Number(selected) || null);
  }
  mode.onchange = refresh;
  threshold.oninput = refresh;
  if (layout) {
    layout.plots.append(element("h4", "Pocket participation"), rankingControls, explanation, figure);
    layout.tables.append(element("h4", "Pocket ranking"), rankingWrap);
    layout.inspection.append(element("h4", "Pocket residue inspection"), select, detail, section);
  } else section.append(element("h4", "Pocket ranking"), rankingControls, explanation, figure, rankingWrap, select, detail);
  refresh();
  if (!result.pockets.length) return section;

  const secondRun = element("input");
  secondRun.type = "file";
  secondRun.accept = ".json,application/json";
  const compareLabel = element("label", "Compare a second run JSON ");
  compareLabel.append(secondRun);
  const comparison = element("div");
  comparison.setAttribute("aria-live", "polite");
  secondRun.onchange = async () => {
    const file = secondRun.files[0];
    comparison.replaceChildren();
    if (!file) return;
    try {
      const other = JSON.parse(await file.text());
      if (secondRun.files[0] !== file) return;
      const key = ({ chain, segid, resid, icode, name }) => JSON.stringify([chain, segid || "", resid, icode, name]);
      const firstNodes = new Map(result.profile.map(({ id }) => [id, key(state.residues.get(id))]));
      const otherNodes = new Map(other.node_mapping.map((node) => [node.id, key(node)]));
      const mapped = (ids, nodes) => JSON.stringify(ids.map((id) => nodes.get(id)).sort());
      if (mapped([...firstNodes.keys()], firstNodes) !== mapped([...otherNodes.keys()], otherNodes) ||
          other.settings.method !== result.settings.method || other.settings.cutoff !== result.settings.cutoff ||
          mapped(other.settings.a, otherNodes) !== mapped(result.settings.a, firstNodes) ||
          mapped(other.settings.functional, otherNodes) !== mapped(result.settings.functional, firstNodes)) {
        throw new Error("Use a run with matching residues, Region A, functional reference, coupling method, and contact cutoff.");
      }
      const otherPockets = new Map(other.predicted_pockets.map(({ id, residues }) => [id, mapped(residues, otherNodes)]));
      const { table, body } = resultsTable(["Pocket", "Current mean |r| (rank)", "Second mean |r| (rank)", "Δ mean |r|"]);
      for (const [i, pocket] of result.pockets.entries()) {
        const residues = state.pockets.find(({ id }) => id === pocket.id).residues;
        const match = mapped(residues, firstNodes);
        const matches = other.pockets.filter(({ id, coupling }) => otherPockets.get(id) === match && Number.isFinite(coupling));
        const peer = matches.length === 1 ? matches[0] : matches.find(({ id }) => id === pocket.id);
        const row = body.insertRow();
        for (const value of [
          `Pocket ${pocket.id}`,
          `${number(pocket.coupling)} (${i + 1})`,
          peer ? `${number(peer.coupling)} (${other.pockets.indexOf(peer) + 1})` : "No unique match",
          peer ? number(peer.coupling - pocket.coupling) : "—",
        ]) row.insertCell().textContent = value;
      }
      comparison.append(element("small", "Pockets match by lining residues. Δ is second run minus current run."), table);
    } catch (error) {
      if (secondRun.files[0] === file) comparison.textContent = error.message;
    }
  };
  const { table, body } = resultsTable([
    "Pocket", "Full mean |r|", "First half |r| (rank)", "Second half |r| (rank)",
  ]);
  const ranks = result.pocket_blocks.map((_, i) => {
    const scores = [...result.pockets].sort((a, b) => b.blocks[i] - a.blocks[i]);
    let rank = 0;
    return new Map(scores.map((pocket, position) => {
      if (position === 0 || pocket.blocks[i] !== scores[position - 1].blocks[i]) rank = position + 1;
      return [pocket.id, rank];
    }));
  });
  for (const pocket of result.pockets) {
    const row = body.insertRow();
    const values = [
      `Pocket ${pocket.id}`, number(pocket.coupling),
      ...pocket.blocks.map((score, i) => `${number(score)} (${ranks[i].get(pocket.id)})`),
    ];
    for (const value of values) row.insertCell().textContent = value;
  }
  const span = result.pocket_blocks.map(({ first, last, count }) => `frames ${first}–${last} (n = ${count})`);
  const stability = element("details");
  stability.append(element("summary", "Pocket coupling stability"),
    element("p", `First half: ${span[0]}. Second half: ${span[1]}. The same reference and lining residues are used in both halves.`),
    element("small", "Halves are consecutive in the retained frame list. These scores describe within-run consistency."),
    table, compareLabel, comparison);
  section.append(stability);
  return section;
}

function renderResults() {
  const result = state.analyzed;
  const root = $("results");
  const connecting = result.settings.b.length > 0;
  const method =
    result.settings.method === "dcc"
      ? "Displacement DCC"
      : "Contact-change correlation";
  root.replaceChildren(
    element("h3", "Communication results"),
    element(
      "small",
      `${result.frames} frames · ${result.nodes} residues · ${result.edges} network edges · ${method}`,
    ),
  );
  if (result.sasa_frames.length) {
    root.append(
      element(
        "small",
        `Mean SASA from ${result.sasa_frames.length} sampled frames · ${result.settings.sasa_points} sphere points per atom`,
      ),
    );
  }
  root.append(analysisSummary('communication', result.settings, [`${result.frames} retained frames`, `${result.nodes} Cα nodes`, `${result.edges} edges`, method]));
  const plotSection = resultSection('Plots', 'plots');
  const tableSection = resultSection('Tables', 'tables');
  const inspectionSection = resultSection('Residue and path inspection', 'inspection');
  root.append(plotSection, tableSection, inspectionSection);
  const entries = result.rows;
  const paths = new Map(entries.map((r) => [r.id, r]));
  const details = new Map(result.profile.map((r) => [r.id, r]));
  const select = element("select");
  select.setAttribute("aria-label", "Communication target");
  select.append(new Option("Choose a residue…", ""));
  for (const row of entries) {
    select.append(
      new Option(
        `${nameOf(row.id)} · ${number(row.coupling)}${row.connected ? "" : " · unreachable"}`,
        row.id,
      ),
    );
  }
  select.disabled = !entries.length;
  const target = element("div", null, "target-row");
  const rankHeading = element(
    "h4",
    connecting ? "Region B endpoints" : "Coupled residues outside Region A",
  );
  target.append(rankHeading, select);
  const readout = element("div", null, "target-readout");
  const routeText = element("div", null, "routes");
  const routeEdges = element("div", null, "route-edges");
  const routeTools = element("div", null, "result-buttons");
  const findRoutes = element("button", "Find alternate routes");
  findRoutes.type = "button";
  const routeChoice = element("select");
  routeChoice.setAttribute("aria-label", "Communication route");
  routeChoice.hidden = true;
  const routeStatus = element("small");
  routeStatus.setAttribute("role", "status");
  routeTools.append(findRoutes, routeChoice, routeStatus);
  const routeResults = new Map();
  const markers = element("div", null, "plot-controls");
  const viewTarget = element("button", "Show in 3D");
  viewTarget.type = "button";
  viewTarget.onclick = () => $("molecule").scrollIntoView({ block: "center" });
  markers.append(viewTarget);
  inspectionSection.append(target, readout, routeText, routeTools, routeEdges, markers);
  if (!entries.length) {
    tableSection.append(
      element(
        "p",
        "No residues pass the current discovery filters. The plots still show the full analysis.",
      ),
    );
  }

  const sendPath = element("button", "Send path to Perturbation");
  sendPath.type = "button";
  sendPath.onclick = () => openPathPerturbation(state.route, result.settings.b);
  routeText.after(sendPath);

  function showRoute(row, info) {
    state.route = row?.path || [];
    sendPath.disabled = state.route.length < 2;
    routeText.textContent = row?.connected
      ? `Path cost ${number(row.cost)} · ${row.path.map(nameOf).join(" → ")}`
      : row
        ? "No path at the current occupancy and coupling thresholds."
        : info
          ? "This residue is outside the current endpoint list."
          : "";
    routeEdges.replaceChildren();
    if (row?.edges.length) {
      const { table, body } = resultsTable([
        "Path edge",
        "Signed r",
        "Occupancy",
      ]);
      for (const [i, edge] of row.edges.entries()) {
        const line = body.insertRow();
        for (const value of [
          `${nameOf(row.path[i])} → ${nameOf(row.path[i + 1])}`,
          number(edge.correlation),
          number(edge.occupancy),
        ])
          line.insertCell().textContent = value;
      }
      const disclosure = element("details");
      disclosure.append(element("summary", "Path edge values"), table);
      routeEdges.append(disclosure);
    }
    draw();
  }

  function showChoices(routes) {
    routeChoice.replaceChildren();
    routes.forEach((route, index) => {
      const delta = route.cost - routes[0].cost;
      routeChoice.append(
        new Option(
          `Route ${index + 1} · cost ${number(route.cost)} · Δ ${number(delta)} · ${route.edges.length} edges`,
          index,
        ),
      );
    });
    routeChoice.hidden = routes.length < 2;
    routeStatus.textContent =
      routes.length === 1
        ? "Only one loopless route connects this target."
        : `${routes.length} lowest-cost loopless routes shown.`;
  }

  function pick(id) {
    state.inspected = id;
    const row = paths.get(id);
    const info = details.get(id);
    select.value = row ? id : "";
    readout.textContent = info
      ? `${nameOf(id)} · mean |r| ${number(info.coupling)} · signed mean r ${number(info.signed)} · distance from A ${number(info.distance, 1)} Å${info.sasa == null ? "" : ` · SASA ${number(info.sasa, 1)} Å²`}`
      : "Choose a target or click a diagnostic plot.";
    const routes = routeResults.get(id);
    routeTools.hidden = !row?.connected;
    findRoutes.hidden = Boolean(routes);
    findRoutes.disabled = false;
    routeChoice.hidden = true;
    routeStatus.textContent = "";
    if (routes?.length) showChoices(routes);
    viewTarget.disabled = id == null;
    showRoute(routes?.length ? { ...routes[0], connected: true } : row, info);
  }

  findRoutes.onclick = async () => {
    const id = state.inspected;
    findRoutes.disabled = true;
    routeStatus.textContent = "Finding routes…";
    try {
      const { routes } = await api("/api/routes", {
        run: result.route_run,
        target: id,
      });
      if (routes.length) routeResults.set(id, routes);
      if (state.analyzed !== result || state.inspected !== id) return;
      if (routes.length) pick(id);
      else routeStatus.textContent = "No additional routes were found.";
    } catch (error) {
      if (state.analyzed === result && state.inspected === id)
        routeStatus.textContent = error.message;
    } finally {
      if (state.analyzed === result && state.inspected === id)
        findRoutes.disabled = false;
    }
  };
  routeChoice.onchange = () => {
    const id = state.inspected;
    const route = routeResults.get(id)[Number(routeChoice.value)];
    showRoute({ ...route, connected: true }, details.get(id));
  };
  select.onchange = () => pick(Number(select.value) || null);

  const { table, body } = resultsTable([
    "Rank",
    "Residue",
    "Mean |r|",
    "Signed mean r",
    "Distance from A (Å)",
    ...(result.sasa_frames.length ? ["SASA (Å²)"] : []),
    "Path",
    "Sites",
  ]);
  const tableWrap = element("div", null, "rank-table");
  tableWrap.append(table);
  const limit = element("select");
  limit.setAttribute("aria-label", "Number of ranked residues");
  for (const n of [25, 100]) limit.append(new Option(`Top ${n}`, n));
  limit.append(new Option("All candidates", "all"));
  const membership = pocketMembership();
  const shownRows = () => limit.value === "all" ? entries : entries.slice(0, Number(limit.value));
  function renderRows() {
    body.replaceChildren();
    const shown = shownRows();
    const sites = analysisSites();
    for (const [i, r] of shown.entries()) {
      const row = body.insertRow();
      row.dataset.residue = r.id;
      row.insertCell().textContent = i + 1;
      const button = element("button", nameOf(r.id), "residue-link");
      button.type = "button";
      button.onclick = () => pick(r.id);
      row.insertCell().append(button);
      for (const value of [
        number(r.coupling),
        number(r.signed),
        number(r.distance, 1),
        ...(result.sasa_frames.length ? [number(r.sasa, 1)] : []),
        r.connected ? `${r.edges.length} edges` : "Unreachable",
        residueSiteNames(r.id, sites, membership.get(r.id) || []).join(", "),
      ])
        row.insertCell().textContent = value;
    }
  }
  limit.onchange = () => {
    renderRows();
    state.updateDiagnostics?.();
  };
  if (entries.length) {
    const tableHeader = element("div", null, "target-row");
    tableHeader.append(
      element(
        "small",
        `${entries.length} ${connecting ? "endpoints" : "eligible residues"} ranked by mean |r|`,
      ),
      limit,
    );
    tableSection.append(tableHeader, tableWrap);
    renderRows();
  }

  const bytes = Uint8Array.from(atob(result.correlation), (byte) =>
    byte.charCodeAt(0),
  );
  const binary = new DataView(bytes.buffer);
  const matrix = Float32Array.from({ length: result.nodes ** 2 }, (_, i) =>
    binary.getFloat32(i * 4, true),
  );
  const correlationPlot = matrixPlot(result, matrix, nameOf, pick);
  const plots = [
    profilePlot(result, nameOf, pick),
    correlationPlot,
    scatterPlot(result, true, nameOf, pick),
    scatterPlot(result, false, nameOf, pick),
  ];
  const overlay = element("fieldset", null, "plot-overlay");
  overlay.append(element("legend", "Plot overlays"));
  const groupToggles = new Map();
  for (const group of analysisSites()) {
    const caption = element("label", group.name);
    const toggle = element("input");
    toggle.type = "checkbox";
    toggle.checked = true;
    toggle.onchange = () => state.updateDiagnostics?.();
    caption.prepend(toggle);
    overlay.append(caption);
    groupToggles.set(group.name, toggle);
  }
  const pocketChoice = element("select");
  pocketChoice.setAttribute("aria-label", "Predicted pockets to plot");
  pocketChoice.append(new Option("All predicted pockets", ""));
  for (const pocket of state.pockets)
    pocketChoice.append(new Option(`Pocket ${pocket.id}`, pocket.id));
  pocketChoice.hidden = state.pockets.length < 2;
  pocketChoice.onchange = () => state.updateDiagnostics?.();
  overlay.append(pocketChoice);
  const grid = element("div", null, "diagnostic-grid");
  for (const plot of plots) {
    plot.svg.append(
      svgNode(
        "text",
        { x: 65, y: 370, fill: "#40574c", "font-size": 10 },
        `${method} · ${result.frames} retained frames · ${result.nodes} Cα nodes`,
      ),
    );
    grid.append(plot.card);
  }
  const buttons = element("div", null, "result-buttons");
  function exportButton(title, action) {
    const button = element("button", title);
    button.type = "button";
    button.onclick = action;
    buttons.append(button);
  }
  exportButton("Export CSV", downloadCsv);
  exportButton("Export matrix CSV", correlationPlot.exportData);
  exportButton("Export run JSON", () => {
    const { correlation, route_run, ...metadata } = result;
    saveBlob(
      new Blob(
        [
          JSON.stringify(
            {
              structure: state.structure.name,
              ...metadata,
              alternate_routes: Array.from(
                routeResults,
                ([target, routes]) => ({ target, routes }),
              ),
              node_mapping: result.profile.map(({ id }, i) => ({
                node_index: i + 1,
                ...state.residues.get(id),
              })),
              sites: analysisSites().map(({ name, ids }) => ({
                name,
                ids: [...ids],
              })),
              predicted_pockets: state.pockets.map(({ id, residues }) => ({
                id,
                residues,
              })),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "communication_run.json",
    );
  });
  if (viewer)
    exportButton("Save 3D view PNG", () => saveScenePng("communication_structure.png"));
  plotSection.append(overlay, buttons, grid);
  if (state.pockets.length) {
    pocketResults(result, pick, entries, { plots: plotSection, tables: tableSection, inspection: inspectionSection });
  }
  let oldHighlights;
  state.updateDiagnostics = () => {
    if (state.highlighted !== oldHighlights) {
      oldHighlights = state.highlighted;
      renderRows();
    }
    const groups = [];
    for (const site of analysisSites()) {
      const toggle = groupToggles.get(site.name);
      toggle.disabled = !site.ids.size;
      if (!toggle.checked || toggle.disabled) continue;
      if (site.name === "Predicted pockets" && pocketChoice.value) {
        const pocket = state.pockets.find(
          (p) => p.id === Number(pocketChoice.value),
        );
        groups.push({
          ...site,
          name: `Pocket ${pocket.id}`,
          ids: new Set(pocket.residues),
        });
      } else groups.push(site);
    }
    pocketChoice.disabled = !groupToggles.get("Predicted pockets").checked;
    for (const plot of plots) plot.update(groups, state.inspected);
    for (const row of body.rows)
      row.classList.toggle(
        "focused",
        Number(row.dataset.residue) === state.inspected,
      );
  };
  root.hidden = !state.communication;
  pick(entries[0]?.id ?? null);
}

function clearWorkspace() {
  if (state.busy) return;
  dismissExportFeedback();
  for (const form of document.forms) form.reset();
  $("computeSettings").open = false;
  $("cpuWorkers").value = $("cpuWorkers").defaultValue;
  $("pngDpi").value = "300";
  $("showStructuralIons").checked = $("ionLabels").checked = $("appendPick").checked = true;
  $("pickAction").value = "inspect";
  for (const refresh of trajectorySampling.values()) refresh();
  for (const id of ["pocketLining", "pocketBeads", "pocketResidueLabels", "residueLabels", "frameResidueLabels"]) {
    $(id).checked = $(id).defaultChecked;
  }
  for (const section of document.querySelectorAll("#viewerDisplay, #pocketForm details, #pocketTrackingForm details, #commForm details, #conformationForm details")) {
    section.open = false;
  }
  $("landscapePanel").open = true;
  for (const panel of Object.keys(state.viewerColors)) state.viewerColors[panel] = "chain";
  $("viewerColor").value = "chain";
  $("prsResponseLimit").value = "100";
  $("negativeCorrelationLimit").value = $("positiveCorrelationLimit").value = "1";
  updateCorrelationScale();
  $("viewerBackground").value = "dark";
  displayedBackground = viewerBackground();
  viewer?.setBackgroundColor(displayedBackground);
  groupChoices.length = 0;
  setStructure(null);
  $("surfaceTransparency").value = $("surfaceTransparency").defaultValue;
  updateSurfaceTransparency();
  for (const id of ["results", "projectionPlot", "landscapePlot", "observableResults", "associationResults"]) {
    $(id).replaceChildren();
  }
  for (const id of ["candidateFilter", "confBasis", "confClustering", "associationFeature", "observableKind"]) {
    $(id).dispatchEvent(new Event("change"));
  }
  notice();
  controls();
}

$("clearWorkspace").addEventListener("click", clearWorkspace);
$("dismissExportFeedback").onclick = dismissExportFeedback;
$("uploadLabel").addEventListener("click", () => {
  task("Choose a PDB…", async () => {
    if (state.nativePdb) {
      const { structure } = await api("/api/pick-file", { kind: "structure" });
      if (structure !== null) setStructure(structure);
    } else {
      const path = await browseServerFile("structure", "");
      if (path !== null) setStructure(await api("/api/structure-path", { path }));
    }
  });
});
$("uploadLocal").addEventListener("click", () => $("upload").click());
$("upload").addEventListener("change", () => {
  const file = $("upload").files[0];
  if (!file) return;
  $("upload").value = "";
  task("Reading structure…", async () => {
    const data = new FormData();
    data.append("structure", file);
    const structure = await api("/api/structure", data);
    setStructure(structure);
  });
});
$("pocketTab").addEventListener("click", () => setPanel(false));
$("commTab").addEventListener("click", () => setPanel(true));
$("conformationTab").addEventListener("click", () => setPanel("conformations"));
$("highlightForm").addEventListener("submit", (event) => {
  event.preventDefault();
  applyHighlight();
});
$("clearHighlight").addEventListener("click", () => {
  $("highlights").value = "";
  applyHighlight();
});
$("style").addEventListener("change", () => {
  controls();
  draw();
});
$("viewerColor").addEventListener("change", () => {
  state.viewerColors[state.viewerPanel] = $("viewerColor").value;
  draw();
});
function updateCorrelationScale() {
  const scale = correlationColorScale();
  $("negativeCorrelationValue").textContent = `−${scale.negative.toFixed(2)}`;
  $("positiveCorrelationValue").textContent = `+${scale.positive.toFixed(2)}`;
  $("negativeCorrelationLimit").setAttribute("aria-valuetext", `Full blue at −${scale.negative.toFixed(2)}`);
  $("positiveCorrelationLimit").setAttribute("aria-valuetext", `Full red at +${scale.positive.toFixed(2)}`);
  surfaceColorSource = undefined;
  draw();
}
for (const id of ["negativeCorrelationLimit", "positiveCorrelationLimit"])
  $(id).addEventListener("input", updateCorrelationScale);
$("resetCorrelationScale").onclick = () => {
  $("negativeCorrelationLimit").value = $("positiveCorrelationLimit").value = "1";
  updateCorrelationScale();
};
function updatePrsColorScale() {
  surfaceColorSource = undefined;
  draw();
}
$("prsResponseLimit").addEventListener("input", updatePrsColorScale);
$("resetPrsScale").onclick = () => {
  $("prsResponseLimit").value = "100";
  updatePrsColorScale();
};
$("viewerBackground").addEventListener("change", draw);
$("surfaceTransparency").addEventListener("input", updateSurfaceTransparency);
$("pocketLining").addEventListener("change", draw);
$("pocketBeads").addEventListener("change", draw);
$("pocketResidueLabels").addEventListener("change", draw);
$("residueLabels").addEventListener("change", draw);
$("exportScenePng").onclick = () => saveScenePng("allosteric_scene.png");
for (const [id, format] of [
  ["exportSceneVmd", "vmd"],
  ["exportScenePymol", "pymol"],
]) {
  $(id).onclick = () => exportScene(mainScene(), format, "allosteric_scene", $("sceneExportStatus"));
}
$("reset").addEventListener("click", () => {
  if (viewer && cameraHome) viewer.setView(cameraHome);
});
$("showAll").addEventListener("click", () => setVisibility(true));
$("hideAll").addEventListener("click", () => setVisibility(false));
$("showReferenceLining").addEventListener("change", draw);
const pocketSettingFields = {
  min_radius: "pocketMinRadius",
  max_radius: "pocketMaxRadius",
  min_spheres: "pocketMinSpheres",
  clustering_distance: "pocketClusteringDistance",
  clustering_method: "pocketClusteringMethod",
};

function applyPocketScan(pockets, chain, settings, tracking = null) {
  const scope = $("pocketChain");
  scope.value = chain ?? "all";
  state.pockets = pockets;
  clearPrsResults();
  state.pocketScan = { chain, settings };
  state.trackedPocket = tracking;
  $("pocketTrackingForm").hidden = !pockets.length;
  state.visible = new Set(tracking
    ? (tracking.match == null ? [] : [tracking.match])
    : pockets.slice(0, 3).map((p) => p.id));
  state.selected = tracking ? tracking.match : pockets[0]?.id ?? null;
  state.source = `fpocket · ${scope.selectedOptions[0].text}`;
  for (const field of Object.values(roleFields))
    if ($(field).value.startsWith("p")) $(field).value = "";
  clearResults();
  renderRoles();
  updateContactGroups({ replacePockets: true });
  renderPockets();
  draw();
}

$("pocketForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.structure || state.pocketPreview) return;
  const scope = $("pocketChain").selectedOptions[0];
  const settings = Object.fromEntries(
    Object.entries(pocketSettingFields).map(([key, id]) => [key, $(id).value])
      .filter(([, value]) => value !== ""),
  );
  task(`Running fpocket · ${scope.text}…`, async () => {
    const chain = scope.value === "all" ? null : scope.value;
    const result = await api("/api/pockets", {
      pdb: state.structure.pdb,
      chain,
      settings,
    });
    clearPocketTracking();
    applyPocketScan(result.pockets, chain, settings);
  });
});
$("copyPocketTrackingInputs").onclick = () => {
  for (const [target, source] of [["Topology", "topology"], ["Trajectory", "trajectory"], ["Selection", "selection"], ["Stride", "stride"]]) {
    $("pocketTrack" + target).value = $(source).value;
  }
  trajectorySampling.get("pocketTrackTrajectory")?.();
  clearPocketTracking();
};
$("pocketTrackingForm").addEventListener("input", clearPocketTracking);
$("pocketTrackingForm").onsubmit = (event) => {
  event.preventDefault();
  const visiblePockets = state.pockets.filter(({ id }) => state.visible.has(id));
  if (!visiblePockets.length || !state.pocketScan) return;
  const { chain, settings } = state.pocketScan;
  const { pdb, name } = state.structure;
  const trajectory = {
    topology: $("pocketTrackTopology").value.trim(),
    trajectory: $("pocketTrackTrajectory").value.trim(),
    selection: $("pocketTrackSelection").value,
    stride: $("pocketTrackStride").value,
    max_frames: $("pocketTrackMax").value,
  };
  const request = { pdb, chain, fpocket: settings, trajectory, overlap: $("pocketTrackOverlap").value };
  const references = new Map(state.pockets.map((pocket) => [pocket.id, {
    ...pocket,
    liningKeys: new Set(pocket.residues.map((id) => {
      const { chain, segid, resid, icode } = state.residues.get(id);
      return atomKey(chain, segid, resid, icode);
    })),
  }]));
  const previewVisible = new Set(visiblePockets.map(({ id }) => id));
  const activeId = previewVisible.has(state.selected) ? state.selected : visiblePockets[0].id;
  task(`Tracking ${visiblePockets.length} visible ${visiblePockets.length === 1 ? "pocket" : "pockets"} across trajectory frames…`, async () => {
    const result = await api("/api/pockets/track", {
      ...request,
      workers: requestedCpuWorkers(),
      pockets: visiblePockets.map(({ id, residues }) => ({ id, lining: residues })),
    });
    const tracked = result.pockets.map(({ id, samples }) => ({ ...references.get(id), samples }));
    state.pocketPreview = null;
    $("showReferenceLining").checked = true;
    const selectPocket = ({ id, liningKeys }) => {
      const lining = [...liningKeys].filter((key) => state.atomIds.has(key)).map((key) => state.atomIds.get(key));
      state.trackedPocket = { id, lining };
      if (state.pocketPreview) Object.assign(state.pocketPreview, { id, liningKeys });
      renderDetail();
      draw();
      return state.pocketPreview?.frame ?? null;
    };
    const previewFrame = (pocket, frame, ready) => {
      const { id, liningKeys } = pocket;
      const showPreview = (structure) => {
        state.pocketPreview = structure && { ...structure, id, liningKeys, frame, pockets: references, visible: previewVisible };
        if (state.pocketPreview) renderPreviewPocketList(state.pocketPreview);
        ready();
        draw();
      };
      if (frame === null || frame === -1) {
        showPreview(frame === null ? null : { pdb, name: "Original PDB · frame −1" });
        controls();
        return;
      }
      task(`Opening frame ${frame}…`, async () => {
        const structure = await api("/api/pockets/track/preview", { pdb, trajectory, frame });
        showPreview(structure);
      });
    };
    renderPocketTracking(tracked, name, activeId, selectPocket, previewFrame, (pocket, frame) => task(`Detecting pockets in frame ${frame}…`, async () => {
      const { structure, pockets, tracking } = await api("/api/pockets/track/frame", { ...request, lining: pocket.residues, frame });
      setStructure(structure, { keepPocketTracking: true });
      for (const [key, id] of Object.entries(pocketSettingFields)) $(id).value = settings[key] ?? "";
      applyPocketScan(pockets, chain, settings, { ...tracking, id: pocket.id, frame });
    }), result.workers, { ...request.trajectory, chain: request.chain, detector: request.settings, overlap: request.overlap, workers: result.workers });
  });
};
for (const field of Object.values(roleFields))
  $(field).addEventListener("change", renderCustom);
$("candidateFilter").addEventListener("change", () => {
  $("sasaSettings").hidden = $("candidateFilter").value === "all";
  controls();
});
$("commForm").addEventListener("input", clearResults);
$("commForm").addEventListener("change", clearResults);
$("commForm").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.structure) return;
  task("Reading and analyzing retained trajectory frames…", async () => {
    const settings = Object.fromEntries(
      [
        "topology",
        "trajectory",
        "selection",
        "method",
        "stride",
        "cutoff",
        "occupancy",
        "coupling",
      ].map((key) => [key, $(key).value.trim()]),
    );
    settings.max_frames = $("maxFrames").value;
    if (conformationState.transferred)
      settings.frame_indices = conformationState.transferred.frames;
    settings.candidate_filter = $("candidateFilter").value;
    if (settings.candidate_filter !== "all") settings.workers = requestedCpuWorkers();
    settings.sasa_threshold = $("sasaThreshold").value;
    settings.sasa_snapshots = $("sasaSnapshots").value;
    settings.sasa_points = $("sasaPoints").value;
    settings.shielding = $("shielding").value.trim();
    settings.min_distance = $("minDistance").value;
    settings.reachable_only = $("reachableOnly").checked;
    for (const key of Object.keys(roleFields)) settings[key] = role(key);
    state.analyzed = await api("/api/communication", {
      pdb: state.structure.pdb,
      pockets: state.pockets,
      settings,
    });
    renderResults();
  });
});

try {
  viewer = $3Dmol.createViewer($("molecule"), {
    backgroundColor: "#111e23",
    antialias: true,
  });
  emptyView = viewer.getView();
  new ResizeObserver(() => viewer.resize()).observe($("molecule"));
} catch {
  $("viewError").textContent =
    "The 3D viewer needs WebGL. Enable hardware acceleration or try another browser.";
  $("viewError").hidden = false;
}
initConformations();
initMechanism();
addFieldHelp();
watchTrajectorySampling("topology", "trajectory", "stride", "maxFrames", "communicationFrameCount");
watchTrajectorySampling("confTopology", "confTrajectory", "confStride", "confMax", "conformationFrameCount");
watchTrajectorySampling("pocketTrackTopology", "pocketTrackTrajectory", "pocketTrackStride", "pocketTrackMax", "pocketTrackFrameCount");
setStructure(null);
task("Starting workspace…", async () => {
  const session = await api("/api/session");
  state.token = session.token;
  state.available = session.fpocket;
  state.nativePdb = session.native_pdb;
  for (const refresh of trajectorySampling.values()) refresh();
  $("uploadLocal").hidden = session.native_pdb;
  for (const button of document.querySelectorAll("[data-browse]")) {
    button.hidden = false;
  }
});

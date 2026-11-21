"use strict";

const chainPalette = [
  "#80b8ee", "#e7a288", "#83c4aa", "#b99ae0", "#d8c283", "#dc9abb",
  "#82cbd1", "#aac77f", "#baab98", "#a5a9e0", "#dbb3a6", "#84b3ad",
];
const trackedLiningColor = "#8f54c2";

function hasMolecularSurface(mode) {
  return mode === "surface" || mode === "cartoon-surface";
}

function viewerBackground() {
  return $("viewerBackground").value === "white" ? "#ffffff" : "#111e23";
}

function communicationMarkColor() {
  return $("viewerBackground").value === "white" ? "#263531" : "#ffffff";
}

function correlationColorScale() {
  return {
    negative: Number($("negativeCorrelationLimit").value),
    positive: Number($("positiveCorrelationLimit").value),
  };
}

function scaledCorrelation(value, scale) {
  return Math.max(-1, Math.min(1, value / (value < 0 ? scale.negative : scale.positive)));
}

const chainGroup = (r) => JSON.stringify([r?.chain || "", r?.segid || ""]);

function structureChainGroups(residues) {
  const groups = new Map();
  const ordered = [...residues].sort(
    (a, b) => a.chain.localeCompare(b.chain) || (a.segid || "").localeCompare(b.segid || ""),
  );
  for (const r of ordered) {
    const key = chainGroup(r);
    if (groups.has(key)) continue;
    const name = [r.chain && `Chain ${r.chain}`, r.segid].filter(Boolean).join(" · ");
    const index = groups.size;
    const shade = chainPalette[index] ??
      "#" + ((0x528945 + index * 0x2c3b57) & 0xffffff).toString(16).padStart(6, "0");
    groups.set(key, { name: name || "Unassigned chain", shade });
  }
  return groups;
}

function chainShade(id, fallback) {
  if (state.chainGroups.size < 2) return fallback;
  return state.chainGroups.get(chainGroup(state.residues.get(id)))?.shade ?? fallback;
}

function newScene(pdb, mode) {
  const shade = mode === "stick" ? "#bdcdd0" : "#b9cfca";
  const baseColors = new Map();
  if (state.chainGroups.size > 1) {
    for (const id of state.residues.keys()) baseColors.set(id, chainShade(id, shade));
  }
  const scene = {
    pdb,
    mode,
    shade,
    baseColors,
    baseScores: new Map(),
    sticks: new Map(),
    markers: [],
    labels: [],
  };
  addIonMarkers(scene);
  return scene;
}

function paintSticks(scene, ids, shade, radius) {
  for (const id of ids) scene.sticks.set(id, { shade, radius });
}

function sceneAtoms(pdb) {
  return pdb
    .split("\n")
    .filter((line) => /^(ATOM  |HETATM)/.test(line))
    .map((line, index) => ({
      index,
      serial: Number(line.slice(6, 11)),
      hetero: line.startsWith("HETATM"),
      id: nodeOfPdbLine(line),
      key: pdbAtomKey(line),
      name: line.slice(12, 16).trim(),
      xyz: [30, 38, 46].map((i) => Number(line.slice(i, i + 8))),
    }));
}

function sceneHighlights(scene, ids, coords, showLabels) {
  paintSticks(scene, ids, "#ffcf6e", 0.29);
  if (!showLabels || ids.size > 24) return;
  for (const id of ids) {
    const xyz = coords.get(id);
    if (xyz)
      scene.labels.push({ id, xyz, text: label(state.residues.get(id)) });
  }
}

function mainScene() {
  const mode = $("style").value;
  const preview = activePocketPreview();
  const reference = visibleReferenceLining();
  const scene = newScene(preview?.pdb || (state.perturbation && mechanism.prsPdb) || state.structure.pdb, mode);
  scene.background = viewerBackground();
  const previewAtoms = preview ? sceneAtoms(scene.pdb) : [];
  const previewCAs = previewAtoms.filter(({ name }) => name === "CA");
  if (hasMolecularSurface(mode)) scene.surfaceOpacity = (100 - Number($("surfaceTransparency").value)) / 100;
  const coloring = $("viewerColor").value;
  if (coloring === "coupling" && state.communication && state.analyzed) {
    scene.correlationScale = correlationColorScale();
    for (const { id, signed } of state.analyzed.profile) {
      const score = scaledCorrelation(signed, scene.correlationScale);
      const endpoint = score < 0 ? [50, 97, 162] : [177, 55, 67];
      const rgb = [246, 247, 246].map((v, i) =>
        Math.round(v + Math.abs(score) * (endpoint[i] - v))
          .toString(16)
          .padStart(2, "0"),
      );
      scene.baseColors.set(id, "#" + rgb.join(""));
      scene.baseScores.set(id, signed);
    }
  } else if (coloring === "response" && state.perturbation) {
    for (const [id, shade] of prsColors()) scene.baseColors.set(id, shade);
  }
  const pockets = preview ? preview.pockets.values() : state.pockets;
  const visible = preview?.visible ?? state.visible;
  const showPocketLabels = $("pocketResidueLabels").checked;
  const pocketLabels = new Map();
  const previewNodes = new Map(previewAtoms.filter(({ id }) => id != null).map(({ key, id }) => [key, id]));
  for (const pocket of pockets) {
    if (!visible.has(pocket.id)) continue;
    const shade = color(pocket.id);
    const ids = preview
      ? [...pocket.liningKeys].filter((key) => previewNodes.has(key)).map((key) => previewNodes.get(key))
      : pocket.residues;
    if ($("pocketLining").checked) paintSticks(scene, ids, shade, 0.18);
    if (showPocketLabels) {
      for (const id of ids)
        if (!pocketLabels.has(id)) pocketLabels.set(id, shade);
    }
    if ($("pocketBeads").checked && (!preview || preview.frame === -1) && !(state.perturbation && mechanism.prsPdb)) {
      for (const xyz of pocket.centers)
        scene.markers.push({ xyz, shade, radius: 0.64, group: "pocket_beads" });
    }
  }
  if (reference && preview) {
    for (const { key, xyz } of previewCAs)
      if (preview.liningKeys.has(key))
        scene.markers.push({ xyz, shade: trackedLiningColor, radius: 0.49, group: "tracked_pocket_lining" });
  } else if (reference) {
    for (const id of reference.lining) {
      const xyz = state.residues.get(id)?.ca;
      if (xyz)
        scene.markers.push({ xyz, shade: trackedLiningColor, radius: 0.49, group: "tracked_pocket_lining" });
      if (showPocketLabels && !pocketLabels.has(id)) pocketLabels.set(id, trackedLiningColor);
    }
  }
  if (state.communication && state.analyzed) {
    const markColor = communicationMarkColor();
    for (const site of analysisSites().slice(0, 3))
      paintSticks(scene, site.ids, site.color, 0.23);
    const inspected = state.residues.get(state.inspected);
    if (inspected?.ca)
      scene.markers.push({
        xyz: inspected.ca,
        radius: 0.75,
        shade: markColor,
        group: "inspected",
      });
    const route = state.route.map((id) => state.residues.get(id).ca);
    if (route.length > 1) {
      for (const [i, xyz] of route.entries()) {
        if (i)
          scene.markers.push({
            xyz: route[i - 1],
            end: xyz,
            radius: 0.18,
            shade: markColor,
            group: "communication_path",
          });
        scene.markers.push({
          xyz,
          radius: 0.38,
          shade: markColor,
          group: "communication_path",
        });
      }
    }
  }
  if (state.perturbation && $("prsResults").childElementCount) {
    paintSticks(scene, mechanism.prsTargets, "#179dbd", 0.23);
    if (mechanism.prsReceiver) paintSticks(scene, [mechanism.prsReceiver], "#ffcf6e", 0.32);
    if (mechanism.prsPick !== null) paintSticks(scene, [mechanism.prsPick], "#ee94df", 0.32);
    else paintSticks(scene, mechanism.prsSources, "#ee94df", 0.24);
    const xyz = mechanism.prsCoordinates?.get(mechanism.prsPick) || state.residues.get(mechanism.prsPick)?.ca;
    if (xyz) scene.markers.push({ xyz, shade: "#ee94df", radius: 0.65, group: "perturbation_source" });
  }
  const coords = preview ? new Map(previewCAs.map(({ id, xyz }) => [id, xyz]))
    : state.perturbation && mechanism.prsPdb ? mechanism.prsCoordinates
      : new Map([...new Set([...state.highlighted, ...pocketLabels.keys()])]
        .map((id) => [id, state.residues.get(id)?.ca]));
  sceneHighlights(scene, state.highlighted, coords, $("residueLabels").checked);
  const labeled = new Set(scene.labels.map(({ id }) => id));
  for (const [id, shade] of pocketLabels) {
    const xyz = coords.get(id);
    if (xyz && !labeled.has(id))
      scene.labels.push({ id, xyz, shade, text: label(state.residues.get(id)) });
  }
  return scene;
}

function styleGroups(entries) {
  const groups = new Map();
  for (const [id, style] of entries) {
    const key = `${style.shade}:${style.radius ?? ""}`;
    if (!groups.has(key)) groups.set(key, { ...style, ids: new Set() });
    groups.get(key).ids.add(id);
  }
  return [...groups.values()];
}

function drawScene(view, model, scene) {
  const representation = scene.mode === "stick" ? "stick" : "cartoon";
  const base =
    representation === "stick"
      ? { color: scene.shade, radius: 0.16 }
      : { color: scene.shade };
  if (scene.baseColors.size) {
    delete base.color;
    base.colorfunc = (atom) =>
      parseInt(
        (scene.baseColors.get(nodeOf(atom)) || scene.shade).slice(1),
        16,
      );
  }
  model.setStyle({}, scene.mode === "surface" ? {} : { [representation]: base });
  for (const group of styleGroups(scene.sticks)) {
    model.setStyle(
      { predicate: (atom) => group.ids.has(nodeOf(atom)) },
      { stick: { color: group.shade, radius: group.radius } },
      true,
    );
  }
  // Retained ions are rendered as explicit markers, never as protein sticks.
  model.setStyle({ hetflag: true }, {});
  installResidueInspection(view, model);
  const objects = scene.markers.map(({ xyz, end, shade, radius, group }) =>
    end
      ? view.addCylinder({
          start: point(xyz),
          end: point(end),
          color: shade,
          radius,
        })
      : view.addSphere({
          center: point(xyz),
          color: shade,
          radius,
          alpha: group === "pocket_beads" ? 0.77 : 1,
        }),
  );
  const marks = scene.labels.map(({ xyz, text, shade }) =>
    view.addLabel(text, {
      position: point(xyz),
      inFront: true,
      fontColor: shade ?? "#fff1c8",
      fontSize: 11,
      backgroundColor: shade ? "#17272b" : "#40321f",
      backgroundOpacity: 0.9,
      padding: 3,
    }),
  );
  return { objects, marks };
}

function exportScene(scene, format, name, status) {
  const atoms = sceneAtoms(scene.pdb);
  const baseColors = styleGroups(
    [...scene.baseColors].map(([id, shade]) => [id, { shade }]),
  );
  const sticks = styleGroups(scene.sticks);
  const data = { ...scene, baseColors, sticks, atoms };
  const content = format === "vmd" ? vmdScene(data) : pymolScene(data);
  const extension = format === "vmd" ? "tcl" : "py";
  const file = new File([content], `${name}.${extension}`, { type: "text/plain;charset=utf-8" });
  status.hidden = true;
  saveBlob(file, file.name);
}

let exportRequest = 0;

function dismissExportFeedback() {
  exportRequest++;
  $("exportFeedback").hidden = true;
  $("exportSaveAs").onclick = null;
}

async function saveBlob(blob, name) {
  const request = ++exportRequest;
  const feedback = $("exportFeedback");
  const status = $("exportFeedbackMessage");
  const alternative = $("exportSaveAs");
  const hasBrowserPicker = typeof window.showSaveFilePicker === "function";
  const data = new FormData();
  data.append("structure", blob, name);
  alternative.disabled = false;
  alternative.hidden = true;
  alternative.onclick = null;
  status.textContent = `Saving ${name}…`;
  feedback.hidden = false;
  try {
    const { path } = await api("/api/export/working-directory", data);
    if (request !== exportRequest) return;
    status.textContent = `Saved ${path}`;
    alternative.hidden = true;
    alternative.onclick = null;
  } catch (error) {
    if (request !== exportRequest) return;
    status.textContent = error.message;
    alternative.textContent = state.nativePdb || hasBrowserPicker ? "Save as…" : "Download";
    alternative.hidden = false;
    alternative.onclick = saveAs;
  }

  async function saveAs() {
    alternative.disabled = true;
    try {
      let message;
      if (state.nativePdb) {
        const { path } = await api("/api/export/save-as", data);
        if (path === null) return;
        message = `Saved ${path}`;
      } else if (hasBrowserPicker) {
        const handle = await window.showSaveFilePicker({ suggestedName: name });
        const stream = await handle.createWritable();
        await stream.write(blob);
        await stream.close();
        message = `Saved ${handle.name}`;
      } else {
        downloadBlob(blob, name);
        message = `Download requested for ${name}. Check your browser’s downloads.`;
      }
      if (request !== exportRequest) return;
      status.textContent = message;
      alternative.hidden = true;
      alternative.onclick = null;
    } catch (error) {
      if (request === exportRequest && error.name !== "AbortError") status.textContent = error.message;
    } finally {
      if (request === exportRequest) alternative.disabled = false;
    }
  }
}

function rgb(shade) {
  return [1, 3, 5].map((i) => parseInt(shade.slice(i, i + 2), 16) / 255);
}

function pymolScene(scene) {
  const lines = [
    "# Load with: run /path/to/scene.py",
    "from pymol import cmd",
    "from pymol.cgo import ALPHA, COLOR, SPHERE, CYLINDER",
    `model = cmd.get_unused_name("explorer_protein")`,
    `cmd.read_pdbstr(${JSON.stringify(scene.pdb)}, model)`,
    'cmd.hide("everything", model)',
  ];
  const names = new Set();
  const colorName = (shade) => {
    const name = "ae_" + shade.slice(1);
    if (!names.has(name)) {
      names.add(name);
      lines.push(`cmd.set_color("${name}", ${JSON.stringify(rgb(shade))})`);
    }
    return name;
  };
  const select = (atoms) =>
    `model + " and id ${atoms.map((atom) => atom.serial).join("+")}"`;
  const style = (rep, target, shade, radius) => {
    const name = colorName(shade);
    if (rep === "sticks")
      lines.push(`cmd.set("stick_radius", ${radius}, ${target})`);
    const setting = {
      sticks: "stick_color",
      cartoon: "cartoon_color",
      surface: "surface_color",
    }[rep];
    lines.push(
      `cmd.set("${setting}", "${name}", ${target})`,
      `cmd.show("${rep}", ${target})`,
    );
  };
  const rep = scene.mode === "stick" ? "sticks" : "cartoon";
  if (scene.mode !== "surface") {
    style(rep, 'model + " and not hetatm"', scene.shade, 0.16);
    for (const group of scene.baseColors) {
      const atoms = scene.atoms.filter((atom) => group.ids.has(atom.id));
      if (atoms.length) style(rep, select(atoms), group.shade, 0.16);
    }
  }
  if (hasMolecularSurface(scene.mode)) {
    style("surface", 'model + " and not hetatm"', "#a7c7bf");
    for (const group of scene.baseColors) {
      const atoms = scene.atoms.filter((atom) => group.ids.has(atom.id));
      if (atoms.length) style("surface", select(atoms), group.shade);
    }
    lines.push(`cmd.set("transparency", ${(1 - scene.surfaceOpacity).toFixed(2)}, model)`);
  }
  for (const group of scene.sticks) {
    const atoms = scene.atoms.filter((atom) => group.ids.has(atom.id));
    if (atoms.length) style("sticks", select(atoms), group.shade, group.radius);
  }
  const groups = new Map();
  for (const { xyz, end, shade, radius, group } of scene.markers) {
    if (!groups.has(group)) groups.set(group, []);
    const color = rgb(shade);
    const cgo = groups.get(group);
    if (end)
      cgo.push(
        `CYLINDER, ${[...xyz, ...end, radius, ...color, ...color].join(", ")}`,
      );
    else
      cgo.push(
        `COLOR, ${color.join(", ")}, SPHERE, ${[...xyz, radius].join(", ")}`,
      );
  }
  for (const [name, objects] of groups) {
    const opacity = name === "pocket_beads" ? "ALPHA, 0.77, " : "";
    lines.push(
      `cmd.load_cgo([
    ${opacity}${objects.join(",\n    ")}
], cmd.get_unused_name("${name}"))`,
    );
  }
  for (const { id, text } of scene.labels) {
    const ca = scene.atoms.find((atom) => atom.id === id && atom.name === "CA");
    if (ca)
      lines.push(
        `cmd.label(${select([ca])}, ${JSON.stringify(JSON.stringify(text))})`,
      );
  }
  lines.push(
    `cmd.bg_color("${scene.background === "#ffffff" ? "white" : "black"}")`,
    "cmd.orient(model)",
    "cmd.zoom(model)",
    "",
  );
  return lines.join("\n");
}

function tclHex(value) {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const vmdPalette = {
  black: "#000000",
  blue: "#3333ff",
  red: "#ff2020",
  gray: "#808080",
  orange: "#ff8000",
  yellow: "#ffff00",
  tan: "#bea16a",
  silver: "#c0c0c0",
  green: "#00cc00",
  white: "#ffffff",
  pink: "#ff9bbd",
  cyan: "#00cccc",
  purple: "#a060d0",
  lime: "#a8cf32",
  iceblue: "#9cceff",
};

function vmdShade(shade) {
  const source = rgb(shade);
  return Object.entries(vmdPalette)
    .map(([name, hex]) => [
      name,
      rgb(hex).reduce((sum, v, i) => sum + (v - source[i]) ** 2, 0),
    ])
    .sort((a, b) => a[1] - b[1])[0][0];
}

function vmdScene(scene) {
  const lines = [
    "# Load with: source /path/to/scene.tcl",
    "proc allosteric_explorer_scene {} {",
    "  set directory [pwd]",
    "  foreach key {TMPDIR TEMP TMP} {",
    "    if {[info exists ::env($key)] && [file isdirectory $::env($key)]} {",
    "      set directory $::env($key)",
    "      break",
    "    }",
    "  }",
    "  if {$directory eq [pwd] && [file isdirectory /tmp]} {set directory /tmp}",
    "  set pdb [file join $directory ae_[pid]_[clock clicks].pdb]",
    "  set handle [open $pdb {WRONLY CREAT EXCL}]",
    "  fconfigure $handle -translation binary",
    `  puts -nonewline $handle [binary format H* {${tclHex(scene.pdb)}}]`,
    "  close $handle",
    "  set status [catch {mol new $pdb type pdb waitfor all} molecule]",
    "  file delete $pdb",
    "  if {$status} {error $molecule}",
    "  mol rename $molecule {Allosteric Explorer}",
    "  mol delrep 0 $molecule",
  ];
  function representation(rep, selection, shade, material) {
    lines.push(
      `  mol representation ${rep}`,
      shade
        ? `  mol color ColorID [colorinfo index ${vmdShade(shade)}]`
        : "  mol color Beta",
      `  mol selection {${selection}}`,
      `  mol material ${material}`,
      "  mol addrep $molecule",
    );
  }
  function selected(ids) {
    return scene.atoms
      .filter((atom) => ids.has(atom.id))
      .map((atom) => atom.index);
  }
  function coloredRepresentation(rep, shade, material) {
    if (!scene.baseColors.length) {
      representation(rep, "not hetero", shade, material);
      return;
    }
    const colored = new Set();
    for (const group of scene.baseColors) {
      const indexes = selected(group.ids);
      if (indexes.length) representation(rep, `index ${indexes.join(" ")}`, group.shade, material);
      for (const id of group.ids) colored.add(id);
    }
    const remaining = scene.atoms.filter((atom) => !atom.hetero && !colored.has(atom.id)).map((atom) => atom.index);
    if (remaining.length) representation(rep, `index ${remaining.join(" ")}`, shade, material);
  }
  const base = scene.mode === "stick" ? "Licorice 0.16 12 12" : "NewCartoon";
  if (scene.baseScores.size) {
    const scores = scene.atoms.map(
      (atom) => scaledCorrelation(scene.baseScores.get(atom.id) || 0,
        scene.correlationScale || { negative: 1, positive: 1 }),
    );
    lines.push(
      "  # Beta stores signed correlation normalized to the selected blue/red display limits.",
      "  color scale method BWR",
      "  set atoms [atomselect $molecule all]",
      `  $atoms set beta {${scores.map((value) => value.toFixed(3)).join(" ")}}`,
      "  $atoms delete",
    );
  }
  if (scene.mode !== "surface") {
    if (scene.baseScores.size) {
      representation(base, "not hetero", null, "Opaque");
      lines.push("  mol scaleminmax $molecule 0 -1.0 1.0");
    } else {
      coloredRepresentation(base, scene.shade, "Opaque");
    }
  }
  if (hasMolecularSurface(scene.mode)) {
    lines.push(
      "  set surfaceMaterial [material add copy Transparent]",
      `  material change opacity $surfaceMaterial ${scene.surfaceOpacity.toFixed(2)}`,
    );
    if (scene.baseScores.size) {
      representation("QuickSurf", "not hetero", null, "$surfaceMaterial");
      lines.push(`  mol scaleminmax $molecule ${scene.mode === "surface" ? 0 : 1} -1.0 1.0`);
    } else {
      coloredRepresentation("QuickSurf", "#a7c7bf", "$surfaceMaterial");
    }
  }
  for (const group of scene.sticks) {
    const indexes = selected(group.ids);
    if (indexes.length)
      representation(
        `Licorice ${group.radius} 12 12`,
        `index ${indexes.join(" ")}`,
        group.shade,
        "Opaque",
      );
  }
  for (const { xyz, end, shade, radius } of scene.markers) {
    lines.push(`  graphics $molecule color ${vmdShade(shade)}`);
    lines.push(
      end
        ? `  graphics $molecule cylinder {${xyz.join(" ")}} {${end.join(" ")}} radius ${radius} resolution 16 filled yes`
        : `  graphics $molecule sphere {${xyz.join(" ")}} radius ${radius} resolution 12`,
    );
  }
  lines.push("  graphics $molecule color yellow");
  for (const { xyz, text } of scene.labels) {
    lines.push(
      `  graphics $molecule text {${xyz.join(" ")}} [encoding convertfrom utf-8 [binary format H* {${tclHex(text)}}]] size 1`,
    );
  }
  lines.push(
    ...(scene.background ? [`  color Display Background ${scene.background === "#ffffff" ? "white" : "black"}`] : []),
    "  display resetview",
    "  return $molecule",
    "}",
    "allosteric_explorer_scene",
    "",
  );
  return lines.join("\n");
}

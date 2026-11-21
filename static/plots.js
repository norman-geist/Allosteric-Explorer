"use strict";

const svgNamespace = "http://www.w3.org/2000/svg";
const plotBox = { left: 65, top: 62, width: 450, height: 248 };
const plotTheme = Object.freeze({
  font: "Arial, Helvetica, sans-serif", ink: "#182922", muted: "#40574c", grid: "#e3eae4",
  negative: "#3261a2", neutral: "#f6f7f6", positive: "#b13743",
  regionA: "#c445a0", regionB: "#179dbd", highlighted: "#d28b16", predicted: "#576dca",
  clusters: ["#3679a4", "#bd7434", "#7a8c38", "#9363ac", "#278a80", "#bc5876", "#6477bb", "#9c853a", "#6c9c73", "#9c657a", "#5a8e9b", "#a16c4e"],
});
const diverging = [plotTheme.negative, plotTheme.neutral, plotTheme.positive];
function clusterColor(id) { return id === -1 ? "#9aaca6" : !id ? "#64756e" : id <= plotTheme.clusters.length ? plotTheme.clusters[id - 1] : `hsl(${(id * 137.508) % 360} 46% 44%)`; }


function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS(svgNamespace, tag);
  for (const [key, value] of Object.entries(attributes))
    node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function pngExportDpi() {
  return Number($("pngDpi").value);
}

async function savePng(blob, name, dpi) {
  const bytes = new DataView(await blob.arrayBuffer());
  if (bytes.byteLength < 33 || bytes.getUint32(0) !== 0x89504e47 || bytes.getUint32(4) !== 0x0d0a1a0a)
    throw new Error("The rendered image is not a valid PNG.");

  // A pHYs chunk records equal horizontal and vertical pixels per metre.
  const density = new Uint8Array(21);
  const chunk = new DataView(density.buffer);
  const pixelsPerMetre = Math.round(dpi / 0.0254);
  const pHYs = 0x70485973;
  chunk.setUint32(0, 9);
  chunk.setUint32(4, pHYs);
  chunk.setUint32(8, pixelsPerMetre);
  chunk.setUint32(12, pixelsPerMetre);
  density[16] = 1;
  let crc = 0xffffffff;
  for (const byte of density.subarray(4, 17)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  chunk.setUint32(17, crc ^ 0xffffffff);

  for (let start = 8; start + 12 <= bytes.byteLength;) {
    const end = start + bytes.getUint32(start) + 12;
    if (end > bytes.byteLength) break;
    const type = bytes.getUint32(start + 4);
    if (type === pHYs || type === 0x49444154) { // Replace pHYs or insert before the first IDAT.
      const after = type === pHYs ? end : start;
      await saveBlob(new Blob([blob.slice(0, start), density, blob.slice(after)], { type: "image/png" }), name);
      return;
    }
    start = end;
  }
  throw new Error("The rendered PNG is missing image data.");
}

function plotCard(title, filename, width = 560, height = 385) {
  const card = document.createElement("figure");
  card.className = "diagnostic";
  const svg = svgNode("svg", {
    xmlns: svgNamespace,
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": title,
    "font-family": plotTheme.font,
    "font-size": 11,
  });
  svg.append(
    svgNode("rect", { width, height, fill: "white" }),
    svgNode(
      "text",
      { x: 18, y: 26, "font-size": Math.max(11, Math.min(16, (width - 36) / (title.length * 0.56))), "font-weight": "bold", fill: plotTheme.ink },
      title,
    ),
  );
  const status = document.createElement("figcaption");
  status.className = "plot-readout";
  status.setAttribute("role", "status");
  const tools = document.createElement("div");
  tools.className = "result-buttons plot-export-tools";
  for (const format of ["SVG", "PNG"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Save ${format}`;
    button.setAttribute("aria-label", `Export ${title} as ${format}`);
    button.onclick = () => {
      const xml = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
      if (format === "SVG") {
        saveBlob(blob, `${filename}.svg`);
        return;
      }
      const dpi = pngExportDpi();
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * dpi / 96);
        canvas.height = Math.round(height * dpi / 96);
        canvas
          .getContext("2d")
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(async (png) => {
          try {
            if (!png) throw new Error("Could not render the plot at the selected PNG DPI.");
            await savePng(png, `${filename}.png`, dpi);
          } catch (error) {
            status.textContent = error.message;
          }
        });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        status.textContent = "PNG export failed. The SVG export is available.";
      };
      image.src = url;
    };
    tools.append(button);
  }
  card.append(svg, status, tools);
  const plot = {
    card, svg, status, tools,
    addData(rows) {
      const button = element("button", "Data CSV");
      button.type = "button";
      button.setAttribute("aria-label", `Export data for ${title} as CSV`);
      plot.exportData = () => exportCsv(rows(), `${filename}.csv`);
      button.onclick = plot.exportData;
      tools.append(button);
    },
  };
  return plot;
}

function pocketTrackingSummary(samples) {
  const matched = samples.filter(({ detected }) => detected);
  const volumes = matched.map(({ volume }) => volume).filter(Number.isFinite);
  return {
    frames: samples.length,
    matched: matched.length,
    occupancy: matched.length / samples.length,
    volumeFrames: volumes.length,
    meanVolume: volumes.length ? volumes.reduce((total, volume) => total + volume, 0) / volumes.length : null,
  };
}

function renderPocketTracking(pockets, referenceName, activeId, onSelect, onPreview, onScan, workers, settings = {}) {
  const root = $("pocketTrackingResults");
  const slot = element("div");
  const inspection = element("div");
  const chooser = element("select");
  chooser.id = "trackedPocketChoice";
  chooser.append(...pockets.map(({ id }) => new Option(`Pocket ${id}`, id)));
  const label = element("label", "Inspect tracked pocket");
  label.htmlFor = chooser.id;
  const { table, body } = resultsTable([
    "Reference pocket", "Matched frames", "Sampled frames", "Occupancy (%)", "Mean matched volume (Å³)", "Frames with volume",
  ]);
  const summary = [
    ["reference_pocket", "matched_frames", "sampled_frames", "occupancy_percent", "mean_matched_volume_A3", "frames_with_volume"],
  ];
  function selectPocket(id) {
    const pocket = pockets.find((item) => item.id === id);
    chooser.value = String(id);
    const frame = onSelect(pocket);
    renderTrackedPocket(slot, pocket, frame, (next, ready) => onPreview(pocket, next, ready), (next) => onScan(pocket, next), inspection);
  }
  chooser.onchange = () => { if (!state.busy) selectPocket(Number(chooser.value)); };
  for (const { id, samples } of pockets) {
    const { frames, matched, occupancy, meanVolume, volumeFrames } = pocketTrackingSummary(samples);
    summary.push([id, matched, frames, 100 * occupancy, meanVolume, volumeFrames]);
    const row = body.insertRow();
    const button = element("button", `Pocket ${id}`, "residue-link");
    button.type = "button";
    button.onclick = () => { if (!state.busy) selectPocket(id); };
    row.insertCell().append(button);
    for (const value of [matched, frames, number(100 * occupancy, 1), number(meanVolume, 2), volumeFrames]) {
      row.insertCell().textContent = value;
    }
  }
  const exportRows = (label, filename, getRows) => {
    const button = element("button", label);
    button.type = "button";
    button.onclick = () => exportCsv(getRows(), filename);
    return button;
  };
  const toolbar = element("div", null, "result-buttons");
  toolbar.append(
    exportRows("Export summary CSV", "pocket_tracking_summary.csv", () => summary),
    exportRows("Export all frame data CSV", "pocket_tracking_frames.csv", () => [
      ["reference_pocket", "frame", "detected", "lining_overlap", "volume_A3", "is_reference"],
      ...pockets.flatMap(({ id, samples, volume }) => [
        [id, -1, true, 1, volume ?? null, true],
        ...samples.map((s) => [id, s.frame, s.detected, s.overlap, s.volume, false]),
      ]),
    ]),
  );
  const wrap = element("div", null, "rank-table");
  wrap.append(table);
  const selection = element("div", null, "target-row");
  selection.append(label, chooser);
  const title = workers ? `Pocket tracking · ${referenceName} · ${workers} fpocket ${workers === 1 ? "worker" : "workers"}`
    : `Pocket tracking · ${referenceName}`;
  const plotSection=resultSection("Plots", "plots"); plotSection.append(selection, slot);
  const tableSection=resultSection("Tables", "tables"); tableSection.append(toolbar, wrap);
  const detailSection=resultSection("Frame inspection", "inspection"); detailSection.append(inspection);
  root.replaceChildren(element("h3", title), analysisSummary("pocket_tracking", settings, [`${pockets.length} tracked pockets`, "Original PDB excluded from occupancy and volume means"]),
    element("small", "Occupancy is the percentage of sampled frames with a match. Mean volume uses matched frames with reported volumes."),
    plotSection, tableSection, detailSection);
  root.hidden = false;
  selectPocket(activeId);
}

function renderTrackedPocket(root, { id, samples, volume: referenceVolume = null }, initialFrame, onPreview, onScan, inspection = null) {
  const detected = samples.filter((sample) => sample.detected).length;
  const firstFrame = samples[0].frame;
  const lastFrame = samples.at(-1).frame;
  const referenceX = firstFrame - Math.max(1, (lastFrame - firstFrame) * 0.16);
  const xValue = ({ frame }) => frame === -1 ? referenceX : frame;
  const frames = [{ frame: -1, detected: true, overlap: 1, volume: referenceVolume }, ...samples];
  const xRange = paddedRange(frames.map(xValue));
  const xLabel = "Trajectory frame (zero-based)";
  const frameTicks = [...new Set(ticks(firstFrame, lastFrame).map(Math.round))];
  const xAxis = {
    xTicks: [referenceX, ...frameTicks],
    xTickText: (x) => x === referenceX ? "PDB (−1)" : String(x),
  };
  const frameLabel = (frame) => frame === -1 ? "Original PDB · frame −1" : `Frame ${frame}`;
  const occurrence = plotCard(`Pocket ${id} · detection by frame`, `pocket_${id}_detection`);
  const volume = plotCard(`Pocket ${id} · volume by frame`, `pocket_${id}_volume`);
  occurrence.addData(() => [
    ["frame", "detected", "lining_overlap", "is_reference"],
    ...frames.map(({ frame, detected, overlap }) => [frame, Number(detected), overlap, frame === -1]),
  ]);
  volume.addData(() => [
    ["frame", "volume_angstrom3", "detected", "is_reference"],
    ...frames.map(({ frame, detected, volume }) => [frame, volume, detected, frame === -1]),
  ]);
  const detectionAxis = axes(occurrence.svg, xRange, [-0.15, 1.15], xLabel, "Detected (0/1)", { ...xAxis, yTicks: [0, 1] });
  const upper = Math.max(1, ...frames.map(({ volume }) => volume ?? 0)) * 1.08;
  const volumeAxis = axes(volume.svg, xRange, [0, upper], xLabel, "Volume (Å³)", xAxis);
  let previous = null;
  for (const sample of frames) {
    const x = xValue(sample);
    const marker = svgNode("circle", {
      cx: detectionAxis.x(x), cy: detectionAxis.y(Number(sample.detected)), r: 3.5,
      fill: sample.frame === -1 ? "#8f54c2" : sample.detected ? "#216a51" : "#849590",
    });
    marker.append(svgNode("title", {}, `${frameLabel(sample.frame)} · lining overlap ${number(sample.overlap, 3)}`));
    occurrence.svg.append(marker);
    if (sample.volume === null) {
      previous = null;
      continue;
    }
    if (previous) volume.svg.append(svgNode("line", {
      x1: volumeAxis.x(xValue(previous)), y1: volumeAxis.y(previous.volume),
      x2: volumeAxis.x(x), y2: volumeAxis.y(sample.volume), stroke: "#216a51",
    }));
    const dot = svgNode("circle", { cx: volumeAxis.x(x), cy: volumeAxis.y(sample.volume), r: 3.3, fill: sample.frame === -1 ? "#8f54c2" : "#216a51" });
    dot.append(svgNode("title", {}, `${frameLabel(sample.frame)} · ${number(sample.volume, 2)} Å³`));
    volume.svg.append(dot);
    previous = sample.frame === -1 ? null : sample;
  }
  occurrence.status.textContent = `Occupancy ${number(100 * detected / samples.length, 1)}% · detected in ${detected}/${samples.length} trajectory frames. The PDB is a separate reference.`;
  volume.status.textContent = frames.some(({ volume }) => volume !== null)
    ? "Lines join consecutive samples with reported volumes. Gaps indicate no qualifying match or no reported volume. The PDB reference is separate."
    : "No volume was reported for the sampled frames.";
  const picker = element("select");
  picker.id = "trackedPocketFrame";
  picker.append(new Option("Current structure (exit preview)", ""),
    ...frames.map(({ frame, detected }) => new Option(`${frameLabel(frame)}${detected ? "" : " · no match"}`, frame)));
  const label = element("label", "Inspect frame");
  label.htmlFor = picker.id;
  const scan = element("button", "Run pocket detection on frame");
  scan.id = "scanTrackedFrame";
  scan.type = "button";
  scan.disabled = true;
  scan.onclick = () => onScan(Number(scan.dataset.frame));
  const readout = element("p", "Select a frame in either plot or from the list to preview it in 3D.");
  readout.setAttribute("role", "status");
  const traces = [
    { plot: occurrence, axis: detectionAxis, value: (sample) => Number(sample.detected) },
    { plot: volume, axis: volumeAxis, value: (sample) => sample.volume },
  ];
  function selectFrame(sample) {
    picker.value = sample ? String(sample.frame) : "";
    scan.dataset.frame = picker.value;
    scan.disabled = !sample || state.busy;
    readout.textContent = sample
      ? `${frameLabel(sample.frame)} · ${sample.frame === -1 ? "Reference pocket" : sample.detected ? "Pocket matched during tracking" : "No qualifying match during tracking"} · overlap ${number(sample.overlap, 3)}${sample.volume === null ? "" : ` · ${number(sample.volume, 2)} Å³`}`
      : "Select a frame in either plot or from the list to preview it in 3D.";
    for (const { guide, axis, value } of traces) {
      guide.replaceChildren();
      if (!sample) continue;
      const x = axis.x(xValue(sample));
      guide.append(svgNode("line", { x1: x, x2: x, y1: axis.top, y2: axis.bottom, stroke: "#925816", "stroke-dasharray": "4 3" }));
      const y = value(sample);
      if (y !== null) guide.append(svgNode("circle", { cx: x, cy: axis.y(y), r: 5, fill: "#925816", stroke: "white" }));
    }
  }
  for (const trace of traces) {
    const { plot, axis, value } = trace;
    trace.guide = svgNode("g", { "pointer-events": "none" });
    plot.svg.append(trace.guide);
    if (!frames.some((sample) => value(sample) !== null)) continue;
    const hit = svgNode("rect", { x: axis.left, y: axis.top, width: axis.width, height: axis.height, fill: "transparent", class: "plot-hit" });
    function sampleAt(event) {
      const x = cursor(plot.svg, event).x;
      const distance = (sample) => Math.abs(axis.x(xValue(sample)) - x);
      return frames.reduce((nearest, sample) => distance(sample) < distance(nearest) ? sample : nearest);
    }
    const summary = plot.status.textContent;
    hit.onpointermove = (event) => {
      const sample = sampleAt(event);
      if (value(sample) === null) {
        const reason = sample.detected ? "no volume reported" : "no qualifying match";
        plot.status.textContent = `${frameLabel(sample.frame)} · ${reason} · select it on the detection plot`;
        return;
      }
      const { frame, detected, volume } = sample;
      plot.status.textContent = `${frameLabel(frame)} · ${frame === -1 ? "Reference pocket" : detected ? "Pocket matched" : "No qualifying match"}${volume === null ? "" : ` · ${number(volume, 2)} Å³`}`;
    };
    hit.onpointerleave = () => { plot.status.textContent = summary; };
    hit.onclick = (event) => {
      const sample = sampleAt(event);
      if (!state.busy && value(sample) !== null) onPreview(sample.frame, () => selectFrame(sample));
    };
    plot.svg.append(hit);
  }
  picker.onchange = () => {
    const sample = frames.find(({ frame }) => String(frame) === picker.value);
    picker.value = scan.dataset.frame || "";
    onPreview(sample?.frame ?? null, () => selectFrame(sample));
  };
  const csv = element("button", "Export tracking CSV");
  csv.type = "button";
  csv.onclick = () => exportCsv([
    ["frame", "detected", "lining_overlap", "volume_A3"],
    ...frames.map(({ frame, detected, overlap, volume }) => [frame, detected, overlap, volume]),
  ], `pocket_${id}_tracking.csv`);
  const figures = element("div", null, "diagnostic-grid");
  figures.append(occurrence.card, volume.card);
  const controls = element("div", null, "result-buttons");
  controls.append(label, picker, scan, csv);
  root.replaceChildren(figures);
  (inspection || root).replaceChildren(...(inspection ? [] : [figures]), readout, controls,
    element("small", "A preview changes the 3D view only. Running pocket detection replaces the current structure and its analyses."));
  selectFrame(frames.find(({ frame }) => frame === initialFrame));
}

function pocketCouplingPlot(result, pockets, onPick) {
  const anchor = result.settings.functional.length ? "functional reference" : "Region A";
  return pocketScorePlot(pockets, result.pockets.map(({ id, coupling, residues }) => ({ id, score: coupling, count: residues })), {
    title: `Pocket coupling to ${anchor}`, filename: "pocket_coupling", metric: "Mean |r|", upper: 1,
    description: "Mean across lining residues and reference residues · reference residues excluded from pocket",
    caption: "Select a pocket to inspect its lining residues. n counts mapped lining residues outside the reference.",
    onPick,
  });
}

function pocketScorePlot(pockets, ranked, { title, filename, metric, upper, description, caption, onPick, dataRows, xTicks, showCount = true }) {
  const scores = new Map(ranked.map((pocket) => [pocket.id, pocket]));
  const ids = [...scores.keys(), ...pockets.filter(({ id }) => !scores.has(id)).map(({ id }) => id)];
  const box = { left: 92, top: 57, width: 343, height: ids.length * 25 };
  const plot = plotCard(title, filename, 560, box.height + 106);
  plot.addData(dataRows || (() => [
    ["pocket", "series", "metric", "score", "lining_residues_scored"],
    ...ids.map((id) => [id, title, metric, scores.get(id)?.score, scores.get(id)?.count ?? 0]),
  ]));
  const axis = axes(plot.svg, [0, upper], [0, ids.length], metric, "", { box, yTicks: [], xTicks });
  plot.svg.append(svgNode("text", { x: 18, y: 45, fill: "#40574c", "font-size": 10 }, description));
  for (const [i, id] of ids.entries()) {
    const pocket = scores.get(id);
    const y = box.top + i * 25 + 12;
    const formatted = pocket ? String(Number(pocket.score.toPrecision(4))) : "";
    const detail = pocket && `Pocket ${id} · ${metric}: ${formatted}${showCount ? ` · ${pocket.count} lining residues used` : ""}`;
    plot.svg.append(svgNode("text", { x: box.left - 8, y: y + 4, "text-anchor": "end", fill: "#40574c" }, `Pocket ${id}`));
    if (pocket) {
      const bar = svgNode("rect", { x: axis.x(0), y: y - 6, width: axis.x(pocket.score) - axis.x(0), height: 12, fill: color(id), stroke: "#55665e" });
      bar.append(svgNode("title", {}, detail));
      plot.svg.append(bar);
    }
    plot.svg.append(svgNode("text", { x: box.left + box.width + 9, y: y + 4, fill: "#40574c" },
      pocket ? `${formatted}${showCount ? ` · n = ${pocket.count}` : ""}` : "No eligible residues"));
    if (pocket && onPick) {
      const target = svgNode("rect", {
        x: 10, y: y - 11, width: 540, height: 22, fill: "transparent",
        tabindex: 0, role: "button", class: "plot-hit", "aria-label": `Inspect Pocket ${id}`,
      });
      target.append(svgNode("title", {}, detail));
      target.onclick = () => onPick(id);
      target.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPick(id);
        }
      };
      plot.svg.append(target);
    }
  }
  plot.status.textContent = caption;
  return plot.card;
}

function ticks(min, max, count = 4) {
  return Array.from(
    { length: count + 1 },
    (_, i) => min + ((max - min) * i) / count,
  );
}

function indexTicks(n) {
  return [...new Set(ticks(1, n).map(Math.round))];
}

function axes(svg, xDomain, yDomain, xLabel, yLabel, options = {}) {
  const { left, top, width, height } = options.box || plotBox;
  const right = left + width;
  const bottom = top + height;
  const x = (v) =>
    left + (width * (v - xDomain[0])) / (xDomain[1] - xDomain[0]);
  const y = (v) =>
    bottom - (height * (v - yDomain[0])) / (yDomain[1] - yDomain[0]);
  const put = (tag, attr, text) => svg.append(svgNode(tag, attr, text));
  const labelColor = plotTheme.muted;
  const tickText = (v) =>
    String(Number.isInteger(v) ? v : Number(v.toPrecision(3)));
  for (const v of options.yTicks || ticks(...yDomain)) {
    const yy = y(v);
    if (!options.noGrid)
      put("line", { x1: left, x2: right, y1: yy, y2: yy, stroke: plotTheme.grid });
    put(
      "text",
      { x: left - 8, y: yy + 4, "text-anchor": "end", fill: labelColor },
      tickText(v),
    );
  }
  for (const v of options.xTicks || ticks(...xDomain)) {
    const xx = x(v);
    put("line", {
      x1: xx,
      x2: xx,
      y1: bottom,
      y2: bottom + 4,
      stroke: labelColor,
    });
    put(
      "text",
      { x: xx, y: bottom + 17, "text-anchor": "middle", fill: labelColor },
      (options.xTickText || tickText)(v),
    );
  }
  put("path", {
    d: `M${left},${top} V${bottom} H${right}`,
    fill: "none",
    stroke: labelColor,
  });
  put(
    "text",
    {
      x: (left + right) / 2,
      y: bottom + 36,
      "font-size": 12,
      "text-anchor": "middle",
      fill: labelColor,
    },
    xLabel,
  );
  put(
    "text",
    {
      transform: `translate(17 ${(top + bottom) / 2}) rotate(-90)`,
      "font-size": 12,
      "text-anchor": "middle",
      fill: labelColor,
    },
    yLabel,
  );
  return { x, y, left, right, top, bottom, width, height };
}

function cursor(svg, event) {
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(
    svg.getScreenCTM().inverse(),
  );
}

function colorStops(value) {
  const fraction = Math.abs(value);
  const extreme = value < 0 ? [50, 97, 162] : [177, 55, 67];
  return [246, 247, 246].map((v, i) =>
    Math.round(v + fraction * (extreme[i] - v)),
  );
}

function plotSiteKey(svg, groups) {
  const key = svgNode("g", { "font-size": 9, fill: "#40574c" });
  let x = 65;
  for (const { name, color } of groups) {
    key.append(
      svgNode("circle", { cx: x, cy: 44, r: 3, fill: color }),
      svgNode("text", { x: x + 6, y: 47 }, name),
    );
    x += name.length * 5.3 + 18;
  }
  svg.append(key);
  return key;
}

function profilePlot(result, nameOf, onPick) {
  const plot = plotCard("Coupling to Region A", "region_a_coupling");
  const { svg, status } = plot;
  const n = result.nodes;
  const a = axes(
    svg,
    [1, n],
    [-1, 1],
    "Residue node (1-based)",
    "Correlation to Region A",
    {
      xTicks: indexTicks(n),
      yTicks: [-1, -0.5, 0, 0.5, 1],
    },
  );
  const profile = result.profile;
  plot.addData(() => [
    ["node", "residue", "mean_absolute_correlation", "mean_signed_correlation"],
    ...profile.map(({ id, coupling, signed }, i) => [i + 1, nameOf(id), coupling, signed]),
  ]);
  for (const [key, stroke, dash] of [
    ["coupling", "#216a51", ""],
    ["signed", "#626781", "4 3"],
  ]) {
    svg.append(
      svgNode("polyline", {
        points: profile
          .map(
            (row, i) => `${a.x(i + 1).toFixed(2)},${a.y(row[key]).toFixed(2)}`,
          )
          .join(" "),
        fill: "none",
        stroke,
        "stroke-width": 1.35,
        "stroke-dasharray": dash,
      }),
    );
  }
  svg.append(
    svgNode("text", { x: 264, y: 26, fill: "#216a51" }, "Solid  Mean |r|"),
    svgNode(
      "text",
      { x: 358, y: 26, fill: "#626781" },
      "Dashed  Mean signed r",
    ),
  );
  const marks = svgNode("g");
  svg.append(marks);
  let key;
  plot.update = (groups, focus) => {
    key?.remove();
    key = plotSiteKey(svg, groups);
    marks.replaceChildren();
    const locations = new Map(profile.map((r, i) => [r.id, i + 1]));
    const overlap = new Map();
    for (const group of groups) {
      for (const id of group.ids) {
        const index = locations.get(id);
        if (index == null) continue;
        const layers = overlap.get(id) || 0;
        marks.append(svgNode("circle", {
          cx: a.x(index),
          cy: a.y(profile[index - 1].coupling),
          r: 3.1 + layers * 1.8,
          fill: layers ? "none" : group.color,
          stroke: layers ? group.color : "#ffffff",
          "stroke-width": layers ? 1.2 : 0.6,
          "data-site": group.name,
        }));
        overlap.set(id, layers + 1);
      }
    }
    const i = locations.get(focus);
    if (i != null)
      marks.append(
        svgNode("line", {
          x1: a.x(i),
          x2: a.x(i),
          y1: a.top,
          y2: a.bottom,
          stroke: "#283630",
          "stroke-dasharray": "3 3",
        }),
      );
  };
  const hit = svgNode("rect", {
    x: a.left,
    y: a.top,
    width: a.width,
    height: a.height,
    fill: "transparent",
    class: "plot-hit",
  });
  svg.append(hit);
  const nodeAt = (event) =>
    profile[
      Math.max(
        0,
        Math.min(
          n - 1,
          Math.round(((cursor(svg, event).x - a.left) / a.width) * (n - 1)),
        ),
      )
    ];
  hit.onpointermove = (event) => {
    const r = nodeAt(event);
    status.textContent = `${nameOf(r.id)} · mean |r| ${r.coupling.toFixed(3)} · signed mean ${r.signed.toFixed(3)}`;
  };
  hit.onclick = (event) => onPick(nodeAt(event).id);
  status.textContent =
    "Hover for residue values. Click a residue to inspect it in 3D.";
  return plot;
}

function matrixPlot(result, matrix, nameOf, onPick) {
  const plot = plotCard(
    "Signed correlation matrix",
    "signed_correlation_matrix",
  );
  const { svg, status } = plot;
  const meaning = result.settings.method === "contacts"
    ? "Red (+r) means the two residues’ contact counts tend to rise and fall together. Blue (−r) means one tends to rise as the other falls."
    : "Red (+r) means the two Cα atoms tend to move in the same direction after alignment. Blue (−r) means they tend to move in opposite directions.";
  plot.tools.classList.add("plot-tools-with-help");
  plot.tools.append(...helpControl("correlation-map-help", "How to read the correlation map",
    `Each cell compares the residue on its row with the residue on its column. ${meaning} Paler colors near zero indicate weak measured correlation. The diagonal compares residues with themselves. Hover for residue names and the signed coefficient.`,
    "Read the map"));
  const n = result.nodes;
  const box = { left: 86, top: 62, width: 248, height: 248 };
  function* matrixRows() {
    const labels = result.profile.map(({ id }) => nameOf(id));
    yield ["node", ...labels];
    for (const [i, label] of labels.entries()) yield [label, ...matrix.subarray(i * n, (i + 1) * n)];
  }
  plot.addData(matrixRows);
  const a = axes(
    svg,
    [0.5, n + 0.5],
    [0.5, n + 0.5],
    "Residue node (1-based)",
    "Residue node (1-based)",
    {
      box,
      xTicks: indexTicks(n),
      yTicks: indexTicks(n),
      noGrid: true,
    },
  );
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n;
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(n, n);
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      const v = matrix[row * n + column];
      const i = ((n - row - 1) * n + column) * 4;
      const t = Math.abs(v);
      pixels.data[i] = 246 + t * ((v < 0 ? 50 : 177) - 246);
      pixels.data[i + 1] = 247 + t * ((v < 0 ? 97 : 55) - 247);
      pixels.data[i + 2] = 246 + t * ((v < 0 ? 162 : 67) - 246);
      pixels.data[i + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  svg.append(
    svgNode("image", {
      x: a.left,
      y: a.top,
      width: a.width,
      height: a.height,
      href: canvas.toDataURL("image/png"),
      style: "image-rendering:pixelated",
    }),
  );
  const gradient = svgNode("linearGradient", {
    id: "signed-gradient",
    x1: "0",
    x2: "0",
    y1: "1",
    y2: "0",
  });
  diverging.forEach((shade, i) =>
    gradient.append(svgNode("stop", { offset: i / 2, "stop-color": shade })),
  );
  svg.append(
    gradient,
    svgNode("rect", {
      x: 354,
      y: a.top,
      width: 14,
      height: a.height,
      fill: "url(#signed-gradient)",
    }),
  );
  for (const v of [-1, -0.5, 0, 0.5, 1])
    svg.append(
      svgNode(
        "text",
        { x: 376, y: a.top + ((1 - v) / 2) * a.height + 4, fill: "#40574c" },
        String(v),
      ),
    );
  svg.append(
    svgNode(
      "text",
      { x: 407, y: 76, fill: "#40574c" },
      "Pairwise correlation r",
    ),
  );
  const marks = svgNode("g");
  svg.append(marks);
  let key;
  plot.update = (groups, focus) => {
    key?.remove();
    key = plotSiteKey(svg, groups);
    marks.replaceChildren();
    const locations = new Map(result.profile.map((r, i) => [r.id, i + 1]));
    for (const [lane, group] of groups.entries()) {
      const path = [...group.ids]
        .filter((id) => locations.has(id))
        .map((id) => {
          const i = locations.get(id);
          return `M${a.x(i).toFixed(2)},${a.top - 2 - lane * 3}v-2 M${a.right + 2 + lane * 3},${a.y(i).toFixed(2)}h2`;
        })
        .join("");
      marks.append(
        svgNode("path", { d: path, stroke: group.color, "stroke-width": 2 }),
      );
    }
    const i = locations.get(focus);
    if (i != null)
      marks.append(
        svgNode("path", {
          d: `M${a.x(i)},${a.top}V${a.bottom} M${a.left},${a.y(i)}H${a.right}`,
          fill: "none",
          stroke: "#283630",
          "stroke-dasharray": "3 3",
        }),
      );
  };
  const hit = svgNode("rect", {
    x: a.left,
    y: a.top,
    width: a.width,
    height: a.height,
    fill: "transparent",
    class: "plot-hit",
  });
  svg.append(hit);
  function cellAt(event) {
    const p = cursor(svg, event);
    const clamp = (v) => Math.min(n - 1, Math.max(0, Math.floor(v * n)));
    return [
      clamp((a.bottom - p.y) / a.height),
      clamp((p.x - a.left) / a.width),
    ];
  }
  hit.onpointermove = (event) => {
    const [row, col] = cellAt(event);
    status.textContent = `${nameOf(result.profile[row].id)} × ${nameOf(result.profile[col].id)} · r ${matrix[row * n + col].toFixed(3)}`;
  };
  hit.onclick = (event) => onPick(result.profile[cellAt(event)[1]].id);
  status.textContent =
    "Hover for the residue pair and signed r. Click to inspect the column residue.";
  return plot;
}

function scatterPlot(result, consistency, nameOf, onPick) {
  const plot = consistency
    ? plotCard("First-half vs second-half coupling", "coupling_consistency")
    : plotCard("Cartesian PCA", "cartesian_pca");
  const { svg, status } = plot;
  const data = consistency ? result.profile.map((r) => r.halves) : result.pc;
  plot.addData(() => consistency ? [
    ["node", "residue", "first_half_mean_absolute_correlation", "second_half_mean_absolute_correlation"],
    ...data.map(([x, y], i) => [i + 1, nameOf(result.profile[i].id), x, y]),
  ] : [
    ["frame", "PC1_angstrom", "PC2_angstrom", "PC1_variance_fraction", "PC2_variance_fraction"],
    ...data.map(([x, y], i) => [result.frame_indices[i], x, y, ...result.pc_variance.slice(0, 2)]),
  ]);
  function domain(dim) {
    const values = data.map((point) => point[dim]);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const padding = (hi - lo) * 0.07 || 1;
    return [lo - padding, hi + padding];
  }
  const varLabel = (axis) =>
    `PC${axis + 1} (Å · ${(result.pc_variance[axis] * 100).toFixed(1)}% variance)`;
  const a = consistency
    ? axes(svg, [0, 1], [0, 1], "First half mean |r|", "Second half mean |r|")
    : axes(svg, domain(0), domain(1), varLabel(0), varLabel(1));
  if (consistency)
    svg.append(
      svgNode("line", {
        x1: a.x(0),
        x2: a.x(1),
        y1: a.y(0),
        y2: a.y(1),
        stroke: "#7c8d83",
        "stroke-dasharray": "4 4",
      }),
    );
  const circles = data.map(([x, y], i) => {
    const circle = svgNode("circle", {
      cx: a.x(x),
      cy: a.y(y),
      r: consistency ? 3 : 2.3,
      fill: consistency
        ? "#4f8a76"
        : `rgb(${colorStops((2 * i) / (data.length - 1) - 1).join(",")})`,
      opacity: consistency ? 0.68 : 0.88,
    });
    circle.onpointerenter = () => {
      status.textContent = consistency
        ? `${nameOf(result.profile[i].id)} · first ${x.toFixed(3)} · second ${y.toFixed(3)}`
        : `Trajectory frame ${result.frame_indices[i]} · PC1 ${x.toFixed(3)} Å · PC2 ${y.toFixed(3)} Å`;
    };
    if (consistency) {
      circle.onclick = () => onPick(result.profile[i].id);
      circle.classList.add("plot-hit");
    }
    svg.append(circle);
    return circle;
  });
  let key;
  plot.update = (groups, focus) => {
    if (!consistency) return;
    key?.remove();
    key = plotSiteKey(svg, groups);
    result.profile.forEach(({ id }, i) => {
      const shade = [...groups]
        .reverse()
        .find((group) => group.ids.has(id))?.color;
      circles[i].setAttribute("fill", shade || "#4f8a76");
      circles[i].setAttribute("r", id === focus ? 5.4 : shade ? 3.8 : 2.6);
      circles[i].setAttribute("stroke", id === focus ? "#182922" : "none");
    });
  };
  if (!consistency)
    svg.append(
      svgNode(
        "text",
        { x: 65, y: 45, fill: "#40574c" },
        "Frame order · blue early · red late",
      ),
    );
  status.textContent = consistency
    ? "Descriptive split-half comparison. Click a point to inspect the residue."
    : "Hover to see the original trajectory frame index.";
  return plot;
}

function associationPlot(rows, circular, onPick, spec, frameCount) {
  const plot = plotCard('Residue–observable association', 'residue_observable_profile');
  const nodes = [...rows].sort((a,b)=>a.id-b.id);
  const domain = nodes.length > 1 ? [nodes[0].id, nodes.at(-1).id] : [(nodes[0]?.id || 1)-.5,(nodes[0]?.id || 1)+.5];
  const axis = axes(plot.svg, domain, [-1,1], 'Residue node (1-based)', 'Spearman ρ');
  plot.addData(()=>[['residue_node','residue','series','spearman_rho','absolute_ranking_score','feature','retained_frames','observable','scope','reference_residue_ids'], ...nodes.flatMap(row=>row.coefficients.map((value,i)=>[row.id,nameOf(row.id),circular ? i ? 'cos(angle)' : 'sin(angle)' : 'observable',value,row.score,spec.feature,frameCount,spec.observable_title || '',spec.scope || '',(spec.reference || []).join(';')]))]);
  const marks=[];
  for (const row of nodes) for (const [i,value] of row.coefficients.entries()) {
    if (!Number.isFinite(value)) continue;
    const dot=svgNode('circle',{cx:axis.x(row.id),cy:axis.y(value),r:3,fill:circular ? i ? plotTheme.regionB : plotTheme.regionA : value < 0 ? plotTheme.negative : plotTheme.positive,tabindex:0,role:'button','aria-label':`Select ${nameOf(row.id)}; Spearman rho ${value.toFixed(3)}`});
    dot.append(svgNode('title',{},`${nameOf(row.id)} · ρ ${value.toPrecision(4)}`));
    dot.onclick=()=>{onPick(row.id);};dot.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onPick(row.id);}};
    plot.svg.append(dot); marks.push({id:row.id,dot});
  }
  plot.svg.append(svgNode('text',{x:65,y:46,fill:plotTheme.muted,'font-size':10},circular ? 'Magenta: sin(angle) · teal: cos(angle)' : 'Blue: negative association · red: positive association'));
  plot.status.textContent='Select points or table residues to toggle frame-viewer highlights. Association is descriptive, not causal.';
  plot.update=ids=>{for(const {id,dot} of marks){dot.setAttribute('r',ids.has(id)?5:3);dot.setAttribute('stroke',ids.has(id)?plotTheme.highlighted:'none');dot.setAttribute('stroke-width',2);}};
  return plot;
}

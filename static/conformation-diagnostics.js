"use strict";

function projectedOccupancy(run, px, py, bins, temperature) {
  const xDomain = paddedRange(run.projection.map((p) => p[px]));
  const yDomain = paddedRange(run.projection.map((p) => p[py]));
  const index = (value, domain) =>
    Math.max(
      0,
      Math.min(
        bins - 1,
        Math.floor((bins * (value - domain[0])) / (domain[1] - domain[0])),
      ),
    );
  const counts = Array(bins * bins).fill(0);
  for (const row of run.projection)
    counts[index(row[py], yDomain) * bins + index(row[px], xDomain)]++;
  const peak = Math.max(...counts);
  const energy = counts.map((value) =>
    value ? 0.008314462618 * temperature * Math.log(peak / value) : null,
  );
  return { xDomain, yDomain, counts, energy };
}

function landscapeColor(value) {
  // Gnuplot's default palette uses rgbformulae 7, 5, 15.
  return [Math.sqrt(value), value ** 3, Math.max(0, Math.sin(2 * Math.PI * value))]
    .map((channel) => Math.round(255 * channel));
}

function interpolateLandscapeEnergy(energy, bins, x, y) {
  // Interpolate between bin centers and extend the outer samples to the edges.
  const gridX = Math.max(0, Math.min(bins - 1, x - 0.5));
  const gridY = Math.max(0, Math.min(bins - 1, y - 0.5));
  const left = Math.min(bins - 2, Math.floor(gridX));
  const lower = Math.min(bins - 2, Math.floor(gridY));
  const i = lower * bins + left;
  const [ll, lr, ul, ur] = [energy[i], energy[i + 1], energy[i + bins], energy[i + bins + 1]];
  const u = gridX - left;
  const v = gridY - lower;
  return (1 - v) * ((1 - u) * ll + u * lr) + v * ((1 - u) * ul + u * ur);
}

function landscapeRaster(energy, bins, max, interpolate) {
  const canvas = document.createElement("canvas");
  const resolution = bins * (interpolate ? 8 : 1);
  canvas.width = canvas.height = resolution;
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(resolution, resolution);
  const display = interpolate ? energy.map((value) => value ?? max) : energy;
  for (let row = 0; row < resolution; row++) {
    const y = bins * (1 - (row + 0.5) / resolution);
    for (let col = 0; col < resolution; col++) {
      const x = bins * (col + 0.5) / resolution;
      const value = interpolate ? interpolateLandscapeEnergy(display, bins, x, y)
        : display[Math.floor(y) * bins + Math.floor(x)];
      const color = value === null ? [232, 238, 235] : landscapeColor(value / (max || 1));
      const offset = 4 * (row * resolution + col);
      pixels.data.set(color, offset);
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png");
}

function renderLandscape() {
  const run = conformationState.run;
  if (!run || !$("landscapeForm").checkValidity()) return;
  const px = Number($("pcX").value),
    py = Number($("pcY").value);
  const bins = Number($("landscapeBins").value);
  const temperature = Number($("landscapeTemperature").value);
  const interpolate = $("landscapeInterpolate").checked;
  const { xDomain, yDomain, counts, energy } = projectedOccupancy(run, px, py, bins, temperature);
  const max = Math.max(...energy);
  const plot = plotCard("PCA free-energy landscape", "pca_free_energy");
  plot.addData(() => {
    const dx = (xDomain[1] - xDomain[0]) / bins;
    const dy = (yDomain[1] - yDomain[0]) / bins;
    return [
      ["x_bin", "y_bin", "x_pc", "y_pc", "x_lower", "x_upper", "y_lower", "y_upper",
        "frame_count", "apparent_delta_f_kj_mol", "temperature_k", "display_interpolated",
        "empty_bin_display_cap_kj_mol"],
      ...counts.map((count, i) => {
        const x = i % bins, y = Math.floor(i / bins);
        return [x + 1, y + 1, px + 1, py + 1,
          xDomain[0] + x * dx, xDomain[0] + (x + 1) * dx,
          yDomain[0] + y * dy, yDomain[0] + (y + 1) * dy,
          count, energy[i], temperature, interpolate, interpolate ? max : null];
      }),
    ];
  });
  const a = axes(plot.svg, xDomain, yDomain, `PC${px + 1} (${pcaUnit(run)})`, `PC${py + 1} (${pcaUnit(run)})`, {
    box: { left: 65, top: 62, width: 387, height: 248 },
    noGrid: true,
  });
  plot.svg.append(svgNode("image", {
    x: a.left, y: a.top, width: a.width, height: a.height,
    href: landscapeRaster(energy, bins, max, interpolate),
    preserveAspectRatio: "none", "image-rendering": "pixelated",
  }));
  const hit = svgNode("rect", {
    x: a.left, y: a.top, width: a.width, height: a.height, fill: "transparent",
  });
  const caption = "Hover for raw bin counts and apparent ΔF. Thermodynamic interpretation requires equilibrium sampling or reweighting.";
  hit.onpointermove = (event) => {
    const { x, y } = cursor(plot.svg, event);
    const bin = (v) => Math.max(0, Math.min(bins - 1, Math.floor(bins * v)));
    const i = bin((a.bottom - y) / a.height) * bins + bin((x - a.left) / a.width);
    const value = energy[i];
    plot.status.textContent = value === null
      ? interpolate ? "Unsampled bin · 0 frames · bin center uses the display ceiling" : "Unsampled bin · 0 frames"
      : `${counts[i]} frames · apparent ΔF ${number(value, 2)} kJ/mol`;
  };
  hit.onpointerleave = () => { plot.status.textContent = caption; };
  plot.svg.append(hit);
  const colorScale = 40;
  for (let i = 0; i < colorScale; i++) {
    const height = a.height / colorScale;
    plot.svg.append(
      svgNode("rect", {
        x: 470,
        y: a.bottom - (i + 1) * height,
        width: 13,
        height: height + 0.1,
        fill: `rgb(${landscapeColor(max ? i / (colorScale - 1) : 0).join(",")})`,
      }),
    );
  }
  for (const [value, y] of [
    [max, a.top],
    [max / 2, (a.top + a.bottom) / 2],
    [0, a.bottom],
  ]) {
    if (!max && y !== a.bottom) continue;
    plot.svg.append(
      svgNode("text", { x: 488, y: y + 4, fill: "#40574c" }, number(value, 2)),
    );
  }
  plot.svg.append(
    svgNode(
      "text",
      { x: 454, y: 48, fill: "#40574c", "font-size": 10 },
      "ΔF (kJ/mol)",
    ),
    svgNode(
      "text",
      { x: 65, y: 45, fill: "#40574c", "font-size": 10 },
      `All ${run.frames.length} frames · ${bins} × ${bins} bins · ${temperature} K`,
    ),
    svgNode(
      "text",
      { x: 65, y: 370, fill: "#40574c", "font-size": 10 },
      interpolate
        ? "Display interpolation · empty bins set to sampled maximum for coloring"
        : "Raw histogram bins · gray bins are unsampled",
    ),
  );
  plot.status.textContent = caption;
  $("landscapePlot").replaceChildren(plot.card);
}

function clusterBoxPlot(groups, unit, subsetId, frameRows) {
  const width = 640;
  const rowHeight = 32;
  const box = { left: 135, top: 64, width: 480, height: rowHeight * groups.length };
  const plot = plotCard("Observable by cluster", "observable_cluster_boxplot", width, box.top + box.height + 50);
  plot.addData(frameRows);
  const limits = groups.flatMap(({ sample, center, sd }) => [
    sample[0], sample.at(-1), center - (sd ?? 0), center + (sd ?? 0),
  ]);
  const a = axes(plot.svg, paddedRange(limits), [0, groups.length], unit, "", {
    box,
    yTicks: [],
  });
  const ink = "#40574c";
  const meanColor = "#1f4769";
  plot.svg.append(svgNode("text", { x: 18, y: 47, fill: ink, "font-size": 10 },
    "Box Q1–Q3 · line median · whiskers min–max · diamond mean · blue bar ±1 SD"));
  const line = (x1, y1, x2, y2, stroke) =>
    svgNode("line", { x1, y1, x2, y2, stroke, "stroke-width": 1.5 });
  for (const [i, { id, sample, center, sd, median }] of groups.entries()) {
    const quantile = (p) => {
      const position = (sample.length - 1) * p;
      const lower = Math.floor(position);
      return sample[lower] + (sample[Math.ceil(position)] - sample[lower]) * (position - lower);
    };
    const q1 = quantile(0.25), q3 = quantile(0.75);
    const min = sample[0], max = sample.at(-1);
    const name = id ? clusterName(id) : "All retained frames";
    const y = box.top + (i + 0.5) * rowHeight - 4;
    const group = svgNode("g");
    if (id === subsetId) {
      group.append(svgNode("rect", {
        x: 8, y: y - 10, width: width - 16, height: rowHeight,
        fill: "#eef4ef", "fill-opacity": 0.58,
      }));
    }
    group.append(
      svgNode("title", {}, `${name} · n = ${sample.length} · median ${number(median, 3)} · mean ${number(center, 3)} · SD ${number(sd, 3)}`),
      svgNode("text", { x: 18, y: y + 4, fill: ink }, name),
      line(a.x(min), y, a.x(max), y, ink),
      line(a.x(min), y - 4, a.x(min), y + 4, ink),
      line(a.x(max), y - 4, a.x(max), y + 4, ink),
      svgNode("rect", {
        x: a.x(q1), y: y - 6, width: a.x(q3) - a.x(q1), height: 12,
        fill: id ? clusterShade(id) : "#a3b5b0", stroke: ink,
      }),
      line(a.x(median), y - 6, a.x(median), y + 6, ink),
    );
    const meanX = a.x(center), meanY = y + 12;
    if (sd !== null) {
      const low = a.x(center - sd), high = a.x(center + sd);
      group.append(
        line(low, meanY, high, meanY, meanColor),
        line(low, meanY - 2, low, meanY + 2, meanColor),
        line(high, meanY - 2, high, meanY + 2, meanColor),
      );
    }
    group.append(svgNode("path", {
      d: `M${meanX},${meanY - 4} l4,4 -4,4 -4,-4 Z`, fill: meanColor,
    }));
    plot.svg.append(group);
  }
  plot.status.textContent = "SD shows within-group spread. Hover over a row for its summary.";
  return plot.card;
}

function comparisonAnchor(observable) {
  return observable.clusterStats.length > 24
    ? (observable.comparisonAnchor ?? observable.clusterStats[0].id)
    : null;
}

async function updateClusterTests() {
  const observable = conformationState.observable;
  if (!observable || !$("observableCompare").checked) {
    renderObservable();
    return;
  }
  const anchor = comparisonAnchor(observable);
  const isCurrent = () =>
    conformationState.observable === observable &&
    comparisonAnchor(observable) === anchor;
  observable.testResult = null;
  observable.testStatus = "Calculating pairwise Welch tests…";
  renderObservable();
  try {
    const { pairs } = await api("/api/conformations/cluster-tests", {
      groups: observable.clusterStats,
      anchor,
    });
    if (!isCurrent()) return;
    observable.testResult = new Map(
      pairs.map((pair) => [`${pair.first}:${pair.second}`, pair.adjusted]),
    );
    observable.testStatus = "";
  } catch (error) {
    if (isCurrent()) observable.testStatus = error.message;
  }
  if (isCurrent()) renderObservable();
}

function clusterComparisonTable(observable) {
  const { clusterStats: groups, unit } = observable;
  const section = element(
    "section",
    null,
    "observable-stats cluster-comparison",
  );
  section.append(element("h4", "Pairwise cluster differences"));
  const anchor = comparisonAnchor(observable);
  if (anchor !== null) {
    const label = element("label", "Compare cluster ");
    const select = element("select");
    select.append(...groups.map(({ id }) => new Option(clusterName(id), id)));
    select.value = anchor;
    select.onchange = () => {
      observable.comparisonAnchor = Number(select.value);
      updateClusterTests();
    };
    label.append(select);
    section.append(label);
  }

  const testing =
    observable.spec.kind !== "pc" && $("observableCompare").checked;
  const tests = testing ? observable.testResult : null;
  const { table, body } = resultsTable([
    "Cluster pair",
    `Mean difference (${unit})`,
    "Difference / RMS SD",
    ...(testing ? ["Holm-adjusted p", "Exploratory p < 0.05"] : []),
  ]);
  const pairs = [];
  for (const [i, first] of groups.entries()) {
    if (anchor !== null && first.id !== anchor) continue;
    const others =
      anchor === null
        ? groups.slice(i + 1)
        : groups.filter((g) => g.id !== anchor);
    for (const second of others) {
      const difference = first.mean - second.mean;
      const spread = Math.hypot(first.sd, second.sd) / Math.SQRT2;
      pairs.push({
        first,
        second,
        difference,
        standardized: spread ? difference / spread : null,
      });
    }
  }
  pairs.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  for (const { first, second, difference, standardized } of pairs) {
    const row = body.insertRow();
    row.insertCell().textContent = `${first.id} vs ${second.id}`;
    row.insertCell().textContent = number(difference, 4);
    row.insertCell().textContent =
      first.count < 2 || second.count < 2 ? "—" : number(standardized, 3);
    if (testing) {
      const p = tests?.get(`${first.id}:${second.id}`);
      row.insertCell().textContent =
        p == null ? "—" : p < 0.001 ? p.toExponential(2) : number(p, 4);
      const decision = row.insertCell();
      decision.textContent = p == null ? "—" : p < 0.05 ? "Yes" : "No";
      if (p != null && p < 0.05) decision.className = "observable-hit";
    }
  }
  const wrapper = element("div", null, "rank-table");
  wrapper.append(table);
  section.append(
    wrapper,
    element(
      "small",
      "Differences are first minus second. RMS SD combines the two within-cluster SDs. Rows are ordered by absolute mean difference.",
    ),
  );
  if (testing) {
    const status = element(
      "small",
      observable.testStatus ||
        "Framewise Welch tests assume independent observations. Correlated MD frames and clusters found from the same data make these p-values exploratory. Tests require at least five frames per cluster and nonzero variance in at least one group.",
    );
    status.setAttribute("role", "status");
    section.append(status);
  }
  return section;
}

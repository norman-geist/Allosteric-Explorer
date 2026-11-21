"use strict";

const mechanism = {
  path: [],
  prsPick: null,
  prsReceiver: null,
  prsPdb: null,
  prsSources: [],
  prsTargets: [],
  response: [],
  contactViews: [],
};

function resetMechanism() {
  mechanism.path = [];
  $("perturbationForm").reset();
  clearPrsResults(false);
  updatePrsSources();
}

function resetStateContacts() {
  $("contactComparison").hidden = true;
  if ($("prsReference").value) clearPrsResults();
  renderPrsReferences([]);
  $("contactComparison").open = false;
  mechanism.contactHighlightText = null;
  clearStateContactResults();
}

function clearStateContactResults() {
  for (const view of mechanism.contactViews) view.clear();
  mechanism.contactViews = [];
  $("stateContactResults").replaceChildren();
}

function prsGroupOptions() {
  return [
    ...(mechanism.path.length ? [new Option("Transferred path", "path")] : []),
    ...state.pockets.map(({ id }) => new Option(`Pocket ${id}`, `p${id}`)),
    new Option("Custom residues…", "custom"),
  ];
}

function updatePrsSources() {
  for (const [id, field] of [["prsScope", "prsCustomField"], ["prsTargetScope", "prsTargetCustomField"]]) {
    const select = $(id);
    const previous = select.value;
    select.replaceChildren(new Option("All mapped residues", "all"), ...prsGroupOptions());
    if ([...select.options].some(({ value }) => value === previous)) select.value = previous;
    $(field).hidden = select.value !== "custom";
  }
  $("prsRankingFields").hidden = $("prsWorkflow").value !== "sources";
}

function prsSelection(scopeId, customId, caption) {
  const scope = $(scopeId).value;
  if (scope === "all") return [];
  const ids = scope === "path" ? mechanism.path
    : scope === "custom" ? selectedResidues($(customId).value, caption)
      : state.pockets.find(({ id }) => `p${id}` === scope)?.residues;
  if (!ids?.length) throw new Error(`Choose at least one residue for ${caption.toLowerCase()}.`);
  return ids;
}

function mechanismControls() {
  for (const field of $("perturbationForm").querySelectorAll("input, select, button:not(.help-trigger)"))
    field.disabled = state.busy || !state.structure;
  for (const field of $("stateContactForm").querySelectorAll("input, select, button"))
    field.disabled = state.busy || !conformationState.run;
  for (const side of ["A", "B"]) {
    const scope = $(`contactScope${side}`);
    const input = $(`contactGroup${side}`);
    scope.disabled ||= $("contactUsePath").checked;
    input.hidden = scope.value !== "custom";
    input.disabled ||= scope.disabled || input.hidden;
    input.required = !input.hidden;
  }
}

function qualifiedResidues(ids) {
  return ids.map((id) => {
    const r = state.residues.get(id);
    const group = r.chain && r.segid ? `${r.chain}/${r.segid}` : r.segid || r.chain || "_";
    return `${group}:${r.resid}${r.icode}`;
  }).join(", ");
}

function openPathPerturbation(path, targets) {
  if (state.busy || path.length < 2) return;
  mechanism.path = [...path];
  $("prsTarget").value = qualifiedResidues(targets.length ? targets : path.slice(-1));
  clearPrsResults();
  $("prsWorkflow").value = "sources";
  setPanel("perturbation");
  $("prsScope").value = "path";
  $("prsTargetScope").value = "custom";
  $("prsTargetCustomField").hidden = false;
  $("prsCustomField").hidden = true;
  $("perturbationTab").focus();
}

function clearPrsResults(redraw = true) {
  $("prsResults").replaceChildren();
  $("prsResults").hidden = true;
  mechanism.prsPdb = mechanism.prsReceiver = mechanism.inspectReceiver = null;
  mechanism.prsPick = null;
  mechanism.prsSources = [];
  mechanism.prsTargets = [];
  mechanism.response = [];
  if (redraw && state.perturbation) draw();
}

function prsResponderRows(rows, scope, sourceIds, groupIds) {
  const group = new Set(groupIds);
  return rows.filter(({ id, score }) => Number.isFinite(score) &&
    (scope === "all" || (scope === "outside" ? !sourceIds.has(id) : group.has(id))));
}

function renderPrs(result, { workflow, sourceName, targetName, targetRestricted, referenceName, pocketSource }) {
  const root = $("prsResults");
  const summarySlot = element("div");
  const receivers = result.response;
  const forward = workflow === "responders";
  const sourceIds = new Set(result.sources);
  const membership = pocketMembership();
  const receiverIndex = new Map(receivers.map(({ id }, i) => [id, i]));
  const sourceIndex = new Map(result.sources.map((id, i) => [id, i]));
  const bytes = Uint8Array.from(atob(result.pair_scores), (byte) => byte.charCodeAt(0));
  const matrix = new DataView(bytes.buffer);
  function pairScore(source, receiver) {
    const value = matrix.getFloat32(4 * (sourceIndex.get(source) * receivers.length + receiverIndex.get(receiver)), true);
    return Number.isFinite(value) ? value : null;
  }
  const pocketNames = (id) => (membership.get(id) || []).map((p) => `Pocket ${p}`).join(", ");
  mechanism.prsPdb = result.pdb || null;
  mechanism.prsCoordinates = mechanism.prsPdb
    ? new Map(sceneAtoms(mechanism.prsPdb).filter(({ name }) => name === "CA").map(({ id, xyz }) => [id, xyz]))
    : null;
  mechanism.prsTargets = targetRestricted ? result.targets : [];
  mechanism.prsSources = sourceIds.size < receivers.length ? result.sources : [];
  mechanism.prsPick = mechanism.prsReceiver = null;

  const scope = element("select");
  scope.id = "prsResponderScope";
  const outsideLabel = pocketSource ? "Outside the pushed pocket" : "Outside the scanned residues";
  scope.append(new Option("Whole protein", "all"));
  if (sourceIds.size < receivers.length) scope.append(new Option(outsideLabel, "outside"));
  if (targetRestricted) scope.append(new Option(`Monitored region · ${targetName}`, "target"));
  scope.append(...prsGroupOptions());
  let activeScope = forward && sourceIds.size < receivers.length ? "outside" : targetRestricted ? "target" : "all";
  let scopeName = [...scope.options].find(({ value }) => value === activeScope).text;
  let groupIds = targetRestricted ? result.targets : [];
  scope.value = activeScope;
  const scopeLabel = element("label", "Show responses in");
  scopeLabel.htmlFor = scope.id;
  scopeLabel.title = "Filters the responder table, plot, 3D colors, pocket summary, picker, and responder export.";
  const scopeRow = element("div", null, "target-row");
  scopeRow.append(scopeLabel, scope);
  const customForm = element("form", null, "target-row");
  customForm.hidden = true;
  const custom = element("input");
  custom.id = "prsResponderCustom";
  custom.placeholder = "A:85, A:91–94";
  custom.required = true;
  const customLabel = element("label", "Custom responding residues");
  customLabel.htmlFor = custom.id;
  const apply = element("button", "Apply responder scope");
  const scopeError = element("small");
  scopeError.setAttribute("role", "status");
  customForm.append(customLabel, custom, apply);

  const sort = element("select");
  sort.setAttribute("aria-label", "Sort responders");
  sort.append(new Option("Highest response", "score"), new Option("Farthest from displayed push or scan", "distance"));
  const responseTable = resultsTable(["Responding residue", "RMS response", "Nearest displayed source Cα (Å)", "Pockets"]);
  const sourceTable = resultsTable(["Residue pushed", "RMS response", "Target residues scored", "Pockets"]);
  const sourcePane = element("details");
  sourcePane.open = !forward;
  sourcePane.hidden = forward;
  const sourceTitle = element("summary");
  const sourceHint = element("p");
  const sourceWrap = element("div", null, "rank-table");
  sourceWrap.append(sourceTable.table);
  sourcePane.append(sourceTitle, sourceHint, sourceWrap);
  const status = element("p");
  status.setAttribute("role", "status");
  const plotSlot = element("div");
  const pocketPlotSlot = element("div");
  const picker = element("select");
  picker.id = "prsReceiverPicker";
  const pickerLabel = element("label", "Responder to inspect");
  pickerLabel.htmlFor = picker.id;
  const inspect = element("button", "Which pushes drive this response?");
  inspect.type = "button";
  inspect.onclick = () => inspectReceiver(Number(picker.value));
  picker.onchange = () => { inspect.disabled = !picker.value; };
  const pickerRow = element("div", null, "target-row");
  pickerRow.append(pickerLabel, picker, inspect);
  const responderRows = new Map();
  let markReceiver;
  let rankedSources = [];

  function showMap() {
    const rows = mechanism.response;
    const title = mechanism.prsPick ? `Response to a push at ${nameOf(mechanism.prsPick)}` : "Combined response across scanned sources";
    status.textContent = `Scanned ${sourceName} (${sourceIds.size} residues) · ${title} · ${scopeName} (${rows.length} scored residues)`;
    pocketPlotSlot.replaceChildren();
    if (!rows.length) {
      markReceiver = null;
      plotSlot.replaceChildren(element("p", "No scored residues in this responder scope. Choose another scope."));
      return;
    }
    const plot = plotCard(title, "perturbation_response");
    const source = mechanism.prsPick ? nameOf(mechanism.prsPick) : "aggregate";
    plot.addData(() => [
      ["node", "residue", "rms_response_model_units", "source", "reference", "cutoff_angstrom", "scan_sources", "responder_scope"],
      ...rows.map(({ id, score }) => [receiverIndex.get(id) + 1, nameOf(id), score, source, referenceName, result.cutoff, sourceName, scopeName]),
    ]);
    const domain = [0.5, receivers.length + 0.5];
    const axis = axes(plot.svg, domain, [0, prsMaximum() * 1.05], "Cα node", "RMS response (model units)", { xTicks: indexTicks(receivers.length) });
    let previous = -2;
    const trace = rows.map(({ id, score }) => {
      const i = receiverIndex.get(id);
      const command = i === previous + 1 ? "L" : "M";
      previous = i;
      return `${command}${axis.x(i + 1)},${axis.y(score)}`;
    }).join(" ");
    plot.svg.append(svgNode("path", { d: trace, fill: "none", stroke: plotTheme.positive, "stroke-width": 2 }));
    const shown = new Map(rows.map((row) => [row.id, row]));
    if (rows.length < receivers.length) {
      for (const { id, score } of rows)
        plot.svg.append(svgNode("circle", { cx: axis.x(receiverIndex.get(id) + 1), cy: axis.y(score), r: 2, fill: plotTheme.positive }));
    }
    const selection = svgNode("g", { "pointer-events": "none" });
    const hover = svgNode("g", { "pointer-events": "none" });
    const hit = svgNode("rect", { x: axis.left, y: axis.top, width: axis.width, height: axis.height, fill: "transparent", class: "plot-hit" });
    const rowAt = (event) => {
      const i = Math.floor((cursor(plot.svg, event).x - axis.left) / axis.width * receivers.length);
      return shown.get(receivers[Math.max(0, Math.min(receivers.length - 1, i))].id);
    };
    function mark(group, row, color) {
      group.replaceChildren();
      if (!row) return;
      const x = axis.x(receiverIndex.get(row.id) + 1);
      group.append(svgNode("line", { x1: x, x2: x, y1: axis.top, y2: axis.bottom, stroke: color, "stroke-dasharray": "4 3" }),
        svgNode("circle", { cx: x, cy: axis.y(row.score), r: 4, fill: color, stroke: "white" }));
    }
    const readout = ({ id, score }) => `${nameOf(id)} · node ${receiverIndex.get(id) + 1} · RMS response ${number(score, 4)}`;
    markReceiver = () => {
      const row = shown.get(mechanism.prsReceiver);
      mark(selection, row, "#925816");
      hover.replaceChildren();
      plot.status.textContent = row ? `Selected ${readout(row)}` : "Click a scored residue to see which pushes drive its response.";
    };
    hit.onpointermove = (event) => {
      const row = rowAt(event);
      mark(hover, row, plotTheme.positive);
      plot.status.textContent = row ? readout(row) : "No scored residue at this position in the current scope.";
    };
    hit.onpointerleave = markReceiver;
    hit.onclick = (event) => {
      const row = rowAt(event);
      if (row) inspectReceiver(row.id);
    };
    plot.svg.append(selection, hover, hit);
    markReceiver();
    plotSlot.replaceChildren(plot.card);
    if (state.pockets.length) pocketPlotSlot.append(prsPocketPlot(state.pockets, rows, mechanism.prsPick));
  }

  function showResponders() {
    responseTable.body.replaceChildren();
    responderRows.clear();
    const rows = [...mechanism.response].sort((a, b) => sort.value === "distance"
      ? (b.distance ?? -1) - (a.distance ?? -1) || b.score - a.score : b.score - a.score);
    for (const { id, score, distance } of rows) {
      const row = responseTable.body.insertRow();
      responderRows.set(id, row);
      row.classList.toggle("focused", id === mechanism.prsReceiver);
      const button = element("button", nameOf(id), "residue-link");
      button.type = "button";
      button.title = `Which pushes drive the response at ${nameOf(id)}?`;
      button.onclick = () => inspectReceiver(id);
      row.insertCell().append(button);
      for (const value of [number(score, 4), number(distance, 1), pocketNames(id)])
        row.insertCell().textContent = value;
    }
  }

  function showSources() {
    const receiver = mechanism.prsReceiver;
    sourcePane.hidden = forward && receiver === null;
    sourceTable.body.replaceChildren();
    sourceTitle.textContent = receiver === null ? `Which pushes affect ${targetName}?` : `Which pushes drive the response at ${nameOf(receiver)}?`;
    sourceHint.textContent = receiver === null
      ? `Pushes ranked by RMS response within ${targetName} (${result.targets.length} residues). Select a source to show its individual push.`
      : "Pushes ranked by their response at this residue. Select a source to show its individual push.";
    rankedSources = receiver === null ? result.rows : result.sources
      .filter((id) => id !== receiver)
      .map((id) => ({ id, score: pairScore(id, receiver), target_count: 1 }))
      .sort((a, b) => b.score - a.score);
    if (!rankedSources.length) {
      const cell = sourceTable.body.insertRow().insertCell();
      cell.colSpan = 4;
      cell.textContent = "No other source was scanned for this responder.";
    }
    for (const { id, score, target_count } of rankedSources) {
      const row = sourceTable.body.insertRow();
      const button = element("button", nameOf(id), "residue-link");
      button.type = "button";
      button.title = "Show the response to this individual push.";
      button.disabled = receiver !== null && score === null;
      button.onclick = () => {
        mechanism.prsPick = id;
        refreshMap();
        plotSlot.scrollIntoView({ block: "nearest" });
      };
      row.insertCell().append(button);
      for (const value of [number(score, 4), target_count, pocketNames(id)]) row.insertCell().textContent = value;
    }
  }

  const coordinates = (id) => mechanism.prsCoordinates?.get(id) || state.residues.get(id)?.ca;
  function refreshMap() {
    const source = mechanism.prsPick;
    const origin = source === null ? null : coordinates(source);
    const scores = source === null ? receivers : receivers.map((row) => {
      const xyz = coordinates(row.id);
      return { ...row, score: pairScore(source, row.id), distance: origin && xyz
        ? Math.hypot(...xyz.map((value, i) => value - origin[i])) : null };
    });
    mechanism.response = prsResponderRows(scores, activeScope, sourceIds, groupIds);
    summarySlot.replaceChildren(analysisSummary("perturbation", {workflow, sources:result.sources, targets:result.targets, cutoff:result.cutoff, reference:referenceName, source_selection:sourceName, monitored_selection:targetName, displayed_source:source === null ? "Combined source response" : nameOf(source), responder_scope:scopeName, displayed_responders:mechanism.response.map(row=>row.id)}, ["RMS response in model units", "Self-response excluded"]));
    if (!mechanism.response.some(({ id }) => id === mechanism.prsReceiver)) mechanism.prsReceiver = null;
    picker.replaceChildren(new Option("Choose a responding residue…", ""),
      ...mechanism.response.map(({ id }) => new Option(`${nameOf(id)} · node ${receiverIndex.get(id) + 1}`, id)));
    picker.value = mechanism.prsReceiver ?? "";
    picker.disabled = !mechanism.response.length;
    inspect.disabled = !picker.value;
    showSources();
    showResponders();
    showMap();
    draw();
  }

  function inspectReceiver(id) {
    if (!responderRows.has(id)) return;
    responderRows.get(mechanism.prsReceiver)?.classList.remove("focused");
    mechanism.prsReceiver = id;
    responderRows.get(id).classList.add("focused");
    picker.value = String(id);
    inspect.disabled = false;
    sourcePane.open = true;
    showSources();
    markReceiver?.();
    draw();
    sourcePane.scrollIntoView({ block: "nearest" });
  }
  mechanism.inspectReceiver = inspectReceiver;

  function applyScope() {
    scopeError.textContent = "";
    try {
      const value = scope.value;
      const ids = value === "target" ? result.targets
        : value === "all" || value === "outside" ? []
          : prsSelection(scope.id, custom.id, "Responding residues");
      if (ids.length && !ids.some((id) => receiverIndex.has(id))) throw new Error("The selected region contains no mapped Cα residues.");
      groupIds = ids;
      activeScope = value;
      scopeName = value === "custom" ? `Custom residues (${custom.value.trim()})` : scope.selectedOptions[0].text;
      refreshMap();
    } catch (error) {
      scopeError.textContent = error.message;
    }
  }
  scope.onchange = () => {
    customForm.hidden = scope.value !== "custom";
    if (customForm.hidden) applyScope();
    else custom.focus();
  };
  customForm.onsubmit = (event) => { event.preventDefault(); applyScope(); };
  sort.onchange = showResponders;

  const reset = element("button", "Reset to combined response");
  reset.type = "button";
  reset.title = "Restore the combined response of the scanned sources and clear the inspected residue.";
  reset.onclick = () => {
    mechanism.prsPick = mechanism.prsReceiver = null;
    refreshMap();
  };
  const csv = element("button", "Export displayed PRS results");
  csv.type = "button";
  csv.onclick = () => exportCsv([
    ["type", "residue", "rms_response", "target_count", "nearest_displayed_source_ca_angstrom", "pockets",
      "reference", "cutoff_angstrom", "map_source", "scan_sources", "responder_scope", "ranking_target"],
    ...(!sourcePane.hidden ? rankedSources : []).map(({ id, score, target_count }) => [
      "source", nameOf(id), score, target_count, "", pocketNames(id), referenceName, result.cutoff, "", sourceName, "",
      mechanism.prsReceiver === null ? targetName : nameOf(mechanism.prsReceiver),
    ]),
    ...mechanism.response.map(({ id, score, distance }) => [
      "response", nameOf(id), score, "", distance, pocketNames(id), referenceName, result.cutoff,
      mechanism.prsPick === null ? "aggregate" : nameOf(mechanism.prsPick), sourceName, scopeName, "",
    ]),
  ], "perturbation_response.csv");
  const tools = element("div", null, "result-buttons");
  tools.append(sort, reset, csv);
  const wrap = element("div", null, "rank-table");
  wrap.append(responseTable.table);
  const responseTitle = element("h4", "Responding residues");
  const plotSection = resultSection("Plots", "plots");
  plotSection.append(scopeRow, customForm, scopeError, status, plotSlot, pocketPlotSlot);
  const tableSection = resultSection("Tables", "tables");
  tableSection.append(responseTitle, tools, wrap);
  const inspectionSection = resultSection("Responder and source inspection", "inspection");
  inspectionSection.append(pickerRow, sourcePane);
  root.replaceChildren(element("h3", forward ? "What responds to this push?" : "Which pushes affect this region?"),
    summarySlot,
    plotSection, tableSection, inspectionSection);
  root.hidden = !state.perturbation;
  refreshMap();
}

function prsPocketPlot(pockets, response, source) {
  const scores = new Map(response.map(({ id, score }) => [id, score]));
  const ranked = [];
  for (const { id, residues } of pockets) {
    const values = [...new Set(residues)].map((node) => scores.get(node)).filter(Number.isFinite);
    if (values.length)
      ranked.push({ id, score: values.reduce((sum, value) => sum + value, 0) / values.length, count: values.length });
  }
  ranked.sort((a, b) => b.score - a.score);
  return pocketScorePlot(pockets, ranked, {
    title: source ? `Pocket response to ${nameOf(source)}` : "Pocket response across sources",
    filename: "perturbation_pocket_response",
    metric: "Mean RMS response (model units)",
    upper: (ranked[0]?.score || 1) * 1.05,
    description: "Mean of the displayed residue responses across each pocket’s lining",
    caption: "n counts lining residues with a response value. Pocket membership comes from the reference fpocket scan.",
  });
}

function prsMaximum() {
  return Math.max(1e-8, ...mechanism.response.map(({ score }) => score ?? 0));
}

function prsColorScale() {
  const percent = Number($("prsResponseLimit").value);
  return { percent, maximum: prsMaximum() * percent / 100 };
}

function updatePrsScaleReadout() {
  const { percent, maximum } = prsColorScale();
  $("prsResponseValue").textContent = `${percent}% of max`;
  $("prsResponseValue").title = `Full red at RMS response ${maximum.toPrecision(4)} model units`;
  $("prsResponseLimit").setAttribute("aria-valuetext",
    `${percent}% of the maximum displayed response; full red at ${maximum.toPrecision(4)} model units`);
}

function prsColors() {
  const { maximum } = prsColorScale();
  return new Map(mechanism.response.map(({ id, score }) => [
    id, score === null ? "#a7b3ad" : "#" + colorStops(Math.max(0, Math.min(1, score / maximum)))
      .map((channel) => channel.toString(16).padStart(2, "0")).join(""),
  ]));
}

function renderPrsReferences(clusters) {
  const field = $("prsReference");
  field.replaceChildren(new Option("Loaded structure", ""),
    ...clusters.map(({ id }) => new Option(`Cluster ${id} representative`, id)));
}

function renderStateContactChoices(clusters) {
  renderPrsReferences(clusters);
  $("contactComparison").hidden = clusters.length < 2;
  for (const id of ["contactStateA", "contactStateB"]) {
    $(id).replaceChildren(...clusters.map(({ id, count }) => new Option(`Cluster ${id} · ${count} frames`, id)));
  }
  if (clusters.length >= 2) $("contactStateB").selectedIndex = 1;
  updateContactGroups();
}

function updateContactGroups({ replacePockets = false } = {}) {
  let selectionChanged = false;
  for (const side of ["A", "B"]) {
    const select = $(`contactScope${side}`);
    const previous = select.value;
    select.replaceChildren(new Option("All mapped residues", "all"), new Option("Custom residues…", "custom"));
    for (const key of ["a", "b"])
      if ($(roleFields[key]).value) select.append(new Option(`Region ${key.toUpperCase()}`, key));
    for (const pocket of state.pockets) select.append(new Option(`Pocket ${pocket.id}`, `p${pocket.id}`));
    if (!(replacePockets && previous.startsWith("p")) && [...select.options].some(({ value }) => value === previous))
      select.value = previous;
    selectionChanged ||= Boolean(previous && previous !== select.value);
  }
  if (selectionChanged) clearStateContactResults();
  mechanismControls();
}

function contactGroup(side, number) {
  const source = $(`contactScope${side}`).value;
  if (source === "all") return [];
  if (source === "a" || source === "b") {
    const ids = role(source);
    if (ids.length) return ids;
    throw new Error(`Choose residues for Region ${source.toUpperCase()} in Communication.`);
  }
  return prsSelection(`contactScope${side}`, `contactGroup${side}`, `Residue group ${number}`);
}

function renderContactComparison(result, states) {
  const root = $("stateContactResults");
  root.replaceChildren();
  const [firstCount, secondCount] = result.frame_counts;
  const summary = element("p", `Cluster ${states[0]} (n = ${firstCount}) → Cluster ${states[1]} (n = ${secondCount}) · Cα cutoff ${result.cutoff} Å. Δ is B minus A, in percentage points.`);
  const status = element("p", "Click a contact cell or select a pair below to mark it on both representatives.");
  status.setAttribute("role", "status");
  const models = element("div", null, "diagnostic-grid");
  const panes = states.map((id) => {
    const card = element("div", null, "viewer-card");
    const viewport = element("div", null, "viewport frame-viewport");
    const canvas = element("div", null, "contact-molecule");
    viewport.append(canvas);
    card.append(element("h4", `Cluster ${id} representative`), viewport);
    models.append(card);
    return canvas;
  });
  const markColor = delta => delta > 0 ? "#b13743" : delta < 0 ? "#3261a2" : "#64756c";
  const coordinates = result.models.map((pdb) => new Map(
    sceneAtoms(pdb).filter(({ name }) => name === "CA").map(({ id, xyz }) => [id, xyz]),
  ));
  const highlights = element("form", null, "viewer-export");
  const highlightInput = element("input");
  highlightInput.id = "contactHighlights";
  highlightInput.placeholder = "e.g. A:40, A:174-184";
  highlightInput.value = mechanism.contactHighlightText ?? $("frameHighlights").value;
  const highlightLabel = element("label", "Highlight residues in both viewers");
  highlightLabel.htmlFor = highlightInput.id;
  const highlightButton = element("button", "Highlight");
  highlightButton.type = "submit";
  const copyHighlights = element("button", "Use frame highlights");
  copyHighlights.type = "button";
  const showLabels = element("input");
  showLabels.type = "checkbox";
  showLabels.checked = $("frameResidueLabels").checked;
  const labels = element("label", " Residue labels");
  labels.prepend(showLabels);
  const highlightStatus = element("small");
  highlightStatus.id = "contactHighlightStatus";
  highlightStatus.setAttribute("role", "status");
  highlights.append(highlightLabel, highlightInput, highlightButton, copyHighlights, labels, highlightStatus);
  let highlighted = new Set();
  let selectedPair = null;
  let views = [];
  function pick(row) {
    selectedPair = row;
    status.textContent = `${nameOf(row.a)} ↔ ${nameOf(row.b)} · A ${number(100 * row.first, 1)}% · B ${number(100 * row.second, 1)}% · Δ ${number(100 * row.delta, 1)} pp`;
    redrawRepresentatives();
  }
  function redrawRepresentatives() {
    for (const [i, view] of views.entries()) {
      view.removeAllShapes();
      view.removeAllLabels();
      const pdb = result.models[i];
      const scene = newScene(pdb, "cartoon");
      const coords = coordinates[i];
      sceneHighlights(scene, highlighted, coords, showLabels.checked);
      if (selectedPair) {
        const { a, b, delta } = selectedPair;
        paintSticks(scene, [a, b], "#ffcf6e", 0.28);
        const labeled = new Set(scene.labels.map(({ id }) => id));
        for (const id of [a, b]) {
          if (coords.has(id) && !labeled.has(id)) scene.labels.push({ id, xyz: coords.get(id), text: nameOf(id) });
        }
        if (coords.has(a) && coords.has(b)) scene.markers.push({
          xyz: coords.get(a), end: coords.get(b), shade: markColor(delta), radius: 0.15,
        });
      }
      drawScene(view, view.getModel(), scene);
      view.render();
    }
  }
  function applyHighlights() {
    try {
      const { ids, unknown } = selection(highlightInput.value);
      highlighted = ids;
      mechanism.contactHighlightText = highlightInput.value;
      highlightStatus.textContent = [
        ids.size ? `${ids.size} highlighted` : "",
        unknown.length ? `No match for ${unknown.join(", ")}.` : "",
      ].filter(Boolean).join(" · ");
      redrawRepresentatives();
    } catch (error) {
      highlightStatus.textContent = error.message;
    }
  }
  highlights.onsubmit = (event) => {
    event.preventDefault();
    applyHighlights();
  };
  copyHighlights.onclick = () => {
    highlightInput.value = $("frameHighlights").value;
    applyHighlights();
  };
  showLabels.onchange = redrawRepresentatives;

  const { table, body } = resultsTable(["Residue pair", "A (%)", "B (%)", "Δ (pp)"]);
  for (const row of result.rows.slice(0, 100)) {
    const line = body.insertRow();
    const button = element("button", `${nameOf(row.a)} ↔ ${nameOf(row.b)}`, "residue-link");
    button.type = "button";
    button.onclick = () => pick(row);
    line.insertCell().append(button);
    for (const key of ["first", "second", "delta"]) line.insertCell().textContent = number(100 * row[key], 1);
  }
  const csv = element("button", "Export all contact pairs CSV");
  csv.type = "button";
  csv.onclick = () => exportCsv([
    ["residue_1", "residue_2", "state_a", "state_b", "occupancy_a", "occupancy_b", "delta"],
    ...result.rows.map(({ a, b, first, second, delta }) => [nameOf(a), nameOf(b), ...states, first, second, delta]),
  ], "state_contact_changes.csv");
  const wrap = element("div", null, "rank-table");
  wrap.append(table);
  const plot = contactChangeMap(result, states, pick);
  const plotsSection = resultSection("Plots", "plots"); plotsSection.append(plot.card, status);
  const tablesSection = resultSection("Tables", "tables"); tablesSection.append(element("small", `Showing up to 100 pairs ranked by absolute change · ${result.rows.length} available`), csv, wrap);
  const inspectionSection = resultSection("State and residue inspection", "inspection"); inspectionSection.append(highlights, models, element("small", "Drag either representative to rotate both views."));
  root.append(analysisSummary("state_contacts", {cutoff:result.cutoff, groups:[result.left,result.right], states:states.map(id=>conformationState.run.clusters.find(cluster=>cluster.id===id)), only_path:$("contactUsePath").checked}, [`State A: ${firstCount} frames`, `State B: ${secondCount} frames`, "Δ = B minus A (percentage points)"]),summary, plotsSection, tablesSection, inspectionSection);
  try {
    views = panes.map((pane, i) => {
      const view = $3Dmol.createViewer(pane, { backgroundColor: "#111e23", antialias: true });
      mechanism.contactViews.push(view);
      const pdb = result.models[i];
      const model = view.addModel(pdb, "pdb", { keepH: false });
      drawScene(view, model, newScene(pdb, "cartoon"));
      view.zoomTo({ model });
      view.render();
      return view;
    });
    views[1].setView(views[0].getView());
    views[0].linkViewer(views[1]);
    views[1].linkViewer(views[0]);
    applyHighlights();
  } catch {
    views = [];
    highlights.hidden = true;
    status.textContent = "3D representatives could not be displayed. The heatmap and table remain available.";
  }
}

function contactChangeMap(result, states, pick) {
  const plot = plotCard("Contact occupancy change", "state_contact_changes");
  const { left, right, rows } = result;
  const pairs = new Map(rows.map((row) => [`${row.a}:${row.b}`, row]));
  const key = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
  plot.addData(function* () {
    yield ["y_node", "x_node", "group_1_residue", "group_2_residue", "state_a", "state_b",
      "frames_a", "frames_b", "cutoff_angstrom", "occupancy_a_fraction", "occupancy_b_fraction", "delta_percentage_points"];
    const leftLabels = left.map(nameOf);
    const rightLabels = right.map(nameOf);
    const metadata = [...states, ...result.frame_counts, result.cutoff];
    for (const [i, a] of left.entries()) {
      for (const [j, b] of right.entries()) {
        const row = pairs.get(key(a, b));
        yield [i + 1, j + 1, leftLabels[i], rightLabels[j], ...metadata, row?.first, row?.second,
          row ? 100 * row.delta : null];
      }
    }
  });
  const box = { left: 65, top: 65, width: 445, height: 245 };
  axes(plot.svg, [0.5, right.length + 0.5], [0.5, left.length + 0.5], "Group 2 Cα node", "Group 1 Cα node", {
    box, xTicks: indexTicks(right.length), yTicks: indexTicks(left.length), noGrid: true,
  });
  const canvas = document.createElement("canvas");
  canvas.width = right.length;
  canvas.height = left.length;
  const ctx = canvas.getContext("2d");
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  for (const [i, a] of left.entries()) {
    for (const [j, b] of right.entries()) {
      const row = pairs.get(key(a, b));
      const shade = row ? colorStops(row.delta) : [238, 241, 239];
      pixels.data.set([...shade, 255], ((left.length - 1 - i) * right.length + j) * 4);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  plot.svg.append(svgNode("image", { x: box.left, y: box.top, width: box.width, height: box.height, preserveAspectRatio: "none", "image-rendering": "pixelated", href: canvas.toDataURL() }));
  const hit = svgNode("rect", { x: box.left, y: box.top, width: box.width, height: box.height, fill: "transparent", class: "plot-hit" });
  const pairAt = (event) => {
    const local = cursor(plot.svg, event);
    const i = left.length - 1 - Math.min(left.length - 1, Math.floor((local.y - box.top) / box.height * left.length));
    const j = Math.min(right.length - 1, Math.floor((local.x - box.left) / box.width * right.length));
    return pairs.get(key(left[i], right[j]));
  };
  const legend = "Blue −100 pp · white 0 pp · red +100 pp · gray no observed contact / outside selection";
  plot.svg.append(hit, svgNode("text", { x: 18, y: 45, fill: "#40574c", "font-size": 10 }, legend));
  plot.status.textContent = legend;
  hit.onpointermove = (event) => {
    const row = pairAt(event);
    plot.status.textContent = row ? `${nameOf(row.a)} ↔ ${nameOf(row.b)} · Δ ${number(100 * row.delta, 1)} pp` : legend;
  };
  hit.onclick = (event) => { const row = pairAt(event); if (row) pick(row); };
  return plot;
}

function initMechanism() {
  $("perturbationTab").onclick = () => setPanel("perturbation");
  $("prsWorkflow").onchange = () => { $("prsRankingFields").hidden = $("prsWorkflow").value !== "sources"; };
  $("prsScope").onchange = () => { $("prsCustomField").hidden = $("prsScope").value !== "custom"; };
  $("prsTargetScope").onchange = () => { $("prsTargetCustomField").hidden = $("prsTargetScope").value !== "custom"; };
  $("perturbationForm").oninput = () => clearPrsResults();
  $("perturbationForm").onsubmit = (event) => {
    event.preventDefault();
    if (!state.structure) return;
    task("Calculating elastic network responses…", async () => {
      const sources = prsSelection("prsScope", "prsCustom", "Source residues");
      const workflow = $("prsWorkflow").value;
      const targets = workflow === "sources" ? prsSelection("prsTargetScope", "prsTarget", "Region to monitor") : [];
      const scopeName = (id, customId) => $(id).value === "custom"
        ? `Custom residues (${$(customId).value.trim()})` : $(id).selectedOptions[0].text;
      const sourceName = scopeName("prsScope", "prsCustom");
      const targetName = targets.length ? scopeName("prsTargetScope", "prsTarget") : "the whole protein";
      const pocketSource = /^p\d+$/.test($("prsScope").value);
      const referenceField = $("prsReference");
      const referenceName = referenceField.selectedOptions[0].text;
      const reference = referenceField.value ? { run: conformationState.run.run, cluster: Number(referenceField.value) } : null;
      renderPrs(await api("/api/perturbation", {
        pdb: state.structure.pdb, sources, targets, reference, cutoff: $("prsCutoff").value,
      }), { workflow, sourceName, targetName, targetRestricted: targets.length > 0, referenceName, pocketSource });
    });
  };
  $("copyContactRegions").onclick = () => {
    task("Selecting Communication regions…", async () => {
      const [a, b] = ["a", "b"].map((key) => role(key).length ? key : "all");
      updateContactGroups();
      $("contactScopeA").value = a;
      $("contactScopeB").value = b;
      $("contactUsePath").checked = false;
      clearStateContactResults();
    });
  };
  $("stateContactForm").oninput = () => {
    clearStateContactResults();
    mechanismControls();
  };
  $("stateContactForm").onsubmit = (event) => {
    event.preventDefault();
    if (!conformationState.run) return;
    task("Computing contacts in both states…", async () => {
      const states = [Number($("contactStateA").value), Number($("contactStateB").value)];
      const usePath = $("contactUsePath").checked;
      if (usePath && state.route.length < 2) throw new Error("First select a path in Communication.");
      const groups = usePath ? [] : [contactGroup("A", 1), contactGroup("B", 2)];
      const result = await api("/api/conformations/contact-changes", {
        run: conformationState.run.run, states, groups, path: usePath ? state.route : [], cutoff: $("stateContactCutoff").value,
      });
      clearStateContactResults();
      renderContactComparison(result, states);
    });
  };
}

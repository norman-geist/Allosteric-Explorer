"use strict";

const conformationState = {
  run: null,
  observable: null,
  cluster: 0,
  frame: null,
  pdb: null,
  viewer: null,
  request: 0,
  transferred: null,
  highlighted: null,
  frameLabels: [],
  associationPicks: new Set(),
  transferredResidues: null,
};
const observableGroups = {
  minimum: 2,
  center: 2,
  contacts: 2,
  angle: 3,
  dihedral: 4,
  rmsd: 1,
  sasa: 1,
  rg: 1,
  imported: 0,
  pc: 0,
};
const inputPairs = {
  topology: "confTopology",
  trajectory: "confTrajectory",
  selection: "confSelection",
  stride: "confStride",
  maxFrames: "confMax",
};
const groupChoices = [];

function conformationControls() {
  const { busy, structure } = state;
  $("conformationForm")
    .querySelectorAll("input, select, button")
    .forEach((field) => {
      field.disabled = busy || Boolean(field.closest("[hidden]"));
    });
  $("runConformations").disabled = !structure || busy;
  $("observableForm")
    .querySelectorAll("input, select, button")
    .forEach((field) => {
      field.disabled = busy || Boolean(field.closest("[hidden]"));
    });
  $("associationForm")
    .querySelectorAll("input, select, button")
    .forEach((field) => {
      field.disabled = busy || Boolean(field.closest("[hidden]"));
    });
  $("associationUseRegionA").disabled ||= !$(roleFields.a).value;
  $("runObservable").disabled = !conformationState.run || busy;
  $("sendFrames").disabled = busy || (selectedCluster()?.count || 0) < 20;
  $("representative").disabled =
    busy || conformationState.cluster === -1 || !conformationState.run?.clusters.length;
  for (const id of ["useFrameForPockets", "exportFrame", "exportFrameVmd", "exportFramePymol"]) {
    $(id).disabled = busy || !conformationState.pdb;
  }
}

function selectedCluster() {
  return conformationState.run?.clusters.find(
    (c) => c.id === conformationState.cluster,
  );
}

function resetConformations() {
  resetStateContacts();
  Object.assign(conformationState, {
    run: null,
    observable: null,
    cluster: 0,
    frame: null,
    pdb: null,
  });
  $("observableCompare").checked = false;
  $("frameActionStatus").hidden = true;
  conformationState.request++;
  for (const mark of conformationState.frameLabels)
    conformationState.viewer.removeLabel(mark);
  conformationState.frameLabels = [];
  conformationState.viewer?.removeAllModels();
  $("conformationResults").hidden = true;
  $("observableResults").hidden = true;
  $("observableComparisonControls").hidden = true;
  $("associationPanel").hidden = true;
  clearAssociation();
  $("observableColorLabel").hidden = true;
  $("observableColor").checked = false;
}

function setCommunicationFrames(cluster) {
  conformationState.transferred = cluster;
  $("communicationFrames").hidden = !cluster;
  $("communicationFramesSummary").textContent = cluster
    ? `Cluster ${cluster.id} · ${cluster.count} explicit trajectory frames`
    : "";
  trajectorySampling.get("trajectory")?.();
}

function selectedResidues(text, caption) {
  if (!text.trim()) return [];
  const { ids, unknown } = selection(text);
  if (unknown.length || !ids.size)
    throw new Error(
      `${caption}: no match for ${unknown.join(", ") || "this selection"}.`,
    );
  return [...ids];
}

function renderObservableInputs() {
  const kind = $("observableKind").value;
  $("observableCutoffField").hidden = kind !== "contacts";
  $("observableCsvField").hidden = kind !== "imported";
  $("observablePCField").hidden = kind !== "pc";
  $("observableSasaHelp").hidden = kind !== "sasa";
  $("observableRgHelp").hidden = kind !== "rg";
  const container = $("observableGroups");
  container.replaceChildren();
  for (let i = 0; i < observableGroups[kind]; i++) {
    const field = element("div", null, "comm-field");
    const groupLabel = kind === "sasa" || kind === "rg" ? "Residues to measure" : `Group ${i + 1}`;
    const caption = element("label", groupLabel);
    const choose = element("select");
    choose.id = `observableGroup${i + 1}`;
    caption.htmlFor = choose.id;
    choose.append(
      new Option("Choose residues…", ""),
      new Option("Custom residues…", "custom"),
    );
    for (const [key, label] of [
      ["a", "Region A"],
      ["b", "Region B"],
      ["functional", "Functional reference"],
    ]) {
      if ($(roleFields[key]).value) choose.append(new Option(label, key));
    }
    if (state.highlighted.size)
      choose.append(new Option("Highlighted residues", "highlighted"));
    if (kind === "rg") choose.append(new Option("All mapped residues", "all"));
    for (const pocket of state.pockets)
      choose.append(new Option(`Pocket ${pocket.id}`, `p${pocket.id}`));
    choose.required = true;
    choose.value = groupChoices[i]?.value || "";
    const entry = element("input");
    entry.placeholder = "e.g. A:174-184";
    entry.setAttribute("aria-label", `${groupLabel} (custom selection)`);
    entry.value = groupChoices[i]?.text || "";
    entry.hidden = choose.value !== "custom";
    entry.required = !entry.hidden;
    const save = () => {
      entry.hidden = choose.value !== "custom";
      entry.required = !entry.hidden;
      groupChoices[i] = { value: choose.value, text: entry.value };
      clearObservable();
      conformationControls();
    };
    choose.onchange = save;
    entry.oninput = save;
    field.append(caption, choose, entry);
    container.append(field);
  }
  conformationControls();
}

function observableGroup(i) {
  const { value, text } = groupChoices[i] || {};
  if (value === "custom") return selectedResidues(text, `Group ${i + 1}`);
  if (value === "highlighted") return [...state.highlighted];
  if (value === "all") return [...state.residues.values()].filter(({ ca }) => ca).map(({ id }) => id);
  if (Object.hasOwn(roleFields, value)) return role(value);
  return state.pockets.find((p) => `p${p.id}` === value)?.residues || [];
}

function clearObservable() {
  const hadValue = Boolean(conformationState.observable);
  conformationState.observable = null;
  $("observableResults").hidden = true;
  $("observableComparisonControls").hidden = true;
  $("associationPanel").hidden = true;
  clearAssociation();
  $("observableColorLabel").hidden = true;
  $("observableColor").checked = false;
  if (hadValue && conformationState.run) renderProjection();
}

const clusteringNames = {
  kmeans: "k-means",
  ward: "Ward hierarchical",
  dbscan: "DBSCAN",
};
const clusterShade = clusterColor;
const clusterName = (id) => (id === -1 ? "Unassigned" : `Cluster ${id}`);

function applyFrameHighlights() {
  try {
    const text = $("frameHighlights").value;
    const { ids, unknown } = text.trim()
      ? selection(text)
      : { ids: new Set(), unknown: [] };
    conformationState.highlighted = ids;
    $("frameHighlightStatus").textContent = [
      ids.size ? `${ids.size} selected` : "",
      unknown.length ? `No match for ${unknown.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    restyleFrame();
  } catch (error) {
    $("frameHighlightStatus").textContent = error.message;
  }
}

function frameScene() {
  const { pdb, highlighted } = conformationState;
  const scene = newScene(pdb, "cartoon");
  const coords = new Map(
    sceneAtoms(pdb)
      .filter((atom) => atom.name === "CA")
      .map(({ id, xyz }) => [id, xyz]),
  );
  const showLabels = $("frameResidueLabels").checked;
  sceneHighlights(scene, highlighted || new Set(), coords, showLabels);
  const inspected = [...conformationState.associationPicks].filter(
    (id) => coords.has(id) && !highlighted?.has(id),
  );
  paintSticks(scene, inspected, "#ee94df", 0.29);
  if (showLabels && inspected.length <= 24) {
    for (const id of inspected)
      scene.labels.push({ id, xyz: coords.get(id), text: nameOf(id) });
  }
  return scene;
}

function restyleFrame() {
  const view = conformationState.viewer;
  if (!conformationState.pdb || !view?.getModel()) return;
  const key = $("frameViewKey");
  key.replaceChildren();
  chainLegend(key);
  for (const mark of conformationState.frameLabels) view.removeLabel(mark);
  conformationState.frameLabels = drawScene(
    view,
    view.getModel(),
    frameScene(),
  ).marks;
  view.render();
}

function clearAssociation() {
  $("associationResults").hidden = true;
  $("associationStatus").textContent = "";
  if (conformationState.associationPicks.size) {
    conformationState.associationPicks.clear();
    restyleFrame();
  }
}

function initAssociations() {
  const form = $("associationForm");
  form.addEventListener("input", clearAssociation);
  $("associationFeature").onchange = () => {
    const distance = $("associationFeature").value === "distance";
    $("associationReferenceField").hidden = !distance;
    $("associationCutoffField").hidden =
      $("associationFeature").value !== "contacts";
    $("associationSasaField").hidden = $("associationFeature").value !== "sasa";
    conformationControls();
  };
  $("associationUseRegionA").onclick = () => {
    try {
      $("associationReference").value = role("a")
        .map((id) => resid(state.residues.get(id)))
        .join(", ");
      clearAssociation();
    } catch (error) {
      $("associationStatus").textContent = error.message;
    }
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    clearAssociation();
    task("Ranking residue–observable associations…", async () => {
      const { run, observable } = conformationState;
      const feature = $("associationFeature").value;
      const scope = $("associationScope").value;
      const cluster = selectedCluster();
      const isCurrent = () =>
        conformationState.observable === observable &&
        (scope !== "cluster" || selectedCluster() === cluster);
      try {
        if (scope === "cluster" && !cluster)
          throw new Error(
            "Select an assigned cluster in the Conformation menu first.",
          );
        const spec = {
          values: observable.values,
          kind: observable.spec.kind,
          feature,
          frames: scope === "cluster" ? cluster.frames : null,
          reference:
            feature === "distance"
              ? selectedResidues(
                  $("associationReference").value,
                  "Distance reference",
                )
              : [],
          cutoff: $("associationCutoff").value,
          sasa_max_frames: $("associationSasaFrames").value,
          exclude: $("associationExclude").checked
            ? observable.spec.groups.flat()
            : [],
        };
        const result = await api("/api/conformations/associations", {
          run: run.run,
          association: feature === "sasa" ? { ...spec, workers: requestedCpuWorkers() } : spec,
        });
        if (!isCurrent()) return;
        renderAssociations(
          result,
          spec,
          scope === "cluster" ? `Cluster ${cluster.id}` : "All retained frames",
          observable.title,
        );
      } catch (error) {
        if (isCurrent()) $("associationStatus").textContent = error.message;
      }
    });
  };
}

function renderAssociations(result, spec, scope, observableTitle) {
  const { rows, frame_count, circular, excluded } = result;
  const columns = circular
    ? ["ρ with sin(angle)", "ρ with cos(angle)"]
    : ["Signed Spearman ρ"];
  const scoreTitle = circular ? "Max |ρ|" : "|ρ|";
  const { table, body } = resultsTable([
    "Rank",
    "Residue",
    ...columns,
    scoreTitle,
  ]);
  const root = $("associationResults");
  const info = element(
    "small",
    `${scope} · ${frame_count} frames · ${excluded} excluded residues · ${rows.filter((r) => r.score !== null).length} ranked`,
  );
  const note = element(
    "p",
    circular
      ? "Ranks use the larger absolute Spearman coefficient against sine or cosine of the observable."
      : "Positive ρ means the residue feature tends to increase with the observable. Negative ρ means it tends to decrease.",
  );
  const wrapper = element("div", null, "rank-table");
  wrapper.append(table);
  const actions = element("div", null, "result-buttons");
  const pickers = new Map();
  let profilePlot;
  const view = element("button", "Show in frame viewer");
  view.type = "button";
  view.disabled = true;
  view.onclick = () => $("frameMolecule").scrollIntoView({ block: "center" });
  const download = element("button", "Export association CSV");
  download.type = "button";
  download.onclick = () =>
    exportCsv(
      [
        [
          "rank",
          "residue",
          ...columns,
          scoreTitle,
          "observable",
          "feature",
          "scope",
          "frames",
          "distance_reference",
          "contact_cutoff_angstrom",
          "sasa_max_frames",
        ],
        ...rows.map((row, i) => [
          row.score === null ? "" : i + 1,
          nameOf(row.id),
          ...row.coefficients,
          row.score,
          observableTitle,
          spec.feature,
          scope,
          frame_count,
          spec.reference.map(nameOf).join(" "),
          spec.feature === "contacts" ? spec.cutoff : "",
          spec.feature === "sasa" ? spec.sasa_max_frames : "",
        ]),
      ],
      "residue_observable_associations.csv",
    );
  const clear = element("button", "Clear selected residues");
  const transfer = element("button", "Use selected residues as Region A");
  transfer.type = "button";
  transfer.disabled = true;
  transfer.title = "Copy the selected residues and trajectory inputs to Communication for a pocket coupling search.";
  transfer.onclick = () => {
    if (state.busy || !conformationState.associationPicks.size) return;
    const ids = [...conformationState.associationPicks].sort((a, b) => a - b);
    const text = ids.map((id) => {
      const r = state.residues.get(id);
      const group = r.chain && r.segid ? `${r.chain}/${r.segid}` : r.segid || r.chain || "_";
      return `${group}:${r.resid}${r.icode}`;
    }).join(", ");
    conformationState.transferredResidues = { text, ids };
    const { settings } = conformationState.run;
    copyCommunicationInputs(settings);
    $(roleFields.a).value = "custom";
    $(roleFields.b).value = $(roleFields.functional).value = "";
    custom.a = text;
    setCommunicationFrames(null);
    clearResults();
    renderCustom();
    setPanel(true);
    $("commTab").focus();
    $("commTab").scrollIntoView({ block: "nearest" });
  };
  clear.type = "button";
  clear.disabled = true;
  clear.onclick = () => {
    conformationState.associationPicks.clear();
    for (const row of body.querySelectorAll(".focused"))
      row.classList.remove("focused");
    for (const button of body.querySelectorAll('[aria-pressed="true"]'))
      button.setAttribute("aria-pressed", "false");
    clear.disabled = view.disabled = transfer.disabled = true;
    profilePlot?.update(conformationState.associationPicks);
    restyleFrame();
  };
  actions.append(view, transfer, clear, download);
  for (const [i, row] of rows.entries()) {
    const tr = body.insertRow();
    tr.insertCell().textContent = row.score === null ? "—" : i + 1;
    const pick = element("button", nameOf(row.id), "residue-link");
    pick.type = "button";
    pick.setAttribute("aria-pressed", "false");
    pick.onclick = () => {
      const selected = conformationState.associationPicks;
      if (selected.has(row.id)) selected.delete(row.id);
      else selected.add(row.id);
      tr.classList.toggle("focused", selected.has(row.id));
      pick.setAttribute("aria-pressed", String(selected.has(row.id)));
      view.disabled = clear.disabled = transfer.disabled = !selected.size;
      profilePlot?.update(selected);
      restyleFrame();
    };
    pickers.set(row.id,pick);
    tr.insertCell().append(pick);
    for (const value of [...row.coefficients, row.score])
      tr.insertCell().textContent = number(value);
  }
  profilePlot=associationPlot(rows,circular,id=>pickers.get(id)?.onclick(),{...spec,observable_title:observableTitle,scope},frame_count);
  const plotsSection=resultSection("Plots", "plots");plotsSection.append(profilePlot.card);
  const tablesSection=resultSection("Tables", "tables");tablesSection.append(wrapper,element("small","A dash indicates an undefined coefficient, for example when a contact count is constant."));
  const detailsSection=resultSection("Selected residue inspection", "inspection");detailsSection.append(actions);
  const { values, ...settings }=spec;
  root.replaceChildren(analysisSummary("residue_association",{...settings,scope,observable:observableTitle},[`${frame_count} frames`,`${excluded} excluded residues`]), info,note,plotsSection,tablesSection,detailsSection);
  root.hidden = false;
}

function copyCommunicationInputs(settings) {
  for (const field of Object.keys(inputPairs))
    $(field).value = settings[field === "maxFrames" ? "max_frames" : field];
}

function initConformations() {
  initAssociations();
  $("confBasis").addEventListener("change", () => {
    const contactPca = $("confBasis").value === "ccpca";
    $("ccpcaFields").hidden = !contactPca;
    $("confFocusField").hidden = contactPca;
    conformationControls();
  });
  $("landscapeForm").onsubmit = (event) => {
    event.preventDefault();
    renderLandscape();
  };
  $("landscapeInterpolate").onchange = renderLandscape;
  $("observableCompare").onchange = updateClusterTests;
  $("observablePC").onchange = clearObservable;
  $("confClustering").onchange = () => {
    const density = $("confClustering").value === "dbscan";
    $("confCountField").hidden = density;
    $("dbscanFields").hidden = !density;
    resetConformations();
    conformationControls();
  };
  $("frameHighlightForm").onsubmit = (event) => {
    event.preventDefault();
    applyFrameHighlights();
  };
  $("frameResidueLabels").onchange = restyleFrame;
  $("copyHighlights").onclick = () => {
    $("frameHighlights").value = $("highlights").value;
    applyFrameHighlights();
  };
  for (const [id, format] of [
    ["exportFrameVmd", "vmd"],
    ["exportFramePymol", "pymol"],
  ]) {
    $(id).onclick = () =>
      exportScene(
        frameScene(),
        format,
        `frame_${conformationState.frame}_scene`,
        $("frameActionStatus"),
      );
  }
  $("copyCommunication").onclick = () => {
    for (const [from, to] of Object.entries(inputPairs))
      $(to).value = $(from).value;
    resetConformations();
    trajectorySampling.get("confTrajectory")?.();
  };
  $("conformationForm").addEventListener("input", resetConformations);
  $("conformationForm").onsubmit = (event) => {
    event.preventDefault();
    task("Fitting PCA and clustering retained frames…", async () => {
      const settings = Object.fromEntries(
        Object.entries(inputPairs).map(([key, field]) => [
          key,
          $(field).value.trim(),
        ]),
      );
      settings.max_frames = settings.maxFrames;
      delete settings.maxFrames;
      settings.basis = $("confBasis").value;
      settings.components = $("confComponents").value;
      settings.clustering = $("confClustering").value;
      if (settings.clustering === "dbscan") {
        settings.eps = $("confEps").value;
        settings.min_samples = $("confMinSamples").value;
      } else {
        settings.clusters = $("confClusters").value;
      }
      if (settings.basis === "ccpca") {
        settings.ccpca_selections = ["ccpcaGroup1", "ccpcaGroup2"].map((id) => $(id).value.trim());
      } else {
        settings.focus = selectedResidues($("confFocus").value, "PCA residues");
      }
      settings.fit = selectedResidues($("confFit").value, "Alignment residues");
      const run = await api("/api/conformations", {
        pdb: state.structure.pdb,
        settings,
      });
      resetConformations();
      conformationState.run = run;
      renderConformations();
    });
  };
  $("observableKind").onchange = () => {
    clearObservable();
    renderObservableInputs();
  };
  $("observableCsv").oninput = clearObservable;
  $("observableCutoff").oninput = clearObservable;
  $("observableForm").onsubmit = (event) => {
    event.preventDefault();
    task("Calculating the observable for retained frames…", async () => {
      const kind = $("observableKind").value;
      const groups = Array.from({ length: observableGroups[kind] }, (_, i) =>
        observableGroup(i),
      );
      if (groups.some((group) => !group.length))
        throw new Error("Fill each observable residue group.");
      const spec = {
        kind,
        groups,
        cutoff: $("observableCutoff").value,
        csv: $("observableCsv").value.trim(),
      };
      const run = conformationState.run;
      const component = Number($("observablePC").value);
      const result =
        kind === "pc"
          ? {
              values: run.projection.map((p) => p[component]),
              unit: run.settings.basis === "cartesian" ? "Å" : "PC score",
              circular: false,
            }
          : await api("/api/conformations/observable", {
              run: run.run,
              observable: kind === "sasa" ? { ...spec, workers: requestedCpuWorkers() } : spec,
            });
      conformationState.observable = {
        ...result,
        title:
          kind === "pc"
            ? `PC${component + 1} score`
            : $("observableKind").selectedOptions[0].textContent,
        spec,
      };
      $("observableCompare").checked = false;
      $("observableComparisonControls").hidden =
        kind === "pc" || result.circular || run.clusters.length < 2;
      clearAssociation();
      $("associationPanel").hidden = false;
      $("observableColorLabel").hidden = false;
      renderProjection();
      renderObservable();
    });
  };
  $("clusterChoice").onchange = () =>
    chooseCluster(Number($("clusterChoice").value));
  for (const id of ["pcX", "pcY", "observableColor"]) {
    $(id).onchange = () => {
      if ($("pcX").value === $("pcY").value) {
        const other = id === "pcX" ? "pcY" : "pcX";
        $(other).value = $(id).value === "0" ? "1" : "0";
      }
      renderProjection();
      if (id !== "observableColor") renderLandscape();
    };
  }
  $("representative").onclick = () =>
    showConformationFrame(
      (selectedCluster() || conformationState.run.clusters[0]).representative,
    );
  $("useFrameForPockets").onclick = () => {
    const data = currentFrameFile();
    if (!data) return;
    task("Opening the aligned frame for pocket discovery…", async () => {
      setStructure(await api("/api/structure", data));
      $("pocketTab").focus();
      $("pocketTab").scrollIntoView({ block: "nearest" });
    });
  };
  $("exportFrame").onclick = () => {
    const data = currentFrameFile();
    if (!data) return;
    const file = data.get("structure");
    saveBlob(file, file.name);
  };
  $("exportConformations").onclick = () => {
    const { run, observable } = conformationState;
    const header = [
      "frame",
      "cluster",
      "selected",
      ...run.variance.map((_, i) => `PC${i + 1}`),
    ];
    if (observable)
      header.push("observable_value", "observable_unit", "observable");
    exportCsv(
      [
        header,
        ...run.frames.map((frame, i) => [
          frame,
          run.membership.get(frame),
          conformationState.cluster === 0 ||
            run.membership.get(frame) === conformationState.cluster,
          ...run.projection[i],
          ...(observable
            ? [observable.values[i], observable.unit, observable.title]
            : []),
        ]),
      ],
      "conformation_frames.csv",
    );
  };
  $("sendFrames").onclick = () => {
    const cluster = selectedCluster();
    if (!cluster || cluster.count < 20) return;
    const { settings } = conformationState.run;
    copyCommunicationInputs(settings);
    clearResults();
    setCommunicationFrames(cluster);
    setPanel(true);
  };
  $("clearCommunicationFrames").onclick = () => {
    setCommunicationFrames(null);
    clearResults();
  };
  for (const field of Object.keys(inputPairs))
    $(field).addEventListener("input", () => setCommunicationFrames(null));
}

function renderConformations() {
  const run = conformationState.run;
  run.membership = new Map(
    run.clusters.flatMap((cluster) =>
      cluster.frames.map((frame) => [frame, cluster.id]),
    ),
  );
  for (const frame of run.noise) run.membership.set(frame, -1);
  if (conformationState.highlighted === null) {
    $("frameHighlights").value = $("highlights").value;
    applyFrameHighlights();
  }
  const basisSummary = {
    cartesian: "Cartesian Cα PCA",
    dihedral: `Backbone dihedral PCA · ${run.angles} φ/ψ angles`,
    ccpca: run.contact_pairs
      ? `Contact-contact PCA · ${run.contact_pairs.pair_count} atom pairs · group strides ${run.contact_pairs.strides.join(" / ")}`
      : "Contact-contact PCA",
  };
  $("conformationSummary").textContent = [
    basisSummary[run.settings.basis],
    `${run.frames.length} retained frames`,
    `${clusteringNames[run.settings.clustering]} on ${run.variance.length} PCs`,
    `${run.clusters.length} clusters`,
    ...(run.noise.length ? [`${run.noise.length} unassigned frames`] : []),
  ].join(" · ");
  renderConformationSummary(run);
  $("clusterChoice").replaceChildren(
    new Option("All retained frames", 0),
    ...run.clusters.map(
      (c) => new Option(`Cluster ${c.id} · ${c.count} frames`, c.id),
    ),
    ...(run.noise.length
      ? [new Option(`Unassigned · ${run.noise.length} frames`, -1)]
      : []),
  );
  for (const axis of ["pcX", "pcY"]) {
    $(axis).replaceChildren(
      ...run.variance.map(
        (v, i) => new Option(`PC${i + 1} · ${number(100 * v, 1)}%`, i),
      ),
    );
  }
  $("pcY").value = "1";
  $("observablePC").replaceChildren(
    ...run.variance.map((_, i) => new Option(`PC${i + 1}`, i)),
  );
  renderStateContactChoices(run.clusters);
  renderLandscape();
  $("conformationResults").hidden = $("conformationPanel").hidden;
  renderObservableInputs();
  chooseCluster(0);
}

function chooseCluster(id, frame) {
  if (
    conformationState.cluster !== id &&
    $("associationScope").value === "cluster"
  )
    clearAssociation();
  conformationState.cluster = id;
  $("clusterChoice").value = id;
  const cluster = selectedCluster();
  $("clusterSummary").textContent = cluster
    ? `Cluster ${id} · ${cluster.count} frames · representative frame ${cluster.representative}${cluster.count < 20 ? " · Communication requires at least 20 frames" : ""}`
    : id === -1
      ? "These frames fall outside the DBSCAN clusters."
      : conformationState.run.clusters.length
        ? "Select a cluster or click a PCA point to inspect a frame."
        : "DBSCAN found no clusters at these settings. Increase ε or reduce minimum samples.";
  conformationControls();
  showConformationFrame(
    frame ??
      (id === -1
        ? conformationState.run.noise[0]
        : ((cluster || conformationState.run.clusters[0])?.representative ??
          conformationState.run.frames[0])),
  );
  renderObservable();
}

function currentFrameFile() {
  const { pdb, frame } = conformationState;
  if (!pdb) return null;
  const data = new FormData();
  data.append("structure", new Blob([pdb], { type: "chemical/x-pdb" }), `frame_${frame}.pdb`);
  return data;
}

async function showConformationFrame(frame) {
  const run = conformationState.run;
  const request = ++conformationState.request;
  conformationState.frame = frame;
  conformationState.pdb = null;
  $("frameActionStatus").hidden = true;
  conformationControls();
  $("frameTitle").textContent =
    `Frame ${frame} · ${clusterName(run.membership.get(frame))}`;
  $("frameStatus").textContent = "Loading aligned frame…";
  renderProjection();
  try {
    const { pdb } = await api("/api/conformations/frame", {
      run: run.run,
      frame,
    });
    if (request !== conformationState.request) return;
    conformationState.pdb = pdb;
    conformationControls();
    let view = conformationState.viewer;
    if (!view) {
      view = $3Dmol.createViewer($("frameMolecule"), {
        backgroundColor: "#111e23",
        antialias: true,
      });
      conformationState.viewer = view;
      new ResizeObserver(() => {
        if ($("frameMolecule").clientWidth) view.resize();
      }).observe($("frameMolecule"));
    }
    const camera = view.getModel() ? view.getView() : null;
    for (const mark of conformationState.frameLabels) view.removeLabel(mark);
    conformationState.frameLabels = [];
    view.removeAllModels();
    const model = view.addModel(pdb, "pdb", { keepH: false });
    restyleFrame();
    if (camera) view.setView(camera);
    else view.zoomTo({ model });
    view.render();
    $("frameStatus").textContent =
      frame ===
      run.clusters.find((c) => c.id === run.membership.get(frame))
        ?.representative
        ? "Nearest retained frame to its cluster centroid"
        : "Selected retained trajectory frame";
  } catch (error) {
    if (request === conformationState.request)
      $("frameStatus").textContent = error.message;
  }
}

function paddedRange(values) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low) * 0.06 || Math.max(1, Math.abs(low) * 0.05);
  return [low - pad, high + pad];
}

function pcaUnit(run) { return run.settings.basis === "cartesian" ? "Å" : "dimensionless"; }

function renderProjection() {
  const { run, observable, cluster, frame } = conformationState;
  if (!run) return;
  const px = Number($("pcX").value),
    py = Number($("pcY").value);
  const byObservable = observable && $("observableColor").checked;
  const clusterIds = byObservable ? [] : [
    ...run.clusters.map(({ id }) => id),
    ...(run.noise.length ? [-1] : []),
  ];
  const legendRows = Math.ceil(clusterIds.length / 5);
  const plot = plotCard("PCA and structural clusters", "conformation_pca", 560,
    385 + 18 * Math.max(0, legendRows - 1));
  const xLabel = (i) =>
    `PC${i + 1} (${pcaUnit(run)} · ${number(run.variance[i] * 100, 1)}% variance)`;
  const x = run.projection.map((p) => p[px]);
  const y = run.projection.map((p) => p[py]);
  plot.addData(() => [
    ["frame", "cluster", `PC${px + 1}`, `PC${py + 1}`, "highlighted_cluster",
      "inspected_frame", "colored_by_observable", "observable", "observable_unit", "observable_value", "pc_unit"],
    ...run.frames.map((f, i) => [f, run.membership.get(f), x[i], y[i], cluster,
      f === frame, Boolean(byObservable), observable?.title, observable?.unit, observable?.values[i], pcaUnit(run)]),
  ]);
  const a = axes(
    plot.svg,
    paddedRange(x),
    paddedRange(y),
    xLabel(px),
    xLabel(py),
  );
  const vMin = observable ? Math.min(...observable.values) : 0;
  const vMax = observable ? Math.max(...observable.values) : 0;
  for (const [i, f] of run.frames.entries()) {
    const id = run.membership.get(f);
    const value = observable?.values[i];
    let shade = clusterShade(id);
    if (byObservable) {
      const fraction = (value - vMin) / (vMax - vMin || 1);
      shade = observable.circular
        ? `hsl(${(value + 180) % 360} 58% 44%)`
        : `rgb(${colorStops(vMin < 0 && vMax > 0 ? value / (value < 0 ? -vMin : vMax) : vMax <= 0 ? (value - vMax) / (vMax - vMin || 1) : fraction).join(",")})`;
    }
    const dot = svgNode("circle", {
      cx: a.x(x[i]),
      cy: a.y(y[i]),
      r: f === frame ? 5 : 3.3,
      fill: shade,
      opacity: !cluster || id === cluster || f === frame ? 0.9 : 0.2,
      stroke: f === frame ? "#182922" : "none",
      "stroke-width": 1.6,
      class: "plot-hit",
    });
    dot.onpointerenter = () => {
      plot.status.textContent = `Frame ${f} · ${clusterName(id)}${observable ? ` · ${number(value, 3)} ${observable.unit}` : ""}`;
    };
    dot.onclick = () => chooseCluster(id, f);
    plot.svg.append(dot);
  }
  if (byObservable) {
    plot.svg.append(svgNode(
      "text",
      { x: 65, y: 45, fill: "#40574c", "font-size": 10 },
      observable.circular
        ? "Cyclic hue · −180° and +180° share a color"
        : `${vMin < 0 ? "Blue" : "Pale"} ${number(vMin, 2)} → ${vMax <= 0 ? "pale" : "red"} ${number(vMax, 2)} ${observable.unit}${vMin < 0 && vMax > 0 ? " · white = 0" : ""}`,
    ));
  }
  for (const [index, id] of clusterIds.entries()) {
    const x = 69 + (index % 5) * 90;
    const y = 368 + Math.floor(index / 5) * 18;
    plot.svg.append(
      svgNode("circle", { cx: x, cy: y, r: 4, fill: clusterShade(id), stroke: "#40574c", "stroke-width": 0.6 }),
      svgNode("text", { x: x + 9, y: y + 4, fill: "#40574c" }, clusterName(id)),
    );
  }
  plot.status.textContent = "Click a point to show its trajectory frame.";
  $("projectionPlot").replaceChildren(plot.card);
}

function renderObservable() {
  const { observable, run } = conformationState;
  if (!observable) return;
  const { values, unit, circular, title } = observable;
  const root = $("observableResults");
  root.hidden = false;
  const cluster = selectedCluster();
  const subsetId = conformationState.cluster;
  const activeFrames = new Set(
    subsetId === -1 ? run.noise : cluster?.frames || run.frames,
  );
  const group = values.filter((_, i) => activeFrames.has(run.frames[i]));
  const yDomain = circular ? [-180, 180] : paddedRange(values);
  const timeline = plotCard(
    "Observable by trajectory frame",
    "observable_trajectory",
  );
  const frameRows = () => [
    ["frame", "cluster", "observable", "unit", "value", "in_selected_subset"],
    ...run.frames.map((frame, i) => [
      frame, run.membership.get(frame), title, unit, values[i], activeFrames.has(frame),
    ]),
  ];
  timeline.addData(frameRows);
  const a = axes(
    timeline.svg,
    [run.frames[0], run.frames.at(-1)],
    yDomain,
    "Trajectory frame (zero-based)",
    unit,
    { xTicks: ticks(run.frames[0], run.frames.at(-1)).map(Math.round) },
  );
  for (const [i, frame] of run.frames.entries()) {
    const id = run.membership.get(frame);
    const dot = svgNode("circle", {
      cx: a.x(frame),
      cy: a.y(values[i]),
      r: 3.3,
      fill: clusterShade(id),
      opacity: activeFrames.has(frame) ? 0.95 : 0.2,
      class: "plot-hit",
    });
    dot.onpointerenter = () => {
      timeline.status.textContent = `Frame ${frame} · ${number(values[i], 3)} ${unit} · ${clusterName(id)}`;
    };
    dot.onclick = () => chooseCluster(id, frame);
    timeline.svg.append(dot);
  }
  timeline.status.textContent =
    "Click a point to inspect the corresponding 3D frame.";

  const distribution = plotCard(
    "Observable distribution",
    "observable_distribution",
  );
  const bins = 18;
  const step = (yDomain[1] - yDomain[0]) / bins;
  function histogram(sample) {
    const histogram = Array(bins).fill(0);
    for (const value of sample) {
      const index = Math.max(
        0,
        Math.min(bins - 1, Math.floor((value - yDomain[0]) / step)),
      );
      histogram[index]++;
    }
    return histogram;
  }
  const allCounts = histogram(values);
  const subsetCounts = histogram(group);
  const all = allCounts.map((count) => count / values.length);
  const subset = subsetCounts.map((count) => group.length ? count / group.length : 0);
  distribution.addData(() => [
    ["bin", "lower_edge", "upper_edge", "observable", "unit", "all_count", "all_fraction",
      "overlay_cluster", "overlay_count", "overlay_fraction"],
    ...allCounts.map((count, i) => [i + 1, yDomain[0] + i * step, yDomain[0] + (i + 1) * step,
      title, unit, count, all[i], subsetId || null, subsetId ? subsetCounts[i] : null, subsetId ? subset[i] : null]),
  ]);
  const ymax = Math.max(...all, ...subset);
  const d = axes(
    distribution.svg,
    yDomain,
    [0, ymax * 1.12],
    unit,
    "Fraction of frames per bin",
  );
  for (const [i, frequency] of all.entries()) {
    const left = d.x(yDomain[0] + i * step);
    const width = d.width / bins;
    distribution.svg.append(
      svgNode("rect", {
        x: left + 1,
        y: d.y(frequency),
        width: width - 2,
        height: d.bottom - d.y(frequency),
        fill: "#a3b5b0",
      }),
    );
    if (subsetId)
      distribution.svg.append(
        svgNode("rect", {
          x: left + width * 0.23,
          y: d.y(subset[i]),
          width: width * 0.54,
          height: d.bottom - d.y(subset[i]),
          fill: clusterShade(subsetId),
          stroke: "#374b43",
          "stroke-width": 0.35,
        }),
      );
  }
  distribution.svg.append(
    svgNode(
      "text",
      { x: 65, y: 370, fill: "#40574c", "font-size": 10 },
      subsetId
        ? `Gray: all retained frames · overlay: ${clusterName(subsetId)}`
        : "All retained frames",
    ),
  );
  distribution.status.textContent = subsetId
    ? `Gray · all retained frames. Overlay · ${clusterName(subsetId)}. Each distribution is normalized separately.`
    : "All retained frames. Select a cluster to compare its distribution.";
  for (const plot of [timeline, distribution]) {
    plot.svg.append(
      svgNode(
        "text",
        { x: 65, y: 45, fill: "#40574c", "font-size": 10 },
        title,
      ),
    );
  }
  const stats = resultsTable([
    "Conformation",
    "Frames",
    circular ? "Circular mean ± circular SD (°)" : `Mean ± SD (${unit})`,
    circular ? "Mean resultant length" : `Median (${unit})`,
  ]);
  const populations = [{ id: 0, frames: run.frames }, ...run.clusters];
  if (run.noise.length) populations.push({ id: -1, frames: run.noise });
  const clusterStats = [];
  const boxStats = [];
  for (const rowCluster of populations) {
    const indices = new Set(rowCluster.frames);
    const sample = values
      .filter((_, i) => indices.has(run.frames[i]))
      .sort((a, b) => a - b);
    const mean = (xs) => xs.reduce((sum, value) => sum + value, 0) / xs.length;
    let center, sd, median;
    if (circular) {
      const radians = sample.map((x) => (x * Math.PI) / 180);
      const sin = mean(radians.map(Math.sin)),
        cos = mean(radians.map(Math.cos));
      median = Math.min(1, Math.hypot(sin, cos));
      center = median < 1e-8 ? null : (Math.atan2(sin, cos) * 180) / Math.PI;
      sd =
        sample.length > 1 && median >= 1e-8
          ? (Math.sqrt(-2 * Math.log(median)) * 180) / Math.PI
          : null;
    } else {
      center = mean(sample);
      sd =
        sample.length > 1
          ? Math.sqrt(
              sample.reduce((sum, value) => sum + (value - center) ** 2, 0) /
                (sample.length - 1),
            )
          : null;
      median =
        (sample[Math.floor((sample.length - 1) / 2)] +
          sample[Math.floor(sample.length / 2)]) /
        2;
      boxStats.push({ id: rowCluster.id, sample, center, sd, median });
    }
    const row = stats.body.insertRow();
    if (subsetId && subsetId === rowCluster.id) row.className = "focused";
    if (rowCluster.id > 0)
      clusterStats.push({
        id: rowCluster.id,
        count: sample.length,
        mean: center,
        sd: sd ?? 0,
      });
    for (const value of [
      rowCluster.id ? clusterName(rowCluster.id) : "All retained frames",
      sample.length,
      `${number(center, 3)} ± ${number(sd, 3)}`,
      number(median, 3),
    ])
      row.insertCell().textContent = value;
  }
  observable.clusterStats = clusterStats;
  const grid = element("div", null, "diagnostic-grid");
  grid.append(timeline.card, distribution.card);
  const tableWrap = element("div", null, "observable-stats");
  tableWrap.append(stats.table);
  const plotsSection = resultSection("Plots", "plots"); plotsSection.append(grid);
  const tablesSection = resultSection("Tables", "tables"); tablesSection.append(tableWrap);
  root.replaceChildren(element("h4", title), analysisSummary("observable", observable.spec, [`${run.frames.length} retained frames`, `Unit: ${unit}`]), plotsSection, tablesSection);
  if (!circular) plotsSection.append(clusterBoxPlot(boxStats, unit, subsetId, frameRows));
  if (observable.spec.kind === "pc") {
    root.append(
      element(
        "small",
        "PC scores were used to define the clusters. Between-cluster differences are descriptive.",
      ),
    );
  } else if (circular) {
    root.append(
      element(
        "small",
        "Circular summaries account for the angle wrapping at ±180°. Box plots and Welch tests are available for scalar observables.",
      ),
    );
  }
  if (!circular && clusterStats.length > 1)
    tablesSection.append(clusterComparisonTable(observable));
}

function renderConformationSummary(run) {
  document.getElementById('conformationSettingsSummary')?.remove();
  const summary = analysisSummary('conformations', run.settings, [`${run.frames.length} retained frames`, `${run.clusters.length} clusters`, `${run.noise.length} unassigned frames`]);
  summary.id = 'conformationSettingsSummary'; $('conformationSummary').after(summary);
  const { table, body } = resultsTable(['Cluster', 'Frames', 'Population (%)', 'Representative frame']);
  for (const cluster of run.clusters) {
    const row = body.insertRow(); const pick = element('button', `Cluster ${cluster.id}`, 'residue-link'); pick.type='button'; pick.onclick=()=>chooseCluster(cluster.id);
    row.insertCell().append(pick);
    for (const value of [cluster.count, number(100 * cluster.count / run.frames.length, 1), cluster.representative]) row.insertCell().textContent=value;
  }
  if (run.noise.length) { const row=body.insertRow(); for (const value of ['Unassigned', run.noise.length, number(100 * run.noise.length/run.frames.length,1),'—']) row.insertCell().textContent=value; }
  $('clusterSummaryTable').replaceChildren(...(run.clusters.length ? [] : [element('p','No assigned clusters at these settings. Adjust DBSCAN ε or minimum samples to explore alternative groupings.','empty-hint')]), table);
}

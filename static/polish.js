"use strict";

const explorerVersion = "1.0.0";
const selectionHelp = 'Use IDs (A:40, PROA:50-60) or Boolean expressions: segid PROA and resid 40:60; (chain A or chain B) and not resname GLY. Fields: chain, segid, resid, resname. Precedence: not, and, or. Parentheses and quoted identifiers are supported. These selectors select protein residues; trajectory atom-selection fields retain MDAnalysis syntax.';

function tableNumber(text, heading) {
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?%?$/i.test(text.trim())) return text;
  const value=Number(text.replace('%',''));
  const integer=/^(rank|frames|sampled frames|matched frames|representative frame|residue node|nodes|edges|clusters|target residues scored|participating residues|connected residues|lining residues.*|frames with volume)$/i.test(heading);
  const digits=integer ? 0 : /%|percent/i.test(heading) ? 1 : /p.value|adjusted.*p|holm/i.test(heading) ? 4 : /Å|angstrom|distance|volume/i.test(heading) ? 2 : 3;
  const formatted=value!==0 && (Math.abs(value)<10**(-digits) || Math.abs(value)>=1e6) ? value.toExponential(2) : value.toFixed(digits);
  return formatted + (text.endsWith('%') ? '%' : '');
}

function enhanceResultsTable(table, headers) {
  const caption = table.createCaption();
  const toolbar = document.createElement('div'); toolbar.className = 'table-tools';
  const filter = document.createElement('input'); filter.type = 'search'; filter.placeholder = 'Filter table…';
  filter.setAttribute('aria-label', 'Filter rows in ' + headers.join(', '));
  const count = document.createElement('small'); count.setAttribute('role', 'status');
  const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.textContent = 'Table CSV';
  exportButton.title = 'Export the currently visible rows as displayed, including rounded values. Plot CSV exports retain the underlying figure data.';
  function visibleRows() { return [...table.tBodies[0].rows].filter(row => !row.hidden); }
  function applyFilter() {
    const text = filter.value.trim().toLowerCase();
    for (const row of table.tBodies[0].rows) row.hidden = Boolean(text) && !row.textContent.toLowerCase().includes(text);
    count.textContent = `${visibleRows().length} / ${table.tBodies[0].rows.length} rows`;
  }
  filter.addEventListener('input', applyFilter);
  exportButton.onclick = () => exportCsv([headers, ...visibleRows().map(row => [...row.cells].map(cell => cell.textContent))], 'table_' + headers.slice(0,3).join('_').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'') + '.csv');
  toolbar.append(filter, count, exportButton); caption.append(toolbar);
  let sortedColumn = -1, descending = false;
  [...table.tHead.rows[0].cells].forEach((cell, column) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'sort-column'; button.textContent = headers[column] + ' ↕';
    button.setAttribute('aria-label', `Sort by ${headers[column]}`);
    cell.replaceChildren(button);
    button.onclick = () => {
      descending = sortedColumn === column ? !descending : false; sortedColumn = column;
      const numeric = value => /^[-+]?\d*\.?\d+(e[-+]?\d+)?%?$/i.test(value.trim()) ? Number(value.replace('%', '')) : null;
      const rows = [...table.tBodies[0].rows];
      rows.sort((a, b) => {
        const x = a.cells[column].textContent.trim(), y = b.cells[column].textContent.trim();
        const missing = v => ['', '—', '–', 'NaN'].includes(v);
        if (missing(x) || missing(y)) return Number(missing(x)) - Number(missing(y));
        const xn = numeric(x), yn = numeric(y);
        const order = xn !== null && yn !== null ? xn - yn : x.localeCompare(y, undefined, { numeric: true });
        return descending ? -order : order;
      });
      for (const row of rows) table.tBodies[0].append(row);
      for (const heading of table.tHead.rows[0].cells) heading.removeAttribute('aria-sort');
      cell.setAttribute('aria-sort', descending ? 'descending' : 'ascending'); applyFilter();
    };
  });
  table.classList.add('sortable-table');
  const observer = new MutationObserver(() => {
    for (const row of table.tBodies[0].rows) for (const [index,cell] of [...row.cells].entries()) {
      const numeric=/^[-+]?\d*\.?\d+(e[-+]?\d+)?%?$/i.test(cell.textContent.trim());
      if (numeric && !cell.children.length) {
        const formatted=tableNumber(cell.textContent,headers[index]);
        if (formatted!==cell.textContent) cell.textContent=formatted;
      }
    }
    // Alignment is a column property, including headings and missing values.
    const numberPart='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
    const numericDisplay=new RegExp(`^${numberPart}(?:%|\\s*±\\s*(?:${numberPart}|—)|\\s*\\(\\d+\\))?$`, 'i');
    for (const [index, heading] of [...table.tHead.rows[0].cells].entries()) {
      const cells=[...table.tBodies[0].rows].map(row=>row.cells[index]).filter(Boolean);
      const values=cells.map(cell=>cell.textContent.trim()).filter(value=>!['', '—', '–', 'NaN'].includes(value));
      const numeric=values.length>0 && values.every(value=>numericDisplay.test(value));
      heading.classList.toggle('numeric-cell', numeric);
      for (const cell of cells) cell.classList.toggle('numeric-cell', numeric);
    }
    applyFilter();
  });
  observer.observe(table.tBodies[0], { childList: true, subtree: true, characterData: true });
}

function pdbIons(pdb) {
  const names = new Set('ZN ZN2 CA CAL MG MG2 MN MN2 FE FE2 FE3 CU CU1 CU2 CO CO2 NI NI2 NA SOD K POT CL CLA CD HG SR CS BA LI RB F BR I IOD'.split(' '));
  return pdb.split('\n').filter(line => line.startsWith('HETATM') && names.has(line.slice(17, 20).trim())).map(line => ({
    name: line.slice(17, 20).trim(), chain: line[21].trim(), segid: line.slice(72, 76).trim(),
    resid: Number(line.slice(22, 26)), icode: line[26].trim(), xyz: [30, 38, 46].map(i => Number(line.slice(i, i + 8))),
  }));
}

function addIonMarkers(scene) {
  if (!document.getElementById('showStructuralIons')?.checked) return;
  for (const ion of pdbIons(scene.pdb)) {
    const shade = /^(CA|CAL|MG|MG2)$/.test(ion.name) ? '#7fc9ad' : '#c7acd9';
    scene.markers.push({ xyz: ion.xyz, shade, radius: 0.65, group: 'structural_ions' });
    if (document.getElementById('ionLabels')?.checked)
      scene.labels.push({ xyz: ion.xyz, text: `${ion.name} ${ion.chain || ion.segid || '_'}:${ion.resid}${ion.icode}`, shade });
  }
}

function pocketIonDistances(pocket) {
  const centers = pocket.centers || [];
  if (!centers.length || !state.structure) return [];
  return pdbIons(state.structure.pdb).map(ion => ({ ...ion,
    distance: Math.min(...centers.map(center => Math.hypot(...center.map((v, i) => v - ion.xyz[i])))),
  })).filter(ion => ion.distance <= 5).sort((a, b) => a.distance - b.distance);
}

function atomIdentity(atom) {
  const line = atom.pdbline || '';
  return `${line.slice(17, 20).trim() || atom.resn} · resid ${line.slice(22, 26).trim()}${line[26]?.trim() || ''} · chain ${line[21]?.trim() || '_'} · segid ${line.slice(72, 76).trim() || '_'} · atom ${atom.atom || line.slice(12, 16).trim()}`;
}
const inspectionLabels = new WeakMap();
function installResidueInspection(view, model) {
  if (!model.setHoverable || !model.setClickable) return;
  const previous = inspectionLabels.get(view);
  if (previous) { view.removeLabel(previous); inspectionLabels.delete(view); }
  model.setHoverable({}, true, atom => {
    const old = inspectionLabels.get(view); if (old) view.removeLabel(old);
    inspectionLabels.set(view, view.addLabel(atomIdentity(atom), { position: atom, fontSize: 11, fontColor: '#fff', backgroundColor: '#142b33', backgroundOpacity: 0.95, inFront: true }));
    view.render();
  }, () => { const old = inspectionLabels.get(view); if (old) view.removeLabel(old); inspectionLabels.delete(view); view.render(); });
  model.setClickable({}, true, atom => {
    document.getElementById('atomInspection').textContent = atomIdentity(atom);
    const id = nodeOf(atom);
    if (id == null || state.busy) return;
    const action = document.getElementById('pickAction').value;
    if (action === 'inspect') { if (state.perturbation) mechanism.inspectReceiver?.(id); return; }
    const append = document.getElementById('appendPick').checked;
    const ids = append ? new Set(state.highlighted) : new Set();
    ids.add(id);
    document.getElementById('highlights').value = qualifiedResidues([...ids]);
    applyHighlight();
    if (state.viewerPanel === 'conformations') {
      document.getElementById('frameHighlights').value = document.getElementById('highlights').value;
      conformationState.highlighted = ids; restyleFrame();
    }
    const text = qualifiedResidues([...ids]);
    if (['a', 'b', 'functional'].includes(action)) {
      document.getElementById(roleFields[action]).value = 'custom'; custom[action] = text;
      if (action === 'a') conformationState.transferredResidues = null;
      renderCustom(); clearResults();
      notice(`Picked ${ids.size} residues for ${action === 'functional' ? 'functional reference' : 'Region ' + action.toUpperCase()}.`);
    } else if (action === 'prs-source' || action === 'prs-target') {
      const source = action === 'prs-source';
      if (!source) { document.getElementById('prsWorkflow').value = 'sources'; document.getElementById('prsRankingFields').hidden = false; }
      document.getElementById(source ? 'prsScope' : 'prsTargetScope').value = 'custom';
      document.getElementById(source ? 'prsCustom' : 'prsTarget').value = text;
      document.getElementById(source ? 'prsCustomField' : 'prsTargetCustomField').hidden = false;
      clearPrsResults();
    }
  });
}

function updateWorkspaceStatus() {
  const empty = document.getElementById('analysisEmptyState');
  const summary = document.getElementById('analysisContext');
  const panel = state.viewerPanel;
  const messages = {
    pockets: ['Discover candidate pockets', 'Open a PDB, choose the chains to scan, then detect pockets. Inspect structural ions before interpreting a cavity as an available binding site.'],
    communication: ['Explore communication', 'Choose a topology and trajectory, define Region A, and run analysis. Leave Region B empty to discover coupled residues.'],
    conformations: ['Explore conformational states', 'Choose a topology and trajectory, select a PCA basis and clustering method, then inspect representative frames and observables.'],
    perturbation: ['Explore perturbation response', 'Choose a source pocket or residue group to see what responds, or switch the analysis question to rank pushes against a monitored region.'],
  };
  const hasResults = panel === 'communication' ? state.analyzed : panel === 'conformations' ? conformationState.run : panel === 'perturbation' ? mechanism.response.length : state.pockets.length;
  empty.hidden = Boolean(hasResults);
  document.getElementById('emptyStateTitle').textContent = messages[panel][0];
  document.getElementById('emptyStateDescription').textContent = messages[panel][1];
  summary.hidden = !state.structure;
  if (!state.structure) return;
  const details = [state.structure.name, `${state.residues.size} protein residues`, `${pdbIons(state.structure.pdb).length} retained ions`];
  if (panel === 'communication' && state.analyzed) {
    const r = state.analyzed; details.push(`${r.frames} retained frames`, `${r.nodes} Cα nodes`, `${r.edges} network edges`, r.settings.method);
  } else if (panel === 'conformations' && conformationState.run) {
    const r = conformationState.run; details.push(`${r.frames.length} retained frames`, `${r.clusters.length} clusters`, `${r.settings.basis} PCA`, r.settings.clustering);
  } else if (panel === 'perturbation' && mechanism.response.length) details.push(`${mechanism.prsSources.length} scanned sources`, `${mechanism.response.length} displayed responders`, 'Cα elastic network');
  summary.textContent = details.join(' · ');
}

(() => {
  document.getElementById('openAbout').onclick = () => document.getElementById('aboutDialog').showModal();
  document.getElementById('closeAbout').onclick = () => document.getElementById('aboutDialog').close();
  document.getElementById('aboutVersion').textContent = explorerVersion;
  for (const id of ['highlights', 'frameHighlights', 'prsCustom', 'prsTarget', 'contactGroupA', 'contactGroupB']) {
    const input = document.getElementById(id); if (input) input.title = selectionHelp;
  }
  for (const id of ['showStructuralIons', 'ionLabels']) document.getElementById(id).onchange = () => { draw(); restyleFrame(); };
})();

function resultSection(title, kind) {
  const section = element('section', null, 'result-section');
  section.dataset.resultKind = kind;
  section.append(element('h4', title));
  return section;
}

function analysisSummary(kind, settings, facts = []) {
  const structureName=state.structure?.name || 'Structure';
  const savedSettings=JSON.parse(JSON.stringify(settings || {}));
  const section = resultSection('Analysis summary', 'summary');
  section.append(element('p', [structureName, ...facts].join(' · '), 'analysis-facts'));
  const details = element('details', null, 'settings-used');
  details.append(element('summary', 'Selections and settings used'));
  const list = element('dl', null, 'settings-list');
  const labels = { a:'Region A', b:'Region B', functional:'Functional reference', sources:'Perturbed sources', targets:'Monitored residues', topology:'Topology', trajectory:'Trajectory', selection:'Topology atom selection', frame_indices:'Explicit retained frames', max_frames:'Frame cap', stride:'Frame stride', cutoff:'Contact cutoff (Å)', occupancy:'Minimum contact occupancy', coupling:'Minimum edge |r|', basis:'PCA representation', components:'PCs for clustering', clustering:'Clustering method', clusters:'Requested clusters', eps:'DBSCAN relative ε', min_samples:'DBSCAN minimum samples', focus:'PCA residues', fit:'Alignment residues', min_distance:'Minimum distance from A (Å)', sasa_threshold:'SASA threshold (Å²)', sasa_points:'SASA sphere points', sasa_snapshots:'SASA snapshot cap', candidate_filter:'Accessibility filter', reference:'Reference structure', overlap:'Minimum lining overlap', workers:'CPU workers' };
  const residueKeys = new Set(['a','b','functional','sources','targets','focus','fit','reference','exclude','displayed_responders']);
  for (const [key, value] of Object.entries(savedSettings)) {
    if (key === 'pdb') continue;
    let text;
    if (Array.isArray(value) && key === 'groups') text = value.map((ids,i)=>`Group ${i+1}: ${ids.length ? qualifiedResidues(ids) : 'All mapped residues'}`).join('\n');
    else if (Array.isArray(value) && residueKeys.has(key)) text = value.length ? qualifiedResidues(value) : 'Not restricted / default';
    else if (Array.isArray(value) && key === 'frame_indices') text = value.length ? `${value.length} indices: ${value.join(', ')}` : 'Stride/cap sampling';
    else if (value && typeof value === 'object') text = JSON.stringify(value);
    else text = value == null || value === '' ? 'Default / not specified' : String(value);
    list.append(element('dt', labels[key] || key.replaceAll('_',' ')), element('dd', text));
  }
  details.append(list); section.append(details);
  const exportButton = element('button','Settings JSON'); exportButton.type='button';
  exportButton.onclick=()=>saveBlob(new Blob([JSON.stringify({version:explorerVersion,analysis:kind,structure:structureName,facts,settings:savedSettings},null,2)],{type:'application/json'}),`${kind}_settings.json`);
  section.append(exportButton); return section;
}

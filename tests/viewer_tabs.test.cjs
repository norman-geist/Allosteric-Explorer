// Run with: node tests/viewer_tabs.test.cjs
// Exercise the production draw, startup, API, tab switching and server browser
// functions with a minimal DOM and mocked server responses; no WebGL required.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const mechanism = fs.readFileSync(path.join(__dirname, '../static/mechanism.js'), 'utf8');
class Element {
  constructor(value = '') {
    this.value = value;
    this.children = [];
    this.childElementCount = 0;
    this.hidden = false;
    this.listeners = new Map();
    this.classList = { toggle() {} };
  }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback, options) { this.listeners.set(name, { callback, options }); }
  showModal() { this.open = true; }
  close() {
    this.open = false;
    const listener = this.listeners.get('close');
    if (listener?.options?.once) this.listeners.delete('close');
    listener?.callback();
  }
}
const elements = new Map();
const $ = (id) => {
  if (!elements.has(id)) elements.set(id, new Element());
  return elements.get(id);
};
$('viewerColor').options = ['chain', 'coupling', 'response'].map(value => ({ value, disabled: false }));
$('negativeCorrelationLimit').value = '.25';
$('positiveCorrelationLimit').value = '.7';
$('prsResponseLimit').value = '18';
const state = { pockets: [], viewerPanel: 'pockets', viewerColors: { pockets: 'chain', communication: 'chain', perturbation: 'chain', conformations: 'chain' }, analyzed: {}, communication: false };
const requests = [];
const panelChanges = [];
const browseButtons = [new Element(), new Element()];
const context = {
  state, $, mechanism: { response: [{ score: 10 }] }, conformationState: { run: null },
  viewer: null, protein: null, FormData: class {}, performance, setInterval, clearInterval,
  document: { getElementById: $, querySelectorAll: () => browseButtons, dispatchEvent: event => panelChanges.push(event.detail.panel) },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  updatePrsSources() {}, conformationControls() {}, updateContactGroups() {}, renderObservableInputs() {},
  legend() {}, controls() {}, notice() {},
  trajectorySampling: new Map(),
  element(tag, text) { const e = new Element(); e.textContent = text; return e; },
  fetch: async (url, options) => {
    requests.push({ url, options });
    const data = url === '/api/session' ? { token: 'session-token', fpocket: true, native_pdb: false }
      : { path: '/work', parent: '/', separator: '/', folders: ['subdir'], files: ['protein.psf', 'frames.dcd', 'protein.pdb'] };
    if (url === '/api/browse-files') assert.equal(options.headers['X-Explorer-Token'], 'session-token');
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => data };
  },
};
vm.createContext(context);
function extract(name, next, text = source) {
  const start = text.indexOf(`function ${name}(`);
  const end = text.indexOf(`function ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return text.slice(text.slice(start - 6, start) === "async " ? start - 6 : start, end);
}
const polish = fs.readFileSync(path.join(__dirname, '../static/polish.js'), 'utf8');
vm.runInContext(polish.slice(polish.indexOf('function updateWorkspaceStatus()'), polish.indexOf('\n(() => {', polish.indexOf('function updateWorkspaceStatus()'))), context);
vm.runInContext(extract('activePocketPreview', 'activeColorSource'), context); // includes REAL draw()
vm.runInContext(extract('setPanel', 'selection'), context);
vm.runInContext(extract('prsMaximum', 'prsColors', mechanism), context);
vm.runInContext(extract('api', 'requestedCpuWorkers'), context); // includes task()
vm.runInContext(extract('browseServerFile', 'addFieldHelp').split('\nfor (const button')[0], context);
context.setStructure = () => context.setPanel(false);
const settle = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  // Real startup sequence must reach /api/session after the initial draw.
  vm.runInContext(source.slice(source.lastIndexOf('\nsetStructure(null);')), context);
  await settle();
  assert.equal(state.token, 'session-token');
  assert.equal(state.nativePdb, false);
  assert.equal(state.busy, false);
  const changeMarker = '$("viewerColor").addEventListener("change", () => {';
  const start = source.indexOf(changeMarker) + changeMarker.length;
  const change = source.slice(start, source.indexOf('\n});', start));
  function chooseColor(value) { $('viewerColor').value = value; vm.runInContext(change, context); }
  context.setPanel(true); chooseColor('coupling');
  context.setPanel('perturbation'); chooseColor('response');
  for (const [tab, expected] of [[false, 'chain'], ['conformations', 'chain'], [true, 'coupling'], [false, 'chain'], ['perturbation', 'response'], ['conformations', 'chain'], [true, 'coupling']]) {
    context.setPanel(tab);
    assert.equal($('viewerColor').value, expected);
    assert.equal(panelChanges.at(-1), state.viewerPanel);
    assert.equal($('correlationScaleControls').hidden, expected !== 'coupling');
    assert.equal($('prsScaleControls').hidden, expected !== 'response');
  }
  assert.equal($('negativeCorrelationLimit').value, '.25');
  assert.equal($('positiveCorrelationLimit').value, '.7');
  assert.equal($('prsResponseLimit').value, '18');
  state.analyzed = null; context.draw(); assert.equal($('viewerColor').value, 'chain');
  state.analyzed = {}; context.draw(); assert.equal($('viewerColor').value, 'coupling');
  chooseColor('chain'); context.setPanel('perturbation'); context.setPanel(true);
  assert.equal($('viewerColor').value, 'chain');
  // Authenticated server browser: list and choose each input type, then cancel.
  for (const [kind, file] of [['topology', 'protein.psf'], ['trajectory', 'frames.dcd'], ['structure', 'protein.pdb']]) {
    const selected = context.browseServerFile(kind, '');
    await settle();
    assert.equal($('serverFileDialog').open, true);
    assert.equal($('serverFileStatus').textContent, '');
    const entry = $('serverFileEntries').children.find(e => e.textContent === file);
    assert.ok(entry); entry.onclick();
    assert.equal(await selected, `/work/${file}`);
    assert.equal(JSON.parse(requests.at(-1).options.body).kind, kind);
  }
  const cancelled = context.browseServerFile('trajectory', '/work');
  await settle(); $('serverFileDialog').close(); assert.equal(await cancelled, null);
  console.log('PASS: real draw and startup; all-tab coloring/slider retention; missing-results fallback; authenticated server file browsing, selection and cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });

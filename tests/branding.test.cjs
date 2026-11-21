// Run with: node tests/branding.test.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const script = fs.readFileSync(path.join(__dirname, '../static/branding.js'), 'utf8');
function setup(stored, blocked = false) {
  const classes = new Set();
  const images = ['pockets', 'communication', 'conformations', 'perturbation'].map(panel => ({ dataset: { bannerPanel: panel }, hidden: true }));
  const banner = { hidden: false, querySelectorAll: () => images,
    classList: { toggle(k, on) { if(on) classes.add(k); else classes.delete(k); } } };
  const visual = { hidden: false };
  const toggle = { setAttribute(k, v) { this[k] = v; }, addEventListener(k, fn) { this[k] = fn; } };
  const fields = { brandBanner: banner, toggleBrandBanner: toggle, brandBannerVisual: visual, brandSection: {}, brandDescription: {} };
  const listeners = new Map();
  const storage = new Map([['allosteric-explorer.banner-hidden', stored]]);
  vm.runInNewContext(script, {
    document: { getElementById: id => fields[id], addEventListener: (k, fn) => listeners.set(k, fn) },
    localStorage: {
      getItem: k => { if (blocked) throw new Error('Storage denied'); return storage.get(k); },
      setItem: (k, v) => { if (blocked) throw new Error('Storage denied'); storage.set(k, v); },
    },
  });
  return { banner, visual, toggle, storage, images, fields, classes,
    switchPanel: panel => listeners.get('allosteric:panel-change')({ detail: { panel } }) };
}
let run = setup(null);
assert.equal(run.visual.hidden, false); assert.equal(run.toggle['aria-expanded'], 'true');
for (const panel of ['pockets', 'communication', 'conformations', 'perturbation', 'pockets']) {
  run.switchPanel(panel);
  assert.equal(run.images.filter(image => !image.hidden).length, 1);
  assert.equal(run.images.find(image => !image.hidden).dataset.bannerPanel, panel);
  assert.ok(run.fields.brandSection.textContent);
  assert.ok(run.fields.brandDescription.textContent);
}
run.toggle.click(); assert.equal(run.visual.hidden, true); assert.equal(run.banner.hidden, false);
assert.ok(run.classes.has('is-collapsed')); assert.equal(run.toggle.textContent, 'Show banner');
assert.equal(run.storage.get('allosteric-explorer.banner-hidden'), 'true');
run.switchPanel('perturbation'); run.toggle.click();
assert.equal(run.visual.hidden, false); assert.equal(run.toggle.textContent, 'Hide banner');
assert.equal(run.images.find(image => !image.hidden).dataset.bannerPanel, 'perturbation');
run.switchPanel('unknown'); assert.equal(run.images.find(image => !image.hidden).dataset.bannerPanel, 'pockets');
run = setup('true'); assert.equal(run.visual.hidden, true); assert.equal(run.banner.hidden, false);
run = setup(null, true); assert.equal(run.visual.hidden, false);
assert.doesNotThrow(() => run.toggle.click()); assert.equal(run.visual.hidden, true);
assert.doesNotThrow(() => vm.runInNewContext(script, { document: { getElementById: () => null } }));
console.log('PASS: four panel illustrations/captions, collapsed navigation stays available, saved preference and restricted-storage fallback.');

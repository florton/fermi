/**
 * The viewer. The simulation runs in a worker and streams its history here as
 * it goes, so playback starts at once and follows the simulated edge; once
 * recorded, any moment can be scrubbed to without re-simulating. The map fills the screen; panels float over it and can be hidden.
 */

import { TRAITS } from '../core/genome.ts';
import { DEFAULTS, withHardStepRate, type SimParams } from '../core/params.ts';
import { ARCHETYPES } from '../core/archetypes.ts';
import { CONDITIONS, SCENARIOS, universeParams } from '../core/scenarios.ts';
import type { SimResult } from '../core/sim.ts';
import type { Summary } from '../core/summary.ts';
import { MapView, type Layers, type Slice } from './map2d.ts';
import { TRAIT_COLORS, buildChronicle, drawTraits, renderInspector, renderKinds, renderLineages, renderStats, updateChronicle } from './panels.ts';
import { computeFrame, whatSaw, type Frame } from './state.ts';
import { applyDynamic, unpackStatic } from './civpack.ts';
import type { WorkerMessage } from './worker.ts';
import { Timeline } from './timeline.ts';

const FIELDS: [key: string, label: string, step: number][] = [
  ['seed', 'Seed', 1],
  ['nodes', 'Galaxy groups', 1000],
  ['boxGly', 'Box side, Gly', 0.5],
  ['tEnd', 'End time, Gyr', 1],
  ['hardStepLog10', 'Hard steps, log₁₀ rate/Gyr', 0.1],
  ['habitablePerMsun', 'Habitable planets per solar mass', 0.01],
  ['filterSurvival', 'Filter survival', 0.05],
  ['speedMax', 'Max probe speed, c', 0.05],
  ['preemption', 'Preemption', 0.1],
  ['detectRange', 'Detection range, Gly', 0.1],
  ['techStep', 'Time per tech tier, Gyr', 0.1],
  ['tierHazard', 'Risk per tech tier (filter ahead)', 0.05],
  ['sterilizeRate', 'True sterilizations per Gyr today', 0.01],
  ['resetRate', 'Complex-life wipes per Gyr today', 0.05],
  ['microbialSteps', 'Steps microbes carry through a wipe', 1],
  ['inwardnessCap', 'Turning inward possible (0–1)', 0.1],
  ['restraintCap', 'Restraint / zoo possible (0–1)', 0.1],
  ['growthCollapse', 'Fast growth raises collapse ×', 0.5],
  ['berserkerChance', 'Berserker release chance per scan', 0.05],
  ['strikeKill', 'Strike lethality (0 = no strikes)', 0.1],
  ['strikeRadius', 'Strike blast reach, Gly', 0.05],
  ['strikeReveal', 'Chance a strike is traced', 0.1],
  ['skyResponse', 'Hide when not alone', 0.05],
  ['threatResponse', 'Hide after being hit', 0.05],
  ['ftlChance', 'FTL channel discovery chance', 0.05],
  ['ftlCloak', 'Channel can carry waste heat (0/1)', 1],
  ['stealthFloor', 'Heat still visible at full stealth', 0.01],
  ['siegeDelay', 'Siege delay, Gyr', 0.5],
  ['defenderAdvantage', 'Defender advantage', 0.5],
  ['collapseRate', 'Collapse rate, /Gyr', 0.01],
  ['mutationSigma', 'Mutation σ', 0.01],
];
const HARD_DEFAULT = DEFAULTS.hardSteps.find((s) => s.log10Rate < 0)?.log10Rate ?? -5;
const LAYER_NAMES: [keyof Layers, string][] = [
  ['territory', 'Territory'],
  ['empty', 'Unsettled groups'],
  ['species', 'Species (first light, stayed home)'],
  ['strikes', 'Strikes and impacts'],
  ['labels', 'Lineage names'],
  ['reach', 'Selection: light front, sensors, what it saw'],
  ['wrap', 'Repeat the box to fill the screen (it wraps)'],
  ['key', 'Show the symbol key'],
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const paramsEl = $('params');
const runBtn = $<HTMLButtonElement>('run');
const newSeedBtn = $<HTMLButtonElement>('new-seed');
const nowBtn = $<HTMLButtonElement>('now');
const speedSel = $<HTMLSelectElement>('speed');
const tlabel = $('tlabel');
const overlay = $('overlay');
const tip = $('tip');
const sliceC = $<HTMLInputElement>('slice-c');
const sliceW = $<HTMLInputElement>('slice-w');
const inspector = $('inspector');
const lineagesEl = $('lineages');
const statsEl = $('stats');
const chronicleEl = $('chronicle');
const traitsCanvas = $<HTMLCanvasElement>('traits');
const dialog = $<HTMLDialogElement>('params-dialog');

// ── Parameters ─────────────────────────────────────────────────────────────
for (const [key, label, step] of FIELDS) {
  const l = document.createElement('label');
  l.htmlFor = `f-${key}`;
  l.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.id = `f-${key}`;
  input.name = key;
  input.step = String(step);
  paramsEl.append(l, input);
}
const field = (key: string) => $<HTMLInputElement>(`f-${key}`);
const sizeSel = $<HTMLSelectElement>('size');
const spanSel = $<HTMLSelectElement>('span');
/** Universe size and run length live in the top bar; they write into the same fields the dialog shows. */
function applySizeAndSpan() {
  const [box, nodes] = sizeSel.value.split(',');
  field('boxGly').value = box;
  field('nodes').value = nodes;
  field('tEnd').value = spanSel.value;
}
// ── Universe: which kinds of civilisation can arise, and what nature is like ──
const universeEl = $('universe');
const universeBtn = $<HTMLButtonElement>('universe-btn');
const kinds = new Set<string>(['mixed']);
const conds = new Set<string>();
let preset = 'baseline';
/** Every parameter some condition sets, so unticking one can put it back to its default. */
const CONDITION_KEYS = [...new Set(Object.values(CONDITIONS).flatMap((c) => Object.keys(c.params)))];

universeEl.innerHTML = `
  <label class="row">Preset <select id="preset">${Object.keys(SCENARIOS).map((s) => `<option>${s}</option>`).join('')}<option value="custom">custom</option></select></label>
  <div class="cols">
    <div><h3>Kinds of civilisation</h3>${Object.entries(ARCHETYPES)
      .map(([k, a]) => `<label title="${a.blurb}"><input type="checkbox" data-kind="${k}" /> ${a.label}<small>${a.blurb}</small></label>`)
      .join('')}</div>
    <div><h3>Universe conditions</h3>${Object.entries(CONDITIONS)
      .map(([k, c]) => `<label title="${c.blurb}"><input type="checkbox" data-cond="${k}" /> ${c.label}<small>${c.blurb}</small></label>`)
      .join('')}</div>
  </div>
  <p class="muted">Kinds set a species' starting temperament; traits still mutate and compete. No kinds ticked means Mixed.</p>`;
const presetSel = $<HTMLSelectElement>('preset');

function syncUniverseUi() {
  for (const el of universeEl.querySelectorAll<HTMLInputElement>('input[data-kind]')) el.checked = kinds.has(el.dataset.kind!);
  for (const el of universeEl.querySelectorAll<HTMLInputElement>('input[data-cond]')) el.checked = conds.has(el.dataset.cond!);
  presetSel.value = preset;
  universeBtn.textContent =
    preset === 'custom' ? `Universe: ${kinds.size} kind${kinds.size === 1 ? '' : 's'}, ${conds.size} condition${conds.size === 1 ? '' : 's'} ▾` : `Universe: ${preset} ▾`;
}

/** Write the ticked conditions into the parameter fields, resetting the ones nothing ticked sets. */
function applyConditions() {
  const set = universeParams([...conds], [...kinds]) as Record<string, unknown>;
  for (const key of CONDITION_KEYS) {
    const input = document.getElementById(`f-${key}`) as HTMLInputElement | null;
    if (input) input.value = String(set[key] ?? (DEFAULTS as unknown as Record<string, number>)[key]);
  }
}

function applyPreset(name: string) {
  const s = SCENARIOS[name];
  preset = name;
  kinds.clear();
  for (const k of s.archetypes) kinds.add(k);
  conds.clear();
  for (const c of s.conditions) conds.add(c);
  const merged = { ...DEFAULTS, ...universeParams(s.conditions, s.archetypes), ...s.extra } as unknown as Record<string, number>;
  const hard = s.extra?.hardSteps?.find((h) => h.log10Rate < 0)?.log10Rate ?? HARD_DEFAULT;
  for (const [key] of FIELDS) field(key).value = String(key === 'hardStepLog10' ? hard : merged[key]);
  applySizeAndSpan();
  syncUniverseUi();
}

applyPreset('baseline');
presetSel.onchange = () => {
  if (presetSel.value !== 'custom') applyPreset(presetSel.value);
  markStale();
};
universeEl.onchange = (e) => {
  const input = e.target as HTMLInputElement;
  if (input.dataset.kind) {
    if (input.checked) kinds.add(input.dataset.kind);
    else kinds.delete(input.dataset.kind);
    if (kinds.size === 0) kinds.add('mixed');
  } else if (input.dataset.cond) {
    if (input.checked) conds.add(input.dataset.cond);
    else conds.delete(input.dataset.cond);
    applyConditions();
  } else return;
  preset = 'custom';
  syncUniverseUi();
  markStale();
};
universeBtn.onclick = (e) => {
  e.stopPropagation();
  universeEl.hidden = !universeEl.hidden;
  layersEl.hidden = true;
};
universeEl.onclick = (e) => e.stopPropagation();
document.addEventListener('click', () => (universeEl.hidden = true));

sizeSel.onchange = spanSel.onchange = () => {
  applySizeAndSpan();
  markStale();
};
paramsEl.oninput = () => markStale();
$('open-params').onclick = () => dialog.showModal();

function readParams(): Partial<SimParams> {
  // Start from the universe choice so settings the form doesn't show come along;
  // a preset's extras (like the control's removed options) apply only while it's unedited.
  let over: Partial<SimParams> = { ...universeParams([...conds], [...kinds]), ...(preset !== 'custom' ? SCENARIOS[preset].extra : {}) };
  for (const [key] of FIELDS) {
    const v = Number(field(key).value);
    if (!Number.isFinite(v)) continue;
    if (key === 'hardStepLog10') over = withHardStepRate(over, v);
    else (over as Record<string, number>)[key] = v;
  }
  return over;
}

// ── Layers ─────────────────────────────────────────────────────────────────
const layers: Layers = { territory: true, empty: true, species: true, strikes: true, labels: true, reach: true, wrap: true, key: true };
const layersEl = $('layers');
layersEl.innerHTML =
  LAYER_NAMES.map(([k, label]) => `<label><input type="checkbox" data-layer="${k}" checked /> ${label}</label>`).join('') +
  '<label>Tile size <input id="tile-size" type="range" min="6" max="40" step="1" value="11" /></label>';
layersEl.onchange = (e) => {
  const input = e.target as HTMLInputElement;
  if (!input.dataset.layer) return;
  layers[input.dataset.layer as keyof Layers] = input.checked;
  $('map-key').hidden = !layers.key;
  map.dirty = true;
};
layersEl.oninput = (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === 'tile-size') map.setTileSize(Number(input.value));
};
$('layers-btn').onclick = (e) => {
  e.stopPropagation();
  layersEl.hidden = !layersEl.hidden;
};
document.addEventListener('click', (e) => {
  if (!layersEl.contains(e.target as Node)) layersEl.hidden = true;
});

$('legend').innerHTML = TRAITS.map((t, i) => `<span><i style="background:${TRAIT_COLORS[i]}"></i>${t}</span>`).join('');

// ── State ──────────────────────────────────────────────────────────────────
let result: SimResult | null = null;
let summary: Summary | null = null;
let frame: Frame | null = null;
let t = 0;
let selected = -1;
let playing = false;
let simulating = false;
/** How far the simulation has got; playback can't pass it. */
let simT = 0;
/** Which request the worker's replies should answer. */
let runId = 0;
/** Latest moment that can be shown. */
const limit = () => (result ? (simulating ? simT : result.params.tEnd) : 0);
/** The settings no longer match the universe on screen, so the main button runs instead of plays. */
let stale = true;
const slice = (): Slice => ({ center: Number(sliceC.value), width: Number(sliceW.value) });

const map = new MapView($<HTMLCanvasElement>('map'));
const timeline = new Timeline($<HTMLCanvasElement>('timeline'));
map.onPick = (civ) => select(civ);
map.onHover = (html, x, y) => {
  if (!html) {
    tip.hidden = true;
    return;
  }
  tip.innerHTML = html;
  tip.hidden = false;
  tip.style.left = `${Math.min(x + 14, innerWidth - 270)}px`;
  tip.style.top = `${y + 14}px`;
};
timeline.onScrub = (tt) => setTime(tt);

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;
  if (msg.run !== runId) return;
  if (msg.kind === 'summary') {
    summary = msg.summary;
    refreshPanels(true);
    return;
  }
  simT = msg.simT;
  if (msg.civStatic && msg.positions) {
    // The first picture of a new universe.
    hideProgress();
    const civs = unpackStatic(msg.civStatic);
    applyDynamic(civs, msg.civs);
    result = { ...msg.snap, civs, positions: msg.positions };
    summary = null;
    overlay.textContent = '';
    nowBtn.disabled = false;
    newSeedBtn.hidden = false;
    selected = -1;
    map.sight = [];
    updateInsets();
    map.setResult(result);
    timeline.setResult(result);
    chronicleLength = -1;
    resizeTraits();
    setTime(timeline.t0);
    setPlaying(true);
  } else if (result) {
    applyDynamic(result.civs, msg.civs);
    result = { ...msg.snap, civs: result.civs, positions: result.positions };
    map.update(result);
    timeline.update(result);
  }
  if (!result) return;
  timeline.simT = simT;
  if (msg.done) {
    simulating = false;
    timeline.simT = Infinity;
  }
  if (result.chronicle.length !== chronicleLength) {
    chronicleLength = result.chronicle.length;
    buildChronicle(chronicleEl, result);
  }
  setTime(t);
  updateMainButton();
};
let chronicleLength = -1;

function simulate() {
  simulating = true;
  stale = false;
  simT = 0;
  overlay.textContent = '';
  simStarted = performance.now();
  showProgress(0, 'Placing galaxies and seeding life…');
  setPlaying(false);
  updateMainButton();
  worker.postMessage(readParams());
  runId++;
}

// ── Progress ───────────────────────────────────────────────────────────────
const progressEl = $('progress');
const progressFill = $('progress-fill');
const progressText = $('progress-text');
let simStarted = 0;
function showProgress(fraction: number, note?: string) {
  progressEl.hidden = false;
  progressFill.style.width = `${(100 * fraction).toFixed(1)}%`;
  const span = Number(field('tEnd').value) || DEFAULTS.tEnd;
  const elapsed = (performance.now() - simStarted) / 1000;
  // Progress is in simulated time, and the busy middle of a run is slower than
  // its ends, so the estimate is rough; it settles as the run goes on.
  const eta = fraction > 0.05 ? ` · about ${Math.max(1, Math.round((elapsed * (1 - fraction)) / fraction))} s left` : '';
  progressText.textContent = note ?? `Simulating ${(fraction * span).toFixed(1)} of ${span} billion years${eta}`;
}
function hideProgress() {
  progressEl.hidden = true;
}

function markStale() {
  stale = true;
  updateMainButton();
}

/** One button: Run while the settings are new, then Play / Pause for the universe they made. */
function updateMainButton() {
  if (stale || !result) runBtn.textContent = result ? 'Run new settings' : 'Run';
  else runBtn.textContent = playing ? '❚❚ Pause' : '▶ Play';
  runBtn.disabled = simulating && !result;
}

function setPlaying(on: boolean) {
  playing = on;
  updateMainButton();
}

function togglePlay() {
  if (!result) return;
  if (!simulating && t >= result.params.tEnd) setTime(timeline.t0);
  setPlaying(!playing);
}

runBtn.onclick = () => {
  if (stale || !result) simulate();
  else togglePlay();
};
newSeedBtn.onclick = () => {
  field('seed').value = String(Number(field('seed').value) + 1);
  simulate();
};

// A clicked button keeps keyboard focus, and Space on a focused button clicks it
// again — that's how Space used to re-run the simulation. Buttons give focus back.
document.addEventListener('click', (e) => {
  if (e.target instanceof HTMLButtonElement) e.target.blur();
});
nowBtn.onclick = () => result && setTime(Math.min(limit(), result.cosmology.age));
sliceC.oninput = sliceW.oninput = () => (map.dirty = true);
$('recenter').onclick = () => map.reset();
$('fullscreen').onclick = () => toggleFullscreen();
$('toggle-panels').onclick = () => cyclePanels();

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

/** Tell the map which parts of the screen are covered, so it fits into the clear area. */
function updateInsets() {
  const rectOf = (id: string) => {
    const el = $(id);
    return getComputedStyle(el).display === 'none' ? null : el.getBoundingClientRect();
  };
  const top = $('top-bar').getBoundingClientRect().bottom;
  const bottom = innerHeight - $('time-bar').getBoundingClientRect().top;
  if (innerWidth <= 900) {
    // Narrow: panels sit at the bottom and are toggled; fit above the open one.
    const open = rectOf('left') ?? rectOf('right');
    map.setInsets(0, top, 0, open ? innerHeight - open.top : bottom);
    return;
  }
  const left = rectOf('left');
  const right = rectOf('right');
  map.setInsets(left ? left.right : 0, top, right ? innerWidth - right.left : 0, bottom);
}

// Below this width the two panels would cover most of the map, so they start hidden.
const PANELS_DEFAULT_WIDTH = 1200;
if (innerWidth < PANELS_DEFAULT_WIDTH) document.body.classList.add('panels-hidden');

// Wide screens: panels on/off. Narrow screens: left panel, right panel, none.
function cyclePanels() {
  const b = document.body.classList;
  if (innerWidth > 900) {
    b.toggle('panels-hidden');
  } else if (b.contains('panels-hidden')) {
    b.remove('panels-hidden');
    b.remove('show-right');
  } else if (!b.contains('show-right')) b.add('show-right');
  else {
    b.remove('show-right');
    b.add('panels-hidden');
  }
  updateInsets();
}

function select(civ: number) {
  selected = civ;
  map.sight = result && civ >= 0 ? whatSaw(result, civ) : [];
  map.dirty = true;
  refreshPanels(true);
}
// Dev-only handle for poking at a run from the console.
if (import.meta.env.DEV) Object.assign(window, { fermi: { select, setTime, map, get result() { return result; } } });

lineagesEl.onclick = (e) => {
  const li = (e.target as HTMLElement).closest('li');
  if (li?.dataset.lin) select(Number(li.dataset.lin));
};
chronicleEl.onclick = (e) => {
  const li = (e.target as HTMLElement).closest('li');
  if (!li || !result) return;
  setTime(Number(li.dataset.t));
  if (li.dataset.lin) {
    select(Number(li.dataset.lin));
    map.focus(result.civs[Number(li.dataset.lin)].node);
  }
};
inspector.onclick = (e) => {
  const target = e.target as HTMLElement;
  if (target.id === 'clear-sel') select(-1);
  if (target.id === 'focus-sel' && result && selected >= 0) map.focus(result.civs[selected].node);
};

/** Typing into a field, where keys should do what they normally do. */
const typing = (target: EventTarget | null) =>
  dialog.open ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLInputElement && (target.type === 'number' || target.type === 'text'));

// Space plays and pauses from anywhere outside a text field. Captured, so no
// focused button or slider gets to act on it first.
window.addEventListener(
  'keyup',
  (e) => {
    if (e.key === ' ' && !typing(e.target)) e.preventDefault();
  },
  true,
);
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== ' ' || typing(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) togglePlay();
  },
  true,
);

window.addEventListener('keydown', (e) => {
  if (typing(e.target) || e.target instanceof HTMLInputElement) return;
  if (e.key === 'Escape') select(-1);
  else if (e.key === 'Tab') {
    e.preventDefault();
    cyclePanels();
  } else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === '0') map.reset();
  else if (e.key === '+' || e.key === '=') map.zoomAt(innerWidth / 2, innerHeight / 2, 1.25);
  else if (e.key === '-') map.zoomAt(innerWidth / 2, innerHeight / 2, 0.8);
  else if (e.key === 'ArrowRight' && result) setTime(t + result.params.tEnd / 200);
  else if (e.key === 'ArrowLeft' && result) setTime(t - result.params.tEnd / 200);
});

// ── Time ───────────────────────────────────────────────────────────────────
function setTime(next: number) {
  if (!result) return;
  t = Math.max(timeline.t0, Math.min(limit(), next));
  const age = result.cosmology.age;
  tlabel.textContent = `${t.toFixed(2)} Gyr${Math.abs(t - age) < 0.15 ? ' · today' : ''}`;
  frame = computeFrame(result, t);
  map.dirty = true;
  timeline.draw(t);
  updateChronicle(chronicleEl, t);
  refreshPanels();
}

let panelsDue = 0;
function refreshPanels(force = false) {
  if (!result || !frame) return;
  // While playing, the sidebar doesn't need 60 updates a second.
  const now = performance.now();
  if (playing && !force && now < panelsDue) return;
  panelsDue = now + 200;
  renderStats(statsEl, result, summary, t);
  renderInspector(inspector, result, frame, selected, map.sight.length);
  renderLineages(lineagesEl, result, frame, selected);
  renderKinds($('kinds'), result, frame);
  drawTraits(traitsCanvas, result, t);
}

// The key says what zooming will add.
const LOD_HINTS = ['zoom in for detail', 'zoom in to see single groups', 'each disc a galaxy group, filled by its waste heat'];
const keyLod = $('key-lod');
let shownLevel = -1;

let last = performance.now();
function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing && result) {
    const next = t + dt * Number(speedSel.value);
    // At the simulated edge, wait for more; at the end of the run, stop.
    if (!simulating && next >= result.params.tEnd) setPlaying(false);
    if (next <= limit() || t < limit()) setTime(next);
    else timeline.draw(t);
  }
  if (frame && map.dirty) {
    map.render(frame, selected, slice(), layers);
    if (map.level !== shownLevel) {
      shownLevel = map.level;
      keyLod.textContent = LOD_HINTS[shownLevel];
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function resizeTraits() {
  const dpr = devicePixelRatio || 1;
  traitsCanvas.width = Math.floor(traitsCanvas.clientWidth * dpr);
  traitsCanvas.height = Math.floor(120 * dpr);
}
function onResize() {
  map.resize();
  updateInsets();
  timeline.resize();
  timeline.draw(t);
  resizeTraits();
  if (result) drawTraits(traitsCanvas, result, t);
}
window.addEventListener('resize', onResize);
// Moving to a screen with a different pixel density (or browser zoom) changes
// devicePixelRatio without always firing resize; canvases sized for the old one
// would draw at the wrong scale.
function watchPixelRatio() {
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      onResize();
      watchPixelRatio();
    },
    { once: true },
  );
}
watchPixelRatio();

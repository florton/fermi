/**
 * The viewer. The simulation runs to completion in a worker first; the timeline
 * then replays its recorded history, so scrubbing is free and nothing is
 * re-simulated. The map fills the screen; panels float over it and can be hidden.
 */

import { TRAITS } from '../core/genome.ts';
import { DEFAULTS, withHardStepRate, type SimParams } from '../core/params.ts';
import { SCENARIOS } from '../core/scenarios.ts';
import type { SimResult } from '../core/sim.ts';
import type { Summary } from '../core/summary.ts';
import { MapView, type Layers, type Slice } from './map2d.ts';
import { TRAIT_COLORS, buildChronicle, drawTraits, renderInspector, renderLineages, renderStats, updateChronicle } from './panels.ts';
import { computeFrame, whatSaw, type Frame } from './state.ts';
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
  ['sterilizeRate', 'Sterilizing bursts per Gyr today', 0.25],
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
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const paramsEl = $('params');
const scenarioSel = $<HTMLSelectElement>('scenario');
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
scenarioSel.innerHTML = Object.keys(SCENARIOS).map((s) => `<option>${s}</option>`).join('');
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
function fillFromScenario() {
  const s = SCENARIOS[scenarioSel.value];
  const merged = { ...DEFAULTS, ...s } as unknown as Record<string, number>;
  const hard = s.hardSteps?.find((h) => h.log10Rate < 0)?.log10Rate ?? HARD_DEFAULT;
  for (const [key] of FIELDS) field(key).value = String(key === 'hardStepLog10' ? hard : merged[key]);
  applySizeAndSpan();
}
fillFromScenario();
scenarioSel.onchange = () => {
  fillFromScenario();
  markStale();
};
sizeSel.onchange = spanSel.onchange = () => {
  applySizeAndSpan();
  markStale();
};
paramsEl.oninput = () => markStale();
$('open-params').onclick = () => dialog.showModal();

function readParams(): Partial<SimParams> {
  // Start from the scenario so settings the form doesn't show come along.
  let over: Partial<SimParams> = { ...SCENARIOS[scenarioSel.value] };
  for (const [key] of FIELDS) {
    const v = Number(field(key).value);
    if (!Number.isFinite(v)) continue;
    if (key === 'hardStepLog10') over = withHardStepRate(over, v);
    else (over as Record<string, number>)[key] = v;
  }
  return over;
}

// ── Layers ─────────────────────────────────────────────────────────────────
const layers: Layers = { territory: true, empty: true, species: true, strikes: true, labels: true, reach: true };
const layersEl = $('layers');
layersEl.innerHTML =
  LAYER_NAMES.map(([k, label]) => `<label><input type="checkbox" data-layer="${k}" checked /> ${label}</label>`).join('') +
  '<label>Tile size <input id="tile-size" type="range" min="6" max="40" step="1" value="11" /></label>';
layersEl.onchange = (e) => {
  const input = e.target as HTMLInputElement;
  if (!input.dataset.layer) return;
  layers[input.dataset.layer as keyof Layers] = input.checked;
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
worker.onmessage = (e: MessageEvent<{ result: SimResult; summary: Summary }>) => {
  result = e.data.result;
  summary = e.data.summary;
  simulating = false;
  stale = false;
  overlay.textContent = '';
  nowBtn.disabled = false;
  newSeedBtn.hidden = false;
  selected = -1;
  map.sight = [];
  buildChronicle(chronicleEl, result);
  updateInsets();
  map.setResult(result);
  timeline.setResult(result);
  resizeTraits();
  setTime(timeline.t0);
  updateMainButton();
};

function simulate() {
  simulating = true;
  overlay.textContent = `Simulating ${readParams().tEnd ?? DEFAULTS.tEnd} billion years…`;
  setPlaying(false);
  updateMainButton();
  worker.postMessage(readParams());
}

function markStale() {
  stale = true;
  updateMainButton();
}

/** One button: Run while the settings are new, then Play / Pause for the universe they made. */
function updateMainButton() {
  runBtn.disabled = simulating;
  newSeedBtn.disabled = simulating;
  if (simulating) runBtn.textContent = 'Simulating…';
  else if (stale || !result) runBtn.textContent = result ? 'Run new settings' : 'Run';
  else runBtn.textContent = playing ? '❚❚ Pause' : '▶ Play';
}

function setPlaying(on: boolean) {
  playing = on;
  updateMainButton();
}

function togglePlay() {
  if (!result || simulating) return;
  if (t >= result.params.tEnd) setTime(timeline.t0);
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
nowBtn.onclick = () => result && setTime(result.cosmology.age);
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
  t = Math.max(timeline.t0, Math.min(result.params.tEnd, next));
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
  if (!result || !summary || !frame) return;
  // While playing, the sidebar doesn't need 60 updates a second.
  const now = performance.now();
  if (playing && !force && now < panelsDue) return;
  panelsDue = now + 200;
  renderStats(statsEl, result, summary, t);
  renderInspector(inspector, result, frame, selected, map.sight.length);
  renderLineages(lineagesEl, result, frame, selected);
  drawTraits(traitsCanvas, result, t);
}

let last = performance.now();
function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing && result) {
    const next = t + dt * Number(speedSel.value);
    if (next >= result.params.tEnd) setPlaying(false);
    setTime(next);
  }
  if (frame && map.dirty) map.render(frame, selected, slice(), layers);
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

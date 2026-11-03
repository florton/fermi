/**
 * The viewer. The simulation runs to completion in a worker first; the time
 * slider then replays its recorded history, so scrubbing is free and nothing
 * is re-simulated. Two views of the same moment: a lo-fi map for navigating and
 * reading, and a 3D cloud for the shape of things.
 */

import { TRAITS } from '../core/genome.ts';
import { DEFAULTS, withHardStepRate, type SimParams } from '../core/params.ts';
import { SCENARIOS } from '../core/scenarios.ts';
import type { SimResult } from '../core/sim.ts';
import type { Summary } from '../core/summary.ts';
import { MapView, type Slice } from './map2d.ts';
import { TRAIT_COLORS, buildChronicle, drawTraits, renderInspector, renderLineages, renderStats, updateChronicle } from './panels.ts';
import { computeFrame, type Frame } from './state.ts';
import { View3D } from './view3d.ts';

const FIELDS: [key: string, label: string, step: number][] = [
  ['seed', 'Seed', 1],
  ['nodes', 'Galaxy groups', 1000],
  ['boxGly', 'Box side, Gly', 0.5],
  ['tEnd', 'End time, Gyr', 1],
  ['hardStepLog10', 'Hard steps, log₁₀ rate/Gyr', 0.1],
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
  ['strikeRadius', 'Strike blast reach, Gly', 0.05],
  ['threatResponse', 'Hide after being hit', 0.05],
  ['strikeKill', 'Strike lethality (0 = no dark forest)', 0.1],
  ['strikeReveal', 'Chance a strike is traced', 0.1],
  ['skyResponse', 'Hide when not alone', 0.05],
  ['siegeDelay', 'Siege delay, Gyr', 0.5],
  ['defenderAdvantage', 'Defender advantage', 0.5],
  ['collapseRate', 'Collapse rate, /Gyr', 0.01],
  ['mutationSigma', 'Mutation σ', 0.01],
];
const HARD_DEFAULT = DEFAULTS.hardSteps.find((s) => s.log10Rate < 0)?.log10Rate ?? -5;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('params');
const runBtn = $<HTMLButtonElement>('run');
const playBtn = $<HTMLButtonElement>('play');
const nowBtn = $<HTMLButtonElement>('now');
const speedSel = $<HTMLSelectElement>('speed');
const slider = $<HTMLInputElement>('time');
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

// Scenario presets fill the form; any field can still be edited afterwards.
const scenarioLabel = document.createElement('label');
scenarioLabel.htmlFor = 'f-scenario';
scenarioLabel.textContent = 'Scenario';
const scenarioSel = document.createElement('select');
scenarioSel.id = 'f-scenario';
scenarioSel.innerHTML = Object.keys(SCENARIOS).map((s) => `<option>${s}</option>`).join('');
form.append(scenarioLabel, scenarioSel);
scenarioSel.onchange = () => {
  const merged = { ...DEFAULTS, ...SCENARIOS[scenarioSel.value] } as unknown as Record<string, number>;
  for (const [key] of FIELDS) {
    if (key === 'hardStepLog10') continue;
    (form.elements.namedItem(key) as HTMLInputElement).value = String(merged[key]);
  }
};

for (const [key, label, step] of FIELDS) {
  const value = key === 'hardStepLog10' ? HARD_DEFAULT : (DEFAULTS as unknown as Record<string, number>)[key];
  const l = document.createElement('label');
  l.htmlFor = `f-${key}`;
  l.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.id = `f-${key}`;
  input.name = key;
  input.step = String(step);
  input.value = String(value);
  form.append(l, input);
}
$('legend').innerHTML = TRAITS.map((t, i) => `<span><i style="background:${TRAIT_COLORS[i]}"></i>${t}</span>`).join('');

function readParams(): Partial<SimParams> {
  // Start from the scenario so settings the form doesn't show (strike rates, stealth floor) come along.
  let over: Partial<SimParams> = { ...SCENARIOS[scenarioSel.value] };
  for (const [key] of FIELDS) {
    const v = Number((form.elements.namedItem(key) as HTMLInputElement).value);
    if (!Number.isFinite(v)) continue;
    if (key === 'hardStepLog10') over = withHardStepRate(over, v);
    else (over as Record<string, number>)[key] = v;
  }
  return over;
}

// ── State ──────────────────────────────────────────────────────────────────
let result: SimResult | null = null;
let summary: Summary | null = null;
let frame: Frame | null = null;
let t = 0;
let selected = -1;
let playing = false;
let mode: 'map' | '3d' = 'map';
const slice = (): Slice => ({ center: Number(sliceC.value), width: Number(sliceW.value) });

const map = new MapView($<HTMLCanvasElement>('map'));
const view3d = new View3D($<HTMLCanvasElement>('gl'));
if (!view3d.supported) $<HTMLButtonElement>('tab-3d').disabled = true;

map.onPick = (lin) => select(lin);
map.onHover = (html, x, y) => {
  if (!html) {
    tip.hidden = true;
    return;
  }
  tip.innerHTML = html;
  tip.hidden = false;
  tip.style.left = `${x + 14}px`;
  tip.style.top = `${y + 14}px`;
};

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = (e: MessageEvent<{ result: SimResult; summary: Summary }>) => {
  result = e.data.result;
  summary = e.data.summary;
  runBtn.disabled = false;
  runBtn.textContent = 'Run universe';
  overlay.textContent = '';
  playBtn.disabled = nowBtn.disabled = slider.disabled = false;
  slider.max = String(result.params.tEnd);
  selected = -1;
  ($<HTMLDetailsElement>('params-box')).open = false;
  buildChronicle(chronicleEl, result);
  map.setResult(result);
  view3d.resize();
  view3d.setResult(result);
  resizeTraits();
  setTime(0);
};

runBtn.onclick = () => {
  runBtn.disabled = true;
  runBtn.textContent = 'Simulating…';
  overlay.textContent = 'Simulating 40 billion years…';
  setPlaying(false);
  worker.postMessage(readParams());
};

function setPlaying(on: boolean) {
  playing = on;
  playBtn.textContent = on ? 'Pause' : 'Play';
  view3d.spinning = on;
}
playBtn.onclick = () => {
  if (!result) return;
  if (t >= result.params.tEnd) setTime(0);
  setPlaying(!playing);
};
nowBtn.onclick = () => result && setTime(result.cosmology.age);
slider.oninput = () => setTime(Number(slider.value));
sliceC.oninput = sliceW.oninput = () => {
  map.dirty = view3d.dirty = true;
};
$('recenter').onclick = () => map.reset();

function setMode(m: 'map' | '3d') {
  mode = m;
  $('tab-map').classList.toggle('on', m === 'map');
  $('tab-3d').classList.toggle('on', m === '3d');
  map.canvas.hidden = m !== 'map';
  view3d.canvas.hidden = m !== '3d';
  tip.hidden = true;
  if (m === '3d') view3d.resize();
  else map.resize();
}
$('tab-map').onclick = () => setMode('map');
$('tab-3d').onclick = () => setMode('3d');

function select(lin: number) {
  selected = lin;
  map.dirty = view3d.dirty = true;
  refreshPanels();
}
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
  if ((e.target as HTMLElement).id === 'clear-sel') select(-1);
};
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === ' ') {
    e.preventDefault();
    playBtn.click();
  } else if (e.key === 'Escape') select(-1);
});

// ── Time ───────────────────────────────────────────────────────────────────
function setTime(next: number) {
  if (!result) return;
  t = Math.max(0, Math.min(result.params.tEnd, next));
  slider.value = String(t);
  const age = result.cosmology.age;
  tlabel.textContent = `${t.toFixed(2)} Gyr${Math.abs(t - age) < 0.15 ? ' · now' : ''}`;
  frame = computeFrame(result, t);
  map.dirty = view3d.dirty = true;
  updateChronicle(chronicleEl, t);
  refreshPanels();
}

let panelsDue = 0;
function refreshPanels() {
  if (!result || !summary || !frame) return;
  // While playing, the sidebar doesn't need 60 updates a second.
  const now = performance.now();
  if (playing && now < panelsDue) return;
  panelsDue = now + 200;
  renderStats(statsEl, result, summary, t);
  renderInspector(inspector, result, frame, selected);
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
  if (frame) {
    if (mode === 'map' && map.dirty) map.render(frame, selected, slice());
    if (mode === '3d' && (view3d.dirty || view3d.spinning)) view3d.render(frame, selected, slice(), dt);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function resizeTraits() {
  const dpr = devicePixelRatio || 1;
  traitsCanvas.width = Math.floor(traitsCanvas.clientWidth * dpr);
  traitsCanvas.height = Math.floor(140 * dpr);
}
window.addEventListener('resize', () => {
  map.resize();
  view3d.resize();
  resizeTraits();
  if (result) drawTraits(traitsCanvas, result, t);
});

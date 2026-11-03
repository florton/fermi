/**
 * The ant farm: watch one universe play out. The simulation runs to completion
 * in a worker first; the time slider then replays its recorded history, so
 * scrubbing is free and nothing is re-simulated.
 */

import { N_TRAITS, TRAITS } from '../core/genome.ts';
import { DEFAULTS, withHardStepRate, type SimParams } from '../core/params.ts';
import type { SimResult } from '../core/sim.ts';
import type { Summary } from '../core/summary.ts';

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
  ['siegeDelay', 'Siege delay, Gyr', 0.5],
  ['defenderAdvantage', 'Defender advantage', 0.5],
  ['collapseRate', 'Collapse rate, /Gyr', 0.01],
  ['mutationSigma', 'Mutation σ', 0.01],
];
const TRAIT_COLORS = ['#8ab4ff', '#ffd27a', '#ff6b6b', '#b48cff', '#6ee7a8'];
const HARD_DEFAULT = DEFAULTS.hardSteps.find((s) => s.log10Rate < 0)?.log10Rate ?? -5;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('params');
const runBtn = $<HTMLButtonElement>('run');
const playBtn = $<HTMLButtonElement>('play');
const slider = $<HTMLInputElement>('time');
const tlabel = $('tlabel');
const overlay = $('overlay');
const stats = $('stats');
const chronicleEl = $('chronicle');
const map = $<HTMLCanvasElement>('map');
const traitsCanvas = $<HTMLCanvasElement>('traits');

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
  let over: Partial<SimParams> = {};
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
let t = 0;
let playing = false;
let px = new Int32Array(0);
let py = new Int32Array(0);
let lineageColor = new Uint32Array(0);
let base: Uint32Array | null = null;
let frame: ImageData | null = null;
let dot = 2;

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = (e: MessageEvent<{ result: SimResult; summary: Summary }>) => {
  result = e.data.result;
  summary = e.data.summary;
  runBtn.disabled = false;
  runBtn.textContent = 'Run universe';
  overlay.textContent = '';
  playBtn.disabled = false;
  slider.disabled = false;
  slider.max = String(result.params.tEnd);
  lineageColor = new Uint32Array(result.civs.length);
  for (let i = 0; i < lineageColor.length; i++) lineageColor[i] = hslToAbgr((i * 137.508) % 360, 0.8, 0.6);
  buildChronicle();
  layout();
  setTime(0);
};

runBtn.onclick = () => {
  runBtn.disabled = true;
  runBtn.textContent = 'Simulating…';
  overlay.textContent = 'Simulating 40 billion years…';
  playing = false;
  playBtn.textContent = 'Play';
  worker.postMessage(readParams());
};

playBtn.onclick = () => {
  if (!result) return;
  if (t >= result.params.tEnd) setTime(0);
  playing = !playing;
  playBtn.textContent = playing ? 'Pause' : 'Play';
  last = performance.now();
};
slider.oninput = () => setTime(Number(slider.value));

let last = performance.now();
function tick(now: number) {
  if (playing && result) {
    const dt = Math.min(0.1, (now - last) / 1000);
    const next = t + (dt * result.params.tEnd) / 40;
    if (next >= result.params.tEnd) {
      playing = false;
      playBtn.textContent = 'Play';
    }
    setTime(Math.min(next, result.params.tEnd));
  }
  last = now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ── Layout ─────────────────────────────────────────────────────────────────
function layout() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(map.clientWidth * dpr));
  const h = Math.max(1, Math.floor(map.clientHeight * dpr));
  map.width = w;
  map.height = h;
  traitsCanvas.width = Math.floor(traitsCanvas.clientWidth * dpr);
  traitsCanvas.height = Math.floor(140 * dpr);
  if (!result) return;

  const size = Math.min(w, h) - 16 * dpr;
  const ox = (w - size) / 2;
  const oy = (h - size) / 2;
  const { x, y, mass } = result.positions;
  const L = result.params.boxGly;
  const n = x.length;
  px = new Int32Array(n);
  py = new Int32Array(n);
  dot = Math.max(1, Math.round(size / 450));
  const ctx = map.getContext('2d')!;
  frame = ctx.createImageData(w, h);
  base = new Uint32Array(w * h).fill(0xff0a0605);
  for (let i = 0; i < n; i++) {
    px[i] = Math.floor(ox + (x[i] / L) * size);
    py[i] = Math.floor(oy + (y[i] / L) * size);
    const g = Math.min(90, 28 + 14 * Math.log1p(mass[i]));
    const c = 0xff000000 | (g << 16) | (g << 8) | g;
    base[py[i] * w + px[i]] = c;
  }
  draw();
}
window.addEventListener('resize', layout);

// ── Drawing ────────────────────────────────────────────────────────────────
function setTime(next: number) {
  t = next;
  slider.value = String(t);
  const age = result?.cosmology.age ?? 13.8;
  tlabel.textContent = `${t.toFixed(2)} Gyr${Math.abs(t - age) < 0.2 ? ' · now' : ''}`;
  draw();
  drawTraits();
  updateStats();
  updateChronicle();
}

function draw() {
  if (!result || !base || !frame) return;
  const ctx = map.getContext('2d')!;
  const w = map.width;
  const h = map.height;
  const buf = new Uint32Array(frame.data.buffer);
  buf.set(base);
  const pol = result.polities;
  for (let k = 0; k < pol.node.length; k++) {
    if (pol.born[k] > t || pol.died[k] <= t) continue;
    const i = pol.node[k];
    const c = lineageColor[pol.lineage[k]];
    const x0 = px[i];
    const y0 = py[i];
    for (let dy = 0; dy < dot; dy++) {
      const row = (y0 + dy) * w;
      if (y0 + dy >= h) break;
      for (let dx = 0; dx < dot && x0 + dx < w; dx++) buf[row + x0 + dx] = c;
    }
  }
  ctx.putImageData(frame, 0, 0);

  // Civilisations becoming technological near now, as expanding rings.
  ctx.lineWidth = Math.max(1, dot / 2);
  for (const c of result.civs) {
    const age = t - c.tTech;
    if (age < 0 || age > 0.4 || c.fate === 'preempted') continue;
    const a = 1 - age / 0.4;
    ctx.strokeStyle = c.saw && c.saw.lineages === 0 ? `rgba(255,255,255,${a})` : `rgba(255,140,90,${a})`;
    ctx.beginPath();
    ctx.arc(px[c.node], py[c.node], dot * (3 + 14 * age), 0, Math.PI * 2);
    ctx.stroke();
  }
  // Quiet civilisations that stayed home.
  ctx.fillStyle = '#ffffff';
  for (const c of result.civs) {
    if ((c.fate === 'quiet' || c.fate === 'engulfed') && c.tFate <= t) ctx.fillRect(px[c.node] - dot, py[c.node] - dot, dot * 2, dot * 2);
  }
}

function drawTraits() {
  const ctx = traitsCanvas.getContext('2d')!;
  const w = traitsCanvas.width;
  const h = traitsCanvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!result) return;
  const s = result.series;
  const tEnd = result.params.tEnd;
  ctx.strokeStyle = '#1d2230';
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  const X = (tt: number) => (tt / tEnd) * w;
  const Y = (v: number) => h - 4 - v * (h - 8);
  ctx.lineWidth = Math.max(1, w / 300);
  for (let i = 0; i < N_TRAITS; i++) {
    ctx.strokeStyle = TRAIT_COLORS[i];
    ctx.beginPath();
    let started = false;
    for (const p of s) {
      if (p.settled === 0) {
        started = false;
        continue;
      }
      if (started) ctx.lineTo(X(p.t), Y(p.meanGenome[i]));
      else ctx.moveTo(X(p.t), Y(p.meanGenome[i]));
      started = true;
    }
    ctx.stroke();
  }
  // Settled fraction as a filled backdrop.
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (const p of s) ctx.lineTo(X(p.t), Y(p.settled));
  ctx.lineTo(w, h);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(X(t), 0);
  ctx.lineTo(X(t), h);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(138,180,255,0.4)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(X(result.cosmology.age), 0);
  ctx.lineTo(X(result.cosmology.age), h);
  ctx.stroke();
  ctx.setLineDash([]);
}

function updateStats() {
  if (!result || !summary) return;
  let cur = result.series[0];
  for (const p of result.series) if (p.t <= t) cur = p;
  const pct = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '—');
  const rows: [string, string][] = [
    ['Groups settled', pct(cur.settled)],
    ['Lineages alive', String(cur.lineagesAlive)],
    ['Observers so far', String(cur.observers)],
    ['…who saw an empty sky', cur.observers ? pct(cur.silent / cur.observers) : '—'],
    ['', ''],
    ['Technological origins (run)', String(summary.origins)],
    ['Preempted by colonisers', String(summary.fates.preempted)],
    ['Lost to their own filter', String(summary.fates.filtered)],
    ['Expanded', String(summary.fates.expanding)],
    ['Stayed home', String(summary.fates.quiet + summary.fates.engulfed)],
    ['Present-day observers silent', pct(summary.presentSilentFrac)],
    ['Median warning before arrival', Number.isFinite(summary.medianWarning) ? `${summary.medianWarning.toFixed(2)} Gyr` : '—'],
    ['Origins in observable universe', summary.originsObservableUniverse.toExponential(1)],
    ['Each dot stands for', `${Math.round(result.universe.galaxiesPerNode)} galaxies`],
    ['Simulated in', `${(summary.runtimeMs / 1000).toFixed(1)} s${summary.truncated ? ' (truncated)' : ''}`],
  ];
  stats.innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
}

function buildChronicle() {
  if (!result) return;
  chronicleEl.innerHTML = '';
  for (const e of result.chronicle) {
    const li = document.createElement('li');
    li.dataset.t = String(e.t);
    li.className = e.kind;
    li.innerHTML = `<time>${e.t.toFixed(2)}</time>`;
    li.append(e.text);
    chronicleEl.append(li);
  }
}

function updateChronicle() {
  for (const li of chronicleEl.children as HTMLCollectionOf<HTMLLIElement>) li.hidden = Number(li.dataset.t) > t;
}

function hslToAbgr(h: number, s: number, l: number): number {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return (0xff000000 | (f(4) << 16) | (f(8) << 8) | f(0)) >>> 0;
}

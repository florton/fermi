/** The sidebar: run stats, the selected lineage, the busiest lineages, traits over time and the chronicle. */

import { N_TRAITS, TRAITS } from '../core/genome.ts';
import type { SimResult } from '../core/sim.ts';
import type { Summary } from '../core/summary.ts';
import { lightFront, lineageRgb, tierName, type Frame } from './state.ts';

export const TRAIT_COLORS = ['#8ab4ff', '#ffd27a', '#ff6b6b', '#b48cff', '#6ee7a8', '#f5f5f5', '#ff9ad5'];

const pct = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '—');
const gyr = (x: number) => (Number.isFinite(x) ? `${x.toFixed(2)} Gyr` : '—');
const swatch = (lin: number) => `<i class="sw" style="background:rgb(${lineageRgb(lin).join(',')})"></i>`;

export function renderStats(el: HTMLElement, r: SimResult, s: Summary, t: number) {
  let cur = r.series[0];
  for (const p of r.series) if (p.t <= t) cur = p;
  const rows: [string, string][] = [
    ['Groups settled', pct(cur.settled)],
    ['Lineages alive', String(cur.lineagesAlive)],
    ['Observers so far', String(cur.observers)],
    ['…who saw an empty sky', cur.observers ? pct(cur.silent / cur.observers) : '—'],
    ['Strikes fired so far', String(cur.strikes)],
    ['', ''],
    ['Technological origins (run)', String(s.origins)],
    ['Preempted · filtered · stayed home', `${s.fates.preempted} · ${s.fates.filtered} · ${s.fates.quiet + s.fates.engulfed}`],
    ['Expanded', String(s.fates.expanding)],
    ['Present-day observers silent', `${pct(s.presentSilentFrac)} of ${s.presentObservers}`],
    ['Median warning before arrival', gyr(s.medianWarning)],
    ['Strikes · kills · retaliations', `${s.tally.strikes} · ${s.tally.strikeKills} · ${s.tally.retaliations}`],
    ['Origins in observable universe', s.originsObservableUniverse.toExponential(1)],
    ['Each group stands for', `${Math.round(r.universe.galaxiesPerNode)} galaxies`],
    ['Simulated in', `${(s.runtimeMs / 1000).toFixed(1)} s${s.truncated ? ' (truncated)' : ''}`],
  ];
  el.innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
}

export function renderInspector(el: HTMLElement, r: SimResult, frame: Frame, lin: number, sightCount: number) {
  if (lin < 0) {
    el.innerHTML =
      '<p class="muted">Click a territory or a ✶ / o species marker on the map, a lineage below, or a chronicle entry. ' +
      'The map then shows how far their first light has travelled and what they could see when they looked up.</p>';
    return;
  }
  const c = r.civs[lin];
  const t = frame.t;
  const born = t >= c.tTech;
  const saw = c.saw
    ? c.saw.lineages
      ? `${c.saw.lineages} lineage${c.saw.lineages > 1 ? 's' : ''}, nearest ${c.saw.nearest.toFixed(2)} Gly`
      : c.saw.far
        ? 'a faint glow beyond the box'
        : 'an empty sky'
    : 'never looked (preempted)';
  // Current mean genome over this lineage's living polities.
  const mean = new Array<number>(N_TRAITS).fill(0);
  let alive = 0;
  const pol = r.polities;
  for (let k = 0; k < pol.node.length; k++) {
    if (pol.lineage[k] !== lin || pol.born[k] > t || pol.died[k] <= t) continue;
    alive++;
    for (let i = 0; i < N_TRAITS; i++) mean[i] += pol.genome[k * N_TRAITS + i];
  }
  const st = r.strikes;
  let fired = 0;
  let suffered = 0;
  for (let s = 0; s < st.from.length; s++) {
    if (st.launched[s] > t) continue;
    if (st.lineage[s] === lin) fired++;
    if (st.hit[s] && st.arrived[s] <= t && st.victim[s] === lin) suffered++;
  }
  const bars = TRAITS.map((name, i) => {
    const start = c.genome[i];
    const now = alive ? mean[i] / alive : NaN;
    return `<div class="trait"><span>${name}</span><div class="bar"><b style="width:${100 * start}%;background:${TRAIT_COLORS[i]}55"></b>${
      Number.isFinite(now) ? `<em style="left:${100 * now}%;background:${TRAIT_COLORS[i]}"></em>` : ''
    }</div></div>`;
  }).join('');
  el.innerHTML = `
    <div class="insp-head">${swatch(lin)}<b>${c.name}</b><button id="focus-sel" title="Centre the map on their home">Go to</button><button id="clear-sel" title="Clear selection (Esc)">×</button></div>
    <div class="stats">
      <span>Became technological</span><span>${gyr(c.tTech)}${born ? '' : ' (future)'}</span>
      <span>Home star</span><span>${r.params.starClasses[c.starClass].name}</span>
      <span>Saw at first light</span><span>${saw}</span>
      <span>Holdings visible to them then</span><span>${c.saw ? `${sightCount}${sightCount ? ' (orange lines)' : ''}` : '—'}</span>
      <span>Faster-than-light channel</span><span>${Number.isFinite(c.ftl) ? `from ${gyr(c.ftl)}` : 'no'}</span>
      <span>Fate</span><span>${c.fate}</span>
      <span>Groups held now · peak</span><span>${frame.held[lin]} · ${c.peak}</span>
      <span>Technology now</span><span>${tierName(r, lin, t)}</span>
      <span>Strikes fired · groups lost to strikes</span><span>${fired} · ${suffered}</span>
      <span>Their first light has reached</span><span>${born ? `${lightFront(c.tTech, t).toFixed(2)} Gly` : '—'}</span>
    </div>
    <h3>Traits <small>shaded: at origin · tick: mean of living holdings now</small></h3>
    ${bars}`;
}

export function renderLineages(el: HTMLElement, r: SimResult, frame: Frame, selected: number) {
  const ids: number[] = [];
  for (let i = 0; i < frame.held.length; i++) if (frame.held[i] > 0) ids.push(i);
  ids.sort((a, b) => frame.held[b] - frame.held[a]);
  if (ids.length === 0) {
    el.innerHTML = '<li class="muted">No one holds anything yet.</li>';
    return;
  }
  el.innerHTML = ids
    .slice(0, 12)
    .map(
      (i) =>
        `<li data-lin="${i}" class="${i === selected ? 'sel' : ''}">${swatch(i)}<span>${r.civs[i].name}</span><small>${frame.held[i]} · ${tierName(r, i, frame.t)}</small></li>`,
    )
    .join('');
}

export function drawTraits(canvas: HTMLCanvasElement, r: SimResult, t: number) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const s = r.series;
  const tEnd = r.params.tEnd;
  ctx.strokeStyle = '#1d2230';
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  const X = (tt: number) => (tt / tEnd) * w;
  const Y = (v: number) => h - 4 - v * (h - 8);
  // Settled fraction as a filled backdrop.
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (const p of s) ctx.lineTo(X(p.t), Y(p.settled));
  ctx.lineTo(w, h);
  ctx.fill();
  ctx.lineWidth = Math.max(1, w / 300);
  for (let i = 0; i < N_TRAITS; i++) {
    ctx.strokeStyle = TRAIT_COLORS[i];
    ctx.beginPath();
    let started = false;
    for (const p of s) {
      const v = p.meanGenome[i];
      if (!Number.isFinite(v)) {
        started = false;
        continue;
      }
      if (started) ctx.lineTo(X(p.t), Y(v));
      else ctx.moveTo(X(p.t), Y(v));
      started = true;
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(X(t), 0);
  ctx.lineTo(X(t), h);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(138,180,255,0.5)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(X(r.cosmology.age), 0);
  ctx.lineTo(X(r.cosmology.age), h);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function buildChronicle(el: HTMLElement, r: SimResult) {
  el.innerHTML = '';
  for (const e of r.chronicle) {
    const li = document.createElement('li');
    li.dataset.t = String(e.t);
    if (e.who >= 0) li.dataset.lin = String(e.who);
    li.className = e.kind;
    li.innerHTML = `<time>${e.t.toFixed(2)}</time>${e.who >= 0 ? swatch(e.who) : ''}`;
    li.append(e.text);
    el.append(li);
  }
}

export function updateChronicle(el: HTMLElement, t: number) {
  for (const li of el.children as HTMLCollectionOf<HTMLLIElement>) li.hidden = Number(li.dataset.t) > t;
}

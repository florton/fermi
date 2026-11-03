/**
 * What both views need to know about one moment of a finished run: who holds
 * each node, how bright it is, which strikes are in the air. Recomputed when the
 * time changes, then read by whichever view is showing.
 */

import { makeCosmology, type Cosmology } from '../core/cosmology.ts';
import { N_TRAITS, visibility } from '../core/genome.ts';
import type { SimResult } from '../core/sim.ts';
import { TIERS, luminosity, tierAt } from '../core/tech.ts';

export const cosmo: Cosmology = makeCosmology();

export interface Frame {
  t: number;
  /** Polity holding each node at t, or -1. */
  owner: Int32Array;
  /** Waste-heat luminosity of each node at t, 0 if unheld. */
  lum: Float32Array;
  /** Nodes held per lineage at t. */
  held: Int32Array;
  /** Strikes in flight: index and progress 0..1. */
  inFlight: { s: number; f: number }[];
  /** Strikes that hit within the last fade window: index and age 0..1. */
  impacts: { s: number; age: number }[];
}

export const FADE = 0.3; // Gyr an event stays on screen

export function computeFrame(r: SimResult, t: number): Frame {
  const n = r.positions.x.length;
  const owner = new Int32Array(n).fill(-1);
  const lum = new Float32Array(n);
  const held = new Int32Array(r.civs.length);
  const pol = r.polities;
  for (let k = 0; k < pol.node.length; k++) {
    if (pol.born[k] > t || pol.died[k] <= t) continue;
    const node = pol.node[k];
    const lin = pol.lineage[k];
    owner[node] = k;
    held[lin]++;
    const g = pol.genome.subarray(k * N_TRAITS, (k + 1) * N_TRAITS);
    const floor = r.params.ftlCloak > 0 && r.civs[lin].ftl <= t ? 0 : r.params.stealthFloor;
    lum[node] = luminosity(tierAt(r.civs[lin].tierTimes, t), t - pol.born[k], r.params.conversionTime, visibility(g, floor), r.positions.mass[node]);
  }
  const st = r.strikes;
  const inFlight: Frame['inFlight'] = [];
  const impacts: Frame['impacts'] = [];
  for (let s = 0; s < st.from.length; s++) {
    if (st.launched[s] <= t && st.arrived[s] > t) inFlight.push({ s, f: (t - st.launched[s]) / (st.arrived[s] - st.launched[s]) });
    else if (st.hit[s] && st.arrived[s] <= t && t - st.arrived[s] < FADE) impacts.push({ s, age: (t - st.arrived[s]) / FADE });
  }
  return { t, owner, lum, held, inFlight, impacts };
}

/** Golden-angle hues so neighbouring lineage ids look different. RGB 0..255. */
export function lineageRgb(id: number): [number, number, number] {
  const h = (id * 137.508) % 360;
  // Lightness and saturation cycle too, so two lineages that land on similar hues still differ.
  const s = [0.8, 0.55, 0.95][id % 3];
  const l = [0.6, 0.72, 0.5][Math.floor(id / 3) % 3];
  const k = (m: number) => (m + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (m: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(m) - 3, 9 - k(m), 1))));
  return [f(0), f(8), f(4)];
}

export function tierName(r: SimResult, lineage: number, t: number): string {
  const k = tierAt(r.civs[lineage].tierTimes, t);
  return k < 0 ? '—' : TIERS[k].name;
}

/** Shortest periodic displacement from a to b along one axis. */
export function wrapDelta(a: number, b: number, L: number): number {
  let d = b - a;
  if (d > L / 2) d -= L;
  else if (d < -L / 2) d += L;
  return d;
}

/**
 * The holdings a species could see when it first looked up, recomputed with the
 * simulation's own rules: light that left each node at the right time, from
 * whoever held it then, bright enough after redshift to reach a present-day-class
 * sensor. Inside half the box only, like the simulation's exact part.
 */
export function whatSaw(r: SimResult, civId: number): { node: number; lineage: number }[] {
  const c = r.civs[civId];
  if (!c.saw) return [];
  const t = c.tTech;
  const { x, y, z, mass } = r.positions;
  const L = r.params.boxGly;
  const intra = (r.params.intraNodeSeeing * L) / Math.cbrt(x.length);
  const pol = r.polities;
  const out: { node: number; lineage: number }[] = [];
  const a0 = cosmo.a(t);
  for (let k = 0; k < pol.node.length; k++) {
    if (pol.born[k] >= t) continue;
    const node = pol.node[k];
    const dx = wrapDelta(x[c.node], x[node], L);
    const dy = wrapDelta(y[c.node], y[node], L);
    const dz = wrapDelta(z[c.node], z[node], L);
    const d = Math.max(Math.hypot(dx, dy, dz), node === c.node ? intra : 0);
    if (d > L / 2) continue;
    const te = cosmo.emission(t, d);
    if (te < pol.born[k] || te >= pol.died[k]) continue;
    const lin = pol.lineage[k];
    const g = pol.genome.subarray(k * N_TRAITS, (k + 1) * N_TRAITS);
    const floor = r.params.ftlCloak > 0 && r.civs[lin].ftl <= te ? 0 : r.params.stealthFloor;
    const lum = luminosity(tierAt(r.civs[lin].tierTimes, te), te - pol.born[k], r.params.conversionTime, visibility(g, floor), mass[node]);
    if (lum > 0 && d * (a0 / cosmo.a(te)) <= r.params.detectRange * Math.sqrt(lum)) out.push({ node, lineage: lin });
  }
  return out;
}

/** Comoving radius the light of an event at tEvent has reached by t. */
export function lightFront(tEvent: number, t: number): number {
  return t <= tEvent ? 0 : cosmo.D(t) - cosmo.D(tEvent);
}

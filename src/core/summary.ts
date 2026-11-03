/**
 * The numbers a run is for, without the bulk arrays. This is what the CLI prints
 * and what a sweep writes one row of.
 */

import { TRAITS } from './genome.ts';
import { FATES, type SimResult } from './sim.ts';

export interface Summary {
  seed: number;
  expectedOrigins: number;
  origins: number;
  saturated: boolean;
  truncated: boolean;
  fates: Record<string, number>;
  observers: number;
  /** Observers that saw no other civilisation. */
  silentFrac: number;
  /** Same, for observers arising within 1 Gyr of the present day — the ones placed like us. */
  presentObservers: number;
  presentSilentFrac: number;
  /** Of observers later reached by a foreign lineage, median years of warning between looking up and arrival, Gyr. */
  medianWarning: number;
  /** Fraction of observers that are eventually reached. */
  engulfedFrac: number;
  settledAtPresent: number;
  settledAtEnd: number;
  lineagesAtEnd: number;
  /** Mean genome of living polities at the end, by trait name. */
  finalTraits: Record<string, number>;
  /** Expected technological origins in the whole observable universe over the run. */
  originsObservableUniverse: number;
  polities: number;
  tally: SimResult['tally'];
  events: number;
  runtimeMs: number;
}

export function summarize(r: SimResult): Summary {
  const fates: Record<string, number> = {};
  for (const f of FATES) fates[f] = 0;
  for (const c of r.civs) fates[c.fate]++;

  const obs = r.civs.filter((c) => c.saw);
  const silent = obs.filter((c) => c.saw!.lineages === 0).length;
  const age = r.cosmology.age;
  const present = obs.filter((c) => Math.abs(c.tTech - age) < 1);
  const presentSilent = present.filter((c) => c.saw!.lineages === 0).length;
  const warnings = obs.filter((c) => c.tEngulfed > c.tTech).map((c) => c.tEngulfed - c.tTech).sort((a, b) => a - b);

  const at = (t: number) => {
    let best = r.series[0];
    for (const s of r.series) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
    return best;
  };
  const last = r.series[r.series.length - 1];
  const finalTraits: Record<string, number> = {};
  TRAITS.forEach((name, i) => (finalTraits[name] = round(last?.meanGenome[i] ?? NaN)));

  return {
    seed: r.params.seed,
    expectedOrigins: round(r.expectedOrigins),
    origins: r.civs.length,
    saturated: r.saturated,
    truncated: r.truncated,
    fates,
    observers: obs.length,
    silentFrac: round(obs.length ? silent / obs.length : NaN),
    presentObservers: present.length,
    presentSilentFrac: round(present.length ? presentSilent / present.length : NaN),
    medianWarning: round(warnings.length ? warnings[warnings.length >> 1] : NaN),
    engulfedFrac: round(obs.length ? warnings.length / obs.length : NaN),
    settledAtPresent: round(r.series.length ? at(age).settled : NaN),
    settledAtEnd: round(last?.settled ?? NaN),
    lineagesAtEnd: last?.lineagesAlive ?? 0,
    finalTraits,
    originsObservableUniverse: Number((r.expectedOrigins * r.universe.scaleToObservable).toPrecision(3)),
    polities: r.polities.node.length,
    tally: r.tally,
    events: r.events,
    runtimeMs: Math.round(r.runtimeMs),
  };
}

function round(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x;
}

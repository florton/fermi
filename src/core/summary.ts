/**
 * The numbers a run is for, without the bulk arrays. This is what the CLI prints
 * and what a sweep writes one row of.
 */

import { buildStepTable, emergenceByClass, makeLife } from './biology.ts';
import { makeCosmology } from './cosmology.ts';
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
  /** Observers that saw no other civilisation, inside the box or estimated beyond it. */
  silentFrac: number;
  /** Same, counting only what is inside half the box. */
  silentInBoxFrac: number;
  /** Same, for observers arising within 1 Gyr of the present day — the ones placed like us. */
  presentObservers: number;
  presentSilent: number;
  presentSilentFrac: number;
  /**
   * Share of technological species arising in the present window that orbit a
   * G star, computed exactly from the biology rather than counted.
   */
  gShareNow: number;
  /**
   * The likelihood of being us, under the self-sampling assumption: the
   * fraction of all observers who arise in the present window around a G star
   * and see an empty sky. Star class doesn't affect what a civ sees, so this is
   * (silent present observers ÷ all observers) × gShareNow. Pool across seeds by
   * summing numerators and denominators, not by averaging this.
   */
  usLikeFrac: number;
  /**
   * The same observers counted rather than as a fraction, scaled to the
   * observable universe — the likelihood under the self-indication assumption,
   * which also favours universes with more observers in total.
   */
  usLikeObservable: number;
  /**
   * "They're already here, hidden," as a number: of observers who saw an empty
   * sky, the fraction whose own galaxy group someone else already held. Over all
   * time and for the present window.
   */
  silentHosted: number;
  alreadyHereGivenSilent: number;
  presentSilentHosted: number;
  /**
   * Is an empty sky just crude telescopes? Of observers silent at first light
   * that lived to look again a billion years later, with the telescopes they had
   * by then, the fraction that still saw nobody. And of those that did find
   * someone, the median wait, Gyr.
   */
  stillSilentFrac: number;
  stillSilentOf: number;
  medianWaitToSee: number;
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

const cosmo = makeCosmology();

export function summarize(r: SimResult): Summary {
  const fates: Record<string, number> = {};
  for (const f of FATES) fates[f] = 0;
  for (const c of r.civs) fates[c.fate]++;

  const obs = r.civs.filter((c) => c.saw);
  const isSilent = (c: (typeof obs)[number]) => c.saw!.lineages === 0 && !c.saw!.far;
  const silent = obs.filter(isSilent).length;
  const silentInBox = obs.filter((c) => c.saw!.lineages === 0).length;
  const age = r.cosmology.age;
  const present = obs.filter((c) => Math.abs(c.tTech - age) < 1);
  const presentSilent = present.filter(isSilent).length;
  const silentHosted = obs.filter((c) => isSilent(c) && c.saw!.hostHere).length;
  const presentSilentHosted = present.filter((c) => isSilent(c) && c.saw!.hostHere).length;
  const life = makeLife(r.params, cosmo, Math.max(r.params.tEnd, age + 1) + 1);
  const byClass = emergenceByClass(r.params, life, buildStepTable(r.params, Math.min(r.params.tEnd, 60) + 1), age - 1, age + 1);
  const total = byClass.reduce((a, b) => a + b, 0);
  const g = r.params.starClasses.findIndex((c) => c.name === 'G');
  const gShareNow = total > 0 && g >= 0 ? byClass[g] / total : NaN;
  const warnings = obs.filter((c) => c.tEngulfed > c.tTech).map((c) => c.tEngulfed - c.tTech).sort((a, b) => a - b);
  // Silent at first light, and the question settled: found someone later, or looked a billion years on and still saw nobody.
  const settledSilence = obs.filter((c) => isSilent(c) && (c.firstSeen > c.tTech || c.lastLook >= c.tTech + 0.999));
  const stillSilent = settledSilence.filter((c) => Number.isNaN(c.firstSeen)).length;
  const waits = obs.filter((c) => c.firstSeen > c.tTech).map((c) => c.firstSeen - c.tTech).sort((a, b) => a - b);

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
    silentInBoxFrac: round(obs.length ? silentInBox / obs.length : NaN),
    presentObservers: present.length,
    presentSilent,
    presentSilentFrac: round(present.length ? presentSilent / present.length : NaN),
    gShareNow: Number(gShareNow.toPrecision(4)),
    usLikeFrac: obs.length ? Number(((presentSilent / obs.length) * gShareNow).toPrecision(4)) : NaN,
    usLikeObservable: Number((presentSilent * gShareNow * r.universe.scaleToObservable).toPrecision(4)),
    silentHosted,
    alreadyHereGivenSilent: round(silent ? silentHosted / silent : NaN),
    presentSilentHosted,
    stillSilentFrac: round(settledSilence.length ? stillSilent / settledSilence.length : NaN),
    stillSilentOf: settledSilence.length,
    medianWaitToSee: round(waits.length ? waits[waits.length >> 1] : NaN),
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

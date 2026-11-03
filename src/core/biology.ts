/**
 * From star formation to radio telescopes, without simulating a single cell.
 *
 * Pruning, level two. Every star formed is a lottery ticket, and there are
 * ~10²² of them; almost none win. So instead of instantiating planets, compute
 * analytically how many technological species a batch of newly formed stars is
 * expected to produce, and instantiate only those.
 *
 * The model is Carter's "hard steps": life must pass a sequence of stages
 * (abiogenesis, complex cells, ...), each a random waiting time with its own
 * rate, and all of them must finish before the planet stops being habitable.
 * The chance of that is the CDF of the summed waiting times evaluated at the
 * habitable window, which is computed once by convolution. Hard steps have a
 * signature: the rarer they are, the more completions crowd toward the end of
 * the window, whatever the individual rates. That is one reason to suspect
 * Earth's steps were hard — we arrived late in our own window.
 *
 * Radiation hazards (gamma-ray bursts, nearby supernovae) are facts of nature
 * layered on top, two of them, both Poisson rates that track the cosmic star
 * formation rate, so they were roughly ten times worse at cosmic noon than now:
 *
 *   true sterilization  everything dies; the planet's chance is over.
 *   complex-life wipe   animals and plants go, microbes survive. Only the
 *                       later steps are exposed: the stretch from the last
 *                       step microbes can carry (params.microbialSteps) to
 *                       technology. Hard steps conditioned on finishing in time
 *                       are spread roughly evenly through the run (Carter), so
 *                       that stretch starts a predictable fraction of the way in.
 *
 * After a wipe, the later steps could in principle be repeated, but with hard
 * steps a second run almost never finishes in time, so a hit during the exposed
 * stretch ends that attempt. Ordinary mass extinctions cost a few Myr of
 * recovery — noise at these scales — and aren't modelled.
 */

import { MPC_PER_GLY, type Cosmology } from './cosmology.ts';
import type { SimParams, StarClass } from './params.ts';
import { pickCumulative, poisson, type Rng } from './rng.ts';
import type { Universe } from './universe.ts';

export interface StepTable {
  readonly dt: number;
  /** F[k] = P(all steps done by τ = minDelay + k·dt). */
  readonly F: Float64Array;
  readonly minDelay: number;
  /** P(all steps done within τ). */
  cdf(tau: number): number;
  /** τ drawn from the completion time, conditioned on τ ≤ T. */
  sampleWithin(T: number, rng: Rng): number;
}

export function buildStepTable(p: SimParams, tauMax: number, dt = 0.05): StepTable {
  const K = Math.ceil(tauMax / dt) + 1;
  // Probability mass of each step's waiting time in each bin, convolved step by step.
  let acc: Float64Array | null = null;
  for (const step of p.hardSteps) {
    const rate = Math.pow(10, step.log10Rate);
    const binMass = -Math.expm1(-rate * dt);
    const m = new Float64Array(K);
    for (let k = 0; k < K; k++) m[k] = Math.exp(-rate * k * dt) * binMass;
    if (!acc) {
      acc = m;
      continue;
    }
    const out = new Float64Array(K);
    for (let i = 0; i < K; i++) {
      const ai = acc[i];
      if (ai === 0) continue;
      for (let j = 0; i + j < K; j++) out[i + j] += ai * m[j];
    }
    acc = out;
  }
  const F = new Float64Array(K);
  if (acc) {
    let s = 0;
    for (let k = 0; k < K; k++) F[k] = s += acc[k];
  } else F.fill(1);

  const minDelay = p.minDelay;
  const cdf = (tau: number) => {
    const x = (tau - minDelay) / dt;
    if (x <= 0) return 0;
    if (x >= K - 1) return F[K - 1];
    const i = Math.floor(x);
    return F[i] + (x - i) * (F[i + 1] - F[i]);
  };
  const sampleWithin = (T: number, rng: Rng) => {
    const u = rng() * cdf(T);
    let lo = 0;
    let hi = K - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (F[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    const below = lo > 0 ? F[lo - 1] : 0;
    const frac = F[lo] > below ? (u - below) / (F[lo] - below) : 0;
    return minDelay + Math.max(0, lo - 1 + frac) * dt;
  };
  return { dt, F, minDelay, cdf, sampleWithin };
}

export interface Origin {
  /** Node the species arises in. */
  node: number;
  /** When its home planet formed, Gyr. */
  tForm: number;
  /** When it becomes technological, Gyr. */
  tTech: number;
  starClass: number;
}

export interface OriginSample {
  origins: Origin[];
  /** Expected technological origins in the box over the run, before sampling. */
  expected: number;
  /** True if `expected` blew through maxCivs and the sample was cut short. */
  saturated: boolean;
}

/** Rocky-planet formation relative to today, from cumulative star formation as a metallicity proxy. */
export function metalFactor(cosmo: Cosmology, p: SimParams, t: number): number {
  const z = cosmo.starsFormed(t) / cosmo.starsFormed(cosmo.age);
  const norm = 1 / (1 + p.metalHalf);
  return z / (z + p.metalHalf) / norm;
}

/**
 * Expected hits between t0 and t1 for a hazard whose present-day rate is
 * `rate`. The rate follows sfr(t)/sfr(today), so its integral is a rescaled
 * stellar mass formed.
 */
function hits(cosmo: Cosmology, rate: number, t0: number, t1: number): number {
  if (rate <= 0 || t1 <= t0) return 0;
  return (rate * (cosmo.starsFormed(t1) - cosmo.starsFormed(t0))) / cosmo.sfr(cosmo.age);
}

/**
 * How far into a successful run the exposed stretch begins, as a fraction: the
 * hard steps microbes can carry, out of all hard steps plus one (Carter's even spacing).
 */
export function exposedFrom(p: SimParams): number {
  const hard = p.hardSteps.map((s) => s.log10Rate < 0);
  const total = hard.filter(Boolean).length;
  const carried = hard.slice(0, p.microbialSteps).filter(Boolean).length;
  return total === 0 ? 0 : carried / (total + 1);
}

export const hasRadiation = (p: SimParams) => p.sterilizeRate > 0 || p.resetRate > 0;

/** Chance a biosphere formed at tf reaches technology at tf + τ without a fatal hit. */
export function survivesRadiation(cosmo: Cosmology, p: SimParams, tf: number, tau: number): number {
  if (!hasRadiation(p)) return 1;
  const tTech = tf + tau;
  return Math.exp(-hits(cosmo, p.sterilizeRate, tf, tTech) - hits(cosmo, p.resetRate, tf + exposedFrom(p) * tau, tTech));
}

/** Habitable-zone rocky planets formed per comoving Mpc³ per Gyr at time t. */
export function habitableFormationRate(cosmo: Cosmology, p: SimParams, t: number): number {
  return cosmo.sfr(t) * p.habitablePerMsun * metalFactor(cosmo, p, t);
}

/**
 * Expected technological emergences per comoving Mpc³ inside [t0, t1], split by
 * star class. Exact up to the tables' resolution — no sampling — which matters
 * because the classes we care about (G stars, like ours) can be rare enough
 * that counting sampled origins would be all noise.
 */
export function emergenceByClass(p: SimParams, cosmo: Cosmology, table: StepTable, t0: number, t1: number): number[] {
  const out = p.starClasses.map(() => 0);
  const dt = 0.02;
  for (let tf = dt / 2; tf < t1; tf += dt) {
    const planets = habitableFormationRate(cosmo, p, tf) * dt;
    p.starClasses.forEach((cl, c) => {
      // Completion time τ must land in [t0 − tf, t1 − tf] and inside the window.
      const hi = Math.min(cl.window, t1 - tf);
      const lo = Math.max(0, t0 - tf);
      if (hi <= lo) return;
      if (!hasRadiation(p)) {
        out[c] += planets * cl.frac * cl.weight * (table.cdf(hi) - table.cdf(lo));
        return;
      }
      // With radiation hazards the survival factor depends on τ, so walk the
      // completion distribution bin by bin.
      let mass = 0;
      for (let tau = lo; tau < hi; tau += table.dt) {
        const step = Math.min(table.dt, hi - tau);
        mass += (table.cdf(tau + step) - table.cdf(tau)) * survivesRadiation(cosmo, p, tf, tau + step / 2);
      }
      out[c] += planets * cl.frac * cl.weight * mass;
    });
  }
  return out;
}

/**
 * Every technological origin in the box over the whole run, in one pass.
 *
 * The rate separates into (node mass) × (cosmic time profile), so the total for
 * the box is computed per formation epoch, drawn as one Poisson count, and each
 * success is then assigned to a node in proportion to its mass.
 */
export function sampleOrigins(p: SimParams, cosmo: Cosmology, uni: Universe, table: StepTable, rng: Rng): OriginSample {
  const boxMpc3 = Math.pow(uni.L * MPC_PER_GLY, 3);
  const classes: StarClass[] = p.starClasses;
  const cumMass = new Float64Array(uni.n);
  let s = 0;
  for (let i = 0; i < uni.n; i++) cumMass[i] = s += uni.mass[i];

  const dt = 0.05;
  const origins: Origin[] = [];
  let expected = 0;
  let saturated = false;
  const classW = new Float64Array(classes.length);
  for (let t0 = 0; t0 < p.tEnd; t0 += dt) {
    const tMid = t0 + dt / 2;
    const planets = habitableFormationRate(cosmo, p, tMid) * dt * boxMpc3;
    let total = 0;
    for (let c = 0; c < classes.length; c++) {
      const cl = classes[c];
      // Steps must finish both inside the habitable window and before the run ends.
      const T = Math.min(cl.window, p.tEnd - tMid);
      classW[c] = total += planets * cl.frac * cl.weight * table.cdf(T);
    }
    expected += total;
    if (saturated) continue;
    const count = poisson(rng, total);
    for (let k = 0; k < count; k++) {
      if (origins.length >= p.maxCivs) {
        saturated = true;
        break;
      }
      const c = pickCumulative(classW, rng);
      const tForm = t0 + rng() * dt;
      const T = Math.min(classes[c].window, p.tEnd - tForm);
      if (T <= table.minDelay) continue;
      const tTech = tForm + table.sampleWithin(T, rng);
      if (tTech >= p.tEnd) continue;
      if (rng() >= survivesRadiation(cosmo, p, tForm, tTech - tForm)) continue;
      origins.push({ node: pickCumulative(cumMass, rng), tForm, tTech, starClass: c });
    }
  }
  origins.sort((a, b) => a.tTech - b.tTech);
  // Sterilization thins the sample after the fact, so recompute the expectation exactly.
  if (hasRadiation(p)) expected =emergenceByClass(p, cosmo, table, 0, p.tEnd).reduce((a, b) => a + b, 0) * boxMpc3;
  return { origins, expected, saturated };
}

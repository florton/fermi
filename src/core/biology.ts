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
 * Stars. Each class has a mass, which sets its main-sequence lifetime
 * (≈ 10 Gyr × M^−2.5); a planet stays habitable for a fixed share of that as the
 * star brightens (params.habitableShare), so F stars give life ~3 Gyr, the Sun
 * ~6, K dwarfs ~12 and M dwarfs longer than the universe has existed. Against
 * that, M dwarfs flare for billions of years and lock their habitable planets
 * tidally, two unknowns swept as parameters rather than assumed.
 *
 * Metals. Rocky planets need elements heavier than helium, which only built up
 * as stars lived and died, so the early universe made few. Too many metals
 * make giant planets that migrate inward and wreck the inner system. Stars are
 * born across a spread of metallicities around the cosmic mean, and only the
 * middle of that range — the galactic habitable zone of Lineweaver (2004),
 * taken over all galaxies — makes safe rocky planets.
 *
 * Radiation hazards (gamma-ray bursts, nearby supernovae) are facts of nature
 * layered on top, two of them, both Poisson rates that track star formation:
 *
 *   true sterilization  everything dies; the planet's chance is over.
 *   complex-life wipe   animals and plants go, microbes survive. Only the
 *                       later steps are exposed: the stretch from the last
 *                       step microbes can carry (params.microbialSteps) to
 *                       technology. Hard steps conditioned on finishing in time
 *                       are spread roughly evenly through the run (Carter), so
 *                       that stretch starts a predictable fraction of the way in.
 *
 * Long gamma-ray bursts come almost only from metal-poor star formation, so the
 * hazards follow the metal-poor part of the star formation history: tens of
 * times worse in the young universe than its star formation rate alone says.
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

// ── Stars ──────────────────────────────────────────────────────────────────
/** Main-sequence lifetime, Gyr. */
export const mainSequenceLife = (cl: StarClass) => 10 * Math.pow(cl.mass, -2.5);
/** How long a planet around this kind of star stays habitable, Gyr. Life has this long to finish every hard step. */
export const habitableWindow = (p: SimParams, cl: StarClass) => p.habitableShare * mainSequenceLife(cl);
/** Share of this class's habitable-zone planets that survive flares and tidal locking well enough to count. */
export const classWeight = (p: SimParams, cl: StarClass) =>
  Math.pow(p.flareSurvival, cl.flare) * (1 - cl.tidalLock * (1 - p.tidalLockHabitability));

// ── Hard steps ─────────────────────────────────────────────────────────────
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

// ── Metals and radiation, tabulated once per run ───────────────────────────
export interface Life {
  /** Safe habitable-zone rocky planets formed per comoving Mpc³ per Gyr at t, before the per-class weights. */
  planetRate(t: number): number;
  /** Metal-friendliness of planet formation at t, relative to today (1 today). */
  metalFactor(t: number): number;
  /** How much more dangerous radiation is at t than today, per unit time. */
  hazardFactor(t: number): number;
  /** Chance a biosphere formed at tf reaches technology at tf + τ without a fatal hit. */
  survives(tf: number, tau: number): number;
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, |error| < 1.5×10⁻⁷). */
function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erfc = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z);
  return x >= 0 ? 1 - erfc / 2 : erfc / 2;
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

export function makeLife(p: SimParams, cosmo: Cosmology, tMax = Math.max(p.tEnd, cosmo.age) + 1): Life {
  const DT = 0.01;
  const N = Math.ceil(tMax / DT) + 1;
  const zToday = cosmo.starsFormed(cosmo.age);
  /** Mean metallicity relative to today's, using the stellar mass formed so far as the proxy. */
  const meanZ = (t: number) => cosmo.starsFormed(t) / zToday;
  // Quadrature over a log-normal spread of metallicity, ±3σ.
  const Q = 25;
  const qx = Array.from({ length: Q }, (_, i) => -3 + (6 * i) / (Q - 1));
  const qwRaw = qx.map((x) => Math.exp(-x * x / 2));
  const qwSum = qwRaw.reduce((a, b) => a + b, 0);
  const qw = qwRaw.map((w) => w / qwSum);
  const planetsAtZ = (Z: number) => (Z / (Z + p.metalHalf)) * Math.max(0, 1 - p.giantRisk * Z * Z);
  const rawMetal = (t: number) => {
    const z = meanZ(t);
    if (z <= 0) return 0;
    let s = 0;
    for (let i = 0; i < Q; i++) s += qw[i] * planetsAtZ(z * Math.pow(10, p.metalSpread * qx[i]));
    return s;
  };
  /** Share of star formation below the burst cut-off: the metal-poor part, where long GRBs happen. */
  const lowMetal = (t: number) => {
    if (p.grbMetalCut <= 0) return 1;
    const z = meanZ(t);
    if (z <= 0) return 1;
    return normalCdf(Math.log10(p.grbMetalCut / z) / Math.max(1e-3, p.metalSpread));
  };
  const metalNow = rawMetal(cosmo.age);
  const lowNow = lowMetal(cosmo.age);
  const sfrNow = cosmo.sfr(cosmo.age);

  const metal = new Float64Array(N);
  const hazard = new Float64Array(N);
  /** ∫ hazardFactor dt from 0, for Poisson hit counts. */
  const hazardCum = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = i * DT;
    metal[i] = rawMetal(t) / metalNow;
    hazard[i] = (cosmo.sfr(t) * lowMetal(t)) / (sfrNow * lowNow);
    if (i > 0) hazardCum[i] = hazardCum[i - 1] + (DT * (hazard[i - 1] + hazard[i])) / 2;
  }
  const lookup = (tab: Float64Array, t: number) => {
    if (t <= 0) return tab[0];
    const x = t / DT;
    if (x >= N - 1) return tab[N - 1];
    const i = Math.floor(x);
    return tab[i] + (x - i) * (tab[i + 1] - tab[i]);
  };
  /** Expected hits between t0 and t1 for a hazard whose present-day rate is `rate`. */
  const hits = (rate: number, t0: number, t1: number) => (rate <= 0 || t1 <= t0 ? 0 : rate * (lookup(hazardCum, t1) - lookup(hazardCum, t0)));
  const exposed = exposedFrom(p);
  const radiation = hasRadiation(p);

  return {
    planetRate: (t) => cosmo.sfr(t) * p.habitablePerMsun * lookup(metal, t),
    metalFactor: (t) => lookup(metal, t),
    hazardFactor: (t) => lookup(hazard, t),
    survives: (tf, tau) => {
      if (!radiation) return 1;
      const tTech = tf + tau;
      return Math.exp(-hits(p.sterilizeRate, tf, tTech) - hits(p.resetRate, tf + exposed * tau, tTech));
    },
  };
}

// ── Origins ────────────────────────────────────────────────────────────────
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

/**
 * Expected technological emergences per comoving Mpc³ inside [t0, t1], split by
 * star class. Exact up to the tables' resolution — no sampling — which matters
 * because the classes we care about (G stars, like ours) can be rare enough
 * that counting sampled origins would be all noise.
 */
export function emergenceByClass(p: SimParams, life: Life, table: StepTable, t0: number, t1: number): number[] {
  const out = p.starClasses.map(() => 0);
  const windows = p.starClasses.map((cl) => habitableWindow(p, cl));
  const weights = p.starClasses.map((cl) => cl.frac * classWeight(p, cl));
  const radiation = hasRadiation(p);
  const dt = 0.02;
  for (let tf = dt / 2; tf < t1; tf += dt) {
    const planets = life.planetRate(tf) * dt;
    for (let c = 0; c < out.length; c++) {
      // Completion time τ must land in [t0 − tf, t1 − tf] and inside the window.
      const hi = Math.min(windows[c], t1 - tf);
      const lo = Math.max(0, t0 - tf);
      if (hi <= lo) continue;
      if (!radiation) {
        out[c] += planets * weights[c] * (table.cdf(hi) - table.cdf(lo));
        continue;
      }
      // With radiation hazards the survival factor depends on τ, so walk the
      // completion distribution bin by bin.
      let mass = 0;
      for (let tau = lo; tau < hi; tau += table.dt) {
        const step = Math.min(table.dt, hi - tau);
        mass += (table.cdf(tau + step) - table.cdf(tau)) * life.survives(tf, tau + step / 2);
      }
      out[c] += planets * weights[c] * mass;
    }
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
export function sampleOrigins(p: SimParams, life: Life, uni: Universe, table: StepTable, rng: Rng): OriginSample {
  const boxMpc3 = Math.pow(uni.L * MPC_PER_GLY, 3);
  const classes: StarClass[] = p.starClasses;
  const windows = classes.map((cl) => habitableWindow(p, cl));
  const weights = classes.map((cl) => cl.frac * classWeight(p, cl));
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
    const planets = life.planetRate(tMid) * dt * boxMpc3;
    let total = 0;
    for (let c = 0; c < classes.length; c++) {
      // Steps must finish both inside the habitable window and before the run ends.
      const T = Math.min(windows[c], p.tEnd - tMid);
      classW[c] = total += planets * weights[c] * table.cdf(T);
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
      const T = Math.min(windows[c], p.tEnd - tForm);
      if (T <= table.minDelay) continue;
      const tTech = tForm + table.sampleWithin(T, rng);
      if (tTech >= p.tEnd) continue;
      if (rng() >= life.survives(tForm, tTech - tForm)) continue;
      origins.push({ node: pickCumulative(cumMass, rng), tForm, tTech, starClass: c });
    }
  }
  origins.sort((a, b) => a.tTech - b.tTech);
  // Radiation thins the sample after the fact, so recompute the expectation exactly.
  if (hasRadiation(p)) expected = emergenceByClass(p, life, table, 0, p.tEnd).reduce((a, b) => a + b, 0) * boxMpc3;
  return { origins, expected, saturated };
}

/**
 * Technology, energy and sight. Shared by the simulation and the viewer, so
 * both draw and judge the same universe.
 *
 * Technology is a continuous maturity, m, that a lineage climbs after it first
 * leaves home. Whole numbers are named milestones (interstellar probes, Dyson
 * swarms, relativistic weapons, galactic engineering), reached at times drawn
 * once per lineage; between two milestones every capability moves smoothly
 * from one's value to the next. So the tier at any moment, including the past
 * that a light cone needs, is a lookup rather than a simulation.
 *
 * Energy. A holding harnesses mass × filled × conversion of its group's
 * starlight: `filled` is the share of the group's galaxies settled so far (it
 * spreads galaxy by galaxy, see `filled`), and `conversion` the share of each
 * settled galaxy's starlight the technology can capture. In units where a
 * fully harnessed average group is 1, that is what wins fights. Kardashev
 * numbers are this power in watts on his log scale (K = (log₁₀ W − 6)/10).
 *
 * Sight. What gives a civilisation away is waste heat: power used has to be
 * radiated, at a few hundred kelvin, in the mid-infrared, which is what WISE and
 * G-HAT looked for. A galaxy shows its heat fraction f = conversion × visibility
 * (stealth, inwardness) of its starlight. An observer sees it if
 *
 *   f ≥ contrast   its telescopes can tell that heat from natural dust, and
 *   d_L ≤ R·√(gain·f)   it is bright enough at luminosity distance d_L.
 *
 * One galaxy is enough: the group as a whole needn't be lit. Present-day
 * humans have gain 1 and contrast params.humanContrast; each milestone brings
 * bigger telescopes and better spectra.
 */

import type { SimParams } from './params.ts';

export interface Tier {
  name: string;
  /** Multiplier on the genome's probe speed. */
  speed: number;
  /** log₁₀ of the share of a settled galaxy's starlight turned into power, and so waste heat, once built out. */
  logConversion: number;
  /** log₁₀ of telescope flux sensitivity relative to a present-day human all-sky survey. */
  logGain: number;
  /** log₁₀ of the smallest waste-heat fraction the telescopes can tell from natural dust. */
  logContrast: number;
  /** Can launch relativistic strikes at visible targets (see sim.ts). */
  strikes: boolean;
}

export const TIERS: Tier[] = [
  // Settling, not yet re-engineering: a thousandth of the starlight, invisible to anyone like us.
  { name: 'interstellar probes', speed: 0.3, logConversion: -3, logGain: 1, logContrast: -1.3, strikes: false },
  { name: 'Dyson swarms', speed: 0.6, logConversion: -0.5, logGain: 4, logContrast: -2, strikes: false },
  { name: 'relativistic kinetic weapons', speed: 1, logConversion: -0.22, logGain: 6, logContrast: -2.5, strikes: true },
  { name: 'galactic engineering', speed: 1, logConversion: 0, logGain: 8, logContrast: -3, strikes: true },
];

export const STRIKE_TIER = TIERS.findIndex((t) => t.strikes);

/** Index of the milestone reached by `t`, given the times each was reached. -1 before the first. */
export function tierAt(tierTimes: ArrayLike<number>, t: number): number {
  let k = -1;
  for (let i = 0; i < tierTimes.length; i++) if (tierTimes[i] <= t) k = i;
  return k;
}

/** Continuous maturity at t: milestone k plus the fraction of the way to k+1. -1 before the first. */
export function maturity(tierTimes: ArrayLike<number>, t: number): number {
  const n = tierTimes.length;
  if (n === 0 || !(t >= tierTimes[0])) return -1;
  for (let k = 0; k < n - 1; k++) if (t < tierTimes[k + 1]) return k + (t - tierTimes[k]) / (tierTimes[k + 1] - tierTimes[k]);
  return n - 1;
}

type Smooth = 'speed' | 'logConversion' | 'logGain' | 'logContrast';
const LAST = TIERS.length - 1;
function along(key: Smooth, m: number): number {
  if (m <= 0) return TIERS[0][key];
  if (m >= LAST) return TIERS[LAST][key];
  const k = Math.floor(m);
  const f = m - k;
  return TIERS[k][key] * (1 - f) + TIERS[k + 1][key] * f;
}

export const speedFactor = (m: number) => along('speed', m);
/** Share of a settled galaxy's starlight harnessed at maturity m. */
export const conversionAt = (m: number) => Math.pow(10, along('logConversion', m));

export interface Sensor {
  /** Flux sensitivity relative to a present-day all-sky infrared survey. */
  gain: number;
  /** Smallest waste-heat fraction it can tell from natural emission. */
  contrast: number;
}
export const sensorAt = (m: number): Sensor => ({ gain: Math.pow(10, along('logGain', m)), contrast: Math.pow(10, along('logContrast', m)) });
export const humanSensor = (p: SimParams): Sensor => ({ gain: 1, contrast: p.humanContrast });
/**
 * Telescopes of a species that never left home, `since` Gyr after it first
 * looked up: they improve as it learns, up to what a Dyson swarm around its own
 * star can build, starting from present-day human.
 */
export function homeSensor(p: SimParams, since: number): Sensor {
  const m = Math.min(1, Math.max(0, since / p.techStep));
  const s = sensorAt(m);
  // Blend from today's instruments to the probe-era ones over the first stretch.
  const h = humanSensor(p);
  const f = Math.min(1, since / (0.1 * p.techStep));
  return { gain: Math.pow(h.gain, 1 - f) * Math.pow(s.gain, f), contrast: Math.pow(h.contrast, 1 - f) * Math.pow(s.contrast, f) };
}

/**
 * Telescopes of an expanding lineage first technological at tTech: its own
 * technology's, and never worse than what it would have built staying home.
 */
export function lineageSensor(p: SimParams, tTech: number, tierTimes: ArrayLike<number>, t: number): Sensor {
  const home = homeSensor(p, t - tTech);
  const m = maturity(tierTimes, t);
  if (m < 0) return home;
  const own = sensorAt(m);
  return { gain: Math.max(home.gain, own.gain), contrast: Math.min(home.contrast, own.contrast) };
}

/**
 * Share of one settled galaxy's starlight that shows as waste heat: what the
 * technology harnesses, ramped up while it is built out, times the visibility
 * that stealth and inwardness leave. 0 before spacefaring.
 */
export function heatFraction(m: number, builtFor: number, conversionTime: number, visibility: number): number {
  if (m < 0 || builtFor < 0) return 0;
  const ramp = conversionTime > 0 ? Math.min(1, builtFor / conversionTime) : 1;
  return conversionAt(m) * ramp * visibility;
}

/**
 * Share of a group's galaxies settled `heldFor` after the first arrival, if
 * the settled region spreads outward at a steady speed and crosses the whole
 * group in `fillTime`: a growing sphere, so the share goes as time cubed.
 */
export function filled(heldFor: number, fillTime: number): number {
  if (heldFor <= 0) return 0;
  if (fillTime <= 0) return 1;
  const x = heldFor / fillTime;
  return x >= 1 ? 1 : x * x * x;
}

/**
 * Whether a galaxy showing heat fraction f is seen from comoving distance d by
 * an observer at scale factor aObs, the light having left at aEmit. The flux
 * falls with the luminosity distance then, a_obs·d·(a_obs/a_emit): the universe
 * was smaller, and redshift dims the light.
 */
export function canSee(f: number, d: number, aEmit: number, aObs: number, detectRange: number, s: Sensor): boolean {
  if (!(f > 0) || f < s.contrast) return false;
  return aObs * d * (aObs / aEmit) <= detectRange * Math.sqrt(s.gain * f);
}

/** Farthest comoving distance anything could be seen from: heat never exceeds 1, and redshift only dims. */
export const maxSight = (detectRange: number, s: Sensor, aObs: number) => (detectRange * Math.sqrt(s.gain)) / aObs;

/** A Milky-Way-class galaxy's starlight, W (3×10¹⁰ L☉). */
export const GALAXY_WATTS = 3e10 * 3.828e26;

/** Kardashev number of a power given in units of fully harnessed average groups. */
export function kardashev(power: number, galaxiesPerNode: number): number {
  return power > 0 ? (Math.log10(power * galaxiesPerNode * GALAXY_WATTS) - 6) / 10 : NaN;
}

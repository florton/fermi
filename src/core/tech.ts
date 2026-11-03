/**
 * The technology ladder. A lineage climbs it over time after it first leaves
 * home, and every rung changes three things the Fermi question cares about:
 * how fast it spreads, how far it can see, and how bright it is.
 *
 * Brightness is waste heat. A civilisation that uses a star's or a galaxy's
 * power has to radiate it away, which is what infrared surveys look for
 * (WISE/G-HAT searched ~10⁵ galaxies for exactly this and found none above
 * ~85% conversion). So `conversion` — the fraction of a node's starlight
 * turned into heat — is the dial between invisible and unmistakable, and it
 * ramps up with tier and with how long a node has been held.
 *
 * Tier times are drawn once per lineage when it becomes spacefaring, so the
 * tier at any moment (including the past, which is what a light cone needs) is
 * a lookup rather than a simulation.
 */

export interface Tier {
  name: string;
  /** Multiplier on the genome's probe speed. */
  speed: number;
  /** Multiplier on detection range when this lineage looks. */
  sensor: number;
  /** Fraction of a held node's starlight converted to visible waste heat, once fully built out. */
  conversion: number;
  /** Multiplier on strength in a contested node. */
  power: number;
  /** Can launch relativistic strikes at visible targets (see sim.ts). */
  strikes: boolean;
}

export const TIERS: Tier[] = [
  { name: 'interstellar probes', speed: 0.3, sensor: 0.3, conversion: 0.02, power: 1, strikes: false },
  { name: 'Dyson swarms', speed: 0.6, sensor: 0.6, conversion: 0.3, power: 1.5, strikes: false },
  { name: 'relativistic kinetic weapons', speed: 1, sensor: 1, conversion: 0.6, power: 2, strikes: true },
  { name: 'galactic engineering', speed: 1, sensor: 2, conversion: 1, power: 3, strikes: true },
];

export const STRIKE_TIER = TIERS.findIndex((t) => t.strikes);

/** Index of the tier reached by `t`, given the times each tier was reached. -1 before the first. */
export function tierAt(tierTimes: ArrayLike<number>, t: number): number {
  let k = -1;
  for (let i = 0; i < tierTimes.length; i++) if (tierTimes[i] <= t) k = i;
  return k;
}

/**
 * Waste-heat luminosity of a held node, in units where a fully converted
 * average-mass node is 1.
 */
export function luminosity(tier: number, heldFor: number, conversionTime: number, visibility: number, mass: number): number {
  if (tier < 0 || heldFor < 0) return 0;
  const ramp = conversionTime > 0 ? Math.min(1, heldFor / conversionTime) : 1;
  return TIERS[tier].conversion * ramp * visibility * mass;
}
